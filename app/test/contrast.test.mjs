/**
 * WCAG contrast for the text/background pairs the app actually puts together.
 *
 * This exists because of a specific failure: `.button.link` was `color: #fff`,
 * which was correct for the only place it existed at the time - the dark app
 * header - and silently invisible the moment the last-order card reused it on a
 * near-white surface. White on #fbfcfd is 1.03:1. Nothing catches that except
 * looking, and looking is what everyone had already done.
 *
 * So the pairs are asserted by number. 4.5:1 is the AA threshold for body text;
 * a border only has to be perceptible.
 *
 * It reads the real stylesheet, so a colour changed there is checked here
 * without anyone remembering to.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'),
  'utf8',
)

/** Expands #abc to #aabbcc, so shorthand does not silently become NaN. */
function expand(hex) {
  const short = hex.match(/^#([0-9a-fA-F]{3})$/)
  return short ? '#' + [...short[1]].map((c) => c + c).join('') : hex
}

/** A custom property's value from :root. */
function token(name) {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`))
  if (!match) throw new Error(`no --${name} in styles.css`)
  return expand(match[1])
}

/** The declared value of one property inside one rule. */
function declared(selector, property) {
  const rule = CSS.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
  )
  if (!rule) throw new Error(`no rule for ${selector}`)
  const value = rule[1].match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`))
  if (!value) throw new Error(`${selector} declares no ${property}`)
  return value[1].trim()
}

/** Resolves var(--x) one level, which is all this stylesheet uses. */
function colour(value) {
  const varMatch = value.match(/^var\(--([\w-]+)\)$/)
  return varMatch ? token(varMatch[1]) : expand(value)
}

function luminance(hex) {
  // Loud rather than NaN: an unreadable colour must fail the test, not silently
  // produce a ratio of NaN that compares false and looks like a contrast bug.
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`cannot read colour "${hex}" - the contrast test needs a hex value`)
  }

  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function ratio(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const ACCENT = token('accent')
const INK = token('ink')
const SURFACE = token('surface')
const LINE = token('line')
const CARD = colour(declared('.last-order-details', 'background'))

const results = []

function check(name, fg, bg, floor = 4.5) {
  const r = ratio(fg, bg)
  results.push({
    name: `${name}  (${r.toFixed(2)}:1)`,
    pass: r >= floor,
    actual: `${r.toFixed(2)}:1`,
    expected: `>= ${floor}:1`,
  })
}

// ---- the pair that was invisible -----------------------------------------
check('Open #N link on the last-order card', colour(declared('.button.link', 'color')), CARD)
check('Reorder button label on its own surface',
  colour(declared('.last-order-reorder', 'color')),
  colour(declared('.last-order-reorder', 'background')))
check('Reorder button border against the card', LINE, CARD, 1.1)
check('the collapsed summary line on the card',
  colour(declared('.last-order-summary', 'color')), CARD)

// ---- and the dark header it was originally written for -------------------
check('header link on the accent bar', colour(declared('.app-header .button.link', 'color')), ACCENT)
check('header title on the accent bar', '#ffffff', ACCENT)

// ---- the rest of the app's text surfaces ---------------------------------
check('body ink on the page background', INK, token('bg'))
check('body ink on a card', INK, SURFACE)
check('muted ink on a card', token('ink-muted'), SURFACE)
check('danger text on a card', token('danger'), SURFACE)

// ---- the unsaved-changes warning in the header ---------------------------
// It is the one thing on screen that says a tap did not do what it looked like
// it should, so it has to be readable at a glance.
check('exit warning text on its strip',
  colour(declared('.exit-warning', 'color')), colour(declared('.exit-warning', 'background')))
check('exit warning strip stands out from the dark header',
  colour(declared('.exit-warning', 'background')), ACCENT, 3)
check('Keep editing label on its button',
  colour(declared('.exit-warning-keep', 'color')), colour(declared('.exit-warning-keep', 'background')))

// ---- every status badge, on its own background ---------------------------
for (const [, name, bg, fg] of CSS.matchAll(
  /\.badge-([\w-]+)(?:,\s*\n\.badge-[\w-]+)*\s*\{\s*background:\s*(#[0-9a-fA-F]{6});\s*color:\s*([^;]+);/g,
)) {
  check(`badge "${name}" text on its own background`, colour(fg.trim()), bg)
}

// ---- the leak hypothesis, settled structurally ---------------------------
// A status colour could only reach the card's buttons through a selector that
// escapes the badge. None does, which is why the bug looked identical for every
// status rather than tinting green on a Completed order.
const escaping = [...CSS.matchAll(/\.badge-[\w-]+([^{]*)\{/g)]
  .map((m) => m[1].trim())
  .filter((tail) => tail !== '' && !/^(,\s*\.badge-[\w-]+\s*)+$/.test(tail))

results.push({
  name: 'no .badge-* rule selects anything outside the badge',
  pass: escaping.length === 0,
  actual: escaping.length === 0 ? 'none' : escaping.join(' | '),
  expected: 'none',
})

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}` +
    (r.pass ? '' : `\n        expected ${r.expected}, got ${r.actual}`))
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
