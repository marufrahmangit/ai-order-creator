/**
 * The unsaved-changes guard. ONE for the whole app.
 *
 * Every way out of the order form that would discard unsaved work goes through
 * requestExit(), and so does the update banner's Reload, which discards the
 * form just as surely. With nothing unsaved the exit goes straight away.
 * Otherwise the first tap warns and only a second tap on the SAME exit goes.
 *
 * Why a module rather than state inside the form: the banner lives in pwa.js,
 * which is app-wide and must not know about any view. So the form REGISTERS
 * its dirty check here and the banner asks here, and neither imports the
 * other. main.js clears the registration on every screen change, so a form
 * that is no longer mounted cannot make the order list's Reload warn.
 *
 * One armed slot, shared by every exit: a warning licenses only the exit it
 * was shown for. Arming "‹ Orders" and then tapping Reload warns again, and
 * whatever was showing the first warning is told to take it down.
 *
 * Where a warning APPEARS is the caller's business, because it has to appear
 * where the tap was - see the `warn` and `reset` callbacks below.
 */

const NOTHING_UNSAVED = () => false

let isDirty = NOTHING_UNSAVED

/** @type {{key: string, reset?: () => void} | null} */
let armed = null

function release() {
  const previous = armed
  armed = null
  previous?.reset?.()
}

/**
 * The mounted screen's "is there unsaved work?" check. Replaces any previous
 * one and disarms.
 *
 * @param {() => boolean} check
 */
export function setUnsavedCheck(check) {
  release()
  isDirty = check
}

/** No screen with unsaved work is mounted. Called by main.js on every navigation. */
export function clearUnsavedCheck() {
  release()
  isDirty = NOTHING_UNSAVED
}

/**
 * Take a warning down without leaving: "Keep editing", a save, a dismissed
 * banner.
 *
 * @param {string} [key] Only disarm if THIS exit is the one armed.
 */
export function disarm(key) {
  if (key === undefined || armed?.key === key) release()
}

/**
 * @param {string} key   Identifies the exit, e.g. 'close', 'open:412', 'reload'.
 * @param {() => void} go The exit itself.
 * @param {{warn?: () => void, reset?: () => void}} [ui]
 *   warn shows the warning where the user tapped; reset takes it down again,
 *   whether because they left, kept editing, or armed a different exit.
 * @returns {boolean} Whether it went.
 */
export function requestExit(key, go, { warn, reset } = {}) {
  if (!isDirty() || armed?.key === key) {
    release()
    go()
    return true
  }

  release()
  armed = { key, reset }
  warn?.()
  return false
}
