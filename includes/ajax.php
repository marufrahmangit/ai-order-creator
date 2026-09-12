<?php
if (!defined('ABSPATH')) exit;

function ai_ajax_lookup_last_order() {
    check_ajax_referer('ai_order_lookup_nonce', 'nonce');

    if (!current_user_can('manage_woocommerce')) {
        wp_send_json_error('Unauthorized');
    }

    $raw_phone = isset($_POST['phone']) ? sanitize_text_field(wp_unslash($_POST['phone'])) : '';

    $phone = ai_normalize_bd_phone($raw_phone);

    if ($phone === '') {
        wp_send_json_error('Invalid phone number');
    }

    $orders = wc_get_orders([
        'limit'         => 1,
        'orderby'       => 'date',
        'order'         => 'DESC',
        'billing_phone' => $phone,
    ]);

    if (empty($orders)) {
        wp_send_json_success(['found' => false]);
    }

    $order = $orders[0];
    $currency = $order->get_currency();
    $decode   = function ($html) {
        return trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    };

    $items = [];
    foreach ($order->get_items() as $item) {
        $items[] = [
            'name'  => $item->get_name(),
            'qty'   => $item->get_quantity(),
            'total' => $decode(wc_price($item->get_total(), ['currency' => $currency])),
            'type'  => 'product',
        ];
    }
    foreach ($order->get_items('shipping') as $shipping) {
        $items[] = [
            'name'  => $shipping->get_name() ?: __('Shipping', 'woocommerce'),
            'qty'   => '',
            'total' => $decode(wc_price($shipping->get_total(), ['currency' => $currency])),
            'type'  => 'shipping',
        ];
    }
    foreach ($order->get_fees() as $fee) {
        $items[] = [
            'name'  => $fee->get_name() ?: __('Fee', 'woocommerce'),
            'qty'   => '',
            'total' => $decode(wc_price($fee->get_total(), ['currency' => $currency])),
            'type'  => 'fee',
        ];
    }

    $ai_price = $order->get_meta('_ai_extracted_price');

    wp_send_json_success([
        'found'           => true,
        'order_id'        => $order->get_id(),
        'date'            => $order->get_date_created() ? $order->get_date_created()->date_i18n(get_option('date_format')) : '',
        'status'          => wc_get_order_status_name($order->get_status()),
        'total'           => $decode($order->get_formatted_order_total()),
        'billing_name'    => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
        'billing_address' => $order->get_billing_address_1(),
        'ai_price'        => $ai_price ?: '',
        'items'           => $items,
        'edit_url'        => admin_url('post.php?post=' . $order->get_id() . '&action=edit'),
    ]);
}

add_action('wp_ajax_ai_lookup_last_order', 'ai_ajax_lookup_last_order');
