/**
 * The confirmation toast, and the line it must not cross.
 *
 * A toast confirms something that happened and needs no action, so it is
 * allowed to vanish. A WARNING needs reading and often acting on, and an ERROR
 * means the thing did not happen - neither may be a toast, because a failed
 * save flashing for a second is how an order silently does not exist.
 *
 * That distinction is the thing most likely to be flattened later by someone
 * making every message a toast because toasts look tidy, so it is asserted
 * here rather than only written down.
 *
 * Also pinned: that a save with warnings shows BOTH - the toast says it saved,
 * the page says what to look at - and that the trash toast survives the
 * navigation that follows it, which is the whole reason the layer hangs off
 * document.body instead of the view.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { installDom, loadable, VIEW_MODULES, findNode, fire, settle, SRC } from './dom-shim.mjs'

installDom()

const LOADED = {
  id: 412, number: '412', status: 'pending', status_label: 'Pending payment',
  date_created: '2026-10-12T10:00:00+06:00',
  billing: { first_name: 'A', phone: '01771160171', address_1: 'X', state: 'BD-13' },
  line_items: [{ id: 1, product_id: 9, name: 'Thing', quantity: '1', subtotal: '500.00', total: '500.00' }],
  shipping_lines: [{ id: 2, method_title: 'Dhaka Flat Rate', total: '80.00' }],
  fee_lines: [], customer_note: '', total: '580.00', currency: 'BDT',
}

let saveWarnings = []
let failSave = false
let failTrash = false

globalThis.fetch = async (url, options = {}) => {
  const u = String(url)
  const method = options.method || 'GET'

  if (u.includes('/meta')) {
    return json({
      states: [{ code: 'BD-13', label: 'Dhaka' }],
      statuses: [{ slug: 'pending', label: 'Pending payment' }],
      currency: 'BDT', price_decimals: 2, plugin_version: '7.7',
      shipping_rates: { default: { cost: '150.00', label: 'Outside' }, by_state: {} },
    })
  }
  if (u.includes('/last-order')) return json({ found: false })
  if (u.includes('/trash')) {
    if (failTrash) return json({ message: 'Could not trash the order.' }, 500)
    return json({ id: 412, status: 'trash' })
  }
  if (method === 'POST') {
    if (failSave) return json({ message: 'Server exploded.' }, 500)
    return json({ order: LOADED, warnings: saveWarnings })
  }
  if (u.includes('/orders/')) return json(LOADED)
  return json({})
}

function json(payload, status = 200) {
  return {
    ok: status < 400, status, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const { load, cleanup } = loadable(VIEW_MODULES)
const { loadMeta } = await load('meta.js')
await loadMeta()
const { OrderFormView } = await load('views/order-form.js')

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
const ok = (name, cond) => check(name, !!cond, true)

const hasClass = (node, cls) => String(node?.className ?? '').split(' ').includes(cls)
const find = (node, pred) => findNode(node, pred)

/** The toast layer lives on document.body, not inside any view. */
const layerNode = () => find(document.body, (n) => hasClass(n, 'toast-layer'))
const toastNode = () => {
  const layer = layerNode()
  return layer ? find(layer, (n) => hasClass(n, 'toast')) : null
}
const toastLabel = () => {
  const toast = toastNode()
  const span = toast ? find(toast, (n) => hasClass(n, 'toast-label')) : null
  return span ? String(span.textContent) : null
}
const toastIcon = () => {
  const toast = toastNode()
  return toast ? find(toast, (n) => hasClass(n, 'toast-icon')) : null
}

const statusOf = (view) =>
  String(find(view, (n) => hasClass(n, 'status-line'))?.textContent ?? '')
/**
 * All the text under a node, concatenated.
 *
 * Walks rather than stringifying: shim nodes carry a parentNode back-reference,
 * so JSON.stringify on one cycles.
 */
function textUnder(node) {
  if (!node || typeof node !== 'object') return ''
  let out = String(node.textContent ?? '')
  for (const kid of node.children || []) out += ' ' + textUnder(kid)
  return out
}

const warningsTextOf = (view) =>
  textUnder(find(view, (n) => hasClass(n, 'warnings')))

const saveOf = (view) =>
  find(view, (n) => n.className === 'button primary' && String(n.textContent).startsWith('Save'))

async function openForm() {
  document.body.replaceChildren()
  const view = OrderFormView({ orderId: 412, onClose: () => {}, onOpenOrder: () => {} })
  await settle(350)
  return view
}

// ---- a clean save ---------------------------------------------------------
{
  saveWarnings = []
  failSave = false
  const view = await openForm()

  ok('no toast before anything happens', !toastNode())

  fire(saveOf(view), 'click')
  await settle(200)

  ok('saving shows a toast', !!toastNode())
  check('with the saved label', toastLabel(), 'Order saved')
  ok('and an icon beside it', !!toastIcon())
  ok('the icon is an SVG, not a font or an image', toastIcon()?.tagName === 'SVG')
  ok('the icon is drawn from paths', (toastIcon()?.children || []).length >= 1)
  ok('the icon is hidden from screen readers, since the label carries it',
    toastIcon()?.attributes?.['aria-hidden'] === 'true')
  ok('the toast is marked as the saved kind', hasClass(toastNode(), 'toast-saved'))
  ok('the layer announces politely', layerNode()?.attributes?.['aria-live'] === 'polite')

  // The confirmation moved OFF the status line, which is the point.
  check('the status line is not carrying the confirmation', statusOf(view), '')

  // ---- and it goes away on its own ----------------------------------------
  await settle(900)
  ok('it starts leaving after about a second', hasClass(toastNode(), 'is-leaving'))
  await settle(400)
  ok('and is gone, with no dismiss needed', !toastNode())
  ok('but the layer is left in place for the next one', !!layerNode())
}

