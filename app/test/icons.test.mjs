/**
 * The app's icons: all generated from public/icons/logo.png, all where the
 * manifest, index.html and the service worker say they are, and the maskable
 * one safe to cut to a circle.
 *
 * The strongest check here is the first: every committed icon is rebuilt in
 * memory from logo.png by the real scripts/make-icons.mjs and compared byte for
 * byte. A logo replaced without rerunning the script - or an icon edited by
 * hand - fails here rather than shipping a mismatched set.
 *
 * Run with `npm test` from app/.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, pngSize } from '../scripts/png.mjs'
import { buildIcons, describeSource, ICON_DIR, SOURCE, MASKABLE_SAFE_RADIUS } from '../scripts/make-icons.mjs'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(APP, rel))
const iconFile = (name) => fs.readFileSync(path.join(ICON_DIR, name))

const results = []
const check = (name, actual, expected) =>
  results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

const logo = iconFile(SOURCE)

// ---- the source, as recorded in docs/PROJECT-STATE.md ---------------------
{
  const source = describeSource(logo)
  check('logo.png is 500x500', [source.width, source.height], [500, 500])
  // No alpha is why every icon is built on opaque white, the logo's own
  // background, rather than on a colour of its own.
  check('logo.png has no transparency', source.hasAlpha, false)
}

// ---- every icon is what the script makes from the logo ---------------------
const built = buildIcons(logo)
for (const [name, bytes] of Object.entries(built)) {
  const exists = fs.existsSync(path.join(ICON_DIR, name))
  check(`${name} is committed`, exists, true)
  if (exists) {
    check(`${name} matches what make-icons.mjs builds from logo.png`, iconFile(name).equals(bytes), true)
  }
}

// ---- the manifest ----------------------------------------------------------
const manifest = JSON.parse(read('public/manifest.webmanifest'))
for (const icon of manifest.icons) {
  const file = path.join(APP, 'public', icon.src)
  check(`manifest icon ${icon.src} exists`, fs.existsSync(file), true)
  if (fs.existsSync(file)) {
    const { width, height } = pngSize(fs.readFileSync(file))
    check(`${icon.src} really is ${icon.sizes}`, `${width}x${height}`, icon.sizes)
  }
}
const purposes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()
check('the manifest offers 192 and 512 "any" and a 512 maskable',
  purposes, ['192x192 any', '512x512 any', '512x512 maskable'])

// ---- the app's name, wherever a platform shows it ---------------------------
{
  const html = read('index.html').toString()
  check('the manifest names the app CartMix Shop Manager', manifest.name, 'CartMix Shop Manager')
  // Home-screen labels truncate at around 12 characters on both platforms, and
  // the full name would come out as "CartMix Sho…".
  check('its short_name fits a home-screen label', manifest.short_name.length <= 12, true)
  check('iOS, which ignores short_name, is given the same label',
    html.match(/name="apple-mobile-web-app-title" content="([^"]+)"/)?.[1], manifest.short_name)
  check('the browser tab carries the full name', html.match(/<title>([^<]+)<\/title>/)?.[1], manifest.name)

  // No user-visible "Order Ops" left in the app. Internal names - the aioc/v1
  // namespace, the plugin, the application-password prefix the API sets - are
  // not in app/src at all, so any hit here is a leftover.
  const leftovers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/Order Ops/.test(fs.readFileSync(full, 'utf8'))) leftovers.push(path.relative(APP, full).split(path.sep).join('/'))
    }
  }
  walk(path.join(APP, 'src'))
  for (const file of ['index.html', 'public/manifest.webmanifest', 'public/sw.js']) {
    if (/Order Ops/.test(read(file).toString())) leftovers.push(file)
  }
  check('nothing user-visible in the app still says "Order Ops"', leftovers, [])
}

// ---- the maskable icon survives a circular mask ----------------------------
{
  const icon = decodePng(iconFile('icon-512-maskable.png'))
  const c = icon.width / 2
  const r = icon.width * MASKABLE_SAFE_RADIUS
  let outside = 0
  let corners = 0
  for (let y = 0; y < icon.height; y++) {
    for (let x = 0; x < icon.width; x++) {
      const i = (y * icon.width + x) * 4
      const ink = icon.data[i] < 250 || icon.data[i + 1] < 250 || icon.data[i + 2] < 250
      if (ink && Math.hypot(x + 0.5 - c, y + 0.5 - c) > r) outside++
      if (x < 4 && y < 4 && icon.data[i] === 255 && icon.data[i + 1] === 255 && icon.data[i + 2] === 255) corners++
    }
  }
  check('no part of the logo lies outside the 40% safe circle', outside, 0)
  // Whatever shape the launcher cuts, it must show background, not a hole.
  check('the maskable icon is filled to the edge, not transparent', corners, 16)
}

// ---- every icon is opaque --------------------------------------------------
for (const name of Object.keys(built)) {
  // iOS composites a transparent apple-touch-icon onto black; Android draws
  // a transparent maskable icon's holes as the launcher's own colour.
  check(`${name} is opaque`, decodePng(iconFile(name)).hasAlpha, false)
}

// ---- index.html and the service worker point at them -----------------------
{
  const html = read('index.html').toString()
  const apple = html.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1]
  check('index.html links the apple-touch-icon', apple, '/icons/apple-touch-icon.png')
  check('which is the 180x180 iOS asks for',
    pngSize(fs.readFileSync(path.join(APP, 'public', apple))), { width: 180, height: 180 })

  const favicon = html.match(/rel="icon"[^>]*href="([^"]+)"/)?.[1]
  check('index.html links a favicon', favicon, '/icons/favicon-32.png')

  // Icons are part of the cached shell. Precaching them is what lets a cold
  // offline launch paint them; SHELL_VERSION is what gets new ones to
  // installed clients at all.
  // Comments stripped first: an apostrophe in one would otherwise be read as
  // the start of a URL string.
  const sw = read('public/sw.js').toString().replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const precache = [...(sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const needed = [...manifest.icons.map((icon) => icon.src), apple, favicon, '/icons/logo-login.png']
  check('the service worker precaches every icon the shell uses',
    needed.filter((url) => !precache.includes(url)), [])
}

// ---- the login screen's logo ----------------------------------------------
{
  const login = read('src/views/login.js').toString()
  const src = login.match(/src: '([^']+)'/)?.[1]
  check('the login screen shows the generated logo', src, '/icons/logo-login.png')

  const shown = { width: Number(login.match(/width: (\d+)/)?.[1]), height: Number(login.match(/height: (\d+)/)?.[1]) }
  const file = pngSize(fs.readFileSync(path.join(APP, 'public', src)))
  check('the file is twice its displayed width, for a sharp edge on a phone', file.width, shown.width * 2)
  check('and the reserved height keeps its proportions, so nothing jumps when it loads',
    Math.abs(file.height / 2 - shown.height) <= 1, true)
}

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
