/**
 * The only place that talks to the aioc/v1 REST namespace.
 *
 * Every response from that namespace is JSON, every error is shaped
 * { code, message, data: { status } }, and money is always a bare numeric
 * string the client formats. See docs/PROJECT-STATE.md.
 */

import { getCredential, clearCredential } from './auth.js'

const BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

/** True when the app has been configured at all. main.js checks this on boot. */
export function isConfigured() {
  return BASE !== ''
}

export function apiBase() {
  return BASE
}

/**
 * A failure with the API, whatever its cause - an HTTP error carrying a WP
 * error body, a transport failure, or a response that was not JSON. One type
 * so callers need one catch.
 */
export class ApiError extends Error {
  constructor(message, { code = 'aioc_app_error', status = 0, retryAfter = 0 } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }

  /** A transport-level failure, which in a browser is also what CORS looks like. */
  get isNetwork() {
    return this.code === 'aioc_app_network'
  }
}

/**
 * Basic auth header, UTF-8 safe.
 *
 * btoa() throws on any code point above U+00FF, so the string is encoded to
 * UTF-8 bytes first. This is not hypothetical - a Bangla display name or
 * password would break a naive btoa(`${user}:${pass}`), and the failure would
 * look like a login bug rather than an encoding one. PHP reads the decoded
 * bytes, so UTF-8 is what the server expects.
 */
function basicAuthHeader(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function buildUrl(path, params) {
  const url = new URL(`${BASE}${path}`)
  for (const [key, value] of Object.entries(params || {})) {
    // Skip empties rather than sending status= or search= blank. The endpoints
    // treat an absent param and an empty one the same way, but leaving them
    // out keeps request URLs readable in the network panel.
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * Turn a non-2xx response into an ApiError, preferring the API's own message.
 *
 * @param {Response} response
 * @param {any} body Parsed body, or null when it was not JSON.
 */
function errorFromResponse(response, body) {
  const retryHeader = Number(response.headers.get('Retry-After'))
  const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0
    ? retryHeader
    : Number(body?.data?.retry_after) || 0

  // WP error bodies carry a human-readable message; the throttle response from
  // /token is shaped identically on purpose, so this covers it too.
  if (body && typeof body.message === 'string' && body.message !== '') {
    return new ApiError(body.message, {
      code: typeof body.code === 'string' ? body.code : 'aioc_app_error',
      status: response.status,
      retryAfter,
    })
  }

  return new ApiError(`Request failed (HTTP ${response.status}).`, {
    code: 'aioc_app_error',
    status: response.status,
    retryAfter,
  })
}

/**
 * @param {string} path Route path, e.g. '/orders'.
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.params] Query string values.
 * @param {object} [options.body] JSON body.
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.authenticated] False only for POST /token.
 */
async function request(path, options = {}) {
  const {
    method = 'GET',
    params,
    body,
    signal,
    authenticated = true,
  } = options

  if (!isConfigured()) {
    throw new ApiError('VITE_API_BASE is not set. Copy app/.env.example to app/.env.local.', {
      code: 'aioc_app_unconfigured',
    })
  }

  const headers = { Accept: 'application/json' }

  if (authenticated) {
    const credential = getCredential()
    if (!credential) {
      throw new ApiError('You are signed out.', { code: 'aioc_app_signed_out', status: 401 })
    }
    headers.Authorization = basicAuthHeader(credential.username, credential.password)
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let response
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never cookies. If WordPress sees a logged-in auth cookie on a REST
      // request without a nonce, rest_cookie_check_errors() rejects it with
      // rest_cookie_invalid_nonce - a 403 that reads as a permissions bug and
      // is not one. Basic auth is the only credential this app sends.
      credentials: 'omit',
      signal,
    })
  } catch (error) {
    // An abort is the caller's own doing (a superseded search), so it must
    // propagate untouched rather than being reported as a failure.
    if (error?.name === 'AbortError') throw error

    // fetch() rejects with a bare TypeError for DNS failures, offline, and -
    // indistinguishably - a blocked CORS preflight. Given the App Origin
    // setting holds a single origin, CORS is the likeliest cause in practice,
    // so the message names it.
    throw new ApiError(
      'Could not reach the server. Check the connection, and that the App Origin setting matches this origin.',
      { code: 'aioc_app_network' },
    )
  }

  // 204 has no body; nothing in aioc/v1 returns one today, but parsing it
  // would throw.
  const text = response.status === 204 ? '' : await response.text()

  let parsed = null
  if (text !== '') {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const error = errorFromResponse(response, parsed)

    // A stored application password that no longer authenticates - revoked in
    // wp-admin, or the account changed. It will fail identically on every
    // subsequent request, so drop it and let the app return to the login
    // screen rather than looping on errors.
    //
    // Only for authenticated requests: a 401 from /token means "wrong
    // password", which must not touch stored state.
    if (response.status === 401 && authenticated) {
      clearCredential()
      window.dispatchEvent(new CustomEvent('orderops:signedout'))
    }

    throw error
  }

  if (parsed === null && text !== '') {
    throw new ApiError('The server returned a response that was not JSON.', {
      code: 'aioc_app_bad_response',
      status: response.status,
    })
  }

  return parsed
}

/**
 * POST /token - exchange an account username and password for an application
 * password. The only unauthenticated call the app makes.
 *
 * The account password is passed straight through and never stored; only the
 * response is kept. See auth.js.
 */
export function login(username, password, signal) {
  return request('/token', {
    method: 'POST',
    body: { username, password },
    authenticated: false,
    signal,
  })
}

/** GET /meta - states, statuses, currency, price decimals. */
export function fetchMeta(signal) {
  return request('/meta', { signal })
}

/**
 * GET /orders - paginated list.
 *
 * Returns { orders, total, total_pages, page }. per_page is clamped server-side
 * to 1..50 rather than rejected.
 *
 * Note `search` resolves a phone number or a customer name, NOT an order id: a
 * numeric term that is not a valid BD mobile falls through to the name search.
 * That is a recorded decision, not an oversight - staff search by phone.
 */
export function fetchOrders({ page = 1, perPage = 20, search = '', status = '' } = {}, signal) {
  return request('/orders', {
    params: { page, per_page: perPage, search, status },
    signal,
  })
}

/** GET /orders/{id} - full order. Used by step 6; here so the client is complete. */
export function fetchOrder(id, signal) {
  return request(`/orders/${encodeURIComponent(id)}`, { signal })
}

/** GET /ping - auth and CORS smoke test. */
export function ping(signal) {
  return request('/ping', { signal })
}
