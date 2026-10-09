<?php
if (!defined('ABSPATH')) exit;

/**
 * Format a monetary value as a bare numeric string, e.g. "80.00".
 *
 * The REST layer never returns wc_price() output, currency symbols, or HTML -
 * the client formats. (includes/ajax.php deliberately does the opposite; it
 * feeds the existing admin UI.)
 *
 * @param mixed $value
 * @return string
 */
function ai_rest_money($value) {
    return wc_format_decimal($value, wc_get_price_decimals());
}

/**
 * Format a quantity as a bare numeric string with trailing zeros trimmed:
 * "1", "1.5", "3.56".
 *
 * A string for the same reason money is one. Quantities can be fractional on
 * this store (the Decimal Product Quantity plugin filters
 * woocommerce_stock_amount), and get_item_count() SUMS them as floats, so
 * 1.1 + 2.2 would otherwise go out as 3.3000000000000003. Rounded to 2dp
 * because that is the store's limit on a quantity; trimmed because a
 * quantity, unlike money, has no fixed number of decimals to show.
 *
 * @param mixed $value
 * @return string
 */
function ai_rest_quantity($value) {
    return wc_format_decimal($value, AIOC_QUANTITY_DECIMALS, true);
}

/**
 * ISO 8601 representation of a WC_DateTime, or null.
 *
 * @param WC_DateTime|null $date
 * @return string|null
 */
function ai_rest_date($date) {
    return $date ? $date->date(DATE_ATOM) : null;
}

/**
 * Display label for an order status.
 *
 * wc_get_order_status_name() handles every WooCommerce workflow status, but for
 * 'trash' it returns the bare slug 'trash' - its internal "special statuses"
 * map points 'wc-trash' at the slug itself rather than at a translated label.
 * So fall back to the registered POST status label, which is where WordPress
 * keeps the translated "Trash".
 *
 * Still no hardcoded label anywhere: the string comes from whoever registered
 * the status, which is the same rule the district and status lists follow.
 *
 * @param string $status Unprefixed status slug.
 * @return string
 */
function ai_rest_order_status_label($status) {
    $status = (string) $status;
    $label  = (string) wc_get_order_status_name($status);

    // wc_get_order_status_name() returns the slug unchanged when it has no
    // label for it, which is the signal to look elsewhere.
    if ($label !== '' && $label !== $status) {
        return $label;
    }

    $object = get_post_status_object($status);
    if ($object && !empty($object->label)) {
        return (string) $object->label;
    }

    return $label;
}

/**
 * Lean list-view representation of an order.
 *
 * @param WC_Order $order
 * @return array
 */
function ai_rest_prepare_order_summary(WC_Order $order) {
    $status = $order->get_status();

    return [
        'id'            => $order->get_id(),
        'number'        => $order->get_order_number(),
        'date_created'  => ai_rest_date($order->get_date_created()),
        'status'        => $status,
        'status_label'  => ai_rest_order_status_label($status),
        'customer_name' => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
        'phone'         => $order->get_billing_phone(),
        'total'         => ai_rest_money($order->get_total()),
        // A sum of quantities, so fractional when any line is.
        'item_count'    => ai_rest_quantity($order->get_item_count()),
    ];
}

/**
 * Full single-order representation.
 *
 * @param WC_Order $order
 * @return array
 */
function ai_rest_prepare_order_detail(WC_Order $order) {
    $status     = $order->get_status();
    $country    = $order->get_billing_country() ?: 'BD';
    $state_code = $order->get_billing_state();

    $states = (function_exists('WC') && WC()) ? WC()->countries->get_states($country) : [];
    if (!is_array($states)) {
        $states = [];
    }

    $line_items = [];
    foreach ($order->get_items() as $item_id => $item) {
        $line_items[] = [
            'id'           => (int) $item_id,
            'product_id'   => (int) $item->get_product_id(),
            'variation_id' => (int) $item->get_variation_id(),
            'name'         => $item->get_name(),
            // NOT an (int) cast: that read 1.5 back as 1, and the app would then
            // derive a doubled unit price and save the 1 over the real figure.
            'quantity'     => ai_rest_quantity($item->get_quantity()),
            'subtotal'     => ai_rest_money($item->get_subtotal()),
            'total'        => ai_rest_money($item->get_total()),
        ];
    }

    $shipping_lines = [];
    foreach ($order->get_items('shipping') as $item_id => $item) {
        $shipping_lines[] = [
            'id'           => (int) $item_id,
            'method_title' => $item->get_method_title(),
            'total'        => ai_rest_money($item->get_total()),
        ];
    }

    // Fees are used often on this store, including NEGATIVE fees as discounts.
    // Without them the client cannot reconcile the order total: line items plus
    // shipping does not add up on any order carrying one.
    $fee_lines = [];
    foreach ($order->get_items('fee') as $item_id => $item) {
        $fee_lines[] = [
            'id' => (int) $item_id,
            // 'edit' context deliberately. WC_Order_Item_Fee::get_name() in the
            // default 'view' context substitutes the word "Fee" for an empty
            // name and runs display filters; this endpoint reports what is
            // stored, empty string included.
            'name' => (string) $item->get_name('edit'),
            // Can be negative, and is passed through unchanged - no clamping,
            // no abs(). A discount IS a negative fee.
            'total' => ai_rest_money($item->get_total()),
        ];
    }

    return [
        'id'           => $order->get_id(),
        'number'       => $order->get_order_number(),
        'date_created' => ai_rest_date($order->get_date_created()),
        'status'       => $status,
        'status_label' => ai_rest_order_status_label($status),
        'billing'      => [
            'first_name'  => $order->get_billing_first_name(),
            'phone'       => $order->get_billing_phone(),
            'address_1'   => $order->get_billing_address_1(),
            'state'       => $state_code,
            'state_label' => $states[$state_code] ?? '',
            'country'     => $country,
        ],
        'line_items'     => $line_items,
        'shipping_lines' => $shipping_lines,
        'fee_lines'      => $fee_lines,
        'customer_note'  => $order->get_customer_note(),
        'total'          => ai_rest_money($order->get_total()),
        'currency'       => $order->get_currency(),
    ];
}

