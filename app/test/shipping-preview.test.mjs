/**
 * The shipping figure in the form's Totals block.
 *
 * Why this is worth a suite of its own: the Order total is read out to a
 * customer on the phone, and before this existed an unsaved order showed a
 * dash for shipping and a total short by 80-150 BDT. Wrong money, said aloud,
 * is the most expensive kind of wrong this app can be.
 *
 * The rule being tested is NOT "compute shipping". It is:
 *
 *   saved order      -> show the server's actual shipping line, always
 *   unsaved, district-> show the rate the server WOULD apply, looked up in
 *                       /meta's table (never restated in this app)
 *   unsaved, none    -> show nothing, because ai_apply_shipping() returns
 *                       early on an empty billing state and adds no line
 *
 * That last case is the one worth guarding. The default rate is for a district
 * that is SET but unrecognized; applying it to a blank district would
 * overstate every unsaved order, which is the same class of bug in the other
 * direction.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, findNode, fire, settle } from './dom-shim.mjs'
import fs from 'node:fs'
import path from 'node:path'

const { storage } = installDom()

const SAVED_ID = 700

/** A saved order whose server shipping line is NOT the table's rate for its district. */
const SAVED = {
  id: SAVED_ID, number: String(SAVED_ID), status: 'processing', status_label: 'Processing',
  date_created: '2026-10-06T10:00:00+06:00',
  billing: { first_name: 'Saved Person', phone: '01771160171', address_1: 'Somewhere', state: 'BD-13' },
  line_items: [{ id: 1, product_id: 111, name: 'Thing', quantity: '1', subtotal: '500.00', total: '500.00' }],
  // Deliberately 95, not the 80 the table holds for BD-13: a figure someone
  // adjusted in wp-admin. The server stays authoritative on a saved order.
  shipping_lines: [{ id: 2, method_title: 'Adjusted Flat Rate', total: '95.00' }],
  fee_lines: [],
  customer_note: '', total: '595.00', currency: 'BDT',
}

const SHIPPING_RATES = {
  default: { cost: '150.00', label: 'Outside Dhaka Flat Rate' },
  by_state: {
    'BD-13': { cost: '80.00', label: 'Dhaka Flat Rate' },
    'BD-18': { cost: '120.00', label: 'Gazipur Flat Rate' },
  },
}

const requests = []
/** Flipped to simulate a plugin older than 6.9, which serves no rate table. */
let serveRates = true

globalThis.fetch = async (url, options = {}) => {
  const u = String(url)
  requests.push({ url: u, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })

  let payload = {}
  if (u.includes('/meta')) {
    payload = {
      states: [
        { code: 'BD-13', label: 'Dhaka' },
        { code: 'BD-18', label: 'Gazipur ' },
        // In WooCommerce's list but NOT in the rate table: the default case.
        { code: 'BD-27', label: 'Jashore' },
      ],
      statuses: [
        { slug: 'pending', label: 'Pending payment' },
        { slug: 'processing', label: 'Processing' },
      ],
      currency: 'BDT', price_decimals: 2, plugin_version: '6.9',
      ...(serveRates ? { shipping_rates: SHIPPING_RATES } : {}),
    }
  }
  else if (u.includes('/last-order')) payload = { found: false }
  else if (options.method === 'POST') payload = { order: SAVED, warnings: [] }
  else if (u.includes('/orders/')) payload = SAVED
  else if (u.includes('/orders')) payload = { orders: [], total: 0, total_pages: 1, page: 1 }
  else if (u.includes('/products')) payload = { products: [], timing_ms: 1 }

  return {
    ok: true, status: 200, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

/** Every Totals row as [label, value], in order. */
function totalsRows(view) {
  const rows = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (String(node.className).includes('totals-row')) {
      const [label, value] = node.children
      rows.push([String(label?.textContent ?? ''), String(value?.textContent ?? '')])
      return
    }
    for (const kid of node.children || []) walk(kid)
  }
  walk(view)
  return rows
}

/*
 * The AMOUNT out of a formatted money string, dropping the currency symbol.
 *
 * formatMoney() goes through Intl, and which glyph BDT renders as depends on
 * the ICU data the runtime happens to ship - Node here gives "BDT 80.00" where
 * a browser gives "80.00". Asserting the figure keeps these tests about the
 * rate rather than about ICU.
 */
const amount = (text) => String(text).replace(/[^\d.,-]/g, '').trim()

const rowFor = (view, label) => totalsRows(view).find(([l]) => l === label)
/** The shipping row is the one that is neither Items, Fees nor Order total. */
const shippingRow = (view) => {
  const row = totalsRows(view).find(([l]) => !['Items', 'Fees', 'Order total'].includes(l))
  return row ? [row[0], row[1] === '—' ? '—' : amount(row[1])] : row
}
const totalOf = (view) => amount(rowFor(view, 'Order total')?.[1])

/** The provisional-figures note under the totals, if any. */
function totalsNote(view) {
  const hits = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.className === 'field-hint' && String(node.textContent).includes('server on save')) {
      hits.push(String(node.textContent))
    }
    for (const kid of node.children || []) walk(kid)
  }
  walk(view)
  return hits[0] || ''
}

