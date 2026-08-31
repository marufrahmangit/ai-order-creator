<?php
if (!defined('ABSPATH')) exit;

/**
 * Render the outcome of an order-creation attempt.
 *
 * @param int|WP_Error $order_id_or_error Return value of ai_create_order_from_data().
 * @param array        $data              Parsed order data.
 * @param string       $state_code        Matched WooCommerce state code, or '' if unmatched.
 * @param float        $elapsed           Seconds spent on the whole create path.
 * @param bool         $debug_mode        Whether to render the debug details table.
 * @return void
 */
function ai_render_order_result($order_id_or_error, $data, $state_code, $elapsed, $debug_mode) {
    if (is_wp_error($order_id_or_error)) {
        echo '<div class="notice notice-error"><p><strong>Error creating order:</strong> ' . esc_html($order_id_or_error->get_error_message()) . '</p></div>';
        return;
    }

    $order_id = $order_id_or_error;

    echo '<div class="notice notice-success" style="border-left-color:#46b450;">';
    echo '<p><strong>Success!</strong> Order created in ' . round($elapsed, 3) . ' seconds</p>';
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
        echo '<tr><td><strong>Customer Note</strong></td><td>' . nl2br(esc_html($data['customer_note'] ?? 'N/A')) . '</td></tr>';
        echo '</table>';
        echo '</div>';
    }
}

/**
 * Thin admin wrapper for the create path: parse, preview, create, report.
 *
 * This is the only function in the create path that produces output.
 *
 * @param string $text Raw pasted customer text.
 * @return void
 */
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

    $result = ai_create_order_from_data($data);
    $state_code = ai_match_state_code($data['state'] ?? '');

    ai_render_order_result($result, $data, $state_code, microtime(true) - $started_at, $debug_mode);

    ai_log('=== ORDER CREATION COMPLETED ===');
}