/**
 * Resolve the 'status' query param to a wc_get_orders() status argument.
 *
 * Accepts slugs with or without the 'wc-' prefix. With no filter supplied we
 * pass every registered status explicitly; that list never contains 'trash',
 * which is what keeps trashed orders out of the DEFAULT results - unchanged.
 *
 * 'trash' is accepted as an explicit filter so the app can show a trash view,
 * but it is NOT a workflow status and must not be treated as one: it is
 * WordPress's own post status, it never appears in wc_get_order_statuses(),
 * and it has no place in a filter dropdown next to Processing and Completed.
 * A custom workflow status such as 'wc-returned' does belong there; this does
 * not.
 *
 * HPOS stores it UNPREFIXED. OrdersTableDataStore::trash_order() writes
 * `'status' => 'trash'`, while workflow statuses are stored prefixed
 * ('wc-completed'). That asymmetry is load bearing here, because
 * OrdersTableQuery::sanitize_status() only adds the 'wc-' prefix when the
 * prefixed form is a registered status and otherwise passes the value through
 * verbatim - so 'wc-trash' would reach the SQL unchanged and match no rows at
 * all, returning an empty list rather than an error. Both spellings are
 * therefore accepted at the boundary and normalized to the bare one here.
 *
 * @param string $status
 * @return array|WP_Error
 */