const districtOf = (view) => findNode(view, (n) => n.id === 'of-district')
const saveOf = (view) =>
  findNode(view, (n) => n.className === 'button primary' && String(n.textContent).startsWith('Save'))

const { load, cleanup } = loadable(VIEW_MODULES)
const { loadMeta } = await load('meta.js')
await loadMeta()

const { OrderFormView } = await load('views/order-form.js')
const { shippingRateFor } = await load('meta.js')

const newForm = async () => {
  requests.length = 0
  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(150)
  return view
}

// ---- the lookup itself ----------------------------------------------------
{
  check('a district in the table gets its own rate',
    shippingRateFor('BD-13'), { cost: 80, label: 'Dhaka Flat Rate' })
  check('the other one too',
    shippingRateFor('BD-18'), { cost: 120, label: 'Gazipur Flat Rate' })
  check('a district that is SET but not in the table gets the default',
    shippingRateFor('BD-27'), { cost: 150, label: 'Outside Dhaka Flat Rate' })
  check('NO district gets no rate at all, because the server adds no line',
    shippingRateFor(''), null)
  check('and neither does whitespace', shippingRateFor('   '), null)
  check('nor undefined', shippingRateFor(undefined), null)
}

// ---- a brand-new order, nothing selected ---------------------------------
{
  const view = await newForm()

  check('a new order starts with no district', districtOf(view)?.value, '')
  check('shipping shows a dash, not the default rate', shippingRow(view), ['Shipping', '—'])
  check('and the note says why rather than claiming something changed',
    totalsNote(view).includes('no district is selected, so no shipping is added'), true)
  check('the old wording about a change is gone',
    totalsNote(view).includes('the district changed'), false)
}

// ---- a district selected on a new order ----------------------------------
{
  const view = await newForm()
  const district = districtOf(view)

  district.value = 'BD-13'
  fire(district, 'change')
  await settle(50)

  check('the district rate is shown, labelled as the server labels it',
    shippingRow(view), ['Dhaka Flat Rate', '80.00'])
  check('and the Order total includes it', totalOf(view), '80.00')
  check('the note explains it is applied on save',
    totalsNote(view).includes('shipping is the flat rate for the district and is applied on save'), true)
  check('it does not say the district changed, since there was no previous one',
    totalsNote(view).includes('the district changed'), false)

  // Live update: the whole point of reading it from the select.
  district.value = 'BD-18'
  fire(district, 'change')
  await settle(50)
  check('changing the district updates the rate live',
    shippingRow(view), ['Gazipur Flat Rate', '120.00'])
  check('and the total with it', totalOf(view), '120.00')

  district.value = 'BD-27'
  fire(district, 'change')
  await settle(50)
  check('an unlisted district falls back to the default rate',
    shippingRow(view), ['Outside Dhaka Flat Rate', '150.00'])

  // Back to nothing: the figure must disappear, not stick.
  district.value = ''
  fire(district, 'change')
  await settle(50)
  check('clearing the district clears the rate rather than leaving it stale',
    shippingRow(view), ['Shipping', '—'])
  check('and the total drops back', totalOf(view), '0.00')
}

// ---- display only: nothing about this reaches the server -----------------
{
  const view = await newForm()
  const district = districtOf(view)
  district.value = 'BD-18'
  fire(district, 'change')
  await settle(50)

  fire(saveOf(view), 'click')
  await settle(300)

  const body = [...requests].reverse().find((r) => r.method === 'POST')?.body
  check('a save was sent', !!body, true)
  check('the district is sent', body?.state, 'BD-18')
  check('but no shipping line is', 'shipping_lines' in (body || {}), false)
  check('and no shipping total of any kind',
    Object.keys(body || {}).some((k) => k.includes('shipping')), false)
}

