<?php
if (!defined('ABSPATH')) exit;

function ai_ajax_lookup_last_order() {
    check_ajax_referer('ai_order_lookup_nonce', 'nonce');

    if (!current_user_can('manage_woocommerce')) {
        wp_send_json_error('Unauthorized');
    }

    $raw_phone = isset($_POST['phone']) ? sanitize_text_field(wp_unslash($_POST['phone'])) : '';

    // Normalize Bangla digits to ASCII and strip non-digit chars
    $phone = strtr($raw_phone, [
        '০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4',
        '৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9',
    ]);
    $phone = preg_replace('/\D+/', '', $phone);

    // Normalize +88 / 88 prefixes
    if (strpos($phone, '8801') === 0) {
        $phone = '0' . substr($phone, 3);
    } elseif (strpos($phone, '801') === 0) {
        $phone = '0' . substr($phone, 2);
    } elseif (strlen($phone) === 10 && strpos($phone, '1') === 0) {
        $phone = '0' . $phone;
    }

    if (!preg_match('/^01[3-9]\d{8}$/', $phone)) {
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
