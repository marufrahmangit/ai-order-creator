/**
 * Product picker, opened as a sheet over the order form.
 *
 * NOT a route. The form stays mounted underneath, so opening and closing the
 * picker cannot lose unsaved edits - that is the whole reason it is an overlay
 * rather than a screen.
 *
 * Search semantics come from GET /products and shape what this shows. Staff
 * search by price and by name in roughly equal measure, so neither is the
 * primary case and the UI favours neither:
 *
 *   - a numeric term returns exact price matches first, then name/SKU
 *     substring matches, all cheapest-first;
 *   - a text term returns name/SKU matches, cheapest-first;
 *   - a compound term like "three 2500" returns the INTERSECTION, often
 *     exactly one row.
 *
 * The 3-character minimum, the 300ms debounce and the per-keystroke abort are
 * the same discipline views/orders.js uses; this follows that pattern rather
 * than inventing a second one.
 */

import { fetchProducts } from '../api.js'
import { formatMoney } from '../format.js'
import { el, clear, debounce } from '../dom.js'

/** Matches the API's own minimum, so a shorter term never costs a request. */
const MIN_CHARS = 3

const SEARCH_DEBOUNCE_MS = 300

/**
 * Results per search term, for the life of the app session.
 *
 * Server-side search is 40-90ms against several hundred ms of round-trip, so
 * the network dominates and caching is where the latency actually goes. Module
 * scope rather than per-sheet: adding several products to one order reopens the
 * picker repeatedly, and that is exactly when a cache earns its keep.
 *
 * The trade-off: a price changed in wp-admin mid-session is not seen until the
 * cache is dropped, and because the form sends each line's `total`, an order
 * could be saved at the stale figure. Bounded by the session, and sign-out
 * clears it.
 *
 * @type {Map<string, Array<object>>}
 */
const cache = new Map()

/** Called on sign-out, so a different user starts clean. */
export function clearProductCache() {
  cache.clear()
}

/** Digits with an optional decimal part - the same shape the API treats as a price. */
function isPriceTerm(part) {
  return /^\d+(\.\d+)?$/.test(part)
}

/**
 * The longest cached term that this one extends, or null.
 *
 * Typing "thre" then "three" narrows: the second result set is a subset of the
 * first, so the cached rows can be filtered and shown at once.
 */
function narrowingSource(term) {
  let best = null

  for (const key of cache.keys()) {
    if (key.length < MIN_CHARS) continue
    if (!term.startsWith(key)) continue
    if (best === null || key.length > best.length) best = key
  }

  return best
}

/**
 * Filter cached rows for a narrowed term, approximating the server's rules.
 *
 * Deliberately an approximation: it is a preview that the server's response
 * then replaces. It errs toward showing FEWER rows rather than inventing any,
 * so the worst case is a row appearing a moment later, never a wrong row.
 *
 * Mirrors the two rules that matter - every text part must match the name or
 * SKU, and a numeric part matches either the exact price or a substring of the
 * name/SKU, which is the union the API returns for a numeric term.
 */
function filterCached(rows, term) {
  const parts = term.toLowerCase().split(/\s+/).filter(Boolean)
  const numeric = parts.filter(isPriceTerm)
  const text = parts.filter((part) => !isPriceTerm(part))

  return rows.filter((row) => {
    const haystack = `${row.name || ''} ${row.sku || ''}`.toLowerCase()

    if (!text.every((part) => haystack.includes(part))) return false

    if (numeric.length === 0) return true

    return numeric.some((part) => {
      const price = Number(row.price)
      const asNumber = Number(part)
      const samePrice = Number.isFinite(price) && Math.abs(price - asNumber) < 0.005
      return samePrice || haystack.includes(part)
    })
  })
}

/**
 * @param {{ onPick: (product: object) => void, onClose: () => void }} options
 * @returns {HTMLElement} The overlay, ready to append over the form.
 */
