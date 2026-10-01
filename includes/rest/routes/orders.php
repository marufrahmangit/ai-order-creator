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
 * ISO 8601 representation of a WC_DateTime, or null.
 *
 * @param WC_DateTime|null $date
 * @return string|null
 */
function ai_rest_date($date) {
    return $date ? $date->date(DATE_ATOM) : null;
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
        'status_label'  => wc_get_order_status_name($status),
        'customer_name' => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
        'phone'         => $order->get_billing_phone(),
        'total'         => ai_rest_money($order->get_total()),
        'item_count'    => (int) $order->get_item_count(),
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
            'quantity'     => (int) $item->get_quantity(),
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
        'status_label' => wc_get_order_status_name($status),
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
 * which is what keeps trashed orders out of the results in both cases.
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
 * A term that normalizes to a valid BD mobile becomes an exact billing_phone
 * lookup; anything else is treated as a customer name search.
 *
 * The name-search branch uses the HPOS order-table query args ('s' with
 * 'search_filter' => 'customers'). Confirmed on staging (WooCommerce 11.0.1,
 * HPOS): it does partial, mid-name matching. Kept isolated in this function so
 * it can be swapped without touching the handlers. See docs/PROJECT-STATE.md.
 *
 * @param array  $args
 * @param string $search
 * @return array
 */
function ai_rest_apply_search_arg(array $args, $search) {
    $search = trim((string) $search);
    if ($search === '') {
        return $args;
    }

    $phone = ai_normalize_bd_phone($search);
    if ($phone !== '') {
        $args['billing_phone'] = $phone;
        return $args;
    }

    $args['s']             = $search;
    $args['search_filter'] = 'customers';

    return $args;
}

/**
 * GET /aioc/v1/orders
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_get_orders(WP_REST_Request $request) {
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
