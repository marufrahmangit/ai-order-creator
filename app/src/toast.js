/**
 * A brief centred confirmation, over the content.
 *
 * WHAT A TOAST IS FOR HERE, and what it is not. A toast confirms something
 * that already happened and needs NO action: the order saved, the order went
 * to the trash. It is allowed to vanish because there is nothing to do about
 * it, and nothing is lost if it is missed - the order list shows the result.
 *
 * Warnings and errors are NOT toasts and must not become them:
 *
 *   - A WARNING needs reading and often acting on - a line item skipped
 *     because the product is gone, a quantity rounded, a discount capped. It
 *     stays in the form's warnings block until the next save.
 *   - An ERROR means the thing did not happen. It stays in the status line so
 *     the person can see what failed and retry.
 *
 * The distinction is whether the reader has anything to do. Collapsing it -
 * making every message a toast because toasts look tidy - would mean a failed
 * save flashing for a second and disappearing, which is how an order silently
 * does not exist.
 *
 * WHY CENTRED, AND WHY HERE RATHER THAN IN THE VIEW. Save sits pinned at the
 * bottom of a form taller than the phone screen, and the status line is at the
 * top - so the old "Saved." was off screen at the moment it was needed. That is
 * the same failure the exit warning had in app 0.8.0, fixed the same way: put
 * the message where the eye already is.
 *
 * Mounted on document.body, OUTSIDE #app, deliberately. main.js's mount()
 * clears #app on every navigation, and the trash flow navigates to the list the
 * instant the request returns - a toast inside the view would be destroyed
 * before it was seen. On body it starts on the form and survives into the list,
 * which is also where the result it is describing is now visible.
 */

const LAYER_CLASS = 'toast-layer'

/** How long the message stays before it begins to leave. */
const HOLD_MS = 1000

/** Must match the fade in styles.css, or the node outlives its own animation. */
const FADE_MS = 200

const SVG_NS = 'http://www.w3.org/2000/svg'

/** el() uses createElement, which cannot make SVG nodes. */
function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value))
  }
  return node
}

/**
 * The two marks, drawn rather than fetched.
 *
 * Single paths on a 24-unit box, stroked, so the draw-in is a stroke-dash
 * animation in CSS and needs no library for what amounts to three lines. The
 * dash length is set in the stylesheet against the path's own length.
 *
 *   saved - a check.
 *   trash - a cross, which reads as "taken away". Not an error mark: the colour
 *           is the danger red because the action is destructive, and the label
 *           beside it says what happened.
 */
const MARKS = {
  saved: ['M4 12.5 L9.5 18 L20 6.5'],
  trash: ['M6 6 L18 18', 'M18 6 L6 18'],
}

function icon(kind) {
  const node = svg('svg', {
    class: 'toast-icon',
    viewBox: '0 0 24 24',
    width: 28,
    height: 28,
    fill: 'none',
    'stroke-width': 2.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    // Decorative: the label beside it carries the meaning, and the live region
    // announces that. A second announcement of "image" would be noise.
    'aria-hidden': 'true',
    focusable: 'false',
  })

  for (const d of MARKS[kind] || MARKS.saved) {
    node.append(svg('path', { d }))
  }

  return node
}

/** The one layer every toast is appended to, created on first use. */
function layer() {
  let node = document.querySelector(`.${LAYER_CLASS}`)
  if (node) return node

  node = document.createElement('div')
  node.className = LAYER_CLASS
  // polite, not assertive: a confirmation should wait for a pause rather than
  // cut across whatever is being read.
  node.setAttribute('aria-live', 'polite')
  document.body.append(node)
  return node
}

let pending = 0

/**
 * Show a confirmation for about a second.
 *
 * @param {'saved'|'trash'} kind Which mark to draw.
 * @param {string} label The words beside it. Required - the mark alone is not
 *   a message, and a screen reader is given this rather than the drawing.
 */
export function showToast(kind, label) {
  // A second confirmation replaces the first rather than stacking: two of these
  // at once would cover each other, and only the latest is true.
  const host = layer()
  host.replaceChildren()
  window.clearTimeout(pending)

  const toast = document.createElement('div')
  toast.className = `toast toast-${kind}`

  const text = document.createElement('span')
  text.className = 'toast-label'
  text.textContent = label

  toast.append(icon(kind), text)
  host.append(toast)

  pending = window.setTimeout(() => {
    toast.classList.add('is-leaving')
    pending = window.setTimeout(() => host.replaceChildren(), FADE_MS)
  }, HOLD_MS)
}
