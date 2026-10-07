<?php
if (!defined('ABSPATH')) exit;

/**
 * Find a customer's most recent order by phone number.
 *
 * Shared by the legacy AJAX lookup in includes/ajax.php and by
 * GET /aioc/v1/customers/last-order. The two format their responses very
 * differently - the AJAX one feeds the old admin UI and returns wc_price()
 * HTML, the REST one returns the standard order shape - but the LOOKUP must
 * exist once, which is why it lives here in the order layer rather than in
 * either caller.
 *
 * TRASHED ORDERS ARE EXCLUDED, by passing no 'status' at all.
 * OrdersTableQuery::sanitize_status() treats an absent status as "every valid
 * status except those flagged exclude_from_search", which is exactly trash and
 * checkout-draft. That is deliberately NOT the same as the explicit
 * array_keys(wc_get_order_statuses()) list GET /orders passes: that list
 * includes wc-checkout-draft, so passing it here would start surfacing
 * abandoned carts as somebody's last order.
 *
 * @param string $phone            Raw or normalized; normalized here either way.
 * @param int    $exclude_order_id An order to leave out, or 0. The app needs
 *                                 this while editing an order, or the lookup
 *                                 finds the order already open on screen.
 * @return WC_Order|null
 */
function ai_find_last_order_by_phone($phone, $exclude_order_id = 0) {
    // Idempotent, so it does not matter whether the caller already did this.
    $phone = ai_normalize_bd_phone($phone);
    if ($phone === '') {
        return null;
    }

    $exclude_order_id = absint($exclude_order_id);

    $args = [
        // One extra row when excluding, so the exclusion cannot leave an empty
        // result where a second-most-recent order exists.
        'limit'         => $exclude_order_id ? 2 : 1,
        'orderby'       => 'date',
        'order'         => 'DESC',
        'billing_phone' => $phone,
    ];

    if ($exclude_order_id) {
        // Supported by the HPOS query (it becomes `id != ...`), and mapped from
        // post__not_in on the legacy post store.
        $args['exclude'] = [$exclude_order_id];
    }

    $orders = wc_get_orders($args);
    if (!is_array($orders)) {
        return null;
    }

    foreach ($orders as $order) {
        if (!$order instanceof WC_Order) {
            continue;
        }

        // Defence in depth, the same way ai_rest_price_match_product_ids()
        // re-checks the price it just queried on: if the 'exclude' arg is ever
        // ignored, the caller still never sees the order it asked to skip.
        if ($exclude_order_id && $order->get_id() === $exclude_order_id) {
            continue;
        }

        return $order;
    }

    return null;
}
