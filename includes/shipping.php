<?php
if (!defined('ABSPATH')) exit;

/**
 * Single source of truth for the flat shipping rates.
 *
 * @param string $state_code WooCommerce state code (e.g. 'BD-13').
 * @return array{cost:int,label:string}
 */
function ai_get_shipping_rate($state_code) {
    switch ((string) $state_code) {
        case 'BD-13':
            return ['cost' => 80, 'label' => 'Dhaka Flat Rate'];
        case 'BD-18':
            return ['cost' => 120, 'label' => 'Gazipur Flat Rate'];
        default:
            return ['cost' => 150, 'label' => 'Outside Dhaka Flat Rate'];
    }
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
