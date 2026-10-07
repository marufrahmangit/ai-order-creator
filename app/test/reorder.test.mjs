/**
 * Reorder copies a previous order into the form for review.
 *
 * It does NOT create an order - the staff member still taps Save. (A Clone
 * action that creates one outright is a separate operation; nothing here
 * should be reused for it without deciding that deliberately.)
 *
 * Most assertions read the SAVE PAYLOAD rather than internal state, because
 * that is what the dirty-marking exists for: line_items and fee_lines are
 * all-or-nothing on update, so a copy that forgets to mark them dirty looks
 * perfectly correct on screen and then saves nothing at all. Only the request
 * body shows the difference.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, findNode, fire, settle } from './dom-shim.mjs'

installDom()

const EDITING_ID = 500
const OTHER_PHONE = '01812345678'

/** The order being edited: one item, no fees, its own phone. */
const CURRENT = {
  id: EDITING_ID, number: String(EDITING_ID), status: 'pending', status_label: 'Pending payment',
  date_created: '2026-10-05T10:00:00+06:00',
  billing: { first_name: 'Current Person', phone: '01771160171', address_1: 'Current address', state: 'BD-13' },
  line_items: [{ id: 7, product_id: 111, name: 'Already here', quantity: 1, subtotal: '50.00', total: '50.00' }],
  shipping_lines: [{ id: 8, method_title: 'Dhaka Flat Rate', total: '80.00' }],
  fee_lines: [],
  customer_note: '', total: '130.00', currency: 'BDT',
}

/** The previous order Reorder copies from. Completed, with a fee and a discount. */
const PREVIOUS = {
  id: 11851, number: '11851', status: 'completed', status_label: 'Completed',
  date_created: '2026-09-28T10:00:00+06:00',
  billing: { first_name: 'Repeat Customer', phone: OTHER_PHONE, address_1: 'Old address', state: 'BD-18', state_label: 'Gazipur' },
  line_items: [
    { id: 1, product_id: 9167, name: 'Three Piece', quantity: 2, subtotal: '350.00', total: '350.00' },
    { id: 2, product_id: 9200, name: 'Saree', quantity: 1, subtotal: '2500.00', total: '2500.00' },
  ],
  shipping_lines: [{ id: 3, method_title: 'Gazipur Flat Rate', total: '120.00' }],
  fee_lines: [
    { id: 4, name: 'Gift wrap', total: '50.00' },
    { id: 5, name: 'Loyalty discount', total: '-100.00' },
  ],
  customer_note: 'Deliver after 6pm', total: '2920.00', currency: 'BDT',
}

const requests = []
let lookupAnswer = { found: true, order: PREVIOUS }

