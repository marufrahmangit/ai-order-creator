<?php
if (!defined('ABSPATH')) exit;

/**
 * Create a WooCommerce order from parsed order data.
 *
 * Logic only - this function produces no output.
 *
 * @param array $data Parsed fields: name, phone, address_line_1, state, customer_note.
 * @return int|WP_Error Order ID on success, WP_Error on failure.
 */
function ai_create_order_from_data(array $data) {
    try {
        $order = wc_create_order();
        if (is_wp_error($order)) {
            ai_log('ERROR: Order creation failed', $order->get_error_message());
            return $order;
        }

        $order->set_billing_first_name($data['name'] ?? '');
        $order->set_billing_phone($data['phone'] ?? '');
        $order->set_billing_address_1($data['address_line_1'] ?? '');
        $order->set_billing_country('BD');
        $order->set_shipping_first_name($data['name'] ?? '');
        $order->set_shipping_address_1($data['address_line_1'] ?? '');
        $order->set_shipping_country('BD');
        $order->update_meta_data('_shipping_phone', $data['phone'] ?? '');
        $order->update_meta_data('shipping_phone', $data['phone'] ?? '');

        // State must be resolved and set before ai_apply_shipping() runs - it
        // picks the rate off the billing state.
        $state_code = ai_match_state_code($data['state'] ?? '');
        if ($state_code) {
            $order->set_billing_state($state_code);
            $order->set_shipping_state($state_code);
            ai_log('Matched state', ['input' => $data['state'], 'code' => $state_code]);
        } elseif (!empty($data['state'])) {
            ai_log('WARNING: State not matched in WooCommerce states', $data['state']);
        }

        if (!empty($data['customer_note'])) {
            $order->set_customer_note($data['customer_note']);
        }

        $order->set_status('pending');
        $order->add_order_note('Order created via AI Order Creator (Groq)');
        $order->save();

        // Applies the flat rate and calls calculate_totals(), which is what
        // stops the order from being saved with a total of 0.
        ai_apply_shipping($order);

        $order_id = $order->get_id();
        ai_log('SUCCESS: Order created', $order_id);

        return $order_id;
    } catch (Exception $e) {
        ai_log('ERROR: Order creation failed', $e->getMessage());
        return new WP_Error('ai_order_creation_failed', $e->getMessage());
    }
}
