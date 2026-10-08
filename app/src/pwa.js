/**
 * Installability: service worker registration, the update prompt, and the
 * install banners.
 *
 * The service worker itself is app/public/sw.js, which Vite copies verbatim -
 * it is a classic worker and cannot import from here. All it caches is the app
 * shell; API responses are never cached, for the reasons set out at the top of
 * that file.
 */

import { el } from './dom.js'
import { requestExit, disarm } from './exit-guard.js'

const DISMISSED_INSTALL = 'orderops.install.dismissed'
const DISMISSED_IOS_HINT = 'orderops.ioshint.dismissed'

/** localStorage throws in private browsing and when storage is blocked. */
function wasDismissed(key) {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markDismissed(key) {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // The banner reappearing next launch is a far smaller problem than an
    // exception on a screen the user is trying to dismiss.
  }
}

/** Already launched from the home screen, so there is nothing to offer. */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    // iOS Safari's own non-standard flag; it does not support display-mode.
    || window.navigator.standalone === true
}

function isIos() {
  const ua = window.navigator.userAgent || ''
  // iPadOS 13+ reports itself as a Mac, so the touch-point check is what
  // catches an iPad. UA sniffing is unavoidable here: there is no feature to
  // detect, because the thing being detected is the ABSENCE of
  // beforeinstallprompt, which never announces itself.
  const iPhoneish = /iPad|iPhone|iPod/.test(ua)
  const iPadOs = ua.includes('Macintosh') && window.navigator.maxTouchPoints > 1
  return iPhoneish || iPadOs
}

let current = null
let currentObserver = null

/** The banner's distance from the bottom edge, and the gap kept above it. Match .pwa-banner. */
const BANNER_OFFSET_PX = 12
const BANNER_GAP_PX = 12

/**
 * How much room, from the bottom edge (safe area excluded), anything else
 * pinned to the bottom must leave for the banner: its real height plus its
 * offset plus a gap. Written to --pwa-banner-space on body, which the order
 * list's floating button AND the order form's save bar both read.
 *
 * MEASURED, not assumed. On a phone the banner wraps - text over buttons - and
 * the unsaved-changes wording wraps further, so a fixed figure either wastes
 * space on a wide screen or, worse, leaves Save under the banner on a narrow
 * one. The stylesheet carries a default for the moment before layout.
 */
function updateBannerSpace() {
  if (!current) return
  const height = current.getBoundingClientRect?.().height ?? current.offsetHeight
  // Not laid out yet (or no layout at all, as in the tests): keep the
  // stylesheet's default rather than writing 24px and covering Save.
  if (!(height > 0)) return
  document.body.style?.setProperty(
    '--pwa-banner-space',
    `${Math.ceil(height) + BANNER_OFFSET_PX + BANNER_GAP_PX}px`,
  )
}

/**
 * One banner at a time, pinned to the bottom of the viewport.
 *
 * While it is up, body carries a class and the banner's measured clearance
 * (--pwa-banner-space), so everything else pinned to the bottom - the order
 * list's floating button and the order form's save bar - lifts clear of it
 * instead of being covered. One mechanism for both; see styles.css.
 *
 * onAction may return false to keep the banner up - the update banner does,
 * when Reload only warned. The returned handle lets the caller reword it.
 *
 * @returns {{setText: (text: string) => void}}
 */
function showBanner({ text, actionLabel, onAction, onDismiss }) {
  dismissBanner()

  const close = () => {
    dismissBanner()
    onDismiss?.()
  }

  const textNode = el('p', { class: 'pwa-banner-text', text })

  const banner = el('div', { class: 'pwa-banner', role: 'status' }, [
    textNode,
    el('div', { class: 'pwa-banner-actions' }, [
      actionLabel
        ? el('button', {
            type: 'button',
            class: 'button primary pwa-banner-action',
            text: actionLabel,
            onClick: () => {
              if (onAction?.() !== false) dismissBanner()
            },
          })
        : null,
      el('button', {
        type: 'button',
        class: 'button pwa-banner-dismiss',
        text: 'Dismiss',
        'aria-label': 'Dismiss',
        onClick: close,
      }),
    ]),
  ])

  current = banner
  document.body.append(banner)
  document.body.classList.add('has-pwa-banner')

  // Re-measured whenever the banner's size changes - a rotation, or Reload
  // rewording it into the longer unsaved-changes warning.
  updateBannerSpace()
  if (typeof ResizeObserver === 'function') {
    currentObserver = new ResizeObserver(updateBannerSpace)
    currentObserver.observe(banner)
  }

  return {
    setText: (next) => {
      textNode.textContent = next
      // ResizeObserver catches this too, a frame later; measuring now means
      // Save is never covered for that frame.
      updateBannerSpace()
    },
  }
}

