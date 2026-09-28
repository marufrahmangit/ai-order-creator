/**
 * Login screen.
 *
 * Staff type the WordPress username and password they already know. POST
 * /token verifies those and returns an application password, which is what
 * gets stored; the account password lives only in this form's field and in
 * that one request.
 */

import { login } from '../api.js'
import { setCredential } from '../auth.js'
import { el } from '../dom.js'

/**
 * @param {{ onSignedIn: () => void }} options
 * @returns {HTMLElement}
 */
export function LoginView({ onSignedIn }) {
  const error = el('p', { class: 'error', role: 'alert', hidden: true })

  const username = el('input', {
    type: 'text',
    id: 'username',
    name: 'username',
    required: true,
    // Phone keyboards default to capitalising and autocorrecting, which
    // quietly mangles a username.
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: false,
    autocomplete: 'username',
  })

  const password = el('input', {
    type: 'password',
    id: 'password',
    name: 'password',
    required: true,
    autocomplete: 'current-password',
  })

  const submit = el('button', { type: 'submit', class: 'button primary', text: 'Sign in' })

  function showError(message) {
    error.textContent = message
    error.hidden = false
  }

  function clearError() {
    error.textContent = ''
    error.hidden = true
  }

  function setBusy(busy) {
    submit.disabled = busy
    username.disabled = busy
    password.disabled = busy
    submit.textContent = busy ? 'Signing in…' : 'Sign in'
  }

  async function handleSubmit(event) {
    event.preventDefault()
    clearError()

    // Trimmed because a phone keyboard's autocomplete happily appends a space.
    // The password is NOT trimmed - leading or trailing spaces could be part
    // of it, and wp_authenticate() applies its own trim server-side, so doing
    // it here too could only reject something the login form accepts.
    const user = username.value.trim()
    const pass = password.value

    if (user === '' || pass === '') {
      showError('Enter both a username and a password.')
      return
    }

    setBusy(true)
    try {
      const token = await login(user, pass)
      setCredential(token)

      // Do not leave the account password sitting in a live DOM node.
      password.value = ''

      onSignedIn()
    } catch (err) {
      // The API's own messages are already written for a person: one generic
      // line for any bad credential, a distinct one for an account without
      // permission, and the throttle's message states the wait. Showing them
      // verbatim keeps this screen honest about which is which.
      showError(err?.message || 'Could not sign in.')
      setBusy(false)
      password.select()
    }
  }

  const form = el('form', { class: 'login-form', novalidate: true, onSubmit: handleSubmit }, [
    el('h1', { class: 'login-title', text: 'Order Ops' }),
    el('p', { class: 'login-hint', text: 'Sign in with your WordPress username and password.' }),
    error,
    el('div', { class: 'field' }, [
      el('label', { for: 'username', text: 'Username' }),
      username,
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'password', text: 'Password' }),
      password,
    ]),
    submit,
  ])

  const view = el('main', { class: 'login' }, [form])

  // Focus is deliberately not forced on mobile: it pops the keyboard over the
  // form on load. Desktop users can tab straight in.

  return view
}
