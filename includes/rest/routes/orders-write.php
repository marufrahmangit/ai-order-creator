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
        $quantity   = isset($entry['quantity']) ? (int) $entry['quantity'] : 1;
        if ($quantity < 1) {
            $quantity = 1;
        }

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
    ai_apply_shipping($order);

    // ai_apply_shipping() returns early when the billing state is empty, so in
    // that case nothing has recalculated totals. Without this, an order with
    // line items but no state would persist with a total of 0 - the same defect
    // 4.9 fixed for the admin path.
    if ($order->get_billing_state() === '') {
        $order->calculate_totals();
    }
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
 * new row, not an edited one. Shipping and fee lines are not touched here.
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
    if ($request->has_param('line_items')) {
        foreach ($order->get_items('line_item') as $item_id => $item) {
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
 * docs/PROJECT-STATE.md - this needs confirming against staging.
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
 * longer a registered status. See docs/PROJECT-STATE.md.
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
