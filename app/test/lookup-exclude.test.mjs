/**
 * Asserts what the last-order lookup actually REQUESTS, by capturing the URLs.
 *
 * This exists because the `exclude` parameter is invisible to every other kind
 * of check. Reading the code shows an `exclude:` key being passed; only the
 * request shows whether it survived into the query string, and only the query
 * string decides whether the endpoint excludes the order already on screen.
 * Anything that looked at the request would have settled the question.
 *
 * It also pins the request-count behaviour, because the cheapest bug here is
 * not a wrong URL but too many of them.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, findNode, fire, settle } from './dom-shim.mjs'

installDom()

const ORDER_ID = 412
const ORDER_PHONE = '01771160171'

const ORDER = {
  id: ORDER_ID, number: String(ORDER_ID), status: 'processing', status_label: 'Processing',
  date_created: '2026-10-01T10:00:00+06:00',
  billing: { first_name: 'A', phone: ORDER_PHONE, address_1: 'X', state: 'BD-13' },
  line_items: [], shipping_lines: [], fee_lines: [],
  customer_note: '', total: '160.00', currency: 'BDT',
}

const requested = []

globalThis.fetch = async (url) => {
  requested.push(String(url))
  const u = String(url)

  let payload = {}
  if (u.includes('/last-order')) payload = { found: false }
  else if (u.includes('/orders/')) payload = ORDER
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

// ---- edit mode: exclude MUST be in the query string -----------------------
{
  const view = OrderFormView({ orderId: ORDER_ID, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)

  check('edit mode: a lookup is requested', lookups().length > 0, true)
  check('edit mode: the URL carries exclude', latest()?.has('exclude'), true)
  check('edit mode: exclude is the order on screen', latest()?.get('exclude'), String(ORDER_ID))
  check('edit mode: phone is the order\'s phone', latest()?.get('phone'), ORDER_PHONE)

  // A different number, typed: still excludes the order being edited.
  const phone = phoneInputOf(view)
  phone.value = '01812345678'
  fire(phone, 'input')
  await settle(500)

  check('edit mode: exclude survives a retype', latest()?.get('exclude'), String(ORDER_ID))
  check('edit mode: the new number is queried', latest()?.get('phone'), '01812345678')

  // ---- deleting must not re-request ---------------------------------------
  const before = lookups().length
  for (const partial of ['0181234567', '018123456', '01812345']) {
    phone.value = partial
    fire(phone, 'input')
    await settle(500)
  }
  check('deleting fires no lookups', lookups().length - before, 0)

  // Retyping the same number renders from cache rather than asking again.
  phone.value = '01812345678'
  fire(phone, 'input')
  await settle(500)
  check('retyping the same number fires no lookup', lookups().length - before, 0)

  // Blur on an unchanged number is also silent.
  fire(phone, 'blur')
  await settle(300)
  check('blur on an unchanged number fires no lookup', lookups().length - before, 0)
}

// ---- new order: exclude must be ABSENT, since there is nothing to exclude --
{
  requested.length = 0
  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneInputOf(view)
  phone.value = ORDER_PHONE
  fire(phone, 'input')
  await settle(500)

  check('new order: a lookup is requested', lookups().length > 0, true)
  check('new order: no exclude is sent', latest()?.has('exclude'), false)
  check('new order: phone is sent', latest()?.get('phone'), ORDER_PHONE)
}

// ---- a partial number never reaches the network --------------------------
{
  requested.length = 0
  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneInputOf(view)
  for (const partial of ['0', '018', '0181', '018123']) {
    phone.value = partial
    fire(phone, 'input')
    await settle(500)
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