function ai_rest_resolve_status_arg($status) {
    $registered = array_keys(wc_get_order_statuses());

    $status = trim((string) $status);
    if ($status === '') {
        return $registered;
    }

    if ($status === 'trash' || $status === 'wc-trash') {
        return ['trash'];
    }

    $normalized = strpos($status, 'wc-') === 0 ? $status : 'wc-' . $status;
    if (!in_array($normalized, $registered, true)) {
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

    return [$normalized];
}

/**
 * Apply the 'search' param to a wc_get_orders() argument array.
 *
 * ONE SEARCH, matching what wp-admin's order search already does, because
 * staff use both boxes and a difference between them is worse than any
 * individual behaviour either could have. The term is passed through
 * UNTOUCHED, with 'search_filter' => 'all'.
 *
 * What 'all' buys, read from WooCommerce 11.0.1
 * (Internal/DataStores/Orders/OrdersTableSearchQuery.php) rather than assumed:
 *
 *   - 'all' (and an absent filter) expands to every core filter - order_id,
 *     transaction_id, customer_email, customers, products - OR'd together.
 *     It is also what the wp-admin dropdown defaults to.
 *   - ORDER ID: generate_where() adds `id = N` whenever the term is exactly
 *     (string) absint($term), independently of the filter. Exact, not partial,
 *     so "8735" finds order 8735 but "873" does not, and neither does "08735".
 *   - PHONE, NAME, ADDRESS: the 'customers' filter matches
 *     meta_value LIKE '%term%' against _billing_address_index /
 *     _shipping_address_index. Those are written by
 *     OrdersTableDataStore::update_address_index_meta() as
 *     implode(' ', $order->get_address($type)), and a billing address array
 *     INCLUDES phone and email. So a phone is matched because it sits inside
 *     that concatenated string - which is why a fragment matches MID-NUMBER,
 *     and why no phone column and no raw SQL are needed.
 *   - Bengali text keeps working for the same reason: a LIKE on utf8mb4 is a
 *     substring test, with nothing tokenizing or normalizing the term. It is a
 *     CONTIGUOUS substring though, so "yasmin farida" will not find
 *     "farida yasmin".
 *
 * Verified against live at 7.2: "8735" returns exactly order #8735, and "5089"
 * returns the same 7 orders as wp-admin in the same order (12312, 9798, 8735,
 * 8421, 8350, 8313, 7405), each with 5089 inside an 11-digit phone.
 *
 * The term is deliberately NOT normalized. Stored phone numbers on this store
 * are always plain 11-digit ASCII - customer data is never entered with +880,
 * and the parser converts Bangla digits before saving - so a staff member types
 * the digits they can see. ai_normalize_bd_phone() used to run here and made a
 * valid-looking mobile an exact billing_phone lookup, which was narrower than
 * wp-admin in two ways: it could not match a fragment, and it never looked at
 * the SHIPPING phone. It is still the right tool for
 * GET /customers/last-order, which asks for one exact number.
 *
 * HAZARD, recorded because nothing in this repo would reveal it: if HPOS
 * full-text search is ever switched on (woocommerce_hpos_fts_index_enabled and
 * woocommerce_hpos_address_fts_index_created both 'yes'), the customers clause
 * becomes MATCH ... AGAINST ... IN BOOLEAN MODE, which does not match mid-word.
 * Mid-phone search would then break here AND in wp-admin, silently.
 *
 * @param array  $args
 * @param string $search
 * @return array|WP_Error
 */
function ai_rest_apply_search_arg(array $args, $search) {
    $search = trim((string) $search);

    // No search is not a short search: the unfiltered list is the normal view.
    if ($search === '') {
        return $args;
    }

    // Below the minimum the leading wildcard matches almost everything - "01"
    // is inside nearly every BD phone number - so this is a 400 rather than a
    // slow scan returning the whole table. The app enforces the same minimum
    // before it asks, so this is the backstop, not the user-facing rule.
    if (mb_strlen($search) < AIOC_SEARCH_MIN_LENGTH) {
        return new WP_Error(
            'aioc_search_too_short',
            sprintf(
                /* translators: %d: the minimum number of characters. */
                __('The search term must be at least %d characters.', 'ai-order-creator'),
                AIOC_SEARCH_MIN_LENGTH
            ),
            ['status' => 400]
        );
    }

    $args['s']             = $search;
    $args['search_filter'] = 'all';

    return $args;
}

/**
 * GET /aioc/v1/orders
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_get_orders(WP_REST_Request $request) {
    $started = microtime(true);

    $page     = max(1, (int) $request->get_param('page'));
    $per_page = min(50, max(1, (int) $request->get_param('per_page')));

    $status_arg = ai_rest_resolve_status_arg($request->get_param('status'));
    if (is_wp_error($status_arg)) {
        return $status_arg;
    }

    $args = [
        'limit'    => $per_page,
        'page'     => $page,
        'paginate' => true,
        'orderby'  => 'date',
        'order'    => 'DESC',
        'status'   => $status_arg,
    ];

    $args = ai_rest_apply_search_arg($args, $request->get_param('search'));
    if (is_wp_error($args)) {
        return $args;
    }

    $results = wc_get_orders($args);

    $orders = [];
    foreach ($results->orders as $order) {
        if ($order instanceof WC_Order) {
            $orders[] = ai_rest_prepare_order_summary($order);
        }
    }

    return new WP_REST_Response([
        'orders'      => $orders,
        'total'       => (int) $results->total,
        'total_pages' => (int) $results->max_num_pages,
        'page'        => $page,
        // Wall-clock milliseconds inside the handler, as /products reports.
        // Here to answer one question: what does search_filter => 'all' cost?
        // It adds an unindexed order_item_name LIKE '%term%' over the order
        // items table, so the figure to watch is a broad text term against a
        // large order count - not an id lookup, which never reaches that scan.
        'timing_ms'   => (int) round((microtime(true) - $started) * 1000),
    ], 200);
}

/**
 * GET /aioc/v1/orders/{id}
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_get_order(WP_REST_Request $request) {
    $id    = absint($request->get_param('id'));
    $order = $id ? wc_get_order($id) : false;

    // wc_get_order() also resolves refund IDs; only real orders are exposed.
    if (!$order instanceof WC_Order) {
        return new WP_Error(
            'aioc_order_not_found',
            __('No order found with that ID.', 'ai-order-creator'),
            ['status' => 404]
        );
    }

    return new WP_REST_Response(ai_rest_prepare_order_detail($order), 200);
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/orders', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'ai_rest_get_orders',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => [
            'page' => [
                'type'              => 'integer',
                'default'           => 1,
                'sanitize_callback' => 'ai_rest_sanitize_absint',
            ],
            'per_page' => [
                'type'              => 'integer',
                'default'           => 20,
                'sanitize_callback' => 'ai_rest_sanitize_absint',
            ],
            'search' => [
                'type'              => 'string',
                'default'           => '',
                'sanitize_callback' => 'ai_rest_sanitize_text',
            ],
            'status' => [
                'type'              => 'string',
                'default'           => '',
                'sanitize_callback' => 'ai_rest_sanitize_text',
            ],
        ],
    ]);

    register_rest_route(AIOC_REST_NAMESPACE, '/orders/(?P<id>\d+)', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'ai_rest_get_order',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => [
            'id' => [
                'type'              => 'integer',
                'required'          => true,
                'sanitize_callback' => 'ai_rest_sanitize_absint',
            ],
        ],
    ]);
});
