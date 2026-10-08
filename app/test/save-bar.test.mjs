/**
 * The order form's save bar: exactly one of them, always reachable, never on
 * top of the content.
 *
 * This exists because `position: sticky; bottom: 0` failed in a way that looks
 * like a duplicate button. A pinned sticky element keeps its space in the flow
 * at its ORIGINAL position, so nothing below it moves and the pinned bar paints
 * straight over whatever is behind it. On a form taller than the viewport the
 * save bar sat across the middle of the Items section, obscuring a line's price
 * inputs, while the one in the flow was further down the same page.
 *
 * Both halves of the rule are asserted, because fixing one without the other
 * reintroduces the bug: `fixed` alone still overlaps (it reserves no space
 * either), and reserved padding alone leaves the bar unreachable until the
 * bottom of a long form.
 *
 * Run with `npm test` from app/.
 */

import { installDom, loadable, VIEW_MODULES, settle } from './dom-shim.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

installDom()

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
// Comments stripped first: the rule parser below captures everything between
// one `}` and the next `{` as the selector, and a comment sitting above a rule
// would otherwise end up inside it.
const CSS = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

globalThis.fetch = async (url) => {
  const u = String(url)
  let payload = {}
  if (u.includes('/meta')) {
    payload = {
      states: [{ code: 'BD-13', label: 'Dhaka' }],
      statuses: [{ slug: 'pending', label: 'Pending payment' }],
      currency: 'BDT', price_decimals: 2, plugin_version: '7.0',
    }
  } else if (u.includes('/last-order')) payload = { found: false }
  else if (u.includes('/orders/')) {
    payload = {
      id: 412, number: '412', status: 'pending', status_label: 'Pending payment',
      date_created: '2026-10-07T10:00:00+06:00',
      billing: { first_name: 'A', phone: '01771160171', address_1: 'X', state: 'BD-13' },
      line_items: [{ id: 1, product_id: 9, name: 'Thing', quantity: '1', subtotal: '10.00', total: '10.00' }],
      shipping_lines: [], fee_lines: [], customer_note: '', total: '10.00', currency: 'BDT',
    }
  }
  return {
    ok: true, status: 200, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

/** Every node in the shim's tree matching a predicate. */
function findAll(node, predicate, hits = []) {
  if (!node || typeof node !== 'object') return hits
  if (predicate(node)) hits.push(node)
  for (const kid of node.children || []) findAll(kid, predicate, hits)
  return hits
}

/** The body of the FIRST rule whose selector matches exactly. */
function ruleBody(selector) {
  const bodies = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sel]) => sel.split(',').map((x) => x.trim()).includes(selector))
    .map(([, , body]) => body)
  return bodies
}

const declaration = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`).exec(body)
  return m ? m[1].trim() : null
}

/** The largest pixel figure in a value, which is what a calc() reserves. */
const pxIn = (value) => Math.max(
  0,
  ...[...String(value ?? '').matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])),
)

const { load, cleanup } = loadable(VIEW_MODULES)
const { loadMeta } = await load('meta.js')
await loadMeta()
const { OrderFormView } = await load('views/order-form.js')

// ---- exactly one save affordance, on both forms --------------------------
const SAVE_LABELS = ['Save order', 'Save changes', 'Saving…']
const saveButtons = (view) => findAll(view, (n) =>
  n.tagName === 'BUTTON' && SAVE_LABELS.some((l) => String(n.textContent).startsWith(l)))

{
  const view = OrderFormView({ orderId: null, onClose: () => {}, onOpenOrder: () => {} })
  await settle(150)
  check('a new order form has exactly one save button', saveButtons(view).length, 1)
  check('and it is labelled for creating', saveButtons(view)[0]?.textContent, 'Save order')
}

{
  const view = OrderFormView({ orderId: 412, onClose: () => {}, onOpenOrder: () => {} })
  await settle(400)
  check('a loaded order form has exactly one save button', saveButtons(view).length, 1)
  check('and it is labelled for updating', saveButtons(view)[0]?.textContent, 'Save changes')

  // One wrapper too: a second .form-actions would be a second bar even with one
  // button in each, which is the shape the reported screenshot had.
  check('exactly one save bar in the markup',
    findAll(view, (n) => String(n.className).includes('form-actions')).length, 1)
}

// ---- the bar does not paint over the content ------------------------------
{
  const bar = ruleBody('.form-actions')
  check('.form-actions is defined exactly once', bar.length, 1)

  const position = declaration(bar[0], 'position')
  check('the save bar is fixed, not sticky', position, 'fixed')
  check('sticky is gone specifically, since it reserves no space',
    position === 'sticky', false)
  check('it spans the viewport width', [
    declaration(bar[0], 'left'), declaration(bar[0], 'right'),
  ], ['0', '0'])
  check('it is pinned to the bottom', declaration(bar[0], 'bottom'), '0')
  check('and it paints above the sections it overlaps',
    Number(declaration(bar[0], 'z-index')) > 0, true)

  const main = ruleBody('.form-main')
  check('.form-main is defined exactly once, so the reservation cannot be ' +
        'silently overridden by a later rule', main.length, 1)

  // The reservation has to cover the bar, or the trash action sits under it.
  const reserved = pxIn(declaration(main[0], 'padding'))
  const barPadding = pxIn(declaration(bar[0], 'padding'))
  check('the form reserves room below its content', reserved > 0, true)
  check('and the reservation is larger than the bar\'s own padding, so it ' +
        'covers the button too', reserved > barPadding * 2, true)
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
