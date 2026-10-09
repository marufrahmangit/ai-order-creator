<?php
if (!defined('ABSPATH')) exit;

/*
 * Order write endpoints.
 *
 * GOVERNING RULE: validation mirrors WooCommerce, never stricter. WooCommerce
 * permits saving an order with no phone, no address, no state and no line
 * items, so these endpoints permit the same. An empty payload creates an empty
 * order, exactly as the wp-admin "Add order" screen does. The only things that
 * can be rejected are values WooCommerce itself would not recognise: an unknown
 * BD state code and an unknown order status.
 *
 * POST is used for updates rather than PUT, deliberately: updates are PARTIAL.
 * Only fields present in the body are changed; an absent field is left alone.
 * That is why no argument below declares a 'default' - WordPress injects
 * defaults into the request, which would make an omitted field indistinguishable
 * from one explicitly sent, and every omitted field would silently overwrite
 * stored data.
 */

/**
 * Resolve a submitted status to a bare slug WooCommerce knows.
 *
 * Accepts slugs with or without the 'wc-' prefix, same as the orders list
 * endpoint. An empty value means "not supplied" and is not an error.
 *
 * @param string $status
 * @return string|WP_Error Bare slug, '' when absent, or a 400.
 */
function ai_rest_resolve_status_slug($status) {
    $slug = ai_rest_strip_status_prefix($status);
    if ($slug === '') {
        return '';
    }

    if (!in_array('wc-' . $slug, array_keys(wc_get_order_statuses()), true)) {
        return new WP_Error(
            'aioc_invalid_status',
            sprintf(
                /* translators: %s: the rejected order status slug. */
                __('Unrecognized order status: %s', 'ai-order-creator'),
                $status
            ),
            ['status' => 400]
        );
    }

    return $slug;
}

/**
 * Validate a submitted BD state code against WooCommerce's own state list.
 *
 * Empty or absent is allowed and is not an error - an order with no state is
 * valid in WooCommerce, and ai_get_shipping_rate() treats it as Outside Dhaka.
 *
 * @param string $state
 * @return string|WP_Error The code, '' when absent, or a 400.
 */
function ai_rest_validate_bd_state($state) {
    $state = trim((string) $state);
    if ($state === '') {
        return '';
    }

    $states = (function_exists('WC') && WC()) ? WC()->countries->get_states('BD') : [];
    if (!is_array($states) || !isset($states[$state])) {
        return new WP_Error(
            'aioc_invalid_state',
            sprintf(
                /* translators: %s: the rejected state code. */
                __('Unrecognized BD state code: %s', 'ai-order-creator'),
                $state
            ),
            ['status' => 400]
        );
    }

    return $state;
}

/**
 * Validate every rejectable part of the payload BEFORE touching an order.
 *
 * Front-loading this is what stops a rejected create from leaving an orphaned
 * empty order behind.
 *
 * @param WP_REST_Request $request
 * @return array|WP_Error ['state' => ?string, 'status' => ?string]; null means
 *                        the field was absent from the payload.
 */
function ai_rest_validate_order_payload(WP_REST_Request $request) {
    $validated = ['state' => null, 'status' => null];

    if ($request->has_param('state')) {
        $state = ai_rest_validate_bd_state($request->get_param('state'));
        if (is_wp_error($state)) {
            return $state;
        }
        $validated['state'] = $state;
    }

    if ($request->has_param('status')) {
        $status = ai_rest_resolve_status_slug($request->get_param('status'));
        if (is_wp_error($status)) {
            return $status;
        }
        $validated['status'] = $status;
    }

    return $validated;
}

/**
 * A submitted line-item quantity, as this site will store it.
 *
 * DEFERS TO WOOCOMMERCE rather than deciding for itself whether a quantity may
 * be fractional. wc_stock_amount() applies the woocommerce_stock_amount filter,
 * which is intval by default and is replaced by a float-safe version when the
 * Decimal Product Quantity plugin is active (it is, on both sites). So 1.5
 * survives here exactly when WooCommerce would store it, and if that plugin is
 * ever deactivated, quantities go back to whole numbers because WooCommerce
 * says so - not because this code does.
 *
 * The store's 2-decimal limit is applied ON TOP, because the plugin imposes
 * none. A third decimal is ROUNDED rather than rejected: this endpoint fixes a
 * bad line with a warning instead of failing the whole order, and the app
 * rounds the same way when the field loses focus, so what was on screen is
 * what gets stored.
 *
 * Absent means 1, as it always has. Unparseable, zero or negative also becomes
 * 1 - Remove is how a line goes away - but those come back as a warning.
 *
 * @param mixed $raw
 * @return array{0: int|float, 1: bool} The quantity, and whether it differs
 *                                      from what was submitted.
 */