// ---- a save that returns warnings ----------------------------------------
{
  saveWarnings = ['Product 9200 was skipped: no such product.', 'Quantity rounded to 1.5.']
  failSave = false
  const view = await openForm()

  fire(saveOf(view), 'click')
  await settle(200)

  ok('a save WITH warnings still toasts the confirmation', !!toastNode())
  check('and the toast still says it saved', toastLabel(), 'Order saved')

  // The warnings themselves must stay on the page.
  const rendered = warningsTextOf(view)
  ok('the warnings are rendered in the form, not the toast',
    rendered.includes('no such product'))
  ok('both warnings, not just the first', rendered.includes('Quantity rounded'))
  ok('and the status line points at them', /notes above/i.test(statusOf(view)))

  // After the toast has gone, the warnings are still there to act on.
  await settle(1400)
  ok('the toast is gone', !toastNode())
  ok('the warnings are NOT', warningsTextOf(view).includes('no such product'))
}

// ---- a failed save is never a toast --------------------------------------
{
  saveWarnings = []
  failSave = true
  const view = await openForm()

  fire(saveOf(view), 'click')
  await settle(300)

  ok('a failed save shows NO toast', !toastNode())
  ok('the error is in the status line, where it stays', /explod|could not/i.test(statusOf(view)))

  await settle(1400)
  ok('and it is still there a second later', /explod|could not/i.test(statusOf(view)))
  failSave = false
}

// ---- trash: toasts, and survives the navigation --------------------------
{
  const view = await openForm()
  let navigated = false
  const trashView = OrderFormView({
    orderId: 412,
    onClose: () => { navigated = true },
    onOpenOrder: () => {},
  })
  await settle(350)
  void view

  // Two taps: the trash action asks for its own confirmation first.
  const trashButton = find(trashView, (n) => String(n.textContent) === 'Move to trash')
  ok('the form offers a trash action', !!trashButton)
  fire(trashButton, 'click')
  await settle(50)
  // The confirmation panel's own button, which is the one that actually writes.
  const confirmButton = find(trashView, (n) => String(n.textContent) === 'Trash order')
  ok('the confirmation panel offers Trash order', !!confirmButton)
  fire(confirmButton, 'click')
  await settle(300)

  ok('trashing navigates away', navigated)
  ok('and the toast is showing', !!toastNode())
  check('with the trash label', toastLabel(), 'Moved to trash')
  ok('marked as the trash kind', hasClass(toastNode(), 'toast-trash'))

  /*
   * The point of the layer being on document.body: main.js's mount() clears
   * #app on navigation, so a toast inside the view would be destroyed at the
   * instant it was created. Asserted by checking it is NOT inside the view.
   */
  ok('the toast is not inside the form it was fired from',
    !find(trashView, (n) => hasClass(n, 'toast')))
  ok('it hangs off document.body instead', !!find(document.body, (n) => hasClass(n, 'toast')))

  await settle(1400)
  ok('and it leaves on its own like the other one', !toastNode())
}

// ---- a failed trash is never a toast -------------------------------------
{
  failTrash = true
  const view = OrderFormView({ orderId: 412, onClose: () => {}, onOpenOrder: () => {} })
  await settle(350)
  document.body.replaceChildren()

  const trashButton = find(view, (n) => String(n.textContent) === 'Move to trash')
  fire(trashButton, 'click')
  await settle(50)
  const confirmButton = find(view, (n) => String(n.textContent) === 'Trash order')
  fire(confirmButton, 'click')
  await settle(300)

  ok('a failed trash shows NO toast', !toastNode())
  ok('the error stays in the status line', /could not trash/i.test(statusOf(view)))
  failTrash = false
}

// ---- the stylesheet half of the contract ---------------------------------
{
  const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')
  const rule = (selector) => {
    const match = css.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
    )
    return match ? match[1] : ''
  }

  ok('the layer is fixed, so showing a toast cannot shift the layout',
    /position:\s*fixed/.test(rule('.toast-layer')))
  ok('and never takes pointer events, so it cannot swallow a tap on Save',
    /pointer-events:\s*none/.test(rule('.toast-layer')))
  ok('the toast itself does not re-enable them',
    !/pointer-events:\s*(auto|all)/.test(rule('.toast')))
  ok('it is centred', /align-items:\s*center/.test(rule('.toast-layer'))
    && /justify-content:\s*center/.test(rule('.toast-layer')))
  ok('the mark animates by stroke-dash, not a spin or a bounce',
    /stroke-dashoffset/.test(rule('.toast-icon path'))
    && !/rotate|spin|bounce/i.test(rule('.toast-icon path')))

  // Reduced motion must keep the message and drop the movement.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  ok('reduced motion is honoured', reduced.length > 0)
  ok('it removes the animation', /animation:\s*none/.test(reduced))
  ok('and leaves the mark fully drawn rather than hiding it',
    /stroke-dashoffset:\s*0/.test(reduced))
  ok('it does not hide the toast', !/\.toast\s*\{[^}]*display:\s*none/.test(reduced))

  // Colours come from the tokens, not from literals in the rule.
  ok('the saved mark uses the --success token',
    /stroke:\s*var\(--success\)/.test(rule('.toast-saved .toast-icon')))
  ok('the trash mark uses the --danger token',
    /stroke:\s*var\(--danger\)/.test(rule('.toast-trash .toast-icon')))
  ok('the label uses the --ink token', /color:\s*var\(--ink\)/.test(rule('.toast-label')))
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
