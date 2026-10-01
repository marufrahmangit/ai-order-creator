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
 *     override, so this form displays it and never calculates it.
 */

import { fetchOrder, parseText, createOrder, updateOrder, trashOrder } from '../api.js'
import { districts, orderStatuses } from '../meta.js'
import { formatMoney, formatAmount } from '../format.js'
import { el, clear } from '../dom.js'

/** Every field whose dirty state is tracked, in payload-key form. */
const FIELDS = ['name', 'phone', 'address_1', 'state', 'status', 'customer_note']

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
 * @param {{ orderId: number|null, onClose: () => void, signal?: AbortSignal }} options
 */
export function OrderFormView({ orderId, onClose, signal }) {
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
    /** Display only. Never computed here - see the note at the top. */
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
    // No state is a valid order - shipping falls back to the Outside Dhaka
    // rate - so the empty option is a real choice, not a prompt.
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

  const fieldsSection = el('section', { class: 'form-section' }, [
    field('Customer name', nameInput),
    field('Phone', phoneInput),
    field('Address', addressInput),
    el('div', { class: 'field' }, [
      el('label', { for: 'of-district', text: 'District' }),
      districtSelect,
      districtHint,
    ]),
    field('Status', statusSelect),
    field('Customer note', noteInput),
  ])

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
      // Changing the district changes the shipping rate, but only the server
      // computes that, so the totals need to say so rather than go stale.
      if (key === 'state') renderTotals()
    })
  }

  // ---------------------------------------------------------------- items

  const itemsList = el('div', { class: 'items-list' })

  /**
   * One line item row.
   *
   * `unitPrice` is derived from the line SUBTOTAL divided by quantity, because
   * the API reports per-line figures, not a unit price.
   *
   * `total` is the line's own figure and is EDITABLE, the way wp-admin's order
   * editor allows. `overridden` records that the figure is deliberate rather
   * than derived - either because the user typed it, or because the stored
   * total arrived differing from price x quantity (a coupon, a discount, an
   * earlier manual edit).
   *
   * An overridden line is never recomputed. A stepper tap must not silently
   * throw away a figure someone chose on purpose; a non-overridden line
   * recomputes from price x quantity as you would expect.
   *
   * Every line sends its `total` on save, so none of this is lost in the
   * round trip - see lineItemsPayload().
   */
  function makeItem({ product_id, name, unitPrice, quantity, storedTotal }) {
    const safeQuantity = Math.max(1, quantity || 1)
    const computed = unitPrice === null ? null : unitPrice * safeQuantity

    // A stored figure that does not match price x quantity is an override by
    // definition: something other than this form put it there.
    const overridden = storedTotal !== null
      && (computed === null || Math.abs(storedTotal - computed) >= 0.005)

    const total = storedTotal !== null ? storedTotal : computed

    return {
      product_id,
      name,
      unitPrice,
      quantity: safeQuantity,
      total,
      overridden,
    }
  }

  /** The figure to show and send for a row, or null when the price is unknown. */
  function lineTotal(item) {
    return item.total
  }

  function setQuantity(item, quantity) {
    const next = Math.max(1, quantity)
    if (next === item.quantity) return

    item.quantity = next

    // Only a derived total follows the quantity. An override is the user's
    // figure and stays put.
    if (!item.overridden && item.unitPrice !== null) {
      item.total = item.unitPrice * next
    }

    state.itemsDirty = true

    renderItems()
    renderTotals()
  }

  /**
   * Called while the user types in a line total.
   *
   * The text is left exactly as typed - no reformatting mid-entry, which would
   * fight the caret and make "1" impossible to turn into "10". Only the parsed
   * value and the order total are updated here; the input is normalized on
   * blur.
   */
  function onTotalInput(item, rawText) {
    item.overridden = true
    state.itemsDirty = true

    const parsed = parseTypedAmount(rawText)
    if (parsed !== null) {
      item.total = parsed
      renderTotals()
    }
  }

  /**
   * Called when a line total loses focus: settle on a figure and show it
   * canonically.
   *
   * Emptying the field is how a line goes back to being derived, which is the
   * only way out of an override short of retyping the computed figure.
   *
   * @returns {string} The text the input should now display.
   */
  function onTotalBlur(item, rawText) {
    const text = rawText.trim()

    if (text === '') {
      item.overridden = false
      item.total = item.unitPrice === null ? null : item.unitPrice * item.quantity
    } else {
      const parsed = parseTypedAmount(text)
      // Unparseable input falls back to whatever the line already held rather
      // than becoming 0 - a typo must not quietly zero a line.
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

      const overrideHint = el('p', {
        class: 'field-hint',
        hidden: !item.overridden,
        text: 'Edited total — quantity changes will not recalculate it. Clear the field to go back to price × quantity.',
      })

      // Editable, as wp-admin's order editor allows. type=text with a numeric
      // inputmode rather than type=number: a number input rejects a partially
      // typed value in some browsers and brings spinners nobody wants on a
      // phone, while inputmode still gets the numeric keypad.
      const totalInput = el('input', {
        type: 'text',
        inputmode: 'decimal',
        class: 'item-total-input',
        value: total === null ? '' : formatAmount(total),
        placeholder: total === null ? 'Set on save' : '',
        'aria-label': `Line total for ${item.name}`,
        onInput: (event) => {
          onTotalInput(item, event.target.value)
          overrideHint.hidden = false
        },
        onBlur: (event) => {
          // Writing straight to the input rather than re-rendering the row:
          // renderItems() would rebuild this node and, on a phone, drop the
          // keyboard the user may still be moving through the form with.
          event.target.value = onTotalBlur(item, event.target.value)
          overrideHint.hidden = !item.overridden
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
        el('p', { class: 'item-unit', text: item.unitPrice === null
          ? 'Price resolves when you save'
          : `${formatMoney(item.unitPrice)} each` }),
        el('div', { class: 'item-foot' }, [
          el('div', { class: 'qty-stepper' }, [minus, quantityValue, plus]),
          el('div', { class: 'item-total-field' }, [totalInput]),
        ]),
        overrideHint,
      ]))
    }
  }

  /*
   * ------------------------------------------------------------------------
   * STOPGAP - STEP 6a ONLY. REPLACED BY THE PRODUCT PICKER IN STEP 6b.
   * ------------------------------------------------------------------------
   *
   * A raw product_id typed in by hand. Nobody should have to use this; it
   * exists so the items list and the save path can be exercised before the
   * picker exists.
   *
   * The id is sent BLIND - deliberately, not as a shortcut. GET /products has
   * no id lookup: ai_rest_parse_search_term() reads a wholly numeric term as a
   * PRICE, so ?search=9167 returns products COSTING 9167, not product 9167.
   * Resolving through it would show a confidently wrong name and price, which
   * is worse than showing none. The server resolves the id on save and the
   * re-render fills in the real name and price; an id that does not exist
   * comes back as a warning with the line skipped.
   */
  const addIdInput = el('input', {
    type: 'number',
    class: 'add-id-input',
    min: 1,
    step: 1,
    inputmode: 'numeric',
    placeholder: 'Product ID',
    'aria-label': 'Product ID to add',
  })

  const addButton = el('button', { type: 'button', class: 'button', text: 'Add' })

  addButton.addEventListener('click', () => {
    const productId = Number.parseInt(addIdInput.value, 10)
    if (!Number.isInteger(productId) || productId < 1) {
      setMessage('Enter a product ID to add.', 'error')
      return
    }

    // Merging rather than appending a second row: with ids typed by hand, a
    // repeat is far more likely to be a mistake than an intended duplicate
    // line. The picker in 6b can make its own call.
    const existing = state.items.find((item) => item.product_id === productId)
    if (existing) {
      setQuantity(existing, existing.quantity + 1)
    } else {
      state.items.push(makeItem({
        product_id: productId,
        name: `Product ${productId}`,
        unitPrice: null,
        quantity: 1,
        storedTotal: null,
      }))
      state.itemsDirty = true
      renderItems()
      renderTotals()
    }

    addIdInput.value = ''
    setMessage('Added. Save to resolve its name and price.')
  })

  const addItemBox = el('div', { class: 'add-item' }, [
    el('p', { class: 'field-hint', text: 'Temporary: add by product ID. The product picker arrives in step 6b.' }),
    el('div', { class: 'add-item-row' }, [addIdInput, addButton]),
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

    // Shipping is the server's to decide. Blank until it has told us.
    totalsNode.append(totalsRow(
      state.shipping.label || 'Shipping',
      state.shipping.cost === null ? '—' : formatMoney(state.shipping.cost),
    ))

    // While nothing has been edited locally, the server's total is the truth and
    // can legitimately differ from items + shipping - a coupon, a discount, a
    // per-line override. Once there are local edits it cannot be, so the
    // computed figure takes over and the note below says it is provisional.
    const shippingCost = state.shipping.cost ?? 0
    const clean = state.dirty.size === 0 && !state.itemsDirty
    const orderTotal = (clean && state.serverTotal !== null)
      ? state.serverTotal
      : subtotal + shippingCost

    totalsNode.append(totalsRow('Order total', formatMoney(orderTotal), 'totals-total'))

    // Anything that makes the figures above provisional is said plainly rather
    // than left for the staff member to spot after saving.
    const reasons = []
    if (state.dirty.has('state')) reasons.push('the district changed, so shipping recalculates')
    if (unknown > 0) reasons.push('unpriced items are priced')
    if (state.itemsDirty && state.orderId !== null) reasons.push('items were edited and are re-priced from the catalogue')

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
   * catalogue - which means omitting it would discard a stored override the
   * moment anything else about the items changed. That was a real data-loss
   * path; sending the displayed figure closes it.
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

    // A preview from the pure rate table, so staff see the cost before saving.
    // Still the server's figure, not one computed here.
    const preview = toNumber(result?.shipping_preview?.cost)
    if (preview !== null) {
      state.shipping = {
        cost: preview,
        label: result?.shipping_preview?.label || 'Shipping',
      }
    }

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
      const subtotal = toNumber(line.subtotal)
      return makeItem({
        product_id: Number(line.product_id) || 0,
        name: line.name || `Product ${line.product_id}`,
        // Per-line figures only, so the unit price is derived.
        unitPrice: subtotal === null ? null : subtotal / quantity,
        quantity,
        storedTotal: toNumber(line.total),
      })
    })

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

    title.textContent = order.number ? `Order #${order.number}` : 'Order'
    pasteBox.open = false

    renderItems()
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
  renderTotals()
  renderWarnings()
  renderTrash(false)
  setBusy(false)

  if (state.orderId !== null) {
    load()
  }

  return view
}
