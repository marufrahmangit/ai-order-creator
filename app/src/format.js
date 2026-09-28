/**
 * Display formatting.
 *
 * The API deliberately returns money as a bare numeric string ("430.00") with
 * no symbol and no markup, and tells the app the currency and decimal places
 * via /meta. Formatting is therefore entirely the client's job, and must not
 * assume BDT or 2dp.
 */

import { getMeta } from './meta.js'

let formatter = null
let formatterKey = ''

function currencyFormatter(currency, decimals) {
  const key = `${currency}/${decimals}`
  if (formatter && formatterKey === key) return formatter

  try {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  } catch {
    // An unrecognised currency code makes the constructor throw. Fall back to
    // a plain prefixed number rather than losing the amount.
    formatter = null
  }

  formatterKey = key
  return formatter
}

/**
 * @param {string|number} value A raw numeric string from the API.
 * @returns {string}
 */
export function formatMoney(value) {
  const meta = getMeta()
  const currency = meta?.currency || 'BDT'
  const decimals = Number.isInteger(meta?.priceDecimals) ? meta.priceDecimals : 2

  const amount = Number(value)
  if (!Number.isFinite(amount)) {
    // Better to show whatever the API sent than to print "NaN".
    return String(value ?? '')
  }

  const intl = currencyFormatter(currency, decimals)
  return intl ? intl.format(amount) : `${currency} ${amount.toFixed(decimals)}`
}

/**
 * Order dates arrive as ISO 8601 (DATE_ATOM) or null.
 *
 * @param {string|null} iso
 */
export function formatDateTime(iso) {
  if (!iso) return '—'

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
