<?php
if (!defined('ABSPATH')) exit;

/**
 * THE shipping rate table. The only one.
 *
 * These rates have nothing to do with WooCommerce's shipping zones or methods -
 * WooCommerce > Settings > Shipping is never consulted. ai_apply_shipping()
 * writes a flat_rate line from this table directly.
 *
 * Returned as a structure rather than hidden in a switch so that it can be
 * READ as data - GET /meta serves it to the app, which previews the cost before
 * an order is saved. A second copy anywhere, in PHP or JS, would be a second
 * source of truth, and the one that disagreed would be the one staff read out.
 *
 * @return array{default:array{cost:int,label:string},by_state:array<string,array{cost:int,label:string}>}
 */
function ai_get_shipping_rates() {
    return [
        'default'  => ['cost' => 150, 'label' => 'Outside Dhaka Flat Rate'],
        'by_state' => [
            'BD-13' => ['cost' => 80,  'label' => 'Dhaka Flat Rate'],
            'BD-18' => ['cost' => 120, 'label' => 'Gazipur Flat Rate'],
        ],
    ];
}

/**
 * The rate for one state code, defaulting to Outside Dhaka.
 *
 * Note what this does NOT decide: whether a shipping line is added at all.
 * An EMPTY state code returns the default here, but ai_apply_shipping() never
 * asks - it returns early and adds no line. So the default applies to a state
 * that is set but unrecognized, not to an order with no district.
 *
 * @param string $state_code WooCommerce state code (e.g. 'BD-13').
 * @return array{cost:int,label:string}
 */
function ai_get_shipping_rate($state_code) {
    $rates = ai_get_shipping_rates();
    $code  = (string) $state_code;

    return isset($rates['by_state'][$code]) ? $rates['by_state'][$code] : $rates['default'];
}

/**
 * Replace the order's shipping lines with the flat rate for its billing state.
 *
 * @param WC_Order $order
 * @return void
 */
function ai_apply_shipping(WC_Order $order) {
    $state_code = $order->get_billing_state();
    if (empty($state_code)) {
        ai_log('Shipping skipped: billing state is empty', $order->get_id());
        return;
    }

    $rate = ai_get_shipping_rate($state_code);

    foreach ($order->get_items('shipping') as $item_id => $shipping_item) {
        $order->remove_item($item_id);
    }

    $shipping = new WC_Order_Item_Shipping();
    $shipping->set_method_id('flat_rate');
    $shipping->set_method_title($rate['label']);
    $shipping->set_total($rate['cost']);
    $order->add_item($shipping);

    // WC_Abstract_Order::calculate_totals() ends with $this->save(), so it
    // persists the removed/added shipping lines and the recalculated totals.
    // Do not add a save() here - it would be a redundant second write.
    $order->calculate_totals();

    ai_log('Shipping applied', [
        'order' => $order->get_id(),
        'state' => $state_code,
        'cost'  => $rate['cost'],
        'label' => $rate['label'],
    ]);
}

/**
 * Hook bridge: both admin hooks hand us an order ID, ai_apply_shipping() wants
 * the order object.
 *
 * @param int $order_id
 * @return void
 */
function ai_apply_shipping_to_order_id($order_id) {
    if (!is_admin()) {
        return;
    }

    $order = wc_get_order($order_id);
    if (!$order instanceof WC_Order) {
        return;
    }

    ai_apply_shipping($order);
}

add_action('woocommerce_process_shop_order_meta', 'ai_apply_shipping_to_order_id', 60);
add_action('woocommerce_before_save_order_items', 'ai_apply_shipping_to_order_id');
