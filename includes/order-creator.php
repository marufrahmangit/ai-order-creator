<?php
if (!defined('ABSPATH')) exit;

function ai_process_order_text($text) {
    $started_at = microtime(true);
    $parsed = ai_get_parsed_order_data($text);
    $debug_mode = !empty($parsed['debug_mode']);

    if (!$parsed['success']) {
        echo '<div class="notice notice-error"><p><strong>Error:</strong> ' . esc_html($parsed['error']) . '</p></div>';
        if ($debug_mode) {
            echo '<pre style="background:#fff3cd; padding:15px; border-left:4px solid #ffc107;">Check wp-content/debug.log for detailed error information</pre>';
        }
        return;
    }

    ai_render_parse_preview($parsed);
    $data = $parsed['data'];

    try {
        $order = wc_create_order();
        
        $order->set_billing_first_name($data['name'] ?? '');
        $order->set_billing_phone($data['phone'] ?? '');
        $order->set_billing_address_1($data['address_line_1'] ?? '');
        $order->set_billing_country('BD');
        $order->set_shipping_first_name($data['name'] ?? '');
        $order->set_shipping_address_1($data['address_line_1'] ?? '');
        $order->set_shipping_country('BD');
        $order->update_meta_data('_shipping_phone', $data['phone'] ?? '');
        $order->update_meta_data('shipping_phone', $data['phone'] ?? '');

        $state_code = ai_match_state_code($data['state'] ?? '');
        if ($state_code) {
            $order->set_billing_state($state_code);
            $order->set_shipping_state($state_code);
            ai_log('Matched state', ['input' => $data['state'], 'code' => $state_code]);
        } elseif (!empty($data['state'])) {
            ai_log('WARNING: State not matched in WooCommerce states', $data['state']);
        }

        if (!empty($data['price'])) {
            $order->update_meta_data('_ai_extracted_price', (string) $data['price']);
            $order->add_order_note('AI extracted price: ' . (string) $data['price']);
        }

        if (!empty($data['customer_note'])) {
            $order->set_customer_note($data['customer_note']);
        }

        $order->set_status('pending');
        $order->add_order_note('Order created via AI Order Creator (Groq)');
        $order->save();

        $order_id = $order->get_id();
        ai_log('SUCCESS: Order created', $order_id);

        echo '<div class="notice notice-success" style="border-left-color:#46b450;">';
        echo '<p><strong>Success!</strong> Order created in ' . round(microtime(true) - $started_at, 3) . ' seconds</p>';
        echo '<p><a href="' . admin_url('post.php?post=' . $order_id . '&action=edit') . '" class="button button-primary" target="_blank">View Order #' . $order_id . '</a></p>';
        echo '</div>';

        if ($debug_mode) {
            echo '<div style="background:#d1ecf1; padding:15px; margin:15px 0; border-left:4px solid #0c5460;">';
            echo '<h3>Order Details</h3>';
            echo '<table class="widefat" style="max-width:600px;">';
            echo '<tr><th>Field</th><th>Value</th></tr>';
            echo '<tr><td><strong>Order ID</strong></td><td>' . $order_id . '</td></tr>';
            echo '<tr><td><strong>Name</strong></td><td>' . esc_html($data['name'] ?? 'N/A') . '</td></tr>';
            echo '<tr><td><strong>Phone</strong></td><td>' . esc_html($data['phone'] ?? 'N/A') . '</td></tr>';
            echo '<tr><td><strong>Address</strong></td><td>' . esc_html($data['address_line_1'] ?? 'N/A') . '</td></tr>';
            echo '<tr><td><strong>State</strong></td><td>' . esc_html($data['state'] ?? 'N/A') . ($state_code ? " (Code: $state_code)" : ' (Not matched)') . '</td></tr>';
            echo '<tr><td><strong>Price</strong></td><td>' . esc_html(isset($data['price']) && $data['price'] !== '' ? (string) $data['price'] : 'N/A') . '</td></tr>';
            echo '<tr><td><strong>Price Items</strong></td><td>' . esc_html(!empty($data['price_items']) ? ai_format_price_requests($data['price_items']) : 'N/A') . '</td></tr>';
            echo '<tr><td><strong>Customer Note</strong></td><td>' . nl2br(esc_html($data['customer_note'] ?? 'N/A')) . '</td></tr>';
            echo '</table>';
            echo '</div>';
        }
    } catch (Exception $e) {
        ai_log('ERROR: Order creation failed', $e->getMessage());
        echo '<div class="notice notice-error"><p><strong>Error creating order:</strong> ' . esc_html($e->getMessage()) . '</p></div>';
    }

    ai_log('=== ORDER CREATION COMPLETED ===');
}
