/**
 * The order form. One screen, two entry points: a new order (no id) or an
 * existing one loaded from GET /orders/{id}.
 *
 * Step 6a: the form and its line-items list. The product picker is 6b, and the
 * add-by-id control near the bottom of this file is an explicitly temporary
 * stand-in for it.
 *
 * Two rules from docs/PROJECT-STATE.md shape most of what follows:
 *
 *   - Validation mirrors WooCommerce, never stricter. An empty form saves.
 *     There is no required-field checking anywhere in here.
 *   - The server is authoritative on shipping and totals. Shipping is a pure
 *     function of the billing state, computed server-side with no manual
 *     override, so this form displays it and never calculates it. Before the
 *     first save it previews the rate by LOOKING IT UP in /meta's table, which
 *     is the same table the server applies - still not a calculation here.
 */

import { fetchOrder, parseText, createOrder, updateOrder, trashOrder, fetchLastOrder } from '../api.js'
import { districts, orderStatuses, shippingRateFor } from '../meta.js'
import { formatMoney, formatAmount } from '../format.js'
import { el, clear, debounce } from '../dom.js'
import { ProductPicker } from './product-picker.js'
import { LastOrderCard } from './last-order.js'
import { normalizeBdPhone } from '../phone.js'
import { reorderSource } from '../reorder.js'

/** Every field whose dirty state is tracked, in payload-key form. */
const FIELDS = ['name', 'phone', 'address_1', 'state', 'status', 'customer_note']

/** Long enough that typing a number does not fire a request per digit. */
const LOOKUP_DEBOUNCE_MS = 400

/** A numeric string from the API, or null when it is absent or unparseable. */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A figure typed by a person, which is not the same thing as a numeric string.
 *
 * Spaces and thousands separators are stripped, because "1,500" is how the
 * amount gets typed and Number() would make NaN of it - the edit would then be
 * silently ignored, which is the worst of the available behaviours. The comma
 * is unambiguous here: this store's currency is BDT, where it groups
 * thousands rather than marking decimals.
 *
 * @param {string} text
 * @returns {number|null}
 */
function parseTypedAmount(text) {
  const cleaned = String(text).replace(/[\s,]/g, '')
  return toNumber(cleaned)
}

/**
 * @param {{
 *   orderId: number|null,
 *   onClose: () => void,
 *   onOpenOrder: (id: number) => void,
 *   reorderFrom?: object,
 *   signal?: AbortSignal,
 * }} options
 */
