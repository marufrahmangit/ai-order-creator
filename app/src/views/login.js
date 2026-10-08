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
    // Typed passwords are not words; a phone must not "correct" them while
    // the field is showing as text.
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: false,
  })

  /*
   * Show / Hide for the password. Hidden by default.
   *
   *   - A real BUTTON BESIDE the field, outside its border, with a word on it.
   *     Not an icon inside the input, which on a small screen reads as part of
   *     what was typed, and not a checkbox under it, which is a second target
   *     to find. At the field's right-hand end, where a right thumb already is,
   *     and full tap height.
   *   - type="button", so it can never submit the form.
   *   - It does not take focus: pressing it would otherwise blur the field and,
   *     on a phone, drop the keyboard mid-password.
   *   - Password managers key on type="password" plus autocomplete. The field
   *     keeps both its name and its autocomplete whichever way it is showing,
   *     and it is turned back to type="password" BEFORE the form submits, so a
   *     manager offering to save or update the login sees a password field,
   *     and the value is never left showing on the next screen.
   */
  const toggle = el('button', {
    type: 'button',
    class: 'button password-toggle',
    text: 'Show',
    'aria-controls': 'password',
    'aria-pressed': 'false',
    'aria-label': 'Show password',
    onMousedown: (event) => event.preventDefault(),
    onClick: () => setPasswordVisible(password.type === 'password'),
  })

  function setPasswordVisible(visible) {
    password.type = visible ? 'text' : 'password'
    toggle.textContent = visible ? 'Hide' : 'Show'
    toggle.setAttribute('aria-pressed', visible ? 'true' : 'false')
    toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password')
  }

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
    toggle.disabled = busy
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

    // Back to a password field before anything leaves the form - see the
    // toggle above for why.
    setPasswordVisible(false)

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
    // The store's logo, drawn for a white background - which is what the
    // sign-in card is. Generated from public/icons/logo.png by
    // scripts/make-icons.mjs at twice the size it is shown, for sharp
    // edges on a phone's screen. width/height reserve its space before it
    // loads, so the form does not jump.
    el('img', {
      class: 'login-logo',
      src: '/icons/logo-login.png',
      alt: 'CartMix',
      width: 200,
      height: 91,
      decoding: 'async',
    }),
    el('h1', { class: 'login-title', text: 'Order Ops' }),
    el('p', { class: 'login-hint', text: 'Sign in with your WordPress username and password.' }),
    error,
    el('div', { class: 'field' }, [
      el('label', { for: 'username', text: 'Username' }),
      username,
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'password', text: 'Password' }),
      el('div', { class: 'password-row' }, [password, toggle]),
    ]),
    submit,
  ])

  const view = el('main', { class: 'login' }, [form])

  // Focus is deliberately not forced on mobile: it pops the keyboard over the
  // form on load. Desktop users can tab straight in.

  return view
}
