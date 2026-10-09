/**
 * Every way out of a dirty order form either warns first or deliberately does
 * not.
 *
 * Guarded, two-tap - the first tap warns through the status line, a second
 * tap on the SAME exit goes:
 *   - "‹ Orders", back to the list. Unguarded until app 0.7.0, so one tap
 *     discarded a half-filled form - and it is the most common way out.
 *   - "Open #N" on the last-order card.
 *   - "+ New order".
 *
 *   - The update banner's Reload (app 0.8.0), which discards the page. Same
 *     guard, same armed slot, via src/exit-guard.js.
 *
 * Deliberately NOT guarded, asserted so that stays a decision:
 *   - Trash. It has its own confirmation, and the edits belong to an order
 *     that is going away.
 *
 * A clean form goes straight out through all of them.
 *
 * WHERE the warning appears is asserted too. It used to go in the status line
 * at the top of the form, which on a long form has scrolled out of view, so
 * the guard read as a dead button. The form's warning is now inside the
 * sticky header; Reload's is in the banner's own text, where that tap was.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { installDom, loadable, VIEW_MODULES, findNode, fire, settle, SRC } from './dom-shim.mjs'

installDom()

const EDITING_ID = 412

const LOADED = {
  id: EDITING_ID, number: String(EDITING_ID), status: 'pending', status_label: 'Pending payment',
  date_created: '2026-10-08T10:00:00+06:00',
  billing: { first_name: 'A', phone: '01771160171', address_1: 'X', state: 'BD-13' },
  line_items: [{ id: 1, product_id: 9, name: 'Thing', quantity: '1', subtotal: '10.00', total: '10.00' }],
  shipping_lines: [], fee_lines: [], customer_note: '', total: '10.00', currency: 'BDT',
}

/** The same customer's genuine last order - a different one, so the card shows. */
const PREVIOUS = { ...LOADED, id: 399, number: '399' }

const requests = []