function dismissBanner() {
  currentObserver?.disconnect()
  currentObserver = null
  current?.remove()
  current = null
  document.body.classList.remove('has-pwa-banner')
  document.body.style?.removeProperty('--pwa-banner-space')
}

const UPDATE_TEXT = 'An update is ready.'
const UPDATE_WARNING = 'Unsaved changes in this order. Tap Reload again to discard them and update.'

/**
 * The "update is ready" banner. Exported for app/test/exit-guards.test.mjs.
 *
 * Reload discards the page, so it is an exit like any other and goes through
 * the same guard as "‹ Orders": with unsaved work in the order form, the first
 * tap only warns and the second reloads. The warning replaces the BANNER'S OWN
 * TEXT, because the banner is where the tap was - a warning in the form's
 * header would be at the opposite end of the screen.
 *
 * The banner asks the guard rather than the form being told about the banner:
 * pwa.js is app-wide and knows nothing about views, and the form already
 * registers its dirty check with exit-guard.js. Dismissing the banner takes an
 * armed Reload down with it, so a later banner cannot inherit the warning.
 *
 * @param {() => void} reload
 */
export function showUpdateBanner(reload) {
  const banner = showBanner({
    text: UPDATE_TEXT,
    actionLabel: 'Reload',
    onAction: () => requestExit('reload', reload, {
      warn: () => banner.setText(UPDATE_WARNING),
      reset: () => banner.setText(UPDATE_TEXT),
    }),
    onDismiss: () => disarm('reload'),
  })
}

/**
 * Register the worker, and offer an update when a new one is waiting.
 *
 * Production only. A service worker in front of the Vite dev server serves
 * yesterday's bundle while you are editing today's, and the confusion costs
 * more than the feature is worth in development.
 */
function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    let registration
    try {
      registration = await navigator.serviceWorker.register('/sw.js')
    } catch {
      // A failed registration costs the offline shell and nothing else, so it
      // must not take the app down with it.
      return
    }

    const offerUpdate = () => {
      // No controller means this is the FIRST install, not an update - there is
      // nothing for the user to decide, so no prompt.
      if (!navigator.serviceWorker.controller) return

      showUpdateBanner(() => {
        // Never reload without being asked: it would discard a half-filled
        // order form. The worker waits until the user says so.
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => window.location.reload(),
          { once: true },
        )
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
      })
    }

    if (registration.waiting) offerUpdate()

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return

      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') offerUpdate()
      })
    })
  })
}

/**
 * Offer to install.
 *
 * Chrome fires beforeinstallprompt and hands us a prompt to call later. iOS
 * Safari fires nothing and has no programmatic install at all, so the only
 * thing available there is telling the user where the button is.
 */
function initInstallPrompt() {
  if (isStandalone()) return

  if (isIos()) {
    if (wasDismissed(DISMISSED_IOS_HINT)) return

    showBanner({
      text: 'Add CartMix Shop Manager to your home screen: tap Share, then Add to Home Screen.',
      onDismiss: () => markDismissed(DISMISSED_IOS_HINT),
    })
    return
  }

  if (wasDismissed(DISMISSED_INSTALL)) return

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome's own mini-infobar is suppressed so the banner below is the single
    // place this is offered.
    event.preventDefault()

    showBanner({
      text: 'Install CartMix Shop Manager for a faster launch.',
      actionLabel: 'Install',
      onAction: () => event.prompt(),
      // Dismissal persists, so this asks once rather than on every launch.
      onDismiss: () => markDismissed(DISMISSED_INSTALL),
    })
  })
}

export function initPwa() {
  registerServiceWorker()
  initInstallPrompt()
}
