/**
 * Proves the contract views/orders.js depends on when it cancels an in-flight
 * request per keystroke:
 *
 *   - an aborted request throws something with name === 'AbortError', which the
 *     view must silently ignore
 *   - a genuine failure throws an ApiError whose message is worth showing
 *
 * Confusing the two is the kind of defect that hides: the symptom is either an
 * error flashing on every keystroke, or a real outage that looks like silence.
 *
 * Run with `npm test` from app/. No dependencies and no browser - it exercises
 * the real src/api.js against a throwaway localhost server with real
 * AbortControllers.
 *
 * api.js is copied to a temp directory with exactly two substitutions:
 * import.meta.env (which only Vite defines) becomes a literal base URL, and
 * the ./auth.js specifier gains its copy's name. Nothing else about the module
 * under test is changed.
 */

import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'orderops-api-test-'))

// ---- test server -----------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  // fetchOrders() hits /orders, so this is the path the abort tests race.
  // Slow enough that the client always aborts first.
  if (url.pathname.endsWith('/orders')) {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ orders: [], total: 0, total_pages: 1, page: 1 }))
    }, 2000)
    return
  }

  // Headers and a partial body, then never finish - so an abort lands while
  // response.text() is awaiting rather than while fetch() is.
  if (url.pathname.endsWith('/stalledbody')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"orders":[')
    return
  }

  if (url.pathname.endsWith('/fail')) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      code: 'aioc_exploded',
      message: 'The server exploded.',
      data: { status: 500 },
    }))
    return
  }

  // A wrong password. Distinct from /unauthorized so the two 401 paths -
  // 'your stored credential is dead' and 'you typed the wrong password' - can
  // be told apart.
  if (url.pathname.endsWith('/token')) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      code: 'aioc_invalid_credentials',
      message: 'Invalid username or password.',
      data: { status: 401 },
    }))
    return
  }

  if (url.pathname.endsWith('/unauthorized')) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      code: 'aioc_rest_forbidden',
      message: 'Sorry, you are not allowed to do that.',
      data: { status: 401 },
    }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ orders: [], total: 0, total_pages: 1, page: 1 }))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const goodBase = `http://127.0.0.1:${server.address().port}`
// Nothing listens on port 1: a real connection failure, which is also what a
// blocked CORS preflight looks like to fetch().
const badBase = 'http://127.0.0.1:1'

// ---- importable copies of the real modules ---------------------------------

function prepare(base, suffix) {
  fs.writeFileSync(
    path.join(WORK, `auth${suffix}.mjs`),
    fs.readFileSync(path.join(SRC, 'auth.js'), 'utf8'),
  )

  let api = fs.readFileSync(path.join(SRC, 'api.js'), 'utf8')

  const before = api
  api = api.replace('import.meta.env.VITE_API_BASE', JSON.stringify(base))
  assert.notEqual(api, before, 'expected to find import.meta.env.VITE_API_BASE in api.js')

  api = api.replace("'./auth.js'", `'./auth${suffix}.mjs'`)
  assert.ok(api.includes(`auth${suffix}.mjs`), 'expected to rewrite the auth.js import')

  const file = path.join(WORK, `api${suffix}.mjs`)
  fs.writeFileSync(file, api)

  return pathToFileURL(file).href
}

// ---- the browser globals these modules touch -------------------------------

const store = new Map()
const events = []

globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  dispatchEvent: (event) => events.push(event.type),
}

globalThis.CustomEvent = class CustomEvent {
  constructor(type) {
    this.type = type
  }
}

const okUrl = prepare(goodBase, '_ok')
const badUrl = prepare(badBase, '_bad')

const api = await import(okUrl)
const apiOffline = await import(badUrl)
const auth = await import(pathToFileURL(path.join(WORK, 'auth_ok.mjs')).href)

const CREDENTIAL = { username: 'staff', password: 'abcd efgh ijkl mnop', user_id: 1 }

/**
 * The predicate from views/orders.js's catch. Asserted against the real view
 * source at the end, so this test cannot quietly drift from the code it is
 * meant to protect.
 */
function classify(error) {
  if (error?.name === 'AbortError') return 'ignored'
  if (error?.status === 401) return 'ignored'
  return `shown: ${error?.message || 'Could not load orders.'}`
}

