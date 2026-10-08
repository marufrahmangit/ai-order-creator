/**
 * App entry. Three screens: login, the order list, and the order form.
 *
 * Still no router. Swapping the contents of #app covers it, and the form is
 * reached from the list rather than from a URL, so there is nothing to put in
 * one yet. If deep links are ever wanted - opening an order from a message, say
 * - that is the point to add one, and it will want real history handling rather
 * than a hash.
 */

import './styles.css'
import { isConfigured, apiBase } from './api.js'
import { isSignedIn, clearCredential, getCredential } from './auth.js'
import { loadMeta, clearMeta } from './meta.js'
import { clearProductCache } from './views/product-picker.js'
import { initPwa } from './pwa.js'
import { LoginView } from './views/login.js'
import { OrdersView } from './views/orders.js'
import { OrderFormView } from './views/order-form.js'
import { el, clear } from './dom.js'
import { clearUnsavedCheck } from './exit-guard.js'

const root = document.getElementById('app')

/**
 * The screen currently shown or being navigated to, e.g. 'form:412'.
 *
 * A second tap on the same target must not mount a second copy of the screen
 * and repeat its load. That is easy to do on a phone, and far easier when the
 * first request is slow - which is exactly when it happens.
 */
let route = null

/**
 * Abort controller for the current screen's READ requests.
 *
 * Writes are deliberately NOT given this signal. Aborting a POST after the
 * server has already committed loses the response while keeping the change:
 * for POST /orders that means losing the new order's id, and the natural
 * reaction - try again - creates a second order. A read is safe to abandon; a
 * write is not.
 */
let reads = null

function beginScreen(key) {
  route = key
  // Whatever screen was mounted is going. If it had unsaved work, the guard
  // must stop asking about it - otherwise a form already left behind would
  // make Reload on the order list warn about edits nobody can see.
  clearUnsavedCheck()
  reads?.abort()
  reads = new AbortController()
  return reads.signal
}

function mount(view) {
  clear(root)
  root.append(view)
  // Each screen starts at the top. Without this, opening an order from halfway
  // down the list lands the form mid-scroll.
  window.scrollTo(0, 0)
}

/**
 * app/.env.local is untracked by design, so a fresh clone has no VITE_API_BASE
 * and every request would fail with something unhelpful. Say so plainly
 * instead.
 */
function showSetupNeeded() {
  mount(
    el('main', { class: 'setup' }, [
      el('h1', { text: 'Not configured' }),
      el('p', { text: 'VITE_API_BASE is not set, so the app has no API to talk to.' }),
      el('pre', { class: 'code', text: 'cp app/.env.example app/.env.local' }),
      el('p', { text: 'Fill in the REST root, then restart the dev server.' }),
    ]),
  )
}

function showLogin() {
  beginScreen('login')
  mount(LoginView({ onSignedIn: showOrders }))
}

/**
 * Sign out is local-only: it forgets the credential without revoking the
 * application password server-side, which the API cannot do yet. The stored
 * uuid is there for that route when it exists. Until then, revoking for real
 * means deleting it in wp-admin.
 */
function signOut() {
  clearCredential()
  // A different user must not inherit the previous one's cached lists, nor the
  // product search results cached for this session.
  clearMeta()
  clearProductCache()
  route = null
  showLogin()
}

function showStartupFailure(error, retry) {
  mount(
    el('main', { class: 'setup' }, [
      el('h1', { text: 'Could not start' }),
      el('p', { text: error?.message || 'Failed to load settings from the server.' }),
      el('p', { class: 'muted', text: `API: ${apiBase()}` }),
      el('div', { class: 'setup-actions' }, [
        el('button', { type: 'button', class: 'button primary', text: 'Try again', onClick: retry }),
        el('button', { type: 'button', class: 'button', text: 'Sign out', onClick: signOut }),
      ]),
    ]),
  )
}

/**
 * Both signed-in screens need /meta before they render: it supplies the status
 * and district dropdowns, and the currency and decimal places money is
 * formatted with. It is cached for the session, so only the first call costs a
 * request.
 *
 * @param {() => void} render
 */
