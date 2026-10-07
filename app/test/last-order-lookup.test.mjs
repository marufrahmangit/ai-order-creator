/**
 * Asserts what the last-order lookup requests, and what it then shows.
 *
 * Both halves matter and they are separate concerns since 6.8:
 *
 *   REQUEST - always just the phone number. There is no `exclude` parameter
 *   any more. Asking the server for "the last order that is not this one" got
 *   back the SECOND-most-recent order presented as the last one, which on
 *   order 11354 showed 11323 and was misleading rather than merely unhelpful.
 *
 *   DISPLAY - the card shows the genuine most recent order, except when that
 *   order is the one already open, which tells the user nothing. That is a
 *   client-side decision, and this file pins it.
 *
 * The request URLs are captured rather than inferred, because an `exclude:`
 * key in the source tells you nothing about what reached the query string.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, findNode, fire, settle } from './dom-shim.mjs'

installDom()

const EDITING_ID = 11354
const EDITING_PHONE = '01771160171'

/** The order the form is editing. */
const CURRENT = {
  id: EDITING_ID, number: String(EDITING_ID), status: 'processing', status_label: 'Processing',
  date_created: '2026-10-01T10:00:00+06:00',
  billing: { first_name: 'A', phone: EDITING_PHONE, address_1: 'X', state: 'BD-13' },
  line_items: [], shipping_lines: [], fee_lines: [],
  customer_note: '', total: '160.00', currency: 'BDT',
}

/** A different customer's genuine last order. */
const OTHER = { ...CURRENT, id: 11999, number: '11999', billing: { ...CURRENT.billing, phone: '01812345678' } }

const requested = []

/** What the next /last-order call resolves to. */
let lookupAnswer = { found: false }

globalThis.fetch = async (url) => {
  requested.push(String(url))
  const u = String(url)

  let payload = {}
  if (u.includes('/last-order')) payload = lookupAnswer
  else if (u.includes('/orders/')) payload = CURRENT
  else if (u.includes('/orders')) payload = { orders: [], total: 0, total_pages: 1, page: 1 }
  else if (u.includes('/products')) payload = { products: [], timing_ms: 1 }

  return {
    ok: true, status: 200, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const { load, cleanup } = loadable(VIEW_MODULES)
const { OrderFormView } = await load('views/order-form.js')

const lookups = () => requested.filter((u) => u.includes('/last-order'))
const latest = () => {
  const all = lookups()
  return all.length ? new URL(all[all.length - 1]).searchParams : null
}

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: actual === expected, actual, expected })

const phoneInputOf = (view) => findNode(view, (n) => n.tagName === 'INPUT' && n.type === 'tel')
/** The card is hidden when it has nothing to show. */
const cardVisible = (view) => {
  const card = findNode(view, (n) => n.className === 'last-order')
  return card ? card.hidden === false : false
}

// ---- no request ever carries exclude --------------------------------------
{
  requested.length = 0
  lookupAnswer = { found: true, order: CURRENT }

  const view = OrderFormView({ orderId: EDITING_ID, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)

  check('edit mode: a lookup is requested', lookups().length > 0, true)
  check('edit mode: NO exclude in the URL', latest()?.has('exclude'), false)
  check('edit mode: only the phone is sent', [...(latest()?.keys() ?? [])].join(','), 'phone')
  check('edit mode: the phone is the order\'s own', latest()?.get('phone'), EDITING_PHONE)

  // The genuine last order for that number IS the order on screen, so nothing
  // should be shown - this is the case that used to surface a substitute.
  check('the card is suppressed when the last order IS the one on screen',
    cardVisible(view), false)
}

// ---- a different customer's last order DOES show -------------------------
{
  requested.length = 0
  lookupAnswer = { found: true, order: CURRENT }

  const view = OrderFormView({ orderId: EDITING_ID, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)

  // Reassigning the order to another customer: their real last order is useful.
  lookupAnswer = { found: true, order: OTHER }
  const phone = phoneInputOf(view)
  phone.value = '01812345678'
  fire(phone, 'input')
  await settle(500)

  check('reassigning: no exclude is sent', latest()?.has('exclude'), false)
  check('reassigning: the new number is queried', latest()?.get('phone'), '01812345678')
  check('reassigning: the other customer\'s last order IS shown', cardVisible(view), true)
}

// ---- new order: shown whenever one is found ------------------------------
{
  requested.length = 0
  lookupAnswer = { found: true, order: OTHER }

  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneInputOf(view)
  phone.value = '01812345678'
  fire(phone, 'input')
  await settle(500)

  check('new order: no exclude is sent', latest()?.has('exclude'), false)
  check('new order: the last order is shown', cardVisible(view), true)
}

// ---- a new customer shows nothing, and is not asked about twice ----------
{
  requested.length = 0
  lookupAnswer = { found: false }

  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneInputOf(view)
  phone.value = '01911223344'
  fire(phone, 'input')
  await settle(500)

  check('a new customer shows no card', cardVisible(view), false)

  const before = lookups().length
  fire(phone, 'blur')
  await settle(300)
  check('a found:false answer is cached, not re-requested', lookups().length - before, 0)
}

// ---- kept from before: deleting and retyping cost no requests ------------
{
  requested.length = 0
  lookupAnswer = { found: true, order: OTHER }

  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneInputOf(view)
  phone.value = '01812345678'
  fire(phone, 'input')
  await settle(500)

  const before = lookups().length

  for (const partial of ['0181234567', '018123456', '01812345']) {
    phone.value = partial
    fire(phone, 'input')
    await settle(400)
  }
  check('deleting fires no lookups', lookups().length - before, 0)

  phone.value = '01812345678'
  fire(phone, 'input')
  await settle(400)
  check('retyping the same number fires no lookup', lookups().length - before, 0)
  check('and the card comes back from cache', cardVisible(view), true)
}

// ---- kept from before: a partial number never reaches the network --------
{
  requested.length = 0

  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneInputOf(view)
  for (const partial of ['0', '018', '0181', '018123']) {
    phone.value = partial
    fire(phone, 'input')
    await settle(400)
  }

  check('a partial number is never requested', lookups().length, 0)
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