export function OrderFormView({ orderId, onClose, onOpenOrder, reorderFrom, signal }) {
  const state = {
    orderId: orderId ?? null,
    /** Fields the user has actually changed. Drives the partial update. */
    dirty: new Set(),
    items: [],
    /**
     * Whether the user touched the items at all. line_items is all-or-nothing:
     * touched means send the complete list, untouched means omit the key so the
     * stored lines survive.
     */
    itemsDirty: false,
    /** [{ name, total }]. A NEGATIVE total is how a discount is recorded. */
    fees: [],
    /**
     * Tracked SEPARATELY from itemsDirty, never folded into it. The endpoints
     * treat line_items and fee_lines as independent replace-all lists, so
     * collapsing the two flags here would make editing a product silently
     * rewrite the fees, or vice versa.
     */
    feesDirty: false,
    /**
     * The SERVER'S shipping line, and only that. A null cost means the order
     * has none - which is the normal state before the first save, and is what
     * makes renderTotals() fall back to previewing the district's rate.
     * Nothing but applyServerOrder() may write to it, or "has the server told
     * us?" stops being answerable.
     *
     * Deliberately NOT the shipping line's id: ai_apply_shipping() clears and
     * re-adds the line on every save, so any id held here would be stale the
     * moment it was stored. Nothing in this form keeps a line, fee or shipping
     * item id - replacement discards them all server-side anyway.
     */
    shipping: { cost: null, label: '' },
    /** The server's order total, valid until a local edit diverges from it. */
    serverTotal: null,
    warnings: [],
  }

  // ---------------------------------------------------------------- chrome

  const title = el('h1', { class: 'app-title', text: state.orderId ? 'Order' : 'New order' })
  const message = el('p', { class: 'status-line', role: 'status' })
  const warningsNode = el('div', { class: 'warnings', hidden: true })

  function setMessage(text, kind = 'info') {
    message.className = `status-line ${kind}`
    message.textContent = text
  }

  function renderWarnings() {
    clear(warningsNode)
    warningsNode.hidden = state.warnings.length === 0
    if (state.warnings.length === 0) return

    warningsNode.append(
      el('p', { class: 'warnings-title', text: 'The server reported:' }),
      el('ul', {}, state.warnings.map((warning) => el('li', { text: String(warning) }))),
    )
  }

  // ---------------------------------------------------------------- fields

  const pasteInput = el('textarea', {
    class: 'paste-input',
    rows: 6,
    placeholder: 'Paste the customer message here',
    'aria-label': 'Message to parse',
  })

  const parseButton = el('button', { type: 'button', class: 'button', text: 'Parse' })

  // Collapsed on an existing order: its fields are already filled, so the box
  // is the exception there rather than the starting point. <details> rather
  // than a hand-rolled toggle, so it collapses accessibly for free.
  const pasteBox = el('details', { class: 'paste', open: state.orderId === null }, [
    el('summary', { class: 'paste-summary', text: 'Paste and parse' }),
    el('p', { class: 'muted', text: 'Optional. Typing into the fields below works exactly the same.' }),
    pasteInput,
    parseButton,
  ])

  const nameInput = el('input', {
    type: 'text', id: 'of-name', autocomplete: 'off', autocapitalize: 'words',
  })
  const phoneInput = el('input', {
    type: 'tel', id: 'of-phone', autocomplete: 'off', inputmode: 'tel',
  })
  const addressInput = el('textarea', { id: 'of-address', rows: 3 })
  const noteInput = el('textarea', { id: 'of-note', rows: 2 })

  // Districts come from /meta, never hardcoded. Options are keyed on `code`;
  // `label` is display only and is trimmed because some WooCommerce BD labels
  // carry trailing whitespace. Nothing here ever compares a label string.
  const districtSelect = el('select', { id: 'of-district' }, [
    // No district is a valid order, so the empty option is a real choice, not
    // a prompt. It does NOT mean the Outside Dhaka rate: ai_apply_shipping()
    // returns early on an empty billing state and adds no shipping line at all.
    el('option', { value: '', text: '— No district —' }),
    ...districts().map((district) => el('option', { value: district.code, text: district.label })),
  ])

  // Statuses likewise come from /meta, with checkout-draft already filtered out
  // by orderStatuses().
  const statusSelect = el('select', { id: 'of-status' },
    orderStatuses().map((status) => el('option', { value: status.slug, text: status.label })),
  )

  // Default for a new order. Harmless to send - the server defaults to pending
  // anyway - but it has to be what the select shows.
  if (state.orderId === null) statusSelect.value = 'pending'

  function field(labelText, control, hint) {
    return el('div', { class: 'field' }, [
      el('label', { for: control.id, text: labelText }),
      control,
      hint ? el('p', { class: 'field-hint', text: hint }) : null,
    ])
  }

  const districtHint = el('p', { class: 'field-hint', hidden: true })

  /** Current field values, keyed exactly as the write endpoints expect. */
  function readFields() {
    return {
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      address_1: addressInput.value.trim(),
      state: districtSelect.value,
      status: statusSelect.value,
      customer_note: noteInput.value.trim(),
    }
  }

  const controls = {
    name: nameInput,
    phone: phoneInput,
    address_1: addressInput,
    state: districtSelect,
    status: statusSelect,
    customer_note: noteInput,
  }

  for (const [key, control] of Object.entries(controls)) {
    const eventName = control.tagName === 'SELECT' ? 'change' : 'input'
    control.addEventListener(eventName, () => {
      state.dirty.add(key)
      // The district decides the shipping rate, so the totals have to follow
      // it live - on an unsaved order the figure shown IS the district's rate.
      if (key === 'state') renderTotals()
    })
  }

  // --------------------------------------------------- repeat-customer lookup

  /** Anything the user has changed but not saved. */
  function isDirty() {
    return state.dirty.size > 0 || state.itemsDirty || state.feesDirty
  }

  /** The order id a second tap would open, once the first tap warned. */
  let openConfirmFor = null

  /**
   * Opening the previous order navigates away, which discards whatever is in
   * this form. Worth one confirmation rather than losing a half-typed order to
   * a mistap - the same two-step the trash action uses, through the status line
   * rather than a second confirm UI.
   */
  function requestOpenOrder(id) {
    if (!isDirty() || openConfirmFor === id) {
      onOpenOrder(id)
      return
    }

    openConfirmFor = id
    setMessage('Unsaved changes here. Tap Open again to discard them and open that order.', 'error')
  }

  /** The order id a second tap would reorder, once the first tap warned. */
  let reorderConfirmFor = null

  /**
   * Copy a previous order into this form, for review.
   *
   * REORDER FILLS THE FORM. It does not create anything - the staff member
   * reads it over and taps Save like any other order, and the new order gets
   * its number then. There is exactly one Reorder concept in this app, reached
   * from here and from each row of the order list, and nothing anywhere
   * creates an order outright.
   *
   * Everything comes from the order object the card already holds, so there is
   * no second request.
   *
   * What is deliberately NOT copied:
   *   - status: a new order starts at the form's default, not wherever the old
   *     one ended up. Copying "completed" onto a fresh order would be wrong.
   *   - shipping: the server recalculates it from the district, every time.
   *   - the id, number and date: this is a new order, not that one.
   *
   * Stock is deliberately NOT pre-checked. A copied line may point at a product
   * that has since gone out of stock or been deleted, and the write endpoint
   * already handles both - adding out-of-stock anyway with a warning, skipping a
   * missing product with a warning. Those warnings surface after save like any
   * others. Checking here would duplicate the server's judgement against data
   * that is not saved yet.
   *
   * @param {object} order
   */
  function applyReorder(order) {
    // WHAT gets copied is defined once, in src/reorder.js, and shared with the
    // order list's Reorder. Only the applying is local to this form.
    const source = reorderSource(order)

    state.items = source.lines.map((line) => makeItem({
      product_id: line.product_id,
      name: line.name,
      quantity: line.quantity,
      total: line.total,
      // Derived the same way a loaded order derives it, so Price and Total
      // agree on screen.
      price: line.total === null ? null : line.total / line.quantity,
    }))

    state.fees = source.fees.map((fee) => makeFee(fee))

    // MUST be marked dirty. Both lists are all-or-nothing on update, so without
    // these flags the payload omits them entirely and the copy saves nothing.
    state.itemsDirty = true
    state.feesDirty = true

    // Only fill what the user has not. They may be correcting the customer's
    // details, and overwriting a name somebody just typed would be rude at best.
    const fill = (key, control, value) => {
      if (String(control.value).trim() !== '') return
      if (typeof value !== 'string' || value.trim() === '') return
      control.value = value
      state.dirty.add(key)
    }

    fill('name', nameInput, source.fields.name)
    fill('phone', phoneInput, source.fields.phone)
    fill('address_1', addressInput, source.fields.address_1)
    fill('customer_note', noteInput, source.fields.customer_note)

    // The district is a select, so only a code /meta actually offers can be
    // set - an unknown one would either be invented or silently land as ''.
    const district = source.fields.state
    if (district !== '' && String(districtSelect.value).trim() === '') {
      const offered = Array.from(districtSelect.options || [])
        .some((option) => option.value === district)
      if (offered) {
        districtSelect.value = district
        state.dirty.add('state')
      }
    }

    renderItems()
    renderFees()
    renderTotals()

    const itemWord = state.items.length === 1 ? 'item' : 'items'
    setMessage(
      `Copied ${state.items.length} ${itemWord} from #${order.number}. Review, then save.`,
    )
  }

  /**
   * Reorder replaces the items and fees wholesale rather than appending, so a
   * form that already has either would lose them. Confirm once in that case -
   * the same tap-again step the navigation guard beside it uses.
   */
  function requestReorder(order) {
    const hasContent = state.items.length > 0 || state.fees.length > 0

    if (!hasContent || reorderConfirmFor === order.id) {
      reorderConfirmFor = null
      applyReorder(order)
      return
    }

    reorderConfirmFor = order.id
    setMessage(
      `This replaces the items and fees already on the form. Tap Reorder again to copy #${order.number}.`,
      'error',
    )
  }

  const lastOrder = LastOrderCard({
    onOpenOrder: requestOpenOrder,
    onReorder: requestReorder,
  })

  /** The in-flight lookup, aborted before each new one. */
  let lookupPending = null

  /**
   * The last number looked up and what came back for it.
   *
   * The RESULT is cached, not just the number, and that is the point: deleting
   * a digit hides the card without forgetting the lookup, so retyping the same
   * number re-shows it from memory instead of asking the server again.
   * Backspacing through a number therefore costs no requests at all.
   *
   * Invalidated whenever the order id changes, because that changes whether the
   * cached order is the one on screen - see applyServerOrder().
   */
  let lookupCache = { phone: '', order: null }

  /**
   * Show the looked-up order, or nothing.
   *
   * The card always reflects the GENUINE most recent order for the number in
   * the field - the endpoint has no exclude parameter and returns no
   * substitutes. The one case it must not show is that order being the one
   * already open on screen, which tells the user nothing they cannot see. That
   * is a display decision, made here, rather than a filter pushed into the
   * query where it would turn into "show the second-most-recent order" and
   * quietly mislead.
   *
   * It covers the reassignment case for free: change the phone to another
   * customer's number while editing and their real last order appears, because
   * its id is not this order's.
   *
   * @param {object|null} order
   */
  function renderLookup(order) {
    if (!order) {
      lastOrder.hide()
      return
    }

    if (state.orderId !== null && Number(order.id) === Number(state.orderId)) {
      lastOrder.hide()
      return
    }

    lastOrder.show(order)
  }

  /**
   * Look up this phone number's previous order.
   *
   * Fires only for a number that normalizes to a valid BD mobile, so a partial
   * number costs nothing. The gate is app/src/phone.js, a mirror of the
   * server's normalizer - the server re-checks and 400s if it disagrees.
   */
  async function lookupLastOrder() {
    const phone = normalizeBdPhone(phoneInput.value)

    if (phone === '') {
      // Hide the card, but keep the cache: the number is mid-edit, not wrong.
      lookupPending?.abort()
      lastOrder.hide()
      return
    }

    // Unchanged number: render what it resolved to last time, no request. This
    // is what keeps deleting and retyping silent.
    if (phone === lookupCache.phone) {
      renderLookup(lookupCache.order)
      return
    }

    lookupPending?.abort()
    lookupPending = new AbortController()

    try {
      const result = await fetchLastOrder({ phone }, lookupPending.signal)

      // found: false is the common case and shows nothing at all. A "new
      // customer" message would be noise on most orders. It is cached too, so
      // a new customer's number is not asked about twice.
      lookupCache = {
        phone,
        order: result?.found && result.order ? result.order : null,
      }

      renderLookup(lookupCache.order)
    } catch (error) {
      if (error?.name === 'AbortError') return
      if (error?.status === 401) return
      // A failed lookup is not worth a message: it is an extra, and the form
      // works without it. Leaving the card hidden is the honest outcome.
      lastOrder.hide()
    }
  }

  const runLookup = debounce(lookupLastOrder, LOOKUP_DEBOUNCE_MS)

  phoneInput.addEventListener('input', runLookup)
  phoneInput.addEventListener('blur', () => {
    // Blur should not wait out the debounce - the number is finished.
    runLookup.cancel()
    lookupLastOrder()
  })

  // ---------------------------------------------------------------- items

  const itemsList = el('div', { class: 'items-list' })

  /**
   * One line item row: price per unit, quantity, line total.
   *
   * This mirrors WooCommerce's order edit screen, which gives a line exactly
   * these two editable money fields. Changing the price or the quantity
   * recalculates the total; changing the total sets it directly and leaves the
   * price showing whatever it was. There is no override concept, because
   * WooCommerce has no such concept - with both fields present there is no
   * ambiguity for one to resolve.
   *
   * `price` is a CLIENT-SIDE CONVENIENCE ONLY. The API has no per-line price
   * field: it takes product_id, quantity and total, so the price exists here
   * purely to compute the total, and the server only ever receives the total.
   * See lineItemsPayload().
   */
  function makeItem({ product_id, name, price, quantity, total }) {
    return {
      product_id,
      name,
      price,
      quantity: Math.max(1, quantity || 1),
      total,
    }
  }

  /** The figure to show and send for a row, or null when it is not known yet. */
  function lineTotal(item) {
    return item.total
  }

  /** price x quantity, or null when there is no price to multiply. */
  function computedTotal(item) {
    return item.price === null ? null : item.price * item.quantity
  }

  function setQuantity(item, quantity) {
    const next = Math.max(1, quantity)
    if (next === item.quantity) return

    item.quantity = next

    // Quantity always recalculates the total, as WooCommerce does.
    if (item.price !== null) {
      item.total = computedTotal(item)
    }

    state.itemsDirty = true

    renderItems()
    renderTotals()
  }

  /**
   * Typing in the PRICE field. Recalculates the total.
   *
   * The text is left exactly as typed - no reformatting mid-entry, which would
   * fight the caret and make "1" impossible to turn into "10". Normalization
   * happens on blur.
   *
   * @returns {boolean} Whether the total changed and its input needs rewriting.
   */
  function onPriceInput(item, rawText) {
    state.itemsDirty = true

    const parsed = parseTypedAmount(rawText)
    if (parsed === null) {
      return false
    }

    item.price = parsed
    item.total = computedTotal(item)
    renderTotals()

    return true
  }

  /**
   * The price field losing focus: settle on a figure and show it canonically.
   *
   * @returns {string} The text the price input should now display.
   */
  function onPriceBlur(item, rawText) {
    const text = rawText.trim()

    if (text === '') {
      item.price = null
    } else {
      const parsed = parseTypedAmount(text)
      // Unparseable input keeps whatever the line already held rather than
      // becoming 0 - a typo must not quietly zero a line.
      if (parsed !== null) {
        item.price = parsed
        item.total = computedTotal(item)
      }
    }

    renderTotals()

    return item.price === null ? '' : formatAmount(item.price)
  }

  /**
   * Typing in the TOTAL field. Sets the line total directly and leaves the
   * price alone, exactly as WooCommerce does - the price field keeps showing
   * what it showed before.
   */
  function onTotalInput(item, rawText) {
    state.itemsDirty = true

    const parsed = parseTypedAmount(rawText)
    if (parsed !== null) {
      item.total = parsed
      renderTotals()
    }
  }

  /**
   * The total field losing focus.
   *
   * @returns {string} The text the total input should now display.
   */
  function onTotalBlur(item, rawText) {
    const text = rawText.trim()

    if (text === '') {
      item.total = null
    } else {
      const parsed = parseTypedAmount(text)
      if (parsed !== null) item.total = parsed
    }

    renderTotals()

    return item.total === null ? '' : formatAmount(item.total)
  }

  function removeItem(item) {
    state.items = state.items.filter((candidate) => candidate !== item)
    state.itemsDirty = true
    renderItems()
    renderTotals()
  }

  function renderItems() {
    clear(itemsList)

    if (state.items.length === 0) {
      itemsList.append(el('p', { class: 'muted', text: 'No items on this order yet.' }))
      return
    }

    for (const item of state.items) {
      const total = lineTotal(item)

      const quantityValue = el('span', {
        class: 'qty-value',
        text: String(item.quantity),
        role: 'status',
        'aria-label': `Quantity ${item.quantity}`,
      })

      // Quantity has a floor of 1: the remove button is how a row goes away,
      // so decrementing can never delete one by surprise.
      const minus = el('button', {
        type: 'button',
        class: 'qty-button',
        text: '−',
        disabled: item.quantity <= 1,
        'aria-label': 'Decrease quantity',
        onClick: () => setQuantity(item, item.quantity - 1),
      })

      const plus = el('button', {
        type: 'button',
        class: 'qty-button',
        text: '+',
        'aria-label': 'Increase quantity',
        onClick: () => setQuantity(item, item.quantity + 1),
      })

      // Both money fields are type=text with a numeric inputmode rather than
      // type=number: a number input rejects a partially typed value in some
      // browsers and brings spinners nobody wants on a phone, while inputmode
      // still gets the numeric keypad.
      const totalInput = el('input', {
        type: 'text',
        inputmode: 'decimal',
        class: 'item-money-input item-total-input',
        value: total === null ? '' : formatAmount(total),
        placeholder: total === null ? 'Set on save' : '',
        'aria-label': `Line total for ${item.name}`,
        onInput: (event) => onTotalInput(item, event.target.value),
        onBlur: (event) => {
          // Writing straight to the input rather than re-rendering the row:
          // renderItems() would rebuild this node and, on a phone, drop the
          // keyboard the user may still be moving through the form with.
          event.target.value = onTotalBlur(item, event.target.value)
        },
      })

      const priceInput = el('input', {
        type: 'text',
        inputmode: 'decimal',
        class: 'item-money-input item-price-input',
        value: item.price === null ? '' : formatAmount(item.price),
        placeholder: item.price === null ? 'Set on save' : '',
        'aria-label': `Unit price for ${item.name}`,
        onInput: (event) => {
          // Editing the price rewrites the total field, which the user is not
          // typing in - so updating it live is help rather than interference.
          if (onPriceInput(item, event.target.value)) {
            totalInput.value = item.total === null ? '' : formatAmount(item.total)
          }
        },
        onBlur: (event) => {
          event.target.value = onPriceBlur(item, event.target.value)
          totalInput.value = item.total === null ? '' : formatAmount(item.total)
        },
      })

      itemsList.append(el('article', { class: 'item-row' }, [
        el('div', { class: 'item-head' }, [
          el('p', { class: 'item-name', text: item.name }),
          el('button', {
            type: 'button',
            class: 'button link danger',
            text: 'Remove',
            'aria-label': `Remove ${item.name}`,
            onClick: () => removeItem(item),
          }),
        ]),
        el('div', { class: 'item-money-row' }, [
          el('label', { class: 'item-money-label' }, [
            el('span', { text: 'Price' }),
            priceInput,
          ]),
          el('label', { class: 'item-money-label' }, [
            el('span', { text: 'Total' }),
            totalInput,
          ]),
        ]),
        el('div', { class: 'item-foot' }, [
          el('div', { class: 'qty-stepper' }, [minus, quantityValue, plus]),
        ]),
      ]))
    }
  }

  // ------------------------------------------------------------- add product

  /**
   * The picker, opened as a sheet OVER this form rather than as a route, so
   * the form stays mounted and unsaved edits survive opening and closing it.
   */
  let picker = null

  function closePicker() {
    picker?.remove()
    picker = null
    addProductButton.focus()
  }

  function openPicker() {
    if (picker) return

    picker = ProductPicker({
      onPick: (product) => {
        addPickedProduct(product)
        closePicker()
      },
      onClose: closePicker,
    })

    view.append(picker)
  }

  /**
   * Add a picked product as a NEW line.
   *
   * A separate line even when the product is already on the order, because
   * that is what WooCommerce does: WC_Abstract_Order::add_product() builds a
   * fresh WC_Order_Item_Product every call and add_item() appends it with no
   * lookup by product id. (The CART merges by cart item key - a different code
   * path, and not the one the order editor uses.) Our own
   * ai_rest_add_line_items() calls add_product() per payload entry, so
   * duplicate ids become separate lines server-side too; merging here would
   * have disagreed with both.
   *
   * Quantity 1, Price from the search result, Total as price x 1.
   */
  function addPickedProduct(product) {
    const price = toNumber(product.price)

    state.items.push(makeItem({
      product_id: Number(product.id) || 0,
      name: product.name || `Product ${product.id}`,
      price,
      quantity: 1,
      total: price,
    }))

    state.itemsDirty = true

    renderItems()
    renderTotals()
    setMessage(`Added ${product.name || 'product'}.`)
  }

  const addProductButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Add product',
    onClick: openPicker,
  })

  const addItemBox = el('div', { class: 'add-item' }, [addProductButton])

  // ---------------------------------------------------------------- fees

  const feesList = el('div', { class: 'items-list' })

  /**
   * One fee row.
   *
   * `total` can be negative - that is not an edge case, it is how a discount
   * is recorded. Nothing here blocks a minus sign or takes an absolute value.
   * An empty name is allowed, because WooCommerce allows it.
   */
  function makeFee({ name, total }) {
    return {
      name: typeof name === 'string' ? name : '',
      total,
    }
  }

  function addFee() {
    state.fees.push(makeFee({ name: '', total: null }))
    state.feesDirty = true
    renderFees()
    renderTotals()
  }

  function removeFee(fee) {
    state.fees = state.fees.filter((candidate) => candidate !== fee)
    state.feesDirty = true
    renderFees()
    renderTotals()
  }

  /** Mid-typing: update the figure and the order total, never the input. */
  function onFeeAmountInput(fee, rawText) {
    state.feesDirty = true

    const parsed = parseTypedAmount(rawText)
    if (parsed !== null) {
      fee.total = parsed
      renderTotals()
    }
  }

  /**
   * On blur: settle on a figure and show it canonically.
   *
   * @returns {string} The text the input should now display.
   */
  function onFeeAmountBlur(fee, rawText) {
    const text = rawText.trim()

    if (text === '') {
      fee.total = null
    } else {
      const parsed = parseTypedAmount(text)
      // An unparseable amount keeps whatever the row already held rather than
      // collapsing to 0 - a typo must not quietly cancel a discount.
      if (parsed !== null) fee.total = parsed
    }

    renderTotals()

    return fee.total === null ? '' : formatAmount(fee.total)
  }

  function renderFees() {
    clear(feesList)

    if (state.fees.length === 0) {
      feesList.append(el('p', { class: 'muted', text: 'No fees on this order.' }))
      return
    }

    for (const fee of state.fees) {
      const nameInputRow = el('input', {
        type: 'text',
        class: 'fee-name-input',
        value: fee.name,
        placeholder: 'Fee name (optional)',
        'aria-label': 'Fee name',
        onInput: (event) => {
          fee.name = event.target.value
          state.feesDirty = true
        },
      })

      const amountInput = el('input', {
        type: 'text',
        // decimal rather than numeric for the separator key. Note that on iOS
        // neither keypad offers a minus sign, which is why the sign toggle
        // below exists - a discount has to be typeable one-handed.
        inputmode: 'decimal',
        class: 'fee-amount-input',
        value: fee.total === null ? '' : formatAmount(fee.total),
        placeholder: '0.00',
        'aria-label': 'Fee amount, negative for a discount',
        onInput: (event) => onFeeAmountInput(fee, event.target.value),
        onBlur: (event) => {
          // Written straight to the input rather than re-rendering the row,
          // which would rebuild this node and drop the keyboard.
          event.target.value = onFeeAmountBlur(fee, event.target.value)
        },
      })

      const signToggle = el('button', {
        type: 'button',
        class: 'button sign-toggle',
        text: '±',
        title: 'Switch between a charge and a discount',
        'aria-label': 'Switch between a charge and a discount',
        onClick: () => {
          if (fee.total === null || fee.total === 0) return
          fee.total = -fee.total
          state.feesDirty = true
          amountInput.value = formatAmount(fee.total)
          renderTotals()
        },
      })

      feesList.append(el('article', { class: 'item-row' }, [
        el('div', { class: 'fee-row' }, [
          nameInputRow,
          el('div', { class: 'fee-amount-group' }, [signToggle, amountInput]),
        ]),
        el('div', { class: 'fee-row-foot' }, [
          el('span', {
            class: 'field-hint',
            text: (fee.total ?? 0) < 0 ? 'Discount' : 'Charge',
          }),
          el('button', {
            type: 'button',
            class: 'button link danger',
            text: 'Remove',
            'aria-label': 'Remove this fee',
            onClick: () => removeFee(fee),
          }),
        ]),
      ]))
    }
  }

  const addFeeBox = el('div', { class: 'add-item' }, [
    el('button', { type: 'button', class: 'button', text: 'Add fee', onClick: addFee }),
    el('p', { class: 'field-hint', text: 'A negative amount is a discount.' }),
  ])

  // ---------------------------------------------------------------- totals

  const totalsNode = el('div', { class: 'totals' })

  function totalsRow(label, value, modifier = '') {
    return el('div', { class: `totals-row ${modifier}` }, [
      el('span', { text: label }),
      el('span', { class: 'totals-value', text: value }),
    ])
  }

  function renderTotals() {
    clear(totalsNode)

    const known = state.items.filter((item) => lineTotal(item) !== null)
    const unknown = state.items.length - known.length
    const subtotal = known.reduce((sum, item) => sum + lineTotal(item), 0)

    totalsNode.append(totalsRow('Items', formatMoney(subtotal)))

    if (unknown > 0) {
      totalsNode.append(el('p', {
        class: 'field-hint',
        text: unknown === 1
          ? '1 item is not priced yet; it is priced when you save.'
          : `${unknown} items are not priced yet; they are priced when you save.`,
      }))
    }

    // Only when there are fees. A 0.00 Fees row on every order would be noise
    // on a screen that is already taller than the viewport.
    const feesTotal = state.fees.reduce((sum, fee) => sum + (fee.total ?? 0), 0)
    if (state.fees.length > 0) {
      totalsNode.append(totalsRow('Fees', formatMoney(feesTotal)))
    }

    /*
     * Shipping. The server owns it, and on a saved order what it actually
     * charged is what shows.
     *
     * Before the first save there is no server line, and a dash there used to
     * leave the Order total short by the shipping amount - the figure staff
     * read out to the customer. So the rate the server WOULD apply is shown
     * instead, looked up by district in /meta's table. Nothing is computed
     * here: the rate is the plugin's, fetched, not restated.
     *
     * shippingRateFor() returns null for NO district, because the server adds
     * no line in that case either. Showing the default there would overstate
     * every unsaved order with a blank district.
     */
    const preview = state.shipping.cost === null
      ? shippingRateFor(districtSelect.value)
      : null
    const shippingCost = state.shipping.cost ?? preview?.cost ?? null
    const shippingLabel = state.shipping.cost !== null
      ? (state.shipping.label || 'Shipping')
      : (preview?.label || 'Shipping')

    totalsNode.append(totalsRow(
      shippingLabel,
      shippingCost === null ? '—' : formatMoney(shippingCost),
    ))

    // While nothing has been edited locally, the server's total is the truth and
    // can legitimately differ from items + shipping - a coupon or a discount
    // applied outside this app. Once there are local edits it cannot be, so the
    // computed figure takes over and the note below says it is provisional.
    const clean = state.dirty.size === 0 && !state.itemsDirty && !state.feesDirty
    const orderTotal = (clean && state.serverTotal !== null)
      ? state.serverTotal
      : subtotal + feesTotal + (shippingCost ?? 0)

    totalsNode.append(totalsRow('Order total', formatMoney(orderTotal), 'totals-total'))

    // Anything that makes the figures above provisional is said plainly rather
    // than left for the staff member to spot after saving.
    const reasons = []
    /*
     * Worded for the case actually on screen. It used to say "the district
     * changed, so shipping recalculates" on a brand-new order, where nothing
     * had changed and there was no previous district to change from.
     */
    if (state.orderId !== null && state.dirty.has('state')) {
      reasons.push('the district changed, so shipping is recalculated')
    } else if (state.shipping.cost === null && shippingCost !== null) {
      reasons.push('shipping is the flat rate for the district and is applied on save')
    } else if (state.shipping.cost === null && districtSelect.value === '') {
      reasons.push('no district is selected, so no shipping is added')
    }
    if (unknown > 0) reasons.push('unpriced items are priced')
    if (state.itemsDirty && state.orderId !== null) reasons.push('items were edited and are re-priced from the catalogue')
    // WooCommerce caps a negative fee at the order's own value so the total
    // cannot go below zero, rewriting the fee item to do it. Not detected or
    // warned about here - the re-render after saving simply shows the figure
    // the server kept.
    if (state.feesDirty && feesTotal < 0) reasons.push('a discount cannot take the total below zero')

    if (reasons.length > 0) {
      totalsNode.append(el('p', {
        class: 'field-hint',
        text: `Final figures come from the server on save: ${reasons.join('; ')}.`,
      }))
    }
  }

  // ---------------------------------------------------------------- trash

  const trashArea = el('div', { class: 'danger-zone', hidden: state.orderId === null })

  function renderTrash(confirming = false) {
    clear(trashArea)
    if (state.orderId === null) {
      trashArea.hidden = true
      return
    }

    trashArea.hidden = false

    if (!confirming) {
      trashArea.append(el('button', {
        type: 'button',
        class: 'button danger',
        text: 'Move to trash',
        onClick: () => renderTrash(true),
      }))
      return
    }

    // Inline confirmation rather than window.confirm(): a native dialog on a
    // phone is easy to dismiss by accident and can be suppressed outright.
    trashArea.append(
      el('p', { class: 'confirm-text', text: 'Move this order to the trash?' }),
      el('p', { class: 'field-hint', text: 'It leaves the list. Restoring is not possible from this app yet — use wp-admin.' }),
      el('div', { class: 'confirm-actions' }, [
        el('button', {
          type: 'button', class: 'button', text: 'Cancel',
          onClick: () => renderTrash(false),
        }),
        el('button', {
          type: 'button', class: 'button danger', text: 'Trash order',
          onClick: doTrash,
        }),
      ]),
    )
  }

  async function doTrash() {
    setMessage('Moving to trash…')
    try {
      await trashOrder(state.orderId)
      onClose()
    } catch (error) {
      if (error?.status === 401) return
      setMessage(error?.message || 'Could not trash the order.', 'error')
      renderTrash(false)
    }
  }

  // ---------------------------------------------------------------- save

  const saveButton = el('button', { type: 'button', class: 'button primary', text: 'Save order' })

  function setBusy(busy) {
    saveButton.disabled = busy
    parseButton.disabled = busy
    saveButton.textContent = busy
      ? 'Saving…'
      : (state.orderId === null ? 'Save order' : 'Save changes')
  }

  /**
   * line_items for the payload.
   *
   * `total` is sent for EVERY priced line, edited or not. line_items is
   * replace-all, so a line sent without a total is re-priced from the
   * catalogue - which means omitting it would discard the figure on screen the
   * moment anything else about the items changed. That was a real data-loss
   * path; sending the displayed figure closes it.
   *
   * THE API HAS NO PER-LINE PRICE FIELD. It accepts product_id, quantity and
   * total, so the Price input is a client-side convenience for computing the
   * total and the server only ever receives the total. A price typed without a
   * matching total would simply not survive the round trip.
   *
   * The one line that cannot carry a total is a stopgap row added by id, whose
   * price is not known client-side. There the key is omitted on purpose, so
   * the server prices it. Sending 0 or '' would be far worse: '' is ignored by
   * the API, but 0 would set the line to zero.
   */
  function lineItemsPayload() {
    return state.items.map((item) => {
      const line = {
        product_id: item.product_id,
        quantity: item.quantity,
      }

      if (item.total !== null) {
        // A raw numeric string at the store's decimals, per the money
        // convention the API uses in both directions.
        line.total = formatAmount(item.total)
      }

      return line
    })
  }

  /**
   * fee_lines for the payload. [{name, total}] - no ids, because fee
   * replacement discards them server-side.
   *
   * An amount left blank sends no total, and the endpoint stores 0 for it.
   * That mirrors how an unpriced line item omits its total rather than
   * inventing a figure the user never typed.
   */
  function feeLinesPayload() {
    return state.fees.map((fee) => {
      const line = { name: fee.name }

      if (fee.total !== null) {
        line.total = formatAmount(fee.total)
      }

      return line
    })
  }

  function buildPayload() {
    const values = readFields()
    const payload = {}

    if (state.orderId === null) {
      // Create: send what the user filled. Empty fields are left out rather
      // than sent blank - but an entirely empty payload is still a valid
      // create, which is the mimic-WooCommerce rule and is verified.
      for (const key of FIELDS) {
        if (values[key] !== '') payload[key] = values[key]
      }
      if (state.items.length > 0) payload.line_items = lineItemsPayload()
      if (state.fees.length > 0) payload.fee_lines = feeLinesPayload()
      return payload
    }

    // Update: only what the user touched. The endpoint declares no defaults,
    // so an absent key is genuinely untouched. A dirty field that is now empty
    // IS sent empty - the user cleared it on purpose, and that is exactly the
    // distinction this dirty set exists to preserve.
    for (const key of state.dirty) {
      payload[key] = values[key]
    }
    if (state.itemsDirty) payload.line_items = lineItemsPayload()

    // Independent of itemsDirty, and an EMPTY array is meaningful: it clears
    // every fee. So "untouched" has to stay distinguishable from "emptied" -
    // untouched omits the key, emptied sends [].
    if (state.feesDirty) payload.fee_lines = feeLinesPayload()

    return payload
  }

  saveButton.addEventListener('click', async () => {
    const payload = buildPayload()
    setBusy(true)
    setMessage('Saving…')

    try {
      const result = state.orderId === null
        ? await createOrder(payload)
        : await updateOrder(state.orderId, payload)

      // The server is authoritative, so the form is rebuilt from what it
      // returned rather than from what was typed.
      applyServerOrder(result?.order)
      state.warnings = Array.isArray(result?.warnings) ? result.warnings : []
      renderWarnings()
      setMessage('Saved.')
    } catch (error) {
      if (error?.status === 401) return
      setMessage(error?.message || 'Could not save the order.', 'error')
    } finally {
      setBusy(false)
    }
  })

  // ---------------------------------------------------------------- parse

  parseButton.addEventListener('click', async () => {
    const text = pasteInput.value.trim()
    if (text === '') {
      setMessage('Paste a message first.', 'error')
      return
    }

    parseButton.disabled = true
    setMessage('Parsing…')

    try {
      const result = await parseText(text)
      applyParsed(result)
      setMessage('Parsed. Check the fields before saving.')
    } catch (error) {
      if (error?.status === 401) return
      // 422 is the parser's own failure, and its message explains it.
      setMessage(error?.message || 'Could not parse that message.', 'error')
    } finally {
      parseButton.disabled = false
    }
  })

  /**
   * Fill the fields from a /parse response.
   *
   * Only non-empty values are written. The parser returns empty strings for
   * what it could not extract, and copying those over would wipe something the
   * staff member had already typed - parsing assists the form, it does not own
   * it. Everything written counts as a user change, so it is marked dirty.
   */
  function applyParsed(result) {
    const parsed = result?.parsed || {}

    const assign = (key, control, value) => {
      if (typeof value !== 'string' || value.trim() === '') return
      control.value = value
      state.dirty.add(key)
    }

    assign('name', nameInput, parsed.name)
    assign('phone', phoneInput, parsed.phone)
    // Parsing fills the phone programmatically, which fires no input event -
    // so the lookup has to be asked for explicitly.
    runLookup.cancel()
    lookupLastOrder()
    assign('address_1', addressInput, parsed.address_1)
    assign('customer_note', noteInput, parsed.customer_note)

    // state_code is '' when the parser found a district it could not resolve.
    // The dropdown is the resolver in that case, so say so instead of silently
    // leaving it blank.
    districtHint.hidden = true
    districtHint.textContent = ''

    if (typeof parsed.state_code === 'string' && parsed.state_code !== '') {
      districtSelect.value = parsed.state_code
      state.dirty.add('state')
    } else if (typeof parsed.state === 'string' && parsed.state.trim() !== '') {
      districtHint.textContent = `Could not match “${parsed.state.trim()}” to a district — pick one.`
      districtHint.hidden = false
    }

    /*
     * POST /parse also returns a shipping_preview, and it is deliberately NOT
     * used. It comes from the same rate table, so for a district that resolved
     * it is the same number - but when the parser could NOT resolve one it is
     * the Outside Dhaka default, while the dropdown above is still empty and a
     * save would add no shipping at all. Previewing from the district the user
     * can actually see keeps one answer on screen instead of two.
     *
     * state.shipping stays untouched: it means the server's saved line.
     */
    state.warnings = Array.isArray(result?.warnings) ? result.warnings : []
    renderWarnings()
    renderTotals()
  }

  // ---------------------------------------------------------------- load

  /** Rebuild the whole form from a server order object. */
  function applyServerOrder(order) {
    if (!order || typeof order !== 'object') return

    state.orderId = Number(order.id) || state.orderId

    const billing = order.billing || {}
    nameInput.value = billing.first_name || ''
    phoneInput.value = billing.phone || ''
    addressInput.value = billing.address_1 || ''
    districtSelect.value = billing.state || ''
    noteInput.value = order.customer_note || ''

    // An order can carry a status the dropdown filtered out - checkout-draft
    // being the one that exists. Rather than silently showing the wrong
    // status, add it back for this order only.
    const status = order.status || 'pending'
    if (status && !Array.from(statusSelect.options).some((option) => option.value === status)) {
      statusSelect.append(el('option', {
        value: status,
        text: order.status_label || status,
      }))
    }
    statusSelect.value = status

    state.items = (Array.isArray(order.line_items) ? order.line_items : []).map((line) => {
      const quantity = Math.max(1, Number(line.quantity) || 1)
      const total = toNumber(line.total)
      return makeItem({
        product_id: Number(line.product_id) || 0,
        name: line.name || `Product ${line.product_id}`,
        quantity,
        total,
        // Derived from the total so the two fields agree on load. The API
        // reports per-line figures only, never a unit price, and deriving from
        // `total` rather than `subtotal` is what makes price x quantity equal
        // the total exactly as displayed.
        price: total === null ? null : total / quantity,
      })
    })

    state.fees = (Array.isArray(order.fee_lines) ? order.fee_lines : []).map((line) => makeFee({
      name: line.name || '',
      // Negative is normal here. toNumber keeps the sign.
      total: toNumber(line.total),
    }))

    const shippingLines = Array.isArray(order.shipping_lines) ? order.shipping_lines : []
    state.shipping = shippingLines.length === 0
      ? { cost: null, label: '' }
      : {
          cost: shippingLines.reduce((sum, line) => sum + (toNumber(line.total) ?? 0), 0),
          label: shippingLines[0].method_title || 'Shipping',
        }

    state.serverTotal = toNumber(order.total)

    state.dirty.clear()
    state.itemsDirty = false
    state.feesDirty = false

    title.textContent = order.number ? `Order #${order.number}` : 'Order'
    pasteBox.open = false

    // The loaded order's own phone may have a previous order behind it, and the
    // order id has only just become known - which decides whether a cached
    // answer should be SHOWN, since the card is suppressed when the last order
    // is the one on screen. Drop the cache and re-ask.
    lookupCache = { phone: '', order: null }
    lastOrder.hide()
    runLookup.cancel()
    lookupLastOrder()

    renderItems()
    renderFees()
    renderTotals()
    renderTrash(false)
    setBusy(false)
  }

  async function load() {
    setMessage('Loading…')
    try {
      // GET /orders/{id} returns the order BARE, with no { order, warnings }
      // wrapper - unlike the write routes.
      //
      // The ONLY fetch of the order in this view. Saving re-renders from the
      // write response and parsing touches nothing server-side, so there is no
      // second GET anywhere on this screen.
      applyServerOrder(await fetchOrder(state.orderId, signal))
      setMessage('')
    } catch (error) {
      // Navigating away aborts this read. The view is already gone, so there
      // is nothing to report and nothing to render into.
      if (error?.name === 'AbortError') return
      if (error?.status === 401) return
      setMessage(error?.message || 'Could not load that order.', 'error')
    }
  }

  // ---------------------------------------------------------------- assemble

  // ------------------------------------------------------------------ layout
  //
  // Everything below here is ASSEMBLY, and it comes last on purpose. The order
  // this view needs is: field controls, then the controllers that wire them up,
  // then the layout that arranges both.
  //
  // fieldsSection used to be built up with the field controls, in the middle of
  // the declarations - and when the repeat-customer card was added to it in 6.7
  // it reached forward for `lastOrder`, a const declared seventy lines further
  // down. An array literal is evaluated immediately, so that was a temporal
  // dead zone ReferenceError on every open of the form, new or existing. The
  // fix is not to hoist the declaration: it is that layout has no business
  // running before the things it lays out exist. Keep assembly here.
  const fieldsSection = el('section', { class: 'form-section' }, [
    field('Customer name', nameInput),
    field('Phone', phoneInput),
    lastOrder.node,
    field('Address', addressInput),
    el('div', { class: 'field' }, [
      el('label', { for: 'of-district', text: 'District' }),
      districtSelect,
      districtHint,
    ]),
    field('Status', statusSelect),
    field('Customer note', noteInput),
  ])

  const view = el('div', { class: 'order-form' }, [
    el('header', { class: 'app-header' }, [
      el('div', { class: 'header-row' }, [
        el('button', {
          type: 'button', class: 'button link', text: '‹ Orders', onClick: onClose,
        }),
        title,
      ]),
    ]),
    el('main', { class: 'form-main' }, [
      message,
      warningsNode,
      pasteBox,
      fieldsSection,
      el('section', { class: 'form-section' }, [
        el('h2', { class: 'section-title', text: 'Items' }),
        itemsList,
        addItemBox,
      ]),
      el('section', { class: 'form-section' }, [
        el('h2', { class: 'section-title', text: 'Fees' }),
        feesList,
        addFeeBox,
      ]),
      el('section', { class: 'form-section' }, [
        el('h2', { class: 'section-title', text: 'Totals' }),
        totalsNode,
      ]),
      trashArea,
    ]),
    // Sticky, so saving never means scrolling a form that is taller than the
    // viewport to reach the bottom of it.
    el('div', { class: 'form-actions' }, [saveButton]),
  ])

  renderItems()
  renderFees()
  renderTotals()
  renderWarnings()
  renderTrash(false)
  setBusy(false)

  if (state.orderId !== null) {
    load()
  } else if (reorderFrom) {
    // Reorder from the order list: a blank new-order form, pre-filled. Nothing
    // to overwrite, so no confirmation - unlike the card's Reorder, which can
    // land on a form that already has items.
    applyReorder(reorderFrom)
  }

  return view
}
