<?php
if (!defined('ABSPATH')) exit;

/**
 * Human-readable BD state name for a WooCommerce state code.
 *
 * @param string $state_code e.g. 'BD-13'. Empty string yields ''.
 * @return string
 */
function ai_rest_bd_state_label($state_code) {
    $state_code = (string) $state_code;
    if ($state_code === '') {
        return '';
    }

    $states = (function_exists('WC') && WC()) ? WC()->countries->get_states('BD') : [];
    if (!is_array($states)) {
        return '';
    }

    return (string) ($states[$state_code] ?? '');
}

/**
 * POST /aioc/v1/parse
 *
 * Takes raw pasted text and returns structured data for the client to review.
 * READ-ONLY with respect to orders: it creates nothing, updates nothing, and
 * persists nothing. The shipping figure is a preview computed from the pure
 * ai_get_shipping_rate() rate table - no order exists yet, and
 * ai_apply_shipping() (which mutates an order) is deliberately not called.
 *
 * A transport wrapper only. All parsing is ai_get_parsed_order_data() in
 * includes/parsing/parser.php, which is not modified or reimplemented here.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_parse_text(WP_REST_Request $request) {
    $text = trim((string) $request->get_param('text'));

    if ($text === '') {
        return new WP_Error(
            'aioc_text_required',
            __('Text is required.', 'ai-order-creator'),
            ['status' => 400]
        );
    }

    $parsed = ai_get_parsed_order_data($text);

    // The parser only reports failure when BOTH name and phone are missing.
    // Partial extraction is a success carrying warnings.
    if (empty($parsed['success'])) {
        return new WP_Error(
            'aioc_parse_failed',
            (string) ($parsed['error'] ?? __('Could not parse the text.', 'ai-order-creator')),
            ['status' => 422]
        );
    }

    $data = isset($parsed['data']) && is_array($parsed['data']) ? $parsed['data'] : [];

    $state      = (string) ($data['state'] ?? '');
    $state_code = (string) ai_match_state_code($state);

    // An unmatched state is not an error - the client's district dropdown
    // handles it. ai_get_shipping_rate('') yields the Outside Dhaka default,
    // which is the correct preview for that case.
    $rate = ai_get_shipping_rate($state_code);

    return new WP_REST_Response([
        'parsed' => [
            'name'  => (string) ($data['name'] ?? ''),
            'phone' => (string) ($data['phone'] ?? ''),
            // The parser's key is address_line_1; the API exposes address_1.
            'address_1'     => (string) ($data['address_line_1'] ?? ''),
            'state'         => $state,
            'state_code'    => $state_code,
            'state_label'   => ai_rest_bd_state_label($state_code),
            'customer_note' => (string) ($data['customer_note'] ?? ''),
        ],
        'shipping_preview' => [
            'cost'  => ai_rest_money($rate['cost']),
            'label' => (string) $rate['label'],
        ],
        // Absent on the parser's failure paths, so defaulted rather than assumed.
        'warnings' => array_values((array) ($parsed['warnings'] ?? [])),
    ], 200);
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/parse', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'ai_rest_parse_text',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => [
            'text' => [
                'type'     => 'string',
                'required' => true,
                // Textarea, not sanitize_text_field: the parser splits on
                // newlines, and sanitize_text_field() strips them.
                'sanitize_callback' => 'ai_rest_sanitize_textarea',
            ],
        ],
    ]);
});
