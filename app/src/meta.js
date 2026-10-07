/**
 * GET /meta, cached for the session.
 *
 * Districts, order statuses, currency and price decimals all come from
 * WooCommerce per request, so the app hardcodes none of them - a state
 * relabelled upstream or a status registered by another plugin propagates with
 * no app rebuild. Nothing in it changes during normal operation, so it is
 * fetched once and reused, not re-requested per screen.
 *
 * shipping_rates is the plugin's own flat rate table rather than anything
 * WooCommerce knows about. It is here so the form can show the expected
 * shipping on an order that has not been saved yet; the rates are NOT
 * duplicated in this app, and a rate edited in the plugin reaches the app with
 * no rebuild.
 */

import { fetchMeta } from './api.js'

/*
 * Versioned. A session that cached /meta before shipping_rates existed would
 * otherwise keep serving a payload without it, and the shipping preview would
 * stay blank until the tab was closed - for exactly the people who upgraded.
 */
const STORAGE_KEY = 'orderops.meta.v2'

/**
 * WooCommerce's internal abandoned-cart status. /meta returning it is correct -
 * the endpoint reports what WooCommerce registers - but it is not a status
 * staff should ever set, so it is filtered here rather than server-side.
 */
const HIDDEN_STATUSES = new Set(['checkout-draft'])

let cached = null
let inFlight = null

/**
 * sessionStorage, not localStorage: a session is exactly the caching scope the
 * API documents, and a stale district list surviving indefinitely would defeat
 * the point of reading it from WooCommerce at all.
 */
function readStored() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(meta) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
  } catch {
    // In-memory caching still applies for this page load.
  }
}

/** One {cost, label} entry, or null if it is not usable. */
function normalizeRate(raw) {
  const cost = Number(raw?.cost)
  if (!Number.isFinite(cost)) return null
  return { cost, label: String(raw?.label ?? '') || 'Shipping' }
}

function normalizeRates(raw) {
  const fallback = normalizeRate(raw?.default)
  if (!fallback) return null

  const byState = {}
  for (const [code, rate] of Object.entries(raw?.by_state || {})) {
    const parsed = normalizeRate(rate)
    if (parsed) byState[code] = parsed
  }

  return { default: fallback, byState }
}

function normalize(raw) {
  return {
    // Order is WooCommerce's own and is preserved - it is a list, not a map,
    // precisely so JSON encoding cannot reorder it.
    states: Array.isArray(raw?.states) ? raw.states : [],
    statuses: Array.isArray(raw?.statuses) ? raw.statuses : [],
    currency: typeof raw?.currency === 'string' && raw.currency ? raw.currency : 'BDT',
    priceDecimals: Number.isInteger(raw?.price_decimals) ? raw.price_decimals : 2,
    // Absent on a plugin older than 6.9. Left null rather than defaulted, so
    // the form shows no preview instead of a figure this app invented.
    shippingRates: normalizeRates(raw?.shipping_rates),
    pluginVersion: typeof raw?.plugin_version === 'string' ? raw.plugin_version : '',
  }
}

/**
 * Load /meta once. Concurrent callers share the same request.
 *
 * @param {AbortSignal} [signal]
 */
export async function loadMeta(signal) {
  if (cached) return cached

  const stored = readStored()
  if (stored) {
    cached = stored
    return cached
  }

  // Two screens asking at once must not produce two requests.
  if (!inFlight) {
    inFlight = fetchMeta(signal)
      .then((raw) => {
        cached = normalize(raw)
        writeStored(cached)
        return cached
      })
      .finally(() => {
        inFlight = null
      })
  }

  return inFlight
}

/** The loaded meta, or null. Call loadMeta() first. */
export function getMeta() {
  return cached
}

/** Drop the cache. Called on sign-out so a different user starts clean. */
export function clearMeta() {
  cached = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do.
  }
}

/**
 * Districts for a dropdown.
 *
 * `label` is trimmed for DISPLAY ONLY. Some WooCommerce BD labels carry
 * trailing whitespace ("Faridpur ", "Manikganj ") - that is WooCommerce's own
 * data, confirmed at 6.1. `code` is returned untouched and is the only thing
 * anything should ever match, compare or sort on.
 */
export function districts() {
  return (cached?.states || []).map((state) => ({
    code: state.code,
    label: String(state.label ?? '').trim(),
  }))
}

/**
 * Order statuses for a dropdown, minus the ones staff must not set.
 *
 * As with districts, `slug` is the key and `label` is display-only.
 */
export function orderStatuses() {
  return (cached?.statuses || [])
    .filter((status) => !HIDDEN_STATUSES.has(status.slug))
    .map((status) => ({
      slug: status.slug,
      label: String(status.label ?? '').trim(),
    }))
}

/**
 * The shipping rate the SERVER would apply for a district, or null if it would
 * apply none.
 *
 * Null for an empty district is not a shortcut: ai_apply_shipping() returns
 * early when the billing state is empty and adds no shipping line, so the
 * default rate would be a figure no saved order ever has. The default is for a
 * district that is set but not in the table.
 *
 * @param {string} code A WooCommerce BD state code, or '' for none.
 * @returns {{cost: number, label: string}|null}
 */
export function shippingRateFor(code) {
  const rates = cached?.shippingRates
  if (!rates) return null

  const state = String(code ?? '').trim()
  if (state === '') return null

  return rates.byState[state] || rates.default
}

/** Display label for a status slug, falling back to the slug itself. */
export function statusLabel(slug) {
  const match = (cached?.statuses || []).find((status) => status.slug === slug)
  return match ? String(match.label ?? '').trim() : String(slug ?? '')
}