function ai_rest_line_quantity($raw) {
    if ($raw === null || $raw === '') {
        return [1, false];
    }

    // wc_format_decimal() normalizes the store's decimal separator to '.' and
    // strips anything that is not a digit, sign or point, so '' means "not a
    // number at all".
    $clean = is_scalar($raw) ? wc_format_decimal($raw) : '';
    if ($clean === '' || !is_numeric($clean)) {
        return [1, true];
    }

    $quantity = wc_stock_amount($clean);
    if (!is_int($quantity)) {
        $quantity = round((float) $quantity, AIOC_QUANTITY_DECIMALS);
    }

    if ($quantity <= 0) {
        return [1, true];
    }

    // Compared as numbers, so "2" against 2 and "1.50" against 1.5 are equal.
    return [$quantity, (float) $quantity !== (float) $clean];
}

/**
 * Add line items to an order from a payload array.
 *
 * A bad line is skipped with a warning rather than failing the request - one
 * stale product id from the client must not lose the whole order.
 *
 * @param WC_Order $order
 * @param mixed    $line_items
 * @param array    $warnings   Collected by reference.
 * @return void
 */
function ai_rest_add_line_items(WC_Order $order, $line_items, array &$warnings) {
    foreach ((array) $line_items as $entry) {
        if (!is_array($entry)) {
            $warnings[] = __('Skipped a line item that was not an object.', 'ai-order-creator');
            continue;
        }

        $product_id = absint($entry['product_id'] ?? 0);

        // Never an (int) cast here: that silently turned 1.5 into 1, which is
        // a wrong order with no error.
        [$quantity, $quantity_changed] = ai_rest_line_quantity($entry['quantity'] ?? null);

        $product = $product_id ? wc_get_product($product_id) : false;
        if (!$product instanceof WC_Product) {
            $warnings[] = sprintf(
                /* translators: %d: the product id that could not be loaded. */
                __('Product %d not found; line skipped.', 'ai-order-creator'),
                $product_id
            );
            continue;
        }

        // Purchasable here means simple product or variation. Grouped, external
        // and variable parents cannot be ordered.
        //
        // This is deliberately a TYPE check rather than is_purchasable():
        // WC_Product::is_purchasable() also requires post status 'publish', and
        // this store's catalogue is 'private', so it would reject every product
        // for any user without edit_post on it.
        if (!$product->is_type('simple') && !$product->is_type('variation')) {
            $warnings[] = sprintf(
                /* translators: 1: product name, 2: product type slug. */
                __('%1$s is a %2$s product and cannot be added; line skipped.', 'ai-order-creator'),
                $product->get_name(),
                $product->get_type()
            );
            continue;
        }

        // Out of stock is NOT a rejection - WooCommerce admin allows it, so the
        // app must too. Warn and add.
        if (!$product->is_in_stock()) {
            $warnings[] = sprintf(
                /* translators: %s: product name. */
                __('%s is out of stock and was added anyway.', 'ai-order-creator'),
                $product->get_name()
            );
        }

        // Said out loud rather than silently corrected: a quantity is money
        // once it is multiplied by a price.
        if ($quantity_changed) {
            $warnings[] = sprintf(
                /* translators: 1: product name, 2: quantity as submitted, 3: quantity stored. */
                __('Quantity for %1$s was "%2$s"; stored as %3$s.', 'ai-order-creator'),
                $product->get_name(),
                is_scalar($entry['quantity']) ? (string) $entry['quantity'] : '',
                ai_rest_quantity($quantity)
            );
        }

        $args = ['quantity' => $quantity];

        // Per-line price override, as the wp-admin order editor allows. With no
        // override, add_product() defaults subtotal and total to the product's
        // current price for the given quantity.
        if (isset($entry['total']) && $entry['total'] !== '' && $entry['total'] !== null) {
            $total            = wc_format_decimal($entry['total']);
            $args['subtotal'] = $total;
            $args['total']    = $total;
        }

        $order->add_product($product, $quantity, $args);
    }
}

