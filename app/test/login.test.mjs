/**
 * The login screen's Show/Hide password toggle, and the fact that a sign-in
 * persists.
 *
 * Persistence is asserted because a "remember me" option was requested on the
 * belief that staff were being signed out - and the design already keeps the
 * credential in localStorage until an explicit sign-out. These checks are the
 * evidence for not adding one: a stored sign-in survives a relaunch (a fresh
 * copy of auth.js reading the same storage), a failure that is NOT a 401 does
 * not sign anyone out, and only three code paths can remove the credential at
 * all. What does look like being signed out is per-origin storage - see
 * "Signing in persists" in docs/PROJECT-STATE.md.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { installDom, loadable, VIEW_MODULES, findNode, fire, settle, SRC } from './dom-shim.mjs'

const { storage } = installDom()
// installDom() seeds a credential for the view suites. This one starts signed out.
storage.removeItem('orderops.credential')

const TOKEN = {
  username: 'staff', password: 'abcd efgh ijkl mnop', display_name: 'Staff Member',
  user_id: 3, uuid: 'b6f1c2d0-0000-4000-8000-000000000000', name: 'Order Ops (app) 2026-10-08',
}

let respond = () => ({ status: 201, body: TOKEN })
let typeAtRequest = null
let passwordField = null

globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('/token')) typeAtRequest = passwordField?.type
  const { status, body } = respond(String(url), options)
  return {
    ok: status >= 200 && status < 300, status, type: 'basic',
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }
}

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

const first = loadable(VIEW_MODULES)
const { LoginView } = await first.load('views/login.js')
const api = await first.load('api.js')

const byId = (view, id) => findNode(view, (n) => n.id === id)
/** A property the real DOM has, which the shim may hold as an attribute instead. */
const attr = (node, name) => node?.[name] ?? node?.attributes?.[name]
const toggleOf = (view) => findNode(view, (n) => String(n.className).includes('password-toggle'))

// ---- the toggle -------------------------------------------------------------
{
  const view = LoginView({ onSignedIn: () => {} })
  const password = byId(view, 'password')
  const toggle = toggleOf(view)
  const row = findNode(view, (n) => n.className === 'password-row')

  check('the password field is hidden by default', password.type, 'password')
  check('there is a Show button', toggle?.textContent, 'Show')
  check('it is a button that cannot submit the form', toggle?.type, 'button')
  check('it sits BESIDE the field, outside it, not inside it',
    row?.children?.length === 2 && row.children[0] === password && row.children[1] === toggle, true)
  check('it says what it controls', toggle?.attributes?.['aria-controls'], 'password')
  check('and that it is not pressed', toggle?.attributes?.['aria-pressed'], 'false')

  let kept = false
  fire(toggle, 'mousedown', { preventDefault: () => { kept = true } })
  check('pressing it does not take focus from the field, so a phone keeps its keyboard', kept, true)

  fire(toggle, 'click')
  check('Show reveals the password', password.type, 'text')
  check('and becomes Hide', toggle.textContent, 'Hide')
  check('pressed', toggle.attributes['aria-pressed'], 'true')
  check('and its accessible name follows', toggle.attributes['aria-label'], 'Hide password')

  // What a password manager keys on must survive the toggle.
  check('the field keeps its autocomplete while showing', attr(password, 'autocomplete'), 'current-password')
  check('and its name', attr(password, 'name'), 'password')
  check('and a phone will not autocorrect what is showing', attr(password, 'autocorrect'), 'off')

  fire(toggle, 'click')
  check('Hide hides it again', password.type, 'password')
  check('and is Show again', toggle.textContent, 'Show')
}

// ---- submitting while it is showing ----------------------------------------
{
  let signedIn = 0
  const view = LoginView({ onSignedIn: () => { signedIn++ } })
  passwordField = byId(view, 'password')
  byId(view, 'username').value = 'staff'
  passwordField.value = 'their-account-password'
  fire(toggleOf(view), 'click')
  check('(the password is showing as text before submit)', passwordField.type, 'text')

  fire(findNode(view, (n) => n.tagName === 'FORM'), 'submit')
  await settle(100)

  check('it is a password field again BEFORE the request, so a manager sees one', typeAtRequest, 'password')
  check('and the toggle is back to Show', toggleOf(view).textContent, 'Show')
  check('the sign-in completed', signedIn, 1)
  check('the account password does not stay in the field', passwordField.value, '')
}

// ---- persistence ------------------------------------------------------------
{
  // A second, independent copy of the modules over the SAME storage stands in
  // for closing the app and launching it again.
  const relaunch = loadable(VIEW_MODULES)
  const auth = await relaunch.load('auth.js')
  check('the sign-in survives a relaunch', auth.getCredential()?.username, 'staff')
  check('as the application password, not the account one', auth.getCredential()?.password, TOKEN.password)
  check('and is in localStorage, not sessionStorage', storage === window.localStorage, true)
  relaunch.cleanup()
}
{
  respond = () => ({ status: 500, body: { code: 'aioc_exploded', message: 'Boom.', data: { status: 500 } } })
  try { await api.fetchOrders({ page: 1 }) } catch { /* expected */ }
  check('a server error does not sign anyone out', storage.getItem('orderops.credential') !== null, true)

  respond = () => ({ status: 401, body: { code: 'aioc_invalid_credentials', message: 'Invalid username or password.', data: { status: 401 } } })
  try { await api.login('staff', 'wrong') } catch { /* expected */ }
  check('a wrong password at the login screen does not either', storage.getItem('orderops.credential') !== null, true)

  respond = () => ({ status: 401, body: { code: 'rest_forbidden', message: 'No.', data: { status: 401 } } })
  try { await api.fetchOrders({ page: 1 }) } catch { /* expected */ }
  check('a 401 on an authenticated request does - the credential no longer works', storage.getItem('orderops.credential'), null)
}
{
  // Every way the credential can be removed. A new one has to be added here
  // deliberately, which is the point: being signed out unexpectedly is the
  // complaint this guards against.
  const callers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const lines = fs.readFileSync(full, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/\bclearCredential\(\)/.test(line) && !/^\s*(\*|\/\/)/.test(line) && !/function clearCredential/.test(line)) {
          callers.push(`${path.relative(SRC, full).replace(/\\/g, '/')}`)
        }
      })
    }
  }
  walk(SRC)
  check('only sign-out, a 401 and a corrupt stored value remove the credential',
    callers.sort(), ['api.js', 'auth.js', 'auth.js', 'auth.js', 'main.js'])
  check('nothing expires it: auth.js stores no timestamp',
    /Date\.now|expires|maxAge|ttl/i.test(fs.readFileSync(path.join(SRC, 'auth.js'), 'utf8')), false)
}

first.cleanup()

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