globalThis.fetch = async (url, options = {}) => {
  const u = String(url)
  requests.push({ url: u, method: options.method || 'GET' })

  let payload = {}
  if (u.includes('/meta')) {
    payload = {
      states: [{ code: 'BD-13', label: 'Dhaka' }],
      statuses: [{ slug: 'pending', label: 'Pending payment' }],
      currency: 'BDT', price_decimals: 2, plugin_version: '7.1',
    }
  } else if (u.includes('/last-order')) payload = { found: true, order: PREVIOUS }
  else if (u.includes('/trash')) payload = { id: EDITING_ID, status: 'trash' }
  else if (options.method === 'POST') payload = { order: LOADED, warnings: [] }
  else if (u.includes('/orders/')) payload = LOADED

  return {
    ok: true, status: 200, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

const { load, cleanup } = loadable(VIEW_MODULES)
const { loadMeta } = await load('meta.js')
await loadMeta()
const { OrderFormView } = await load('views/order-form.js')
const { showUpdateBanner } = await load('pwa.js')
const guard = await load('exit-guard.js')

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

const byText = (view, text) => findNode(view, (n) => n.textContent === text)
const byClass = (view, cls) => findNode(view, (n) => String(n.className).split(' ').includes(cls))
/** The form's unsaved-changes warning, which lives in the sticky header. */
const warningOf = (view) => byClass(view, 'exit-warning')
const statusText = (view) => byClass(view, 'exit-warning-text')?.textContent || ''
const keepOf = (view) => byText(view, 'Keep editing')
const backOf = (view) => byText(view, '‹ Orders')
const newOf = (view) => byText(view, '+ New order')
const openOf = (view) => byClass(view, 'last-order-open')
const saveOf = (view) => findNode(view, (n) => n.className === 'button primary' && String(n.textContent).startsWith('Save'))

/** A loaded order, with counters for every exit. */
async function form() {
  const calls = { close: 0, open: [], new: 0 }
  const view = OrderFormView({
    orderId: EDITING_ID,
    onClose: () => { calls.close++ },
    onOpenOrder: (id) => { calls.open.push(id) },
    onNewOrder: () => { calls.new++ },
  })
  // Long enough for the load and the debounced last-order lookup behind it.
  await settle(700)
  return { view, calls }
}

/** An unsaved edit, made the way a person makes one. */
function edit(view, value = 'Someone else') {
  const name = findNode(view, (n) => n.id === 'of-name')
  name.value = value
  fire(name, 'input')
}

// ---- ‹ Orders --------------------------------------------------------------
{
  const { view, calls } = await form()
  fire(backOf(view), 'click')
  check('‹ Orders on a clean form goes straight back', calls.close, 1)
}
{
  const { view, calls } = await form()
  edit(view)

  fire(backOf(view), 'click')
  check('‹ Orders with unsaved changes: the first tap only warns', calls.close, 0)
  check('and says what would be lost, and how to go anyway',
    statusText(view), 'Unsaved changes here. Tap ‹ Orders again to discard them and go back to the list.')

  fire(backOf(view), 'click')
  check('the second tap goes back', calls.close, 1)
}
{
  const { view, calls } = await form()
  const name = findNode(view, (n) => n.id === 'of-name')
  name.value = 'Changed'
  fire(name, 'input')
  name.value = 'A'
  fire(name, 'input')
  fire(backOf(view), 'click')
  // The dirty set records that a field was TOUCHED, not that it differs - the
  // same rule the save payload uses. Erring toward a warning is the safe side.
  check('a field edited and put back still counts as unsaved', calls.close, 0)
}

// ---- Open #N on the last-order card ---------------------------------------
{
  const { view, calls } = await form()
  check('the card offers Open for the previous order', !!openOf(view), true)
  fire(openOf(view), 'click')
  check('Open on a clean form goes straight there', calls.open, [399])
}
{
  const { view, calls } = await form()
  edit(view)

  fire(openOf(view), 'click')
  check('Open with unsaved changes: the first tap only warns', calls.open, [])
  check('and says so', /^Unsaved changes here\. Tap Open again/.test(statusText(view)), true)

  fire(openOf(view), 'click')
  check('the second tap opens it', calls.open, [399])
}

// ---- + New order -----------------------------------------------------------
{
  const { view, calls } = await form()
  edit(view)
  fire(newOf(view), 'click')
  check('New order with unsaved changes: the first tap only warns', calls.new, 0)
  fire(newOf(view), 'click')
  check('the second tap goes', calls.new, 1)
}

// ---- a warning licenses only the exit it was shown for ---------------------
{
  const { view, calls } = await form()
  edit(view)

  fire(backOf(view), 'click')
  fire(newOf(view), 'click')
  check('arming ‹ Orders does not wave New order through', calls.new, 0)
  check('New order warns in its own words', /Tap New order again/.test(statusText(view)), true)

  fire(backOf(view), 'click')
  check('and arming New order disarmed ‹ Orders', calls.close, 0)
  fire(backOf(view), 'click')
  check('which then goes on its own second tap', calls.close, 1)
}
{
  const { view, calls } = await form()
  edit(view)
  fire(backOf(view), 'click')

  // Saving makes the warning moot. Edits made AFTER the save are new work,
  // and the old warning must not license discarding them.
  fire(saveOf(view), 'click')
  await settle(200)
  edit(view, 'Edited after saving')

  fire(backOf(view), 'click')
  check('a warning shown before a save does not carry over to edits after it', calls.close, 0)
  check('it warns afresh', /Tap ‹ Orders again/.test(statusText(view)), true)
}

// ---- the warning is where the user can see it ------------------------------
{
  const { view, calls } = await form()
  check('no warning is showing on a fresh form', warningOf(view)?.hidden, true)

  edit(view)
  fire(backOf(view), 'click')

  const header = findNode(view, (n) => n.tagName === 'HEADER')
  check('the warning is showing', warningOf(view)?.hidden, false)
  check('and it is INSIDE the sticky header, so it is on screen however far down the form is scrolled',
    !!findNode(header, (n) => n === warningOf(view)), true)
  check('the status line, which scrolls away, is not used for it',
    /Unsaved/.test(byClass(view, 'status-line')?.textContent || ''), false)
  check('it is announced, not just painted', warningOf(view)?.attributes?.role, 'alert')

  fire(keepOf(view), 'click')
  check('Keep editing takes the warning down', warningOf(view)?.hidden, true)
  check('and stays on the form', calls.close, 0)

  fire(backOf(view), 'click')
  check('after Keep editing, ‹ Orders warns again rather than going', calls.close, 0)
  check('with the warning back up', warningOf(view)?.hidden, false)
}
{
  const { view } = await form()
  edit(view)
  fire(backOf(view), 'click')
  fire(saveOf(view), 'click')
  await settle(200)
  check('saving takes the warning down', warningOf(view)?.hidden, true)
}

// ---- the update banner's Reload --------------------------------------------
const bannerOf = () => findNode(document.body, (n) => n.className === 'pwa-banner')
const bannerText = () => findNode(bannerOf(), (n) => n.className === 'pwa-banner-text')?.textContent
const reloadOf = () => findNode(bannerOf(), (n) => n.textContent === 'Reload')
const dismissOf = () => findNode(bannerOf(), (n) => n.textContent === 'Dismiss')

{
  guard.clearUnsavedCheck()
  let reloads = 0
  showUpdateBanner(() => { reloads++ })
  fire(reloadOf(), 'click')
  check('Reload with no form mounted reloads straight away', reloads, 1)
  check('and the banner goes', bannerOf(), null)
}
{
  const { view } = await form()
  let reloads = 0
  showUpdateBanner(() => { reloads++ })
  fire(reloadOf(), 'click')
  check('Reload over a CLEAN form reloads straight away', reloads, 1)
  void view
}
{
  const { view } = await form()
  edit(view)
  let reloads = 0
  showUpdateBanner(() => { reloads++ })

  fire(reloadOf(), 'click')
  check('Reload over a dirty form: the first tap only warns', reloads, 0)
  check('the banner stays up', !!bannerOf(), true)
  check('and the warning is in the banner, where the tap was',
    bannerText(), 'Unsaved changes in this order. Tap Reload again to discard them and update.')

  fire(reloadOf(), 'click')
  check('the second tap reloads', reloads, 1)
}
{
  const { view, calls } = await form()
  edit(view)
  let reloads = 0
  showUpdateBanner(() => { reloads++ })

  fire(reloadOf(), 'click')
  fire(backOf(view), 'click')
  check('arming Reload does not wave ‹ Orders through', calls.close, 0)
  check('and the banner takes its warning down when another exit is armed', bannerText(), 'An update is ready.')

  fire(reloadOf(), 'click')
  check('arming ‹ Orders disarmed Reload', reloads, 0)
  check('the form takes its warning down in turn', warningOf(view)?.hidden, true)

  fire(dismissOf(), 'click')
  showUpdateBanner(() => { reloads++ })
  fire(reloadOf(), 'click')
  check('a dismissed banner does not leave a later Reload armed', reloads, 0)
}
{
  // Leaving a dirty form for the list must stop the guard asking about it.
  // main.js does that in beginScreen(); the module half is asserted here.
  const { view } = await form()
  edit(view)
  guard.clearUnsavedCheck()
  let reloads = 0
  showUpdateBanner(() => { reloads++ })
  fire(reloadOf(), 'click')
  check('once the form is left behind, Reload no longer warns about it', reloads, 1)
}

// ---- Trash: deliberately not guarded ---------------------------------------
{
  const { view, calls } = await form()
  edit(view)

  fire(byText(view, 'Move to trash'), 'click')
  fire(byText(view, 'Trash order'), 'click')
  await settle(200)

  check('trashing a dirty order goes back after its own confirmation alone', calls.close, 1)
  check('without the unsaved-changes warning', /Unsaved changes/.test(statusText(view)), false)
  check('and the trash request was sent', requests.some((r) => r.url.includes(`/orders/${EDITING_ID}/trash`)), true)
}

// ---- source-level facts ----------------------------------------------------
{
  const formSource = fs.readFileSync(path.join(SRC, 'views', 'order-form.js'), 'utf8')
  check('the header link goes through the guard, not straight to onClose',
    /text: '‹ Orders', onClick: requestClose/.test(formSource), true)

  // The strip is on screen because the header is sticky, and it does not move
  // the page because it overlays rather than growing the header. Both are
  // stylesheet facts, so they are read from the stylesheet.
  const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
  }
  check('the header the warning lives in is sticky', /position:\s*sticky/.test(rule('.app-header')), true)
  check('the warning overlays the content rather than making the header taller',
    /position:\s*absolute/.test(rule('.exit-warning')), true)

  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')
  check('every navigation clears the guard, so a form left behind cannot make Reload warn',
    /function beginScreen\(key\) \{[\s\S]{0,300}?clearUnsavedCheck\(\)/.test(main), true)

  // A beforeunload prompt fires on reload and tab close too, with a generic
  // message no browser lets the page word. Decided against; see DECISIONS.md.
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/beforeunload/.test(fs.readFileSync(full, 'utf8'))) offenders.push(entry.name)
    }
  }
  walk(SRC)
  check('no beforeunload handler anywhere in src/', offenders, [])
}

cleanup()

let failed = 0
for (const result of results) {
  if (!result.pass) failed++
  console.log(
    `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}` +
      (result.pass ? '' : `\n        expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`),
  )
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exitCode = failed === 0 ? 0 : 1
