/**
 * The repeat-customer card: this phone number's previous order.
 *
 * Collapsed to a one-line summary by default. The order form is already taller
 * than a phone screen, and expanding every line item of an unrelated order
 * above the fields someone is trying to fill in would push the form away.
 *
 * Nothing is rendered when the customer is new. That is the common case, and a
 * "no previous orders" message would be noise on most orders.
 */

import { formatMoney, formatDateTime } from '../format.js'
import { el, clear } from '../dom.js'

/**
 * @param {{
 *   onOpenOrder: (id: number) => void,
 *   onReorder: (order: object) => void,
 * }} options
 */
export function LastOrderCard({ onOpenOrder, onReorder }) {
  const node = el('div', { class: 'last-order', hidden: true })

  /** Shown when the lookup found nothing, or has not run. */
  function hide() {
    clear(node)
    node.hidden = true
  }

  function lineRow(label, value, modifier = '') {
    return el('div', { class: `last-order-line ${modifier}` }, [
      el('span', { class: 'last-order-line-label', text: label }),
      el('span', { class: 'last-order-line-value', text: value }),
    ])
  }

  /**
   * @param {object} order An order in the standard shape - the same one
   *   GET /orders/{id} returns, because the endpoint reuses that builder.
   */
  function show(order) {
    clear(node)
    node.hidden = false

    const dateText = formatDateTime(order.date_created)
    const summary = el('summary', { class: 'last-order-summary' }, [
      el('span', {
        class: 'last-order-summary-text',
        // Deliberately the whole story in one line: which order, how much,
        // when. Enough to decide whether to expand it.
        text: `Last order #${order.number} — ${formatMoney(order.total)} on ${dateText}`,
      }),
    ])

    const items = Array.isArray(order.line_items) ? order.line_items : []
    const shipping = Array.isArray(order.shipping_lines) ? order.shipping_lines : []
    const fees = Array.isArray(order.fee_lines) ? order.fee_lines : []

    const billing = order.billing || {}
    const name = String(billing.first_name || '').trim()
    const address = String(billing.address_1 || '').trim()
    const district = String(billing.state_label || '').trim()

    const detail = el('div', { class: 'last-order-detail' }, [
      el('div', { class: 'last-order-head' }, [
        el('div', { class: 'last-order-actions' }, [
          // Tapping the number opens that order. A button rather than the whole
          // card, so expanding the card cannot navigate by accident.
          el('button', {
            type: 'button',
            class: 'button link last-order-open',
            text: `Open #${order.number}`,
            'aria-label': `Open order ${order.number}`,
            onClick: () => onOpenOrder(order.id),
          }),
          // "Reorder" fills the form from this order for review. It does NOT
          // create anything - the staff member still taps Save. Inside the
          // expanded card, beside the order number, so it reads as an action on
          // THIS order rather than on the form.
          el('button', {
            type: 'button',
            class: 'button last-order-reorder',
            text: 'Reorder',
            'aria-label': `Copy order ${order.number} into this form`,
            onClick: () => onReorder(order),
          }),
        ]),
        el('span', {
          class: `badge badge-${order.status}`,
          text: order.status_label || order.status,
        }),
      ]),

      el('p', { class: 'last-order-meta', text: dateText }),
      name ? el('p', { class: 'last-order-meta', text: name }) : null,
      address
        ? el('p', { class: 'last-order-meta', text: district ? `${address}, ${district}` : address })
        : null,

      items.length > 0
        ? el('div', { class: 'last-order-lines' },
            items.map((line) => lineRow(
              `${line.quantity} × ${line.name}`,
              formatMoney(line.total),
            )))
        : el('p', { class: 'last-order-meta', text: 'No items on that order.' }),

      ...shipping.map((line) => lineRow(line.method_title || 'Shipping', formatMoney(line.total))),
      // A fee can be negative - that is how a discount is recorded - so the
      // figure is shown as stored rather than as an absolute value.
      ...fees.map((line) => lineRow(line.name || 'Fee', formatMoney(line.total))),

      lineRow('Order total', formatMoney(order.total), 'last-order-total'),
    ])

    // <details> rather than a hand-rolled toggle: collapsed by default and
    // accessible for free.
    node.append(el('details', { class: 'last-order-details' }, [summary, detail]))
  }

  return { node, show, hide }
}
