/**
 * The order list's search box: what it SENDS, and what it declines to send.
 *
 * Asserted through the request URL rather than internal state, because the URL
 * is the whole contract. The search is a substring match server-side, so any
 * edit to the term on the way out changes what comes back - and the defect this
 * replaces was exactly that: a valid-looking mobile was normalized and turned
 * into an exact `billing_phone` lookup, which could not match a fragment and
 * never looked at the shipping phone.
 *
 * So the rule being pinned is: the term reaches the server byte for byte, or
 * it is not sent at all.
 *
 * The second half covers the 3-character minimum. The endpoint answers 400
 * below it, so the app has to stop short of asking - otherwise someone typing
 * a phone number sees an error flash on the second keystroke of every search.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, findNode, fire, settle } from './dom-shim.mjs'

installDom()

const LIST = [
  {
    id: 8735, number: '8735', status: 'completed', status_label: 'Completed',
    customer_name: 'Farida Yasmin', phone: '01771160171', total: '1080.00',
    item_count: '2', date_created: '2026-10-01T10:00:00+06:00',
  },
]

const requests = []

globalThis.fetch = async (url, options = {}) => {
  const u = String(url)
  requests.push({ url: u, method: options.method || 'GET' })

  let payload = {}
  if (u.includes('/meta')) {
    payload = {
      states: [{ code: 'BD-13', label: 'Dhaka' }],
      statuses: [
        { slug: 'pending', label: 'Pending payment' },
        { slug: 'completed', label: 'Completed' },
      ],
      currency: 'BDT', price_decimals: 2, plugin_version: '7.3',
    }
  } else if (u.includes('/orders')) {
    payload = { orders: LIST, total: 1, total_pages: 1, page: 1, timing_ms: 42 }
  }

  return {
    ok: true, status: 200, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const { load, cleanup } = loadable(VIEW_MODULES)
const { loadMeta } = await load('meta.js')
await loadMeta()
const { OrdersView } = await load('views/orders.js')

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

const searchBoxOf = (view) => findNode(view, (n) => n.tagName === 'INPUT' && n.type === 'search')
const statusSelectOf = (view) => findNode(view, (n) => n.tagName === 'SELECT')
const messageOf = (view) =>
  String(findNode(view, (n) => String(n.className).split(' ').includes('status-line'))?.textContent ?? '')

const orderRequests = () => requests.filter((r) => r.url.includes('/orders'))
const lastOrderRequest = () => [...orderRequests()].pop()

/**
 * The `search` parameter as the server will receive it, decoded, or null when
 * the URL carries none.
 *
 * null is the right answer for an empty term, not a miss: buildUrl() in api.js
 * deliberately omits an empty param rather than sending `search=`, and the
 * endpoints treat absent and empty identically.
 */
function searchParamOf(request) {
  if (!request) return null
  const match = /[?&]search=([^&]*)/.exec(request.url)
  if (!match) return null
  // URLSearchParams encodes a space as '+', and decodeURIComponent does not
  // turn it back. PHP's query-string parser does, so '+' here IS a space on
  // the server - decode it that way or a multi-word term looks mangled when
  // it is in fact correct.
  return decodeURIComponent(match[1].replace(/\+/g, ' '))
}

/** A fresh list view with its initial load finished. */
async function freshView() {
  const view = OrdersView({
    onSignOut: () => {}, onOpenOrder: () => {}, onNewOrder: () => {}, onShowTrash: () => {},
  })
  await settle(150)
  requests.length = 0
  return view
}

/** Types a term and waits past the 300ms debounce. */
async function typeSearch(view, term) {
  const box = searchBoxOf(view)
  box.value = term
  fire(box, 'input')
  await settle(450)
  return box
}

