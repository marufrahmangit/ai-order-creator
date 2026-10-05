/**
 * Exercises the REAL pure logic from app/src/views/product-picker.js - the
 * cache-narrowing lookup and the client-side filter - by lifting that part of
 * the source into a module with the browser-dependent half removed.
 *
 * Those two functions are where the "typing feels instant" behaviour lives, and
 * a wrong filter would show a staff member a product that does not match what
 * they typed. Worth asserting rather than eyeballing.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'views', 'product-picker.js')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'orderops-picker-'))

let src = fs.readFileSync(SRC, 'utf8')

// Drop the imports (they need Vite, the DOM and /meta) and everything from the
// view factory onward. What is left is the pure half, verbatim.
src = src.replace(/^import .*$/gm, '')
const cut = src.indexOf('export function ProductPicker')
assert.ok(cut > 0, 'expected to find the ProductPicker factory')
src = src.slice(0, cut)

assert.ok(src.includes('function filterCached'), 'filterCached must be in the lifted half')
assert.ok(src.includes('function narrowingSource'), 'narrowingSource must be in the lifted half')

src += '\nexport { isPriceTerm, narrowingSource, filterCached, cache }\n'

const file = path.join(WORK, 'picker-logic.mjs')
fs.writeFileSync(file, src)

const { isPriceTerm, narrowingSource, filterCached, cache } = await import(pathToFileURL(file).href)

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

// ---- isPriceTerm -----------------------------------------------------------
check('"2500" is a price term', isPriceTerm('2500'), true)
check('"2500.50" is a price term', isPriceTerm('2500.50'), true)
check('"three" is not', isPriceTerm('three'), false)
check('"-250" is not (matches the API)', isPriceTerm('-250'), false)

// ---- narrowingSource -------------------------------------------------------
cache.clear()
cache.set('thr', [])
cache.set('thre', [])
cache.set('batik', [])
check('picks the LONGEST cached prefix', narrowingSource('three'), 'thre')
check('no cached prefix returns null', narrowingSource('gauze'), null)
check('a term is not its own source when absent', narrowingSource('batikx'), 'batik')
cache.set('xy', [])
check('cached terms under the 3-char minimum are ignored', narrowingSource('xyz'), null)

// ---- filterCached ----------------------------------------------------------
const rows = [
  { id: 1, name: 'Three Piece Batik', sku: 'TP-900', price: '900.00', is_in_stock: true },
  { id: 2, name: 'Three Piece Gauze', sku: 'TP-2500', price: '2500.00', is_in_stock: true },
  { id: 3, name: 'Two Piece Cotton', sku: 'TW-2500', price: '2500.00', is_in_stock: false },
  { id: 4, name: 'Saree Jamdani', sku: 'SR-10000', price: '10000.00', is_in_stock: true },
]
const names = (list) => list.map((r) => r.id)

check('text term matches name', names(filterCached(rows, 'three')), [1, 2])
check('text term is case-insensitive', names(filterCached(rows, 'BATIK')), [1])
check('text term matches SKU', names(filterCached(rows, 'sr-')), [4])
check('every text part must match', names(filterCached(rows, 'three gauze')), [2])
check('compound term intersects text and price',
      names(filterCached(rows, 'three 2500')), [2])
check('compound term order does not matter',
      names(filterCached(rows, '2500 three')), [2])
check('numeric term matches price OR the name/SKU, as the API does',
      names(filterCached(rows, '2500')), [2, 3])
check('numeric term matches a price written without decimals',
      names(filterCached(rows, '900')), [1])
check('no match yields nothing', names(filterCached(rows, 'nonexistent')), [])
check('out-of-stock rows are kept by the filter (the UI greys them)',
      filterCached(rows, '2500').some((r) => r.is_in_stock === false), true)
check('filtering never invents a row',
      filterCached(rows, 'three').every((r) => rows.includes(r)), true)

fs.rmSync(WORK, { recursive: true, force: true })

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
    (r.pass ? '' : `\n        expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`))
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