export function ProductPicker({ onPick, onClose }) {
  let pending = null

  const listNode = el('div', { class: 'sheet-list' })
  const statusNode = el('p', { class: 'sheet-status', role: 'status' })

  function setMessage(message, kind = 'info') {
    statusNode.className = `sheet-status ${kind}`
    statusNode.textContent = message
  }

  const searchInput = el('input', {
    type: 'search',
    class: 'sheet-search',
    inputmode: 'search',
    placeholder: 'Search by price or name',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: false,
    enterkeyhint: 'search',
    'aria-label': 'Search products by price or name',
  })

  function renderRows(rows, { searching = false } = {}) {
    clear(listNode)

    if (rows.length === 0) {
      // "Nothing matched" must not be claimed while a request is still out, or
      // every keystroke flashes a false negative.
      setMessage(searching ? 'Searching…' : `Nothing matched “${searchInput.value.trim()}”.`)
      return
    }

    for (const product of rows) {
      const inStock = product.is_in_stock !== false

      const details = [
        el('div', { class: 'sheet-row-head' }, [
          el('span', { class: 'sheet-row-name', text: product.name || `Product ${product.id}` }),
          el('span', { class: 'sheet-row-price', text: formatMoney(product.price) }),
        ]),
        el('div', { class: 'sheet-row-meta' }, [
          el('span', { text: product.sku ? `SKU ${product.sku}` : 'No SKU' }),
          // Out of stock is shown, never hidden: someone searching for a thing
          // that exists needs to see that it exists.
          inStock ? null : el('span', { class: 'sheet-row-oos', text: 'Out of stock' }),
        ]),
      ]

      if (!inStock) {
        listNode.append(el('div', {
          class: 'sheet-row is-out-of-stock',
          'aria-disabled': 'true',
        }, details))
        continue
      }

      listNode.append(el('button', {
        type: 'button',
        class: 'sheet-row',
        'aria-label': `Add ${product.name}`,
        onClick: () => onPick(product),
      }, details))
    }

    const count = rows.length === 1 ? '1 product' : `${rows.length} products`
    setMessage(searching ? `${count} — searching…` : count)
  }

  async function search(term) {
    if (term.length < MIN_CHARS) {
      clear(listNode)
      pending?.abort()
      setMessage(`Type at least ${MIN_CHARS} characters.`)
      return
    }

    // A term already searched this session needs no request at all.
    if (cache.has(term)) {
      renderRows(cache.get(term))
      return
    }

    // Narrowing an earlier term: show the filtered subset at once so typing
    // feels instant, then reconcile with the server's answer.
    const source = narrowingSource(term)
    if (source) {
      renderRows(filterCached(cache.get(source), term), { searching: true })
    } else {
      clear(listNode)
      setMessage('Searching…')
    }

    pending?.abort()
    pending = new AbortController()

    try {
      const data = await fetchProducts({ search: term, fields: 'picker' }, pending.signal)
      const rows = Array.isArray(data?.products) ? data.products : []

      cache.set(term, rows)
      renderRows(rows)
    } catch (error) {
      // A superseded search is not a failure.
      if (error?.name === 'AbortError') return
      // main.js is already routing to the login screen.
      if (error?.status === 401) return

      clear(listNode)
      setMessage(error?.message || 'Could not search products.', 'error')
    }
  }

  const runSearch = debounce(() => search(searchInput.value.trim()), SEARCH_DEBOUNCE_MS)

  searchInput.addEventListener('input', runSearch)

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      onClose()
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    runSearch.cancel()
    search(searchInput.value.trim())
  })

  const closeButton = el('button', {
    type: 'button',
    class: 'button sheet-close',
    text: 'Close',
    onClick: onClose,
  })

  const sheet = el('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Add a product',
    // A tap inside the sheet must not reach the backdrop's close handler.
    onClick: (event) => event.stopPropagation(),
  }, [
    el('div', { class: 'sheet-head' }, [
      el('div', { class: 'sheet-head-row' }, [searchInput, closeButton]),
      statusNode,
    ]),
    listNode,
  ])

  const overlay = el('div', {
    class: 'sheet-backdrop',
    onClick: onClose,
  }, [sheet])

  setMessage(`Type at least ${MIN_CHARS} characters.`)

  // After the caller appends this; focusing a detached node does nothing.
  // Opening straight onto the keyboard is the point of a search sheet.
  requestAnimationFrame(() => searchInput.focus())

  return overlay
}
