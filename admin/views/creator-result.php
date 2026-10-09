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

    $state_code = ai_match_state_code($data['state'] ?? '');

    /*
     * This tab creates the order the moment the button is pressed - there is no
     * review step between the preview above and the write, unlike the app's
     * parse-review-save. So an unresolved district cannot be left to a human to
     * notice later: ai_apply_shipping() adds NO line without one, and the order
     * would be created short by 80-150 BDT with nothing looking wrong.
     *
     * Refusing is the safe half of that trade. Applying the Outside Dhaka rate
     * instead would contradict 4.9/7.0, which settled that no district means no
     * shipping, whether the order never had one or lost it - and it would put a
     * shipping line on an order with no district to justify it.
     *
     * The district is now only ever taken from the customer's text (see
     * parser.php), so this fires more often than it would have before 7.5. That
     * is the point: it is the case that used to be filled in by a guess.
     */
    if ($state_code === '') {
        echo '<div class="notice notice-error"><p><strong>No order created.</strong> '
            . 'No district could be resolved from this message, and an order with no '
            . 'district gets no shipping charge at all. Add the district to the text '
            . '(or create the order in the app, where the district is a dropdown) and '
            . 'try again.</p></div>';
        ai_log('Order creation refused: no district resolved', $data['state'] ?? '');
        return;
    }

    $result = ai_create_order_from_data($data);

    ai_render_order_result($result, $data, $state_code, microtime(true) - $started_at, $debug_mode);

    ai_log('=== ORDER CREATION COMPLETED ===');
}
