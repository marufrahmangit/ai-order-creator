/**
 * What a Reorder copies from a source order.
 *
 * ONE definition, used by both entry points - the button on the last-order
 * card in the form, and the one on each row of the order list. They have to
 * behave identically, and the only way to guarantee that is for there to be
 * nothing to keep in step.
 *
 * REORDER ALWAYS OPENS OR FILLS A FORM. It never writes to the server. The new
 * order is created when the user taps Save, and gets its number then, like any
 * other new order. There is deliberately no second concept that creates an
 * order outright - see docs/PROJECT-STATE.md for why that was dropped rather
 * than built.
 *
 * Pure: it reads an order and returns plain data. Applying it - which fields
 * are already filled, how the form models a line - is the form's business.
 */

import { parseQuantity } from './quantity.js'

/** A numeric string from the API, or null. */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {object} order An order in the standard shape, from GET /orders/{id}
 *   or GET /customers/last-order.
 * @returns {{
 *   fields: Record<string, string>,
 *   lines: Array<{product_id: number, name: string, quantity: number, total: number|null}>,
 *   fees: Array<{name: string, total: number|null}>,
 * }}
 */
export function reorderSource(order) {
  const billing = (order && order.billing) || {}

  return {
    /*
     * Copied as values for the form to fill in where it has nothing already.
     *
     * NOT here, on purpose:
     *   status - a new order starts at the form's default, not wherever the
     *            source order ended up.
     *   shipping - the server recalculates it from the district, every time.
     *   id, number, date - this is a new order, not that one.
     *
     * `state` IS here, and matters more than it looks: shipping is a pure
     * function of the district, so a reorder that dropped it would price the
     * order wrongly until someone noticed the empty dropdown.
     */
    fields: {
      name: String(billing.first_name || ''),
      phone: String(billing.phone || ''),
      address_1: String(billing.address_1 || ''),
      state: String(billing.state || ''),
      customer_note: String((order && order.customer_note) || ''),
    },

    lines: (Array.isArray(order && order.line_items) ? order.line_items : []).map((line) => {
      // Fractional quantities copy as they are; only a missing one becomes 1.
      const quantity = parseQuantity(line.quantity) ?? 1
      return {
        product_id: Number(line.product_id) || 0,
        name: line.name || `Product ${line.product_id}`,
        quantity,
        total: toNumber(line.total),
      }
    }),

    // Negatives intact: a discount is a negative fee, and dropping the sign
    // would turn a discount into a surcharge.
    fees: (Array.isArray(order && order.fee_lines) ? order.fee_lines : []).map((fee) => ({
      name: fee.name || '',
      total: toNumber(fee.total),
    })),
  }
}