// Authenticated requests need a stored credential, or request() short-circuits
// before reaching the network and every case below tests the wrong thing.
auth.setCredential(CREDENTIAL)

const results = []

function check(name, actual, expected) {
  results.push({ name, pass: actual === expected, actual, expected })
}

// 1. Abort while fetch() is in flight - every superseded keystroke.
{
  const controller = new AbortController()
  const promise = api.fetchOrders({ page: 1 }, controller.signal)
  setTimeout(() => controller.abort(), 30)

  try {
    await promise
    check('abort in flight throws', 'resolved', 'threw')
  } catch (error) {
    check('abort in flight -> name is AbortError', error?.name, 'AbortError')
    check('abort in flight -> not an ApiError', error instanceof api.ApiError, false)
    check('abort in flight -> ignored by the view', classify(error), 'ignored')
  }
}

// 2. Abort while the body is still streaming. Worth its own case: that path
//    does not pass through api.js's try/catch around fetch().
{
  const controller = new AbortController()
  const promise = api.fetchOrder('stalledbody', controller.signal)
  setTimeout(() => controller.abort(), 120)

  try {
    await promise
    check('abort mid-body throws', 'resolved', 'threw')
  } catch (error) {
    check('abort mid-body -> name is AbortError', error?.name, 'AbortError')
    check('abort mid-body -> ignored by the view', classify(error), 'ignored')
  }
}

// 3. A genuine HTTP failure carrying a WP error body.
{
  try {
    await api.fetchOrder('fail')
    check('500 throws', 'resolved', 'threw')
  } catch (error) {
    check('500 -> is an ApiError', error instanceof api.ApiError, true)
    check('500 -> not mistaken for an abort', error?.name === 'AbortError', false)
    check('500 -> status', error?.status, 500)
    check('500 -> keeps the API error code', error?.code, 'aioc_exploded')
    check('500 -> message is shown', classify(error), 'shown: The server exploded.')
  }
}

// 4. A transport failure: offline, DNS, or a blocked CORS preflight.
{
  try {
    await apiOffline.fetchOrders({ page: 1 })
    check('transport failure throws', 'resolved', 'threw')
  } catch (error) {
    check('network -> is an ApiError', error instanceof apiOffline.ApiError, true)
    check('network -> flagged as network', error?.isNetwork, true)
    check('network -> not mistaken for an abort', error?.name === 'AbortError', false)
    check('network -> message names App Origin', /App Origin/.test(error?.message || ''), true)
    check('network -> message is shown', classify(error).startsWith('shown: '), true)
  }
}

// 5. A 401 on an authenticated request must drop the dead credential and
//    announce it, leaving the list silent so main.js can route to login.
{
  auth.setCredential(CREDENTIAL)
  events.length = 0

  try {
    await api.fetchOrder('unauthorized')
    check('401 throws', 'resolved', 'threw')
  } catch (error) {
    check('401 -> status', error?.status, 401)
    check('401 -> credential cleared', auth.getCredential(), null)
    check('401 -> signedout announced', events.includes('orderops:signedout'), true)
    check('401 -> view stays silent', classify(error), 'ignored')
  }
}

// 6. A 401 from /token must NOT clear stored state - it only means the typed
//    password was wrong.
{
  auth.setCredential(CREDENTIAL)
  events.length = 0

  try {
    await api.login('staff', 'wrong', undefined)
    check('login 401 throws', 'resolved', 'threw')
  } catch (error) {
    check('login 401 -> credential untouched', auth.getCredential()?.username, 'staff')
    check('login 401 -> nothing announced', events.length, 0)
  }
}

// 7. The predicate above must still match the real view.
{
  const view = fs.readFileSync(path.join(SRC, 'views', 'orders.js'), 'utf8')
  check(
    'orders.js still checks AbortError first',
    /catch \(error\) \{[\s\S]{0,400}?error\?\.name === 'AbortError'\)\s*return/.test(view),
    true,
  )
  check(
    'orders.js still surfaces a message otherwise',
    /setMessage\(error\?\.message \|\| 'Could not load orders\.', 'error'\)/.test(view),
    true,
  )
}

server.close()
fs.rmSync(WORK, { recursive: true, force: true })

let failed = 0
for (const result of results) {
  if (!result.pass) failed++
  console.log(
    `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}` +
      (result.pass
        ? ''
        : `\n        expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`),
  )
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
