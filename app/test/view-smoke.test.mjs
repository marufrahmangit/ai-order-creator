/**
 * Constructs every view against a minimal DOM shim.
 *
 * The point is narrow and was learned the hard way. In 6.7 the order form
 * referenced a const seventy lines before its declaration, which is a temporal
 * dead zone ReferenceError on every single open of the form - and nothing
 * caught it. The bundler was happy, the contract check greps source text, and
 * the other suites only exercise pure functions. Nothing in this project
 * actually RAN a view.
 *
 * Merely constructing each one catches that whole class: any throw during
 * construction, not just that one. Verified against a copy with the 6.7 bug
 * reintroduced - it fails with exactly the reported error.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, settle } from './dom-shim.mjs'

installDom()

// Every view's load() hits the API on construction; answer plausibly so nothing
// rejects. What is under test is construction, not these responses.
globalThis.fetch = async (url) => {
  const u = String(url)

  let payload = {}
  if (u.includes('/orders/') && !u.includes('/orders?')) {
    payload = {
      id: 412, number: '412', status: 'processing', status_label: 'Processing',
      date_created: '2026-10-01T10:00:00+06:00',
      billing: { first_name: 'A', phone: '01812345678', address_1: 'X', state: 'BD-13' },
      line_items: [{ id: 1, product_id: 9, name: 'Thing', quantity: 2, subtotal: '100.00', total: '100.00' }],
      shipping_lines: [{ id: 2, method_title: 'Dhaka Flat Rate', total: '80.00' }],
      fee_lines: [{ id: 3, name: 'Discount', total: '-20.00' }],
      customer_note: '', total: '160.00', currency: 'BDT',
    }
  } else if (u.includes('/orders')) {
    payload = { orders: [], total: 0, total_pages: 1, page: 1 }
  } else if (u.includes('/products')) {
    payload = { products: [], timing_ms: 1 }
  } else if (u.includes('/last-order')) {
    payload = { found: false }
  }

  return {
    ok: true, status: 200, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const { load, cleanup } = loadable(VIEW_MODULES)

const { LoginView } = await load('views/login.js')
const { OrdersView } = await load('views/orders.js')
const { OrderFormView } = await load('views/order-form.js')
const { ProductPicker } = await load('views/product-picker.js')
const { LastOrderCard } = await load('views/last-order.js')

const results = []

async function construct(name, fn) {
  try {
    const node = await fn()
    const ok = node && typeof node === 'object'
    results.push({ name, pass: !!ok, detail: ok ? '' : 'returned nothing' })
  } catch (error) {
    results.push({ name, pass: false, detail: `${error.name}: ${error.message}` })
  }
}

const noop = () => {}

await construct('LoginView', () => LoginView({ onSignedIn: noop }))

await construct('OrdersView (orders)', () => OrdersView({
  onSignOut: noop, onOpenOrder: noop, onNewOrder: noop, onShowTrash: noop,
}))

await construct('OrdersView (trash)', () => OrdersView({
  mode: 'trash', onSignOut: noop, onClose: noop,
}))

await construct('OrderFormView (new order)', () => OrderFormView({
  orderId: null, onClose: noop, onOpenOrder: noop,
}))

await construct('OrderFormView (existing order)', () => OrderFormView({
  orderId: 412, onClose: noop, onOpenOrder: noop,
}))

await construct('ProductPicker', () => ProductPicker({ onPick: noop, onClose: noop }))

await construct('LastOrderCard', () => {
  const card = LastOrderCard({ onOpenOrder: noop })
  // Also exercise its render path, which only runs when a lookup finds one.
  card.show({
    id: 1, number: '11851', status: 'completed', status_label: 'Completed',
    date_created: '2026-09-28T10:00:00+06:00',
    billing: { first_name: 'B', address_1: 'Y', state_label: 'Dhaka' },
    line_items: [{ name: 'Thing', quantity: 1, total: '10230.00' }],
    shipping_lines: [{ method_title: 'Dhaka Flat Rate', total: '80.00' }],
    fee_lines: [{ name: 'Discount', total: '-50.00' }],
    total: '10230.00',
  })
  card.hide()
  return card.node
})

// Let any pending load() settle so a rejection surfaces here rather than after.
await settle(200)

cleanup()

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  constructs ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
