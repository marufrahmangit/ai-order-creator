/**
 * Order list, in two modes.
 *
 * 'orders' - GET /orders, newest first, with a search box and a status filter.
 * 'trash'  - GET /orders?status=trash, the same rendering, with a Restore
 *            action per row instead of a tap target.
 *
 * One view rather than two because the row, the pager, the search and the
 * abort discipline are identical; only the query and what a row DOES differ.
 *
 * Trash is deliberately NOT an entry in the status filter. It is not a
 * workflow state and has no business sitting next to Processing and Completed -
 * the API makes the same distinction, and `trash` never appears in /meta's
 * status list.
 *
 * ONE search box, behaving as wp-admin's order search does: a substring match
 * across order id, phone, name and address at once. The term is sent exactly as
 * typed - nothing is normalized here or server-side - which is what lets a
 * fragment match mid-phone and lets Bengali addresses be searched.
 */

import { fetchOrders, fetchOrder, restoreOrder } from '../api.js'
import { formatQuantity } from '../quantity.js'
import { getCredential } from '../auth.js'
import { orderStatuses } from '../meta.js'
import { formatMoney, formatDateTime } from '../format.js'
import { el, clear, debounce } from '../dom.js'

const PER_PAGE = 20

/** Matches the ~250-300ms the product picker will use in step 6. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Mirrors AIOC_SEARCH_MIN_LENGTH, which /orders enforces with a 400.
 *
 * Enforced here as well so nobody is shown an error for a half-typed term: the
 * server's 400 is the backstop, this is the rule staff actually meet. The
 * reason for a minimum at all is that the query is a leading-wildcard LIKE, and
 * "01" sits inside nearly every BD phone number.
 */
const SEARCH_MIN_LENGTH = 3

/**
 * "1 item", "3 items", "2.5 items".
 *
 * item_count is WooCommerce's get_item_count(), the SUM of the line quantities,
 * so it is fractional whenever a line is - 1.5 of one thing and 1 of another
 * is 2.5. It is shown as that sum, unpadded, rather than reinterpreted as a
 * count of lines: the figure is WooCommerce's, and the app does not get to
 * redefine it. Singular only for exactly 1; 0.5 and 1.5 read as plural, which
 * is how English counts a fraction.
 *
 * It arrives as a numeric string ("2.5"), so it must be compared as a number:
 * "1" === 1 is false.
 *
 * @param {string|number} value
 */
function itemCountText(value) {
  const count = Number(value)
  if (!Number.isFinite(count)) return ''
  return count === 1 ? '1 item' : `${formatQuantity(count)} items`
}

/**
 * @param {{
 *   mode?: 'orders'|'trash',
 *   onSignOut: () => void,
 *   onOpenOrder?: (id: number) => void,
 *   onNewOrder?: () => void,
 *   onShowTrash?: () => void,
 *   onReorder?: (order: object) => void,
 *   onClose?: () => void,
 * }} options
 */
