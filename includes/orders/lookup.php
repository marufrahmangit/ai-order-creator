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
 * THE MOST RECENT ORDER, NEVER A SUBSTITUTE. This used to take an
 * $exclude_order_id so the app could ask for "the last order that is not the
 * one I am editing", which was the wrong question: the answer is the
 * SECOND-most-recent order, presented as if it were the last one. On order
 * 11354 that showed 11323, which is not that customer's last order and is
 * misleading rather than merely unhelpful. Whether a caller wants to DISPLAY
 * the answer is the caller's decision, and the app now makes it client-side.
 *
 * @param string $phone Raw or normalized; normalized here either way.
 * @return WC_Order|null
 */
function ai_find_last_order_by_phone($phone) {
    // Idempotent, so it does not matter whether the caller already did this.
    $phone = ai_normalize_bd_phone($phone);
    if ($phone === '') {
        return null;
    }

    $orders = wc_get_orders([
        'limit'         => 1,
        'orderby'       => 'date',
        'order'         => 'DESC',
        'billing_phone' => $phone,
    ]);

    if (!is_array($orders) || empty($orders)) {
        return null;
    }

    return $orders[0] instanceof WC_Order ? $orders[0] : null;
}
