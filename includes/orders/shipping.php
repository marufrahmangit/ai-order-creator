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
 * NO DISTRICT MEANS NO SHIPPING, and that has to hold whether the order never
 * had a district or had one and lost it. So the removal is UNCONDITIONAL and
 * happens first, and the totals are always recalculated. Only the adding of a
 * new line depends on there being a state.
 *
 * This function used to return early on an empty state, before removing
 * anything, which caused two separate bugs: an order whose district was cleared
 * kept the old rate on it and in its total (order 11361 on staging, left with a
 * 120.00 Gazipur line and no district), and nothing recalculated totals, which
 * ai_rest_finalize_order() worked around by calling calculate_totals() itself.
 * Both came from the same early return. Do not reintroduce it - "skip when
 * there is nothing to add" is not the same as "skip when there is nothing to
 * do", and an order that had a district is the case where they differ.
 *
 * @param WC_Order $order
 * @return void
 */
function ai_apply_shipping(WC_Order $order) {
    $state_code = $order->get_billing_state();

    // First, and whatever the state is. A line left behind here is a figure on
    // a customer's invoice that nothing in this plugin will remove later.
    foreach ($order->get_items('shipping') as $item_id => $shipping_item) {
        $order->remove_item($item_id);
    }

    $rate = null;
    if (!empty($state_code)) {
        $rate = ai_get_shipping_rate($state_code);

        $shipping = new WC_Order_Item_Shipping();
        $shipping->set_method_id('flat_rate');
        $shipping->set_method_title($rate['label']);
        $shipping->set_total($rate['cost']);
        $order->add_item($shipping);
    }

    // WC_Abstract_Order::calculate_totals() ends with $this->save(), so it
    // persists the removed and added shipping lines along with the
    // recalculated totals. Do not add a save() here - it would be a redundant
    // second write. It runs on BOTH paths: with no state there is still a
    // removal to persist and a total to bring down.
    $order->calculate_totals();

    ai_log(
        $rate === null ? 'Shipping cleared: no billing state' : 'Shipping applied',
        [
            'order' => $order->get_id(),
            'state' => $state_code,
            'cost'  => $rate === null ? 0 : $rate['cost'],
            'label' => $rate === null ? '' : $rate['label'],
        ]
    );
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