export function OrdersView({
  mode = 'orders',
  onSignOut,
  onOpenOrder,
  onNewOrder,
  onShowTrash,
  onReorder,
  onClose,
}) {
  const isTrash = mode === 'trash'

  const state = {
    page: 1,
    search: '',
    // In trash mode the status is fixed and the filter is not offered.
    status: isTrash ? 'trash' : '',
    totalPages: 1,
    total: 0,
    /** The rows currently on screen, so a restore can drop one without refetching. */
    orders: [],
  }

  /**
   * The in-flight request, aborted before each new one.
   *
   * Without this, responses can arrive out of order: type "017", then "0171",
   * and if the first response is slower it lands last and the list shows
   * results for a query the box no longer contains.
   */
  let pending = null

  const listNode = el('div', { class: 'list' })
  const statusNode = el('div', { class: 'status-line', role: 'status' })

  const searchInput = el('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Search phone or customer name',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: false,
    enterkeyhint: 'search',
    'aria-label': 'Search orders by phone or customer name',
  })

  const statusSelect = el('select', { class: 'status-select', 'aria-label': 'Filter by status' }, [
    el('option', { value: '', text: 'All statuses' }),
    // Populated from /meta, never hardcoded - and checkout-draft is already
    // filtered out by orderStatuses(). 'trash' is absent from /meta by design
    // and is reached through its own view, not from here.
    ...orderStatuses().map((status) => el('option', { value: status.slug, text: status.label })),
  ])

  const prevButton = el('button', { type: 'button', class: 'button', text: 'Previous' })
  const nextButton = el('button', { type: 'button', class: 'button', text: 'Next' })
  const pageLabel = el('span', { class: 'page-label' })

  const pager = el('nav', { class: 'pager', hidden: true }, [prevButton, pageLabel, nextButton])

  function setMessage(message, kind = 'info') {
    statusNode.className = `status-line ${kind}`
    statusNode.textContent = message
  }

  function cardBody(order) {
    const name = String(order.customer_name || '').trim()
    const phone = String(order.phone || '').trim()

    return [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'order-number', text: `#${order.number}` }),
        // status_label is display-only; status is the key. Slug drives the
        // modifier class so styling never depends on a label string.
        el('span', {
          class: `badge badge-${order.status}`,
          text: order.status_label || order.status,
        }),
      ]),
      el('p', { class: 'customer', text: name || 'No name' }),
      // Tapping the number dials rather than opening the order, so the click
      // must not reach the card's handler.
      phone
        ? el('p', { class: 'phone' }, [
            el('a', {
              href: `tel:${phone}`,
              text: phone,
              onClick: (event) => event.stopPropagation(),
            }),
          ])
        : null,
      el('div', { class: 'card-bottom' }, [
        el('span', { class: 'total', text: formatMoney(order.total) }),
        el('span', {
          class: 'items',
          text: itemCountText(order.item_count),
        }),
        el('span', { class: 'date', text: formatDateTime(order.date_created) }),
      ]),
    ]
  }

  /**
   * The row's Reorder button.
   *
   * Same label, look and behaviour as the one on the last-order card: it opens
   * a NEW order form pre-filled from this order, and writes nothing. The list
   * endpoint returns summaries with no line items, so it has to fetch the full
   * order first - several hundred milliseconds, hence the loading state.
   */
  function reorderButton(order) {
    const button = el('button', {
      type: 'button',
      class: 'button row-reorder',
      text: 'Reorder',
      'aria-label': `Reorder order ${order.number}`,
    })

    button.addEventListener('click', async (event) => {
      // The whole row opens the edit form, so this tap must not reach it.
      event.stopPropagation()

      button.disabled = true
      button.textContent = 'Loading…'

      try {
        const full = await fetchOrder(order.id)
        onReorder(full)
      } catch (error) {
        if (error?.status === 401) return
        button.disabled = false
        button.textContent = 'Reorder'
        setMessage(error?.message || 'Could not load that order to reorder.', 'error')
      }
    })

    return button
  }

  function renderOrderCard(order) {
    const open = () => onOpenOrder(order.id)

    // The whole card is the tap target, not a small "edit" link: this is used
    // one-handed on a phone. role/tabindex/keydown rather than a <button>
    // wrapper, because the phone number below is itself a link and interactive
    // elements cannot nest.
    return el('article', {
      class: 'card card-tappable',
      role: 'button',
      tabindex: 0,
      'aria-label': `Open order ${order.number}`,
      onClick: open,
      onKeydown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        open()
      },
    }, [...cardBody(order), el('div', { class: 'row-actions' }, [reorderButton(order)])])
  }

  /**
   * A trashed row. Deliberately NOT tappable: editing a trashed order is not a
   * sensible flow, and the API would accept the write, so the restriction has
   * to be here. Restore first, then edit.
   */
  function renderTrashedCard(order) {
    const restoreButton = el('button', {
      type: 'button',
      class: 'button',
      text: 'Restore',
      'aria-label': `Restore order ${order.number}`,
    })

    const card = el('article', { class: 'card' }, [
      ...cardBody(order),
      el('div', { class: 'card-actions' }, [restoreButton]),
    ])

    restoreButton.addEventListener('click', async () => {
      restoreButton.disabled = true
      restoreButton.textContent = 'Restoring…'

      try {
        await restoreOrder(order.id)

        // Drop the row locally rather than refetching the list: the server has
        // already told us it succeeded, and a refetch would cost a round trip
        // to learn what we know.
        state.orders = state.orders.filter((candidate) => candidate.id !== order.id)
        state.total = Math.max(0, state.total - 1)
        renderList()
      } catch (error) {
        if (error?.status === 401) return
        restoreButton.disabled = false
        restoreButton.textContent = 'Restore'
        setMessage(error?.message || 'Could not restore that order.', 'error')
      }
    })

    return card
  }

  function renderPager() {
    const hasPages = state.totalPages > 1
    pager.hidden = !hasPages
    if (!hasPages) return

    pageLabel.textContent = `Page ${state.page} of ${state.totalPages}`
    prevButton.disabled = state.page <= 1
    nextButton.disabled = state.page >= state.totalPages
  }

  function emptyMessage() {
    if (state.search) return 'No orders match that search.'
    if (isTrash) return 'The trash is empty.'
    return state.status ? 'No orders match that filter.' : 'No orders yet.'
  }

  function countMessage() {
    if (isTrash) {
      return state.total === 1 ? '1 order in the trash' : `${state.total} orders in the trash`
    }
    return state.total === 1 ? '1 order' : `${state.total} orders`
  }

  /** Renders whatever is in state.orders. Never fetches. */
  function renderList() {
    clear(listNode)

    if (state.orders.length === 0) {
      setMessage(emptyMessage())
      renderPager()
      return
    }

    listNode.append(...state.orders.map(isTrash ? renderTrashedCard : renderOrderCard))
    setMessage(countMessage())
    renderPager()
  }

  async function load() {
    // Abort the previous request rather than racing it.
    pending?.abort()
    pending = new AbortController()

    setMessage('Loading…')

    try {
      const data = await fetchOrders(
        {
          page: state.page,
          perPage: PER_PAGE,
          search: state.search,
          status: state.status,
        },
        pending.signal,
      )

      const orders = Array.isArray(data?.orders) ? data.orders : []
      state.total = Number(data?.total) || 0
      state.totalPages = Math.max(1, Number(data?.total_pages) || 1)

      // A filter change can leave the page number past the end of the new
      // result set, which returns an empty list rather than an error. Step
      // back instead of showing nothing.
      if (orders.length === 0 && state.page > state.totalPages) {
        state.page = state.totalPages
        return load()
      }

      state.orders = orders
      renderList()
    } catch (error) {
      // A superseded request is not a failure and must not overwrite the list
      // or the message the newer request is about to set.
      if (error?.name === 'AbortError') return

      // A 401 has already cleared the credential and fired orderops:signedout
      // inside api.js; main.js is handling the route change, so saying
      // anything here would flash an error over the login screen.
      if (error?.status === 401) return

      clear(listNode)
      setMessage(error?.message || 'Could not load orders.', 'error')
      listNode.append(
        el('button', {
          type: 'button',
          class: 'button',
          text: 'Try again',
          onClick: () => load(),
        }),
      )
      pager.hidden = true
    }
  }

  /**
   * Adopt whatever is in the search box.
   *
   * A term of 1 or 2 characters is NOT sent. The endpoint answers 400 below the
   * minimum, so a request could only fail - and leaving the previous results on
   * screen while someone types would be worse than failing, because a stale
   * list looks exactly like an answer.
   *
   * state.search stays empty in that case, so nothing else that calls load() -
   * the status filter, the pager - can fire a request the server will reject.
   */
  function applySearch() {
    const term = searchInput.value.trim()
    state.page = 1

    if (term.length > 0 && term.length < SEARCH_MIN_LENGTH) {
      // Abort the in-flight request too: its answer is for an older term.
      pending?.abort()
      state.search = ''
      state.orders = []
      clear(listNode)
      pager.hidden = true
      setMessage(`Type at least ${SEARCH_MIN_LENGTH} characters to search.`)
      return
    }

    state.search = term
    load()
  }

  const runSearch = debounce(applySearch, SEARCH_DEBOUNCE_MS)

  searchInput.addEventListener('input', runSearch)

  // Submitting from the phone keyboard should search now, not after the
  // debounce, and must not let a queued call fire a second request.
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    runSearch.cancel()
    applySearch()
  })

  statusSelect.addEventListener('change', () => {
    state.status = statusSelect.value
    state.page = 1
    load()
  })

  prevButton.addEventListener('click', () => {
    if (state.page <= 1) return
    state.page -= 1
    load()
  })

  nextButton.addEventListener('click', () => {
    if (state.page >= state.totalPages) return
    state.page += 1
    load()
  })

  const credential = getCredential()

  const headerRow = isTrash
    ? el('div', { class: 'header-row' }, [
        el('button', { type: 'button', class: 'button link', text: '‹ Orders', onClick: onClose }),
        el('h1', { class: 'app-title', text: 'Trash' }),
      ])
    : el('div', { class: 'header-row' }, [
        el('h1', { class: 'app-title', text: 'Orders' }),
        el('div', { class: 'header-actions' }, [
          // A link beside the title, not an option in the status filter.
          el('button', { type: 'button', class: 'button link', text: 'Trash', onClick: onShowTrash }),
          el('button', { type: 'button', class: 'button link', text: 'Sign out', onClick: onSignOut }),
        ]),
      ])

  const header = el('header', { class: 'app-header' }, [
    headerRow,
    isTrash
      ? el('p', { class: 'signed-in-as', text: 'Restore an order to edit it. Nothing here is deleted permanently.' })
      : el('p', { class: 'signed-in-as', text: `Signed in as ${credential?.displayName || ''}` }),
    // The status filter is pointless in trash mode - the status is the view.
    el('div', { class: 'filters' }, isTrash ? [searchInput] : [searchInput, statusSelect]),
  ])

  const children = [header, el('main', { class: 'orders-main' }, [statusNode, listNode, pager])]

  if (!isTrash) {
    // Fixed rather than in the header: it stays in thumb reach on a phone, and
    // the header is already carrying a search box and a filter.
    children.push(el('button', {
      type: 'button',
      class: 'fab',
      text: '+ New',
      'aria-label': 'New order',
      onClick: onNewOrder,
    }))
  }

  const view = el('div', { class: 'orders' }, children)

  load()

  return view
}