/**
 * Replace the order's fee items from a payload.
 *
 * Fees are used often on this store, and a NEGATIVE fee is how a discount is
 * recorded, so nothing here clamps or abs()es the figure.
 *
 * One caveat that is WooCommerce's and not ours: calculate_totals() caps a
 * negative fee at the order's own value, so it cannot push the total below
 * zero. When it does that it REWRITES the fee item's total, which is why a
 * discount larger than the order comes back from these endpoints reduced
 * rather than as sent. The response reports what was stored, so the client can
 * see it happened.
 *
 * @param WC_Order $order
 * @param mixed    $fee_lines
 * @param array    $warnings   Collected by reference.
 * @return void
 */
function ai_rest_add_fee_lines(WC_Order $order, $fee_lines, array &$warnings) {
    foreach ((array) $fee_lines as $entry) {
        if (!is_array($entry)) {
            $warnings[] = __('Skipped a fee line that was not an object.', 'ai-order-creator');
            continue;
        }

        $raw_total = $entry['total'] ?? null;

        if ($raw_total === null || $raw_total === '') {
            // No figure is a zero fee, not a rejection - WooCommerce admin
            // allows saving a fee row before its amount is filled in.
            $total = '0';
        } else {
            // wc_format_decimal() strips everything that is not a digit, sign
            // or separator, so non-numeric input collapses to ''. That becomes
            // 0 rather than an error, but it is worth saying out loud: a typo
            // in a DISCOUNT silently becoming nothing is expensive.
            $total = wc_format_decimal($raw_total);

            if ($total === '') {
                $total = '0';
                $warnings[] = sprintf(
                    /* translators: %s: the rejected fee total as submitted. */
                    __('Fee total "%s" is not a number; the fee was added at 0.', 'ai-order-creator'),
                    (string) $raw_total
                );
            }
        }

        $fee = new WC_Order_Item_Fee();

        // An empty name is allowed, exactly as WooCommerce allows it. The read
        // side reports it back empty rather than substituting "Fee".
        $fee->set_name(sanitize_text_field((string) ($entry['name'] ?? '')));
        $fee->set_total($total);

        $order->add_item($fee);
    }
}

/**
 * Apply a validated payload to an order.
 *
 * Only fields present in the request are touched.
 *
 * @param WC_Order        $order
 * @param WP_REST_Request $request
 * @param array           $validated Output of ai_rest_validate_order_payload().
 * @param array           $warnings  Collected by reference.
 * @return void
 */
function ai_rest_apply_order_payload(WC_Order $order, WP_REST_Request $request, array $validated, array &$warnings) {
    if ($request->has_param('name')) {
        $name = (string) $request->get_param('name');
        // The whole customer name goes in first_name and no last name is set.
        // The orders search depends on this.
        $order->set_billing_first_name($name);
        $order->set_shipping_first_name($name);
    }

    if ($request->has_param('phone')) {
        $phone = (string) $request->get_param('phone');
        $order->set_billing_phone($phone);
        $order->update_meta_data('_shipping_phone', $phone);
        $order->update_meta_data('shipping_phone', $phone);
    }

    if ($request->has_param('address_1')) {
        $address = (string) $request->get_param('address_1');
        $order->set_billing_address_1($address);
        $order->set_shipping_address_1($address);
    }

    if ($validated['state'] !== null) {
        $order->set_billing_state($validated['state']);
        $order->set_shipping_state($validated['state']);
    }

    if ($request->has_param('customer_note')) {
        $order->set_customer_note((string) $request->get_param('customer_note'));
    }

    if ($validated['status'] !== null && $validated['status'] !== '') {
        $order->set_status($validated['status']);
    }

    $order->set_billing_country('BD');
    $order->set_shipping_country('BD');

    if ($request->has_param('line_items')) {
        ai_rest_add_line_items($order, $request->get_param('line_items'), $warnings);
    }

    // Before ai_rest_finalize_order() runs, so calculate_totals() counts them.
    if ($request->has_param('fee_lines')) {
        ai_rest_add_fee_lines($order, $request->get_param('fee_lines'), $warnings);
    }
}

/**
 * Save, then apply shipping and totals.
 *
 * @param WC_Order $order
 * @return void
 */
