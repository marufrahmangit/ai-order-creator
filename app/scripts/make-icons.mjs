/**
 * Builds every icon the app ships from public/icons/logo.png.
 *
 *   npm run icons                      (from app/)
 *
 * It ALSO RUNS AUTOMATICALLY before every `npm run build`, as the `prebuild`
 * script, so a replaced logo.png cannot ship stale icons: dist/ is always built
 * from icons made from the logo in the tree at that moment. It writes into
 * public/icons/ - the source tree, not dist/ - so a changed logo shows up as
 * changed icons in `git status`, to be committed with it. Output is
 * deterministic, so an unchanged logo rewrites identical bytes and no diff.
 *
 * Two things it cannot do for you: bump SHELL_VERSION in public/sw.js (the
 * icons are part of the cached shell, and installed clients will not see new
 * ones otherwise), and commit. test/icons.test.mjs catches the second - it
 * regenerates every icon in memory from the logo present when it runs and
 * fails on any committed icon that does not match.
 *
 * The logo is a horizontal mark - cart, speed lines and wordmark - on OPAQUE
 * white, with no alpha channel. That decides the layouts:
 *
 *   - Every icon is opaque white with the logo centred on it. White is the
 *     logo's own background, so nothing has to be cut out of it.
 *   - The logo's white margin is trimmed first, then it is fitted to the icon,
 *     so the artwork is as large as each layout allows.
 *   - "any" icons and the apple-touch-icon keep a small margin: iOS rounds the
 *     corners, and a launcher may draw "any" icons inside its own plate.
 *   - The MASKABLE icon must survive the launcher cutting it to any shape down
 *     to a circle of 40% of the side (the W3C safe zone). The logo is wide, so
 *     fitting its bounding box is not enough - the box's corners are empty, but
 *     its ends, the speed lines and the end of "MIX", sit far from the centre.
 *     So it is scaled until the farthest drawn PIXEL lies inside that circle.
 *     White fills the rest edge to edge, so whatever shape is cut shows white,
 *     not a transparent hole.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png.mjs'

export const ICON_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
export const SOURCE = 'logo.png'

/** A pixel counts as artwork when any channel is this far below white. */
const INK_THRESHOLD = 16

/** The W3C maskable safe zone: a centred circle of radius 40% of the side. */
export const MASKABLE_SAFE_RADIUS = 0.4

/** How much of the safe radius the logo may use, leaving it a little air. */
const MASKABLE_FILL = 0.94

/** How much of the side an "any" icon's artwork may span. */
const ANY_FILL = 0.88

const isInk = (data, i) =>
  data[i] < 255 - INK_THRESHOLD || data[i + 1] < 255 - INK_THRESHOLD || data[i + 2] < 255 - INK_THRESHOLD

/** The tight box around everything that is not white. */
function inkBounds({ width, height, data }) {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(data, (y * width + x) * 4)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) throw new Error('the logo is blank - nothing darker than white was found')
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/** The farthest drawn pixel from the centre of the ink box, in source pixels. */
function inkRadius(image, box) {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  let max = 0
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      if (!isInk(image.data, (y * image.width + x) * 4)) continue
      // The pixel's far corner, so the whole pixel is inside, not its centre.
      const dx = Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx))
      const dy = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy))
      max = Math.max(max, Math.hypot(dx, dy))
    }
  }
  return max
}

/**
 * Area-average resampling of the box onto a white canvas: every output pixel
 * is the coverage-weighted mean of the source pixels under it. The right
 * filter for shrinking a flat logo - no ringing round the letters, and thin
 * strokes fade rather than vanish.
 */
function render(image, box, { size, scale, width = size, height = size }) {
  const out = new Uint8Array(width * height * 4).fill(255)
  const drawW = box.width * scale
  const drawH = box.height * scale
  const left = (width - drawW) / 2
  const top = (height - drawH) / 2

  for (let oy = 0; oy < height; oy++) {
    const sy0 = (oy - top) / scale + box.y
    const sy1 = (oy + 1 - top) / scale + box.y
    for (let ox = 0; ox < width; ox++) {
      const sx0 = (ox - left) / scale + box.x
      const sx1 = (ox + 1 - left) / scale + box.x

      let r = 0
      let g = 0
      let b = 0
      let area = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          const w = wx * wy
          // Outside the ink box is white: the logo's own background.
          const inside = sx >= box.x && sx < box.x + box.width && sy >= box.y && sy < box.y + box.height
          const i = (sy * image.width + sx) * 4
          r += (inside ? image.data[i] : 255) * w
          g += (inside ? image.data[i + 1] : 255) * w
          b += (inside ? image.data[i + 2] : 255) * w
          area += w
        }
      }

      const o = (oy * width + ox) * 4
      out[o] = Math.round(r / area)
      out[o + 1] = Math.round(g / area)
      out[o + 2] = Math.round(b / area)
      out[o + 3] = 255
    }
  }

  return { width, height, data: out }
}

/**
 * Every icon, as encoded PNG bytes keyed by filename. Pure: same logo in, same
 * bytes out.
 *
 * @param {Buffer} logoFile
 * @returns {Record<string, Buffer>}
 */
export function buildIcons(logoFile) {
  const logo = decodePng(logoFile)
  const box = inkBounds(logo)
  const radius = inkRadius(logo, box)

  /** Fit the ink box so its longer side spans `fill` of `size`. */
  const fitted = (size, fill) => render(logo, box, {
    size,
    scale: (size * fill) / Math.max(box.width, box.height),
  })

  const maskable = (size) => render(logo, box, {
    size,
    scale: (size * MASKABLE_SAFE_RADIUS * MASKABLE_FILL) / radius,
  })

  // The login screen's logo: the trimmed artwork at twice its displayed
  // width, on the same white as the sign-in card it sits on.
  const LOGIN_WIDTH = 400
  const loginScale = LOGIN_WIDTH / box.width
  const login = render(logo, box, {
    scale: loginScale,
    width: LOGIN_WIDTH,
    height: Math.round(box.height * loginScale),
  })

  return {
    'icon-192.png': encodePng(fitted(192, ANY_FILL)),
    'icon-512.png': encodePng(fitted(512, ANY_FILL)),
    'icon-512-maskable.png': encodePng(maskable(512)),
    'apple-touch-icon.png': encodePng(fitted(180, ANY_FILL)),
    'favicon-32.png': encodePng(fitted(32, 0.96)),
    'logo-login.png': encodePng(login),
  }
}

/** What the source is, for the record. */
export function describeSource(logoFile) {
  const logo = decodePng(logoFile)
  const box = inkBounds(logo)
  return {
    width: logo.width,
    height: logo.height,
    channels: logo.channels,
    hasAlpha: logo.hasAlpha,
    inkBox: box,
    inkRadius: inkRadius(logo, box),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = fs.readFileSync(path.join(ICON_DIR, SOURCE))
  console.log('source:', JSON.stringify(describeSource(source)))
  for (const [name, bytes] of Object.entries(buildIcons(source))) {
    fs.writeFileSync(path.join(ICON_DIR, name), bytes)
    console.log(`wrote ${name} (${bytes.length} bytes)`)
  }
}
