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
 * construction, not just this one. Verified against a copy with the 6.7 bug
 * reintroduced - it fails with exactly the reported error.
 *
 * The shim is deliberately crude. It only has to be real enough for dom.js's
 * el(), and if a view ever needs more of the DOM than this provides, that is
 * worth knowing too.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'orderops-views-'))

// ---- a DOM just real enough for dom.js's el() -----------------------------

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    listeners: {},
    dataset: {},
    className: '',
    textContent: '',
    id: '',
    value: '',
    type: '',
    disabled: false,
    hidden: false,
    open: false,
    title: '',
    placeholder: '',
    href: '',
    rows: 0,
    min: 0,
    step: 0,
    required: false,
    spellcheck: false,
    options: [],
    attributes: {},
    append(...kids) {
      for (const k of kids) {
        this.children.push(k)
        if (k && typeof k === 'object' && 'tagName' in k && this.tagName === 'SELECT') {
          this.options.push(k)
        }
      }
    },
    addEventListener(type, fn) {
      ;(this.listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    replaceChildren() {
      this.children = []
      this.options = []
    },
    remove() {},
    focus() {},
    select() {},
    querySelector() {
      return null
    },
    classList: { add() {}, remove() {}, contains: () => false },
  }
  return node
}

globalThis.document = {
  createElement: makeNode,
  getElementById: () => makeNode('div'),
  body: makeNode('body'),
  addEventListener() {},
}

const store = new Map()
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

globalThis.window = {
  localStorage: storage,
  sessionStorage: storage,
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  scrollTo() {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  location: { reload() {}, origin: 'http://localhost:5173' },
  navigator: { userAgent: 'node', onLine: true },
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.CustomEvent = class CustomEvent {
  constructor(type) {
    this.type = type
  }
}
// Node 22 defines a read-only global navigator; api.js only reads .onLine off
// it, which is undefined here and simply takes the online branch.

// A credential so api.js reaches the (stubbed) network rather than short-circuiting.
store.set('orderops.credential', JSON.stringify({ username: 'staff', password: 'pw' }))

// Every view's load() hits the API on construction; answer plausibly so nothing
// rejects. What is under test is construction, not these responses.
globalThis.fetch = async (url) => ({
  ok: true,
  status: 200,
  type: 'basic',
  headers: { get: () => null },
  text: async () => {
    const u = String(url)
    if (u.includes('/orders/') && !u.includes('/orders?')) {
      return JSON.stringify({
        id: 412, number: '412', status: 'processing', status_label: 'Processing',
        date_created: '2026-10-01T10:00:00+06:00',
        billing: { first_name: 'A', phone: '01812345678', address_1: 'X', state: 'BD-13' },
        line_items: [{ id: 1, product_id: 9, name: 'Thing', quantity: 2, subtotal: '100.00', total: '100.00' }],
        shipping_lines: [{ id: 2, method_title: 'Dhaka Flat Rate', total: '80.00' }],
        fee_lines: [{ id: 3, name: 'Discount', total: '-20.00' }],
        customer_note: '', total: '160.00', currency: 'BDT',
      })
    }
    if (u.includes('/orders')) {
      return JSON.stringify({ orders: [], total: 0, total_pages: 1, page: 1 })
    }
    if (u.includes('/products')) return JSON.stringify({ products: [], timing_ms: 1 })
    if (u.includes('/last-order')) return JSON.stringify({ found: false })
    return JSON.stringify({})
  },
})

// ---- load the views, with Vite-only syntax substituted --------------------

function prepare(rel) {
  const from = path.join(SRC, rel)
  const to = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })

  let code = fs.readFileSync(from, 'utf8')
  code = code
    .replace(/import\.meta\.env\.VITE_API_BASE/g, JSON.stringify('http://localhost/wp-json/aioc/v1'))
    .replace(/import\.meta\.env\.PROD/g, 'false')
    // styles.css has no meaning outside Vite.
    .replace(/^import '\.\/styles\.css'$/m, '')
  fs.writeFileSync(to, code)
}

for (const rel of [
  'dom.js', 'auth.js', 'api.js', 'meta.js', 'format.js', 'phone.js', 'pwa.js',
  'views/login.js', 'views/orders.js', 'views/order-form.js',
  'views/product-picker.js', 'views/last-order.js',
]) {
  prepare(rel)
}

const load = (rel) => import(pathToFileURL(path.join(WORK, rel)).href)

const results = []
async function construct(name, fn) {
  try {
    const node = await fn()
    const ok = node && (typeof node === 'object')
    results.push({ name, pass: !!ok, detail: ok ? '' : 'returned nothing' })
  } catch (error) {
    results.push({ name, pass: false, detail: `${error.name}: ${error.message}` })
  }
}

const { LoginView } = await load('views/login.js')
const { OrdersView } = await load('views/orders.js')
const { OrderFormView } = await load('views/order-form.js')
const { ProductPicker } = await load('views/product-picker.js')
const { LastOrderCard } = await load('views/last-order.js')

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

// Let any pending async load() settle so a rejection surfaces here.
await new Promise((resolve) => setTimeout(resolve, 150))

fs.rmSync(WORK, { recursive: true, force: true })

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  constructs ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