function ai_rest_finalize_order(WC_Order $order) {
    $order->save();

    // Applies the flat rate from the single rate table and calls
    // calculate_totals(), which persists. The rate table is never duplicated.
    //
    // This is the ONLY call needed. ai_apply_shipping() used to return early on
    // an empty billing state, so nothing recalculated totals in that case and
    // this function called calculate_totals() itself as a workaround. 7.0 fixed
    // the early return instead - the removal and the recalculation now happen
    // whatever the state is - which makes that workaround redundant. Calling it
    // again here would be a second write of figures that are already correct.
    ai_apply_shipping($order);
}

/**
 * Load an order by request id, or a 404.
 *
 * @param mixed $id
 * @return WC_Order|WP_Error
 */
function ai_rest_load_order_or_404($id) {
    $id    = absint($id);
    $order = $id ? wc_get_order($id) : false;

    // wc_get_order() also resolves refund IDs; only real orders are exposed.
    if (!$order instanceof WC_Order) {
        return new WP_Error(
            'aioc_order_not_found',
            __('No order found with that ID.', 'ai-order-creator'),
            ['status' => 404]
        );
    }

    return $order;
}

/**
 * POST /aioc/v1/orders — create.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_create_order(WP_REST_Request $request) {
    $validated = ai_rest_validate_order_payload($request);
    if (is_wp_error($validated)) {
        return $validated;
    }

    $warnings = [];

    $order = wc_create_order();
    if (is_wp_error($order)) {
        return $order;
    }
    if (!$order instanceof WC_Order) {
        return new WP_Error(
            'aioc_order_create_failed',
            __('Could not create the order.', 'ai-order-creator'),
            ['status' => 500]
        );
    }

    ai_rest_apply_order_payload($order, $request, $validated, $warnings);

    // Default status, applied only when the payload did not set one.
    if ($validated['status'] === null || $validated['status'] === '') {
        $order->set_status('pending');
    }

    $order->add_order_note(__('Order created via Order Ops app', 'ai-order-creator'));

    ai_rest_finalize_order($order);

    return new WP_REST_Response([
        'order'    => ai_rest_prepare_order_detail($order),
        'warnings' => $warnings,
    ], 201);
}

/**
 * POST /aioc/v1/orders/{id} — PARTIAL update.
 *
 * Only fields present in the body are changed; an absent field is left alone.
 * POST rather than PUT for exactly that reason.
 *
 * line_items semantics: if the key is absent, existing items are untouched. If
 * present, ALL existing product line items are removed and replaced by the
 * payload - there is no per-item patching, the client holds the full list. Note
 * that this DISCARDS line item ids and any line item meta; a replaced item is a
 * new row, not an edited one.
 *
 * fee_lines behaves identically and INDEPENDENTLY: absent leaves existing fees
 * alone, present removes every fee item and replaces it from the payload, and
 * an empty array therefore removes all fees. It likewise DISCARDS fee item ids
 * - a replaced fee is a new row. Sending one list never affects the other.
 *
 * Shipping lines are not touched by either; ai_apply_shipping() owns them and
 * replaces only its own type.
 *
 * Shipping is ALWAYS recalculated, regardless of which fields changed. That is
 * intentional and follows the auto-only shipping decision - there is no manual
 * override anywhere in this app.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_update_order(WP_REST_Request $request) {
    $order = ai_rest_load_order_or_404($request->get_param('id'));
    if (is_wp_error($order)) {
        return $order;
    }

    $validated = ai_rest_validate_order_payload($request);
    if (is_wp_error($validated)) {
        return $validated;
    }

    $warnings = [];

    // Replace-all, not patch. Done before apply so the payload's items land in
    // an emptied list.
    //
    // Both loops are scoped to ONE item type. That is what keeps the two lists
    // independent: sending line_items alone leaves the fees, and sending
    // fee_lines alone leaves the products. The blunt instrument to avoid is
    // WC_Abstract_Order::remove_order_items() with no argument, which empties
    // every item type at once - products, fees, shipping and taxes.
    if ($request->has_param('line_items')) {
        foreach ($order->get_items('line_item') as $item_id => $item) {
            $order->remove_item($item_id);
        }
    }

    if ($request->has_param('fee_lines')) {
        foreach ($order->get_items('fee') as $item_id => $item) {
            $order->remove_item($item_id);
        }
    }

    ai_rest_apply_order_payload($order, $request, $validated, $warnings);

    ai_rest_finalize_order($order);

    return new WP_REST_Response([
        'order'    => ai_rest_prepare_order_detail($order),
        'warnings' => $warnings,
    ], 200);
}

/**
 * POST /aioc/v1/orders/{id}/trash
 *
 * Moves to trash. Never permanently deletes - no force parameter is accepted or
 * passed anywhere in this file.
 *
 * WC_Order::delete(false) is the mechanism. Under HPOS that routes to the
 * orders-table data store's trash path, which records the pre-trash status in
 * _wp_trash_meta_status (prefixed, e.g. "wc-pending") plus _wp_trash_meta_time,
 * and flips the row's status to 'trash'. wp_trash_post() is the legacy
 * post-storage equivalent and is deliberately NOT used. See
 * docs/VERIFICATION.md - this needs confirming against staging.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_trash_order(WP_REST_Request $request) {
    $order = ai_rest_load_order_or_404($request->get_param('id'));
    if (is_wp_error($order)) {
        return $order;
    }

    if ($order->get_status() === 'trash') {
        return new WP_Error(
            'aioc_already_trashed',
            __('That order is already in the trash.', 'ai-order-creator'),
            ['status' => 400]
        );
    }

    $order_id = $order->get_id();
    $order->delete(false);

    return new WP_REST_Response([
        'id'     => (int) $order_id,
        'status' => 'trash',
    ], 200);
}

/**
 * POST /aioc/v1/orders/{id}/restore
 *
 * Restores from trash to the pre-trash status recorded by the trash path in
 * _wp_trash_meta_status. There is no public HPOS untrash API to call, so this
 * reads that meta and sets the status back - the same approach WooCommerce's own
 * admin list table uses. Falls back to 'pending' when the meta is missing or no
 * longer a registered status. See docs/DECISIONS.md.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_restore_order(WP_REST_Request $request) {
    $order = ai_rest_load_order_or_404($request->get_param('id'));
    if (is_wp_error($order)) {
        return $order;
    }

    if ($order->get_status() !== 'trash') {
        return new WP_Error(
            'aioc_not_trashed',
            __('That order is not in the trash.', 'ai-order-creator'),
            ['status' => 400]
        );
    }

    $previous = ai_rest_resolve_status_slug($order->get_meta('_wp_trash_meta_status'));
    if (is_wp_error($previous) || $previous === '') {
        $previous = 'pending';
    }

    $order->set_status($previous);
    $order->delete_meta_data('_wp_trash_meta_status');
    $order->delete_meta_data('_wp_trash_meta_time');
    $order->save();

    return new WP_REST_Response(ai_rest_prepare_order_detail($order), 200);
}

/**
 * Shared argument schema for create and update.
 *
 * No 'default' on any field - see the note at the top of this file.
 *
 * @return array
 */
