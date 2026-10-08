/**
 * Line-item quantities.
 *
 * Quantities can be fractional on this store - 1.5, 1.25, 3.56 - because the
 * Decimal Product Quantity plugin is active on both sites, and they are limited
 * to 2 decimal places. The server applies the same limit the same way
 * (ai_rest_line_quantity() rounds a third decimal rather than rejecting it), so
 * the figure this module settles on is the figure that gets stored.
 *
 * The API sends a quantity as a trimmed numeric string ("1", "1.5", "3.56"),
 * for the same reason it sends money as one, and accepts it back the same way.
 */

/** The most decimal places a quantity may carry. Matches AIOC_QUANTITY_DECIMALS. */
export const QUANTITY_DECIMALS = 2

/**
 * Round half away from zero to 2 decimal places, on the DECIMAL value.
 *
 * Not Math.round(x * 100) / 100: 1.005 * 100 is 100.49999999999999 in binary
 * floating point, which rounds the wrong way. Shifting through the exponent in
 * a string keeps the decimal digits as typed, and agrees with PHP's round().
 *
 * @param {number} value
 * @returns {number} NaN when the value is not finite.
 */
export function roundQuantity(value) {
  if (!Number.isFinite(value)) return NaN
  const sign = value < 0 ? -1 : 1
  const shifted = Math.round(Number(`${Math.abs(value)}e${QUANTITY_DECIMALS}`))
  return sign * Number(`${shifted}e-${QUANTITY_DECIMALS}`)
}

/**
 * A quantity the form can hold, from the API or from a person typing.
 *
 * Spaces and thousands separators are stripped, exactly as for money - the
 * decimal point is not. Rounded to 2dp. Anything that does not come out above
 * zero is not a quantity: zero is not valid, and Remove is how a line goes
 * away.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null} null when there is no usable quantity.
 */
export function parseQuantity(value) {
  if (value === null || value === undefined) return null
  const cleaned = String(value).replace(/[\s,]/g, '')
  if (cleaned === '') return null

  const rounded = roundQuantity(Number(cleaned))
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null
}

/**
 * Shown and sent without padding: 1 is "1", 1.5 is "1.5", 3.56 is "3.56".
 * Money has a fixed number of decimals to show; a quantity does not.
 *
 * @param {number|string} value
 * @returns {string} '' when the value is not a number.
 */
export function formatQuantity(value) {
  const rounded = roundQuantity(Number(value))
  return Number.isFinite(rounded) ? String(rounded) : ''
}

/**
 * The − button's target. It steps by 1 and never reaches zero, so from 1.5 it
 * goes to 0.5 and from 1 it goes nowhere.
 *
 * @param {number} quantity
 * @returns {number|null} null when stepping down would leave nothing.
 */
export function stepDown(quantity) {
  const next = roundQuantity(quantity - 1)
  return next > 0 ? next : null
}

/** The + button's target. Rounded, so 2.3 + 1 is 3.3 and not 3.3000000000000003. */
export function stepUp(quantity) {
  return roundQuantity(quantity + 1)
}
