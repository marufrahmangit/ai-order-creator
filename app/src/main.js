/**
 * App entry. Two screens for now: login, and the order list.
 *
 * No router - there are no URLs to speak of yet, and step 6 adds a form rather
 * than deep links. Swapping the contents of #app is enough and keeps the
 * back button out of a half-built navigation model.
 */

import './styles.css'
import { isConfigured, apiBase } from './api.js'
import { isSignedIn, clearCredential, getCredential } from './auth.js'
import { loadMeta, clearMeta } from './meta.js'
import { LoginView } from './views/login.js'
import { OrdersView } from './views/orders.js'
import { el, clear } from './dom.js'

const root = document.getElementById('app')

function mount(view) {
  clear(root)
  root.append(view)
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
  // A different user must not inherit the previous one's cached lists.
  clearMeta()
  showLogin()
}

async function showOrders() {
  // /meta has to be loaded before the list renders: it supplies the status
  // dropdown and the currency and decimal places money is formatted with.
  mount(el('main', { class: 'loading' }, [el('p', { text: 'Loading…' })]))

  try {
    await loadMeta()
  } catch (error) {
    // A 401 here means the stored credential is dead; api.js has already
    // cleared it and fired orderops:signedout, which routes to the login
    // screen. Anything else is worth showing, with a way out.
    if (error?.status === 401) return

    mount(
      el('main', { class: 'setup' }, [
        el('h1', { text: 'Could not start' }),
        el('p', { text: error?.message || 'Failed to load settings from the server.' }),
        el('p', { class: 'muted', text: `API: ${apiBase()}` }),
        el('div', { class: 'setup-actions' }, [
          el('button', { type: 'button', class: 'button primary', text: 'Try again', onClick: showOrders }),
          el('button', { type: 'button', class: 'button', text: 'Sign out', onClick: signOut }),
        ]),
      ]),
    )
    return
  }

  mount(OrdersView({ onSignOut: signOut }))
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

if (!isConfigured()) {
  showSetupNeeded()
} else if (isSignedIn() && getCredential()) {
  showOrders()
} else {
  showLogin()
}