function ai_rest_order_write_args() {
    return [
        'name' => [
            'type'              => 'string',
            'sanitize_callback' => 'ai_rest_sanitize_text',
        ],
        'phone' => [
            'type'              => 'string',
            'sanitize_callback' => 'ai_rest_sanitize_text',
        ],
        'address_1' => [
            'type'              => 'string',
            'sanitize_callback' => 'ai_rest_sanitize_textarea',
        ],
        'state' => [
            'type'              => 'string',
            'sanitize_callback' => 'ai_rest_sanitize_text',
        ],
        'customer_note' => [
            'type'              => 'string',
            'sanitize_callback' => 'ai_rest_sanitize_textarea',
        ],
        'status' => [
            'type'              => 'string',
            'sanitize_callback' => 'ai_rest_sanitize_text',
        ],
        'line_items' => [
            'type' => 'array',
        ],
        'fee_lines' => [
            'type' => 'array',
        ],
    ];
}

add_action('rest_api_init', function () {
    $id_arg = [
        'id' => [
            'type'              => 'integer',
            'required'          => true,
            'sanitize_callback' => 'ai_rest_sanitize_absint',
        ],
    ];

    register_rest_route(AIOC_REST_NAMESPACE, '/orders', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'ai_rest_create_order',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => ai_rest_order_write_args(),
    ]);

    register_rest_route(AIOC_REST_NAMESPACE, '/orders/(?P<id>\d+)', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'ai_rest_update_order',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => array_merge($id_arg, ai_rest_order_write_args()),
    ]);

    register_rest_route(AIOC_REST_NAMESPACE, '/orders/(?P<id>\d+)/trash', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'ai_rest_trash_order',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => $id_arg,
    ]);

    register_rest_route(AIOC_REST_NAMESPACE, '/orders/(?P<id>\d+)/restore', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'ai_rest_restore_order',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => $id_arg,
    ]);
});
