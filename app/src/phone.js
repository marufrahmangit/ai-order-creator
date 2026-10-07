/**
 * A client-side mirror of the server's BD mobile normalizer.
 *
 * This exists for ONE reason: deciding whether a half-typed phone number is
 * worth a request. Firing the last-order lookup on every partial would mean a
 * request per keystroke for a number nobody has finished typing.
 *
 * It is a gate, NOT a source of truth. The server re-normalizes with
 * ai_normalize_bd_phone() and answers 400 if it disagrees, so a wrong answer
 * here costs at worst a skipped lookup or one rejected request - never a bad
 * phone number stored on an order. The order itself is saved from the raw field
 * value; nothing on the write path goes through this.
 *
 * Kept deliberately line-for-line with includes/parsing/phone.php:
 *
 *   digits = strip non-digits (after Bangla digits are converted)
 *   8801... -> 0 + rest        801... -> 0 + rest
 *   ten digits starting 1 -> 0 + digits
 *   valid when it matches ^01[3-9]\d{8}$
 *
 * If that function changes, this has to change with it.
 */

const BANGLA_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' }

/**
 * @param {string} raw
 * @returns {string} The normalized number, or '' when it is not a valid BD mobile.
 */
export function normalizeBdPhone(raw) {
  const converted = String(raw ?? '').replace(/[০-৯]/g, (d) => BANGLA_DIGITS[d] ?? d)
  let digits = converted.replace(/\D+/g, '')

  if (digits.startsWith('8801')) {
    digits = `0${digits.slice(3)}`
  } else if (digits.startsWith('801')) {
    digits = `0${digits.slice(2)}`
  } else if (digits.length === 10 && digits.startsWith('1')) {
    digits = `0${digits}`
  }

  return /^01[3-9]\d{8}$/.test(digits) ? digits : ''
}
