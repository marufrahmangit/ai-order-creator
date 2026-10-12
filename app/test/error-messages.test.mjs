/**
 * What a network failure tells a staff member, and what it tells whoever is
 * debugging.
 *
 * Two halves, and both have to hold or the change was pointless:
 *
 *   - ON SCREEN: nothing a staff member cannot act on. No App Origin, no CORS,
 *     no API host, no VITE_API_BASE. Offline and online-but-failed say
 *     different things, because the actions differ: wait for signal, versus
 *     try again now.
 *   - IN THE CONSOLE: the whole diagnostic, still naming App Origin as the
 *     first suspect. The detail was MOVED, not deleted. If the app is ever
 *     pointed at a new origin that failure mode returns, and this output is
 *     what makes it findable.
 *
 * This is NOT a secrecy test and must not be rewritten into one. The API base
 * URL is compiled into the bundle and visible in devtools on every request,
 * and /wp-json paths are public on any WordPress site. Asserting the URL is
 * absent from the SCREEN is about usefulness, not concealment.
 *
 * Run with `npm test` from app/. Exercises the real src/api.js against a
 * fetch that fails the way a browser fails.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'orderops-errors-'))
const API_BASE = 'https://cartmixbd.example/wp-json/aioc/v1'

for (const rel of ['api.js', 'auth.js']) {
  fs.writeFileSync(
    path.join(WORK, rel),
    fs.readFileSync(path.join(SRC, rel), 'utf8')
      .replace(/import\.meta\.env\.VITE_API_BASE/g, JSON.stringify(API_BASE))
      .replace(/import\.meta\.env\.PROD/g, 'false'),
  )
}

// auth.js needs somewhere to keep the credential.
const store = new Map()
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent() {} }
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type } }
globalThis.location = { origin: 'https://ops.cartmixbd.example' }
storage.setItem('orderops.credential', JSON.stringify({ username: 'staff', password: 'pw' }))

const { fetchOrders } = await import(pathToFileURL(path.join(WORK, 'api.js')).href)

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
const ok = (name, cond) => check(name, !!cond, true)

/** The way a browser fails a blocked preflight or a dead network: bare TypeError. */
function failingFetch() {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
}

/** Runs one request and captures both the thrown message and the console output. */
async function attempt({ online }) {
  failingFetch()
  // Node 22 exposes navigator as a getter-only global, so it has to be
  // redefined rather than assigned.
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: online }, configurable: true, writable: true,
  })

  const logged = []
  const realError = console.error
  console.error = (...args) => logged.push(args.map(String).join(' '))

  let message = null
  let code = null
  try {
    await fetchOrders({ page: 1 })
  } catch (error) {
    message = error?.message ?? null
    code = error?.code ?? null
  } finally {
    console.error = realError
  }

  return { message, code, console: logged.join('\n') }
}

// Anything a staff member cannot act on.
const INTERNAL = [
  'App Origin', 'app origin', 'CORS', 'preflight', 'origin setting',
  'VITE_API_BASE', 'cartmixbd.example', 'wp-json', 'aioc', 'TypeError',
  'navigator', 'localhost', 'http',
]

// ---- offline -------------------------------------------------------------
{
  const r = await attempt({ online: false })

  check('offline says there is no connection, and what to do',
    r.message, 'No connection. Reconnect and try again.')
  check('and is flagged as a network failure', r.code, 'aioc_app_network')

  for (const term of INTERNAL) {
    ok(`offline message contains no "${term}"`, !r.message.includes(term))
  }

  ok('offline still logs for a developer', r.console.includes('offline'))
  ok('and the log names the request', r.console.includes(`${API_BASE}/orders`))
}

// ---- online, but the request failed -------------------------------------
{
  const r = await attempt({ online: true })

  check('online failure is short and says to retry',
    r.message, 'Could not reach the server. Try again.')
  check('and is flagged as a network failure', r.code, 'aioc_app_network')

  for (const term of INTERNAL) {
    ok(`online message contains no "${term}"`, !r.message.includes(term))
  }

  // The two cases must not collapse into one message: the action differs.
  const offlineMessage = 'No connection. Reconnect and try again.'
  ok('offline and online-failed say different things', r.message !== offlineMessage)

  // ---- the diagnostic that was moved, not deleted ----------------------
  ok('the console names APP ORIGIN as the first suspect',
    /APP ORIGIN/i.test(r.console))
  ok('and says it holds only one origin',
    r.console.includes('ONE origin'))
  ok('and gives this page\'s origin to compare against',
    r.console.includes('https://ops.cartmixbd.example'))
  ok('and names the site whose setting to check',
    r.console.includes(API_BASE))
  ok('and warns that the preflight still returns 200, which is what misleads',
    r.console.includes('preflight still returns 200'))
  ok('and names the build-time VITE_API_BASE trap',
    r.console.includes('VITE_API_BASE') && r.console.includes('BUILD time'))
  ok('and reports what navigator.onLine said',
    /navigator\.onLine reports ONLINE/.test(r.console))
  ok('and carries the original error for a stack',
    r.console.includes('Failed to fetch'))
}

// ---- the whole app, not just api.js -------------------------------------
{
  /*
   * Every view renders `error?.message || <fallback>`, so api.js's message is
   * what reaches the screen everywhere. Asserted structurally, because a view
   * that started composing its own network text would escape the check above.
   */
  const views = fs.readdirSync(path.join(SRC, 'views'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: `views/${f}`, text: fs.readFileSync(path.join(SRC, 'views', f), 'utf8') }))
  const top = ['main.js', 'api.js', 'pwa.js', 'auth.js']
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(SRC, f), 'utf8') }))

  for (const { file, text } of [...views, ...top]) {
    // Strip comments: the reasoning for this rule names the very terms the
    // rule forbids, which is exactly where that reasoning belongs.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    // Inside a console.error the terms are wanted; outside one they are not.
    const withoutConsole = code.replace(/console\.error\([\s\S]*?\n\s*\)/g, '')

    for (const term of ['App Origin', 'APP ORIGIN']) {
      ok(`${file} does not put "${term}" on screen`, !withoutConsole.includes(term))
    }
  }

  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')
  ok('the startup-failure screen no longer prints the API base',
    !/text: `API: \$\{apiBase\(\)\}`/.test(main))
  ok('but still logs it for whoever is debugging',
    /console\.error\([\s\S]*apiBase\(\)/.test(main))
}

// ---- the service worker's offline page ----------------------------------
{
  const sw = fs.readFileSync(path.join(SRC, '..', 'public', 'sw.js'), 'utf8')
  const html = /const OFFLINE_HTML = `([\s\S]*?)`;/.exec(sw)?.[1] ?? ''
  ok('the offline page exists', html.includes('No connection'))
  for (const term of ['App Origin', 'CORS', 'wp-json', 'VITE_API_BASE']) {
    ok(`the offline page contains no "${term}"`, !html.includes(term))
  }
}

fs.rmSync(WORK, { recursive: true, force: true })

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
    (r.pass ? '' : `\n        expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`))
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