globalThis.fetch = async (url, options = {}) => {
  const u = String(url)
  requests.push({ url: u, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })

  let payload = {}
  if (u.includes('/last-order')) payload = lookupAnswer
  else if (options.method === 'POST') payload = { order: CURRENT, warnings: [] }
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

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

const byClass = (view, cls) => findNode(view, (n) => String(n.className).includes(cls))
const phoneOf = (view) => findNode(view, (n) => n.tagName === 'INPUT' && n.type === 'tel')
const reorderOf = (view) => byClass(view, 'last-order-reorder')
const saveOf = (view) => findNode(view, (n) => n.className === 'button primary' && String(n.textContent).startsWith('Save'))
const statusSelectOf = (view) => findNode(view, (n) => n.id === 'of-status')
const lastWrite = () => [...requests].reverse().find((r) => r.method === 'POST')

/** A fresh new-order form with the card already showing PREVIOUS. */
async function newFormWithCard() {
  requests.length = 0
  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(200)

  const phone = phoneOf(view)
  phone.value = OTHER_PHONE
  fire(phone, 'input')
  await settle(500)

  return view
}

// ---- new order: Reorder copies items, fees and the note -------------------
{
  const view = await newFormWithCard()

  const reorder = reorderOf(view)
  check('the card offers a Reorder action', !!reorder, true)
  check('it is labelled Reorder, not Clone or Duplicate', reorder?.textContent, 'Reorder')

  fire(reorder, 'click')
  await settle(100)

  // Nothing is created by tapping Reorder.
  check('Reorder makes no request of its own', requests.filter((r) => r.method === 'POST').length, 0)

  fire(saveOf(view), 'click')
  await settle(300)

  const body = lastWrite()?.body
  check('a save was sent', !!body, true)

  check('every line item is copied', body?.line_items?.length, 2)
  check('line items carry product_id, quantity and total',
    body?.line_items?.[0], { product_id: 9167, quantity: 2, total: '350.00' })
  check('the second line too',
    body?.line_items?.[1], { product_id: 9200, quantity: 1, total: '2500.00' })

  check('every fee is copied', body?.fee_lines?.length, 2)
  check('fees carry name and total', body?.fee_lines?.[0], { name: 'Gift wrap', total: '50.00' })
  check('a negative fee stays negative',
    body?.fee_lines?.[1], { name: 'Loyalty discount', total: '-100.00' })

  check('the customer note is copied', body?.customer_note, 'Deliver after 6pm')

  // Status is the form's default, never the copied order's.
  check('the copied status is NOT applied to the form', statusSelectOf(view)?.value, 'pending')
  check('the payload does not carry the copied status', body?.status === 'completed', false)

  // Shipping and identity are the server's or nobody's.
  check('no shipping is sent', 'shipping_lines' in (body || {}), false)
  check('no order id is sent', 'id' in (body || {}), false)
  check('no order number is sent', 'number' in (body || {}), false)
  check('no date is sent', 'date_created' in (body || {}), false)
}

// ---- empty name and address are filled; typed ones are left alone --------
{
  const view = await newFormWithCard()
  fire(reorderOf(view), 'click')
  await settle(100)
  fire(saveOf(view), 'click')
  await settle(300)

  check('an empty name is filled from the copy', lastWrite()?.body?.name, 'Repeat Customer')
  check('an empty address is filled from the copy', lastWrite()?.body?.address_1, 'Old address')
}

{
  const view = await newFormWithCard()

  const name = findNode(view, (n) => n.id === 'of-name')
  name.value = 'Typed By Staff'
  fire(name, 'input')

  fire(reorderOf(view), 'click')
  await settle(100)
  fire(saveOf(view), 'click')
  await settle(300)

  check('a name already typed is NOT overwritten', lastWrite()?.body?.name, 'Typed By Staff')
  check('the address is still filled', lastWrite()?.body?.address_1, 'Old address')
}

// ---- editing: items and fees must be marked dirty or they are omitted -----
{
  requests.length = 0
  const view = OrderFormView({ orderId: EDITING_ID, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)

  // Change the phone to a different customer so the card appears while editing.
  const phone = phoneOf(view)
  phone.value = OTHER_PHONE
  fire(phone, 'input')
  await settle(500)

  const reorder = reorderOf(view)
  check('editing: the card offers Reorder too', !!reorder, true)

  // The form already has an item, so the first tap must only warn.
  fire(reorder, 'click')
  await settle(50)
  fire(saveOf(view), 'click')
  await settle(300)

  // Nothing was copied, so nothing is dirty, so line_items is ABSENT from the
  // payload - which is how the API is told to leave the stored items alone.
  // Asserting the key's absence is the real check here; asserting the old
  // product id would assume a resend that correctly never happens.
  const warned = lastWrite()?.body
  check('the first tap changes nothing, so items are left untouched',
    'line_items' in (warned || {}), false)
  check('and fees likewise', 'fee_lines' in (warned || {}), false)

  // Second tap confirms.
  fire(reorderOf(view), 'click')
  await settle(50)
  fire(saveOf(view), 'click')
  await settle(300)

  const body = lastWrite()?.body
  check('editing: line_items ARE in the payload, so they were marked dirty',
    body?.line_items?.length, 2)
  check('editing: fee_lines ARE in the payload, so they were marked dirty',
    body?.fee_lines?.length, 2)
  check('editing: the note is in the payload', body?.customer_note, 'Deliver after 6pm')
  check('editing: status is not sent, since it was not touched', 'status' in (body || {}), false)
  check('editing: the update went to the order being edited',
    lastWrite()?.url.includes(`/orders/${EDITING_ID}`), true)
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