// ---- the term reaches the server untouched -------------------------------
{
  const view = await freshView()

  const terms = [
    ['an order id', '8735'],
    ['a phone fragment', '5089'],
    ['a full 11-digit mobile', '01771160171'],
    ['a 10-digit mobile', '1771160171'],
    ['a district name', 'Chattogram'],
    ['a two-word name', 'farida yasmin'],
    ['Bengali with an ASCII digit', 'সেক্টর 18 উত্তরা'],
    ['Bengali alone', 'উত্তরা'],
    ['mixed case', 'Farida YASMIN'],
    ['an internal hyphen', 'Mirpur-10'],
  ]

  for (const [what, term] of terms) {
    requests.length = 0
    await typeSearch(view, term)
    check(`${what} is sent byte for byte`, searchParamOf(lastOrderRequest()), term)
  }
}

// The regression guard: this is the term the old code intercepted.
{
  const view = await freshView()
  await typeSearch(view, '01771160171')

  const url = lastOrderRequest()?.url ?? ''
  check('a valid mobile is sent as the search term, not normalized',
    searchParamOf(lastOrderRequest()), '01771160171')
  check('and no phone-specific parameter is sent alongside it',
    /phone=/.test(url), false)
}

// ---- below the minimum, nothing is sent ----------------------------------
{
  const view = await freshView()

  for (const short of ['0', '01', 'অ', 'অব']) {
    requests.length = 0
    await typeSearch(view, short)
    check(`"${short}" fires no request at all`, orderRequests().length, 0)
    check(`"${short}" says why instead`,
      messageOf(view).includes('at least 3 characters'), true)
  }
}

{
  const view = await freshView()
  await typeSearch(view, '873')
  check('three characters is enough to search', searchParamOf(lastOrderRequest()), '873')
}

{
  // Bengali is counted in characters, not bytes: "ঢাকা" is 4 characters but 12
  // bytes, and "অব" is 2 characters but 6. A byte-length check would accept
  // the one that must be refused.
  const view = await freshView()
  await typeSearch(view, 'ঢাকা')
  check('a short Bengali term over the minimum is sent',
    searchParamOf(lastOrderRequest()), 'ঢাকা')
}

// ---- recovering from a too-short term ------------------------------------
{
  const view = await freshView()

  await typeSearch(view, '01')
  check('still nothing sent', orderRequests().length, 0)

  requests.length = 0
  await typeSearch(view, '')
  check('clearing the box reloads the unfiltered list', orderRequests().length, 1)
  check('with no search term in the URL at all', searchParamOf(lastOrderRequest()), null)
}

{
  /*
   * A too-short term must not be remembered. The status filter and the pager
   * both call the same loader, and if the rejected term were still held in
   * state they would send it - and get the 400 the typing path just avoided.
   */
  const view = await freshView()
  await typeSearch(view, '01')

  requests.length = 0
  const status = statusSelectOf(view)
  status.value = 'completed'
  fire(status, 'change')
  await settle(150)

  check('changing the status filter still sends a request', orderRequests().length, 1)
  check('and does NOT resend the rejected term',
    searchParamOf(lastOrderRequest()), null)
  check('while still applying the status', /status=completed/.test(lastOrderRequest()?.url ?? ''), true)
}

// ---- Enter searches immediately ------------------------------------------
{
  const view = await freshView()
  const box = searchBoxOf(view)

  box.value = '5089'
  fire(box, 'input')
  // Well inside the 300ms debounce, so only the Enter can have sent this.
  await settle(20)
  fire(box, 'keydown', { key: 'Enter' })
  await settle(50)

  check('Enter searches without waiting for the debounce', orderRequests().length, 1)
  check('with the typed term', searchParamOf(lastOrderRequest()), '5089')

  // And the queued debounce must not then fire a second, identical request.
  await settle(450)
  check('the debounced call does not fire a duplicate', orderRequests().length, 1)
}

{
  const view = await freshView()
  const box = searchBoxOf(view)
  box.value = '01'
  fire(box, 'input')
  await settle(20)
  fire(box, 'keydown', { key: 'Enter' })
  await settle(50)
  check('Enter on a too-short term sends nothing either', orderRequests().length, 0)
}

cleanup()

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
    (r.pass ? '' : `\n        expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`))
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
