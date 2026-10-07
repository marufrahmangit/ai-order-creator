<?php
if (!defined('ABSPATH')) exit;

/**
 * GET /aioc/v1/customers/last-order
 *
 * The repeat-customer lookup the legacy admin tool has always had, exposed to
 * the app. The lookup itself is ai_find_last_order_by_phone() in
 * includes/orders/lookup.php, shared with the AJAX handler; this file is
 * transport only.
 *
 * Transport only in the response shape as well: a found order is returned
 * through ai_rest_prepare_order_detail(), the SAME builder GET /orders/{id}
 * uses, so the client already knows how to read it - line_items,
 * shipping_lines, fee_lines and all. There is deliberately no second order
 * shape in this API.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_get_last_order(WP_REST_Request $request) {
    $raw_phone = (string) $request->get_param('phone');
    $phone     = ai_normalize_bd_phone($raw_phone);

    if ($phone === '') {
        return new WP_Error(
            'aioc_invalid_phone',
            __('That is not a recognizable Bangladeshi mobile number.', 'ai-order-creator'),
            ['status' => 400]
        );
    }

    $order = ai_find_last_order_by_phone($phone, $request->get_param('exclude'));

    if (!$order instanceof WC_Order) {
        // 200, not 404. "This customer is new" is a normal answer to a
        // reasonable question, not a failure - and the app shows nothing at
        // all in that case, so an error status would make it handle a
        // non-error as one.
        return new WP_REST_Response(['found' => false], 200);
    }

    return new WP_REST_Response([
        'found' => true,
        'order' => ai_rest_prepare_order_detail($order),
    ], 200);
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/customers/last-order', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'ai_rest_get_last_order',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => [
            'phone' => [
                'type'              => 'string',
                'required'          => true,
                'sanitize_callback' => 'ai_rest_sanitize_text',
            ],
            'exclude' => [
                'type'              => 'integer',
                'sanitize_callback' => 'ai_rest_sanitize_absint',
                // Clamp rather than reject, as everywhere else in this
                // namespace: a non-numeric value becomes 0, which means
                // "exclude nothing".
                'validate_callback' => 'ai_rest_validate_any',
            ],
        ],
    ]);
});