async function withMeta(render) {
  mount(el('main', { class: 'loading' }, [el('p', { text: 'Loading…' })]))

  try {
    await loadMeta()
  } catch (error) {
    // A 401 here means the stored credential is dead; api.js has already
    // cleared it and fired orderops:signedout, which routes to the login
    // screen. Anything else is worth showing, with a way out.
    if (error?.status === 401) return
    showStartupFailure(error, () => withMeta(render))
    return
  }

  render()
}

function showOrders() {
  // Not guarded on the route: returning to the list after a save or a trash
  // has to re-render it, or a stale row stays on screen. The list manages its
  // own in-flight request per keystroke.
  beginScreen('orders')

  withMeta(() => mount(OrdersView({
    onSignOut: signOut,
    onOpenOrder: showOrderForm,
    onNewOrder: () => showOrderForm(null),
    onShowTrash: showTrash,
    onReorder: showReorderForm,
  })))
}

/**
 * A new order form pre-filled from an existing order.
 *
 * Reorder NEVER writes: this opens the same blank new-order form the + New
 * button does, with the fields and lines copied in. The order is created when
 * the user taps Save, and gets its number then.
 *
 * The route key names the source order, so reordering a different one is a
 * different screen rather than being swallowed by the repeat-tap guard.
 *
 * @param {object} order A full order, already fetched by the list.
 */
function showReorderForm(order) {
  const key = `form:new:from:${order?.id ?? '?'}`
  if (key === route) return

  const signal = beginScreen(key)

  withMeta(() => mount(OrderFormView({
    orderId: null,
    reorderFrom: order,
    onClose: showOrders,
    onOpenOrder: showOrderForm,
    onNewOrder: showNewOrderForm,
    signal,
  })))
}

/**
 * A blank new-order form, from the order form's own New order button.
 *
 * Bypasses the repeat-tap guard deliberately. From an unsaved new order the
 * route is already 'form:new', so showOrderForm(null) would see the same key
 * and do nothing - and discarding that form for a blank one is exactly what
 * was asked for. The form has already asked about unsaved changes by the time
 * this runs. A double tap is harmless: the second lands on a blank, clean form,
 * which simply mounts blank again.
 */
function showNewOrderForm() {
  route = null
  showOrderForm(null)
}

/**
 * The trash view: the same list, queried with status=trash, with a Restore
 * action per row and no way into the edit form.
 *
 * Reached by its own link rather than by a value in the status filter, because
 * trash is not a workflow state - the API draws the same line, and `trash`
 * never appears in /meta's status list. Returning to the list reloads it, so a
 * restored order shows up there.
 */
function showTrash() {
  beginScreen('trash')

  withMeta(() => mount(OrdersView({
    mode: 'trash',
    onSignOut: signOut,
    onClose: showOrders,
  })))
}

/**
 * The order form, for a new order (null) or an existing one.
 *
 * Closing always returns to the list and reloads it, so a saved change or a
 * trashed order is reflected rather than leaving a stale row on screen.
 *
 * The order is fetched exactly once, here, on entering the view. Saving
 * re-renders from the write response, and parsing changes nothing
 * server-side, so neither needs a follow-up GET.
 *
 * @param {number|null} orderId
 */
function showOrderForm(orderId) {
  const key = `form:${orderId ?? 'new'}`
  if (key === route) return

  const signal = beginScreen(key)

  withMeta(() => mount(OrderFormView({
    orderId: orderId ?? null,
    onClose: showOrders,
    // The repeat-customer card can open the previous order, which is the same
    // navigation the list uses.
    onOpenOrder: showOrderForm,
    onNewOrder: showNewOrderForm,
    signal,
  })))
}

/**
 * Raised by api.js when a request comes back 401 - a stored application
 * password that no longer authenticates, because it was revoked in wp-admin or
 * the account changed. The credential is already gone by the time this fires.
 */
window.addEventListener('orderops:signedout', () => {
  clearMeta()
  showLogin()
})

// Independent of which screen renders: the worker and the install offer are
// about the app as a whole, not about being signed in.
initPwa()

if (!isConfigured()) {
  showSetupNeeded()
} else if (isSignedIn() && getCredential()) {
  showOrders()
} else {
  showLogin()
}
