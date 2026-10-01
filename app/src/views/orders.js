/**
 * Order list.
 *
 * GET /orders, newest first, with a search box and a status filter. Search
 * resolves a phone number or a customer name - NOT an order id, which is a
 * recorded decision: staff search by phone.
 */

import { fetchOrders } from '../api.js'
import { getCredential } from '../auth.js'
import { orderStatuses } from '../meta.js'
import { formatMoney, formatDateTime } from '../format.js'
import { el, clear, debounce } from '../dom.js'

const PER_PAGE = 20

/** Matches the ~250-300ms the product picker will use in step 6. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * @param {{ onSignOut: () => void, onOpenOrder: (id: number) => void, onNewOrder: () => void }} options
 */
export function OrdersView({ onSignOut, onOpenOrder, onNewOrder }) {
  const state = {
    page: 1,
    search: '',
    status: '',
    totalPages: 1,
    total: 0,
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
    // filtered out by orderStatuses().
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

  function renderOrderCard(order) {
    const name = String(order.customer_name || '').trim()
    const phone = String(order.phone || '').trim()

    const open = () => onOpenOrder(order.id)

    // The whole card is the tap target, not a small "edit" link: this is used
    // one-handed on a phone. role/tabindex/keydown rather than a <button>
    // wrapper, because the phone number below is itself a link and interactive
    // elements cannot nest.
    const card = el('article', {
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
    }, [
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
          text: order.item_count === 1 ? '1 item' : `${order.item_count} items`,
        }),
        el('span', { class: 'date', text: formatDateTime(order.date_created) }),
      ]),
    ])

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

      clear(listNode)

      if (orders.length === 0) {
        setMessage(
          state.search || state.status
            ? 'No orders match that search.'
            : 'No orders yet.',
        )
        renderPager()
        return
      }

      listNode.append(...orders.map(renderOrderCard))
      setMessage(state.total === 1 ? '1 order' : `${state.total} orders`)
      renderPager()
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

  const runSearch = debounce(() => {
    state.search = searchInput.value.trim()
    state.page = 1
    load()
  }, SEARCH_DEBOUNCE_MS)

  searchInput.addEventListener('input', runSearch)

  // Submitting from the phone keyboard should search now, not after the
  // debounce, and must not let a queued call fire a second request.
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    runSearch.cancel()
    state.search = searchInput.value.trim()
    state.page = 1
    load()
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

  const header = el('header', { class: 'app-header' }, [
    el('div', { class: 'header-row' }, [
      el('h1', { class: 'app-title', text: 'Orders' }),
      el('button', {
        type: 'button',
        class: 'button link',
        text: 'Sign out',
        onClick: onSignOut,
      }),
    ]),
    el('p', { class: 'signed-in-as', text: `Signed in as ${credential?.displayName || ''}` }),
    el('div', { class: 'filters' }, [searchInput, statusSelect]),
  ])

  // Fixed rather than in the header: it stays in thumb reach on a phone, and
  // the header is already carrying a search box and a filter.
  const newOrderButton = el('button', {
    type: 'button',
    class: 'fab',
    text: '+ New',
    'aria-label': 'New order',
    onClick: onNewOrder,
  })

  const view = el('div', { class: 'orders' }, [
    header,
    el('main', { class: 'orders-main' }, [statusNode, listNode, pager]),
    newOrderButton,
  ])

  load()

  return view
}