// ---- a saved order: the server's line wins, even against the table -------
{
  requests.length = 0
  const view = OrderFormView({ orderId: SAVED_ID, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)

  check('the saved order loaded', districtOf(view)?.value, 'BD-13')
  check("the server's actual line is shown, not the table's rate for BD-13",
    shippingRow(view), ['Adjusted Flat Rate', '95.00'])
  check("and the server's own total is shown while nothing is edited",
    totalOf(view), '595.00')
  check('no provisional note on an untouched saved order', totalsNote(view), '')

  // Now change the district: here "changed" IS the right word.
  const district = districtOf(view)
  district.value = 'BD-18'
  fire(district, 'change')
  await settle(50)

  check('the note now says the district changed',
    totalsNote(view).includes('the district changed, so shipping is recalculated'), true)
  check('it does not use the new-order wording',
    totalsNote(view).includes('is applied on save'), false)
  /*
   * Once the district is edited the stored line no longer describes what a save
   * would produce, so the table rate for the NEW district is what shows. This
   * assertion used to require the opposite - the stale 95.00 - which is exactly
   * the bug it now guards against.
   */
  check('editing the district replaces the stored line with the new rate',
    shippingRow(view), ['Gazipur Flat Rate', '120.00'])
  check('and the Order total follows it rather than the stored one',
    totalOf(view), '620.00')

  // Back to the district it was loaded with: the stored line describes a save
  // again, so the wp-admin adjustment must come back rather than stay replaced.
  district.value = 'BD-13'
  fire(district, 'change')
  await settle(50)
  check('putting the district back restores the stored line',
    shippingRow(view), ['Adjusted Flat Rate', '95.00'])
  check('and the note stops claiming a change',
    totalsNote(view).includes('the district changed'), false)
}

// ---- BUG 2: clearing the district on a SAVED order ------------------------
{
  requests.length = 0
  const view = OrderFormView({ orderId: SAVED_ID, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)

  check('the stored line shows while the district is untouched',
    shippingRow(view), ['Adjusted Flat Rate', '95.00'])

  const district = districtOf(view)
  district.value = ''
  fire(district, 'change')
  await settle(50)

  /*
   * ai_apply_shipping() removes any existing line and adds nothing when the
   * state is empty, so a saved order whose district is cleared loses its
   * shipping entirely. The form has to say so BEFORE the save, because the
   * Order total on screen is the figure read out to the customer.
   */
  check('clearing the district drops the stored shipping line',
    shippingRow(view), ['Shipping', '—'])
  check('and the Order total drops with it, items only',
    totalOf(view), '500.00')
  check('the note says the line is removed, not recalculated',
    totalsNote(view).includes('the district was cleared, so the shipping line is removed'), true)
}

// ---- an older plugin serves no rate table --------------------------------
{
  serveRates = false
  storage.removeItem('orderops.meta.v2')

  const second = loadable(VIEW_MODULES)
  const meta2 = await second.load('meta.js')
  await meta2.loadMeta()

  check('with no rate table, no rate is invented', meta2.shippingRateFor('BD-13'), null)

  const { OrderFormView: Form2 } = await second.load('views/order-form.js')
  const view = Form2({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(150)

  const district = districtOf(view)
  district.value = 'BD-13'
  fire(district, 'change')
  await settle(50)

  check('the form degrades to a dash rather than guessing',
    shippingRow(view), ['Shipping', '—'])

  second.cleanup()
  serveRates = true
}

// ---- the rates are not duplicated in this app ----------------------------
{
  const SRC = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'src')
  const sources = fs.readdirSync(SRC, { recursive: true })
    .filter((f) => String(f).endsWith('.js'))
    .map((f) => ({ file: String(f), text: fs.readFileSync(path.join(SRC, String(f)), 'utf8') }))

  // A rate repeated here would be a second source of truth, and the one that
  // disagreed with the plugin is the one staff would read out.
  const offenders = sources.filter(({ text }) =>
    /(^|[^\w.])(80|120|150)\s*(,|\)|;|\]|\})/.test(
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    ) && /shipping/i.test(text))

  check('no shipping rate is hardcoded in the app', offenders.map((o) => o.file), [])
  check('the rate table is read from meta, by lookup only',
    sources.some(({ text }) => text.includes('export function shippingRateFor')), true)
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
