/**
 * Asserts the one property of the service worker whose failure would be silent
 * and serious: an API request must never be served from, or written to, the
 * cache.
 *
 * It lifts routeFor() out of the real public/sw.js - everything above the first
 * event listener, verbatim - so this cannot drift from the shipped worker. A
 * route of 'network' means the worker does not call respondWith at all, and the
 * browser behaves exactly as it would with no worker installed.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'orderops-sw-'))

const source = fs.readFileSync(SRC, 'utf8')

const cut = source.indexOf('self.addEventListener')
assert.ok(cut > 0, 'expected to find the first event listener')

const lifted = source.slice(0, cut)
assert.ok(lifted.includes('function routeFor'), 'routeFor must be above the listeners')

fs.writeFileSync(
  path.join(WORK, 'sw-logic.mjs'),
  lifted + '\nexport { routeFor, SHELL_VERSION, SHELL_CACHE, PRECACHE_URLS }\n',
)

const { routeFor, SHELL_VERSION, SHELL_CACHE, PRECACHE_URLS } =
  await import(pathToFileURL(path.join(WORK, 'sw-logic.mjs')).href)

const APP = 'https://ops.cartmixbd.com'
const API = 'https://staging.cartmixbd.com'

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: actual === expected, actual, expected })

// ---- the API is never intercepted -----------------------------------------
check('cross-origin API GET is not intercepted',
  routeFor('GET', `${API}/wp-json/aioc/v1/orders`, APP, false), 'network')
check('cross-origin API GET for a single order',
  routeFor('GET', `${API}/wp-json/aioc/v1/orders/412`, APP, false), 'network')
check('cross-origin API GET for /meta',
  routeFor('GET', `${API}/wp-json/aioc/v1/meta`, APP, false), 'network')
check('cross-origin API GET for /products',
  routeFor('GET', `${API}/wp-json/aioc/v1/products?search=2500`, APP, false), 'network')
check('same-origin /wp-json/ is not intercepted either',
  routeFor('GET', `${APP}/wp-json/aioc/v1/orders`, APP, false), 'network')
check('a same-origin API navigation is still not intercepted',
  routeFor('GET', `${APP}/wp-json/aioc/v1/orders`, APP, true), 'network')

// ---- writes are never intercepted, whatever the URL ------------------------
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  check(`${method} is not intercepted`,
    routeFor(method, `${API}/wp-json/aioc/v1/orders`, APP, false), 'network')
}
check('POST to the app origin is not intercepted either',
  routeFor('POST', `${APP}/assets/index-abc123.js`, APP, false), 'network')

// ---- the shell IS cached ---------------------------------------------------
check('a navigation is served from the shell',
  routeFor('GET', `${APP}/`, APP, true), 'shell')
check('a deep navigation is served from the shell',
  routeFor('GET', `${APP}/anything`, APP, true), 'shell')
check('the hashed JS bundle is an asset',
  routeFor('GET', `${APP}/assets/index-DLa6AeKe.js`, APP, false), 'asset')
check('the hashed CSS bundle is an asset',
  routeFor('GET', `${APP}/assets/index-CVTWU0-B.css`, APP, false), 'asset')
check('icons are assets', routeFor('GET', `${APP}/icons/icon-192.png`, APP, false), 'asset')
check('the manifest is an asset',
  routeFor('GET', `${APP}/manifest.webmanifest`, APP, false), 'asset')

// ---- anything else goes to the network ------------------------------------
check('an unknown same-origin path is not cached',
  routeFor('GET', `${APP}/something-else.json`, APP, false), 'network')
check('a third-party GET is not cached',
  routeFor('GET', 'https://example.com/tracker.js', APP, false), 'network')
check('a malformed URL falls through to the network',
  routeFor('GET', 'not-a-url', APP, false), 'network')

// ---- cache hygiene ---------------------------------------------------------
check('the cache name carries the version', SHELL_CACHE, `orderops-shell-${SHELL_VERSION}`)
check('nothing under /wp-json/ is precached',
  PRECACHE_URLS.some((url) => url.includes('/wp-json/')), false)
check('the shell HTML is precached', PRECACHE_URLS.includes('/index.html'), true)

fs.rmSync(WORK, { recursive: true, force: true })

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
    (r.pass ? '' : `\n        expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`))
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
