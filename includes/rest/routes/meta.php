<?php
if (!defined('ABSPATH')) exit;

/**
 * GET /aioc/v1/meta
 *
 * Everything the app would otherwise be tempted to hardcode. Every list here
 * is read from WooCommerce at request time, so a state relabelled upstream or
 * an order status registered by another plugin shows up without an app rebuild.
 *
 * CACHEABLE client-side for the length of a session. None of it changes during
 * normal operation - fetch once on load and reuse. It does not need to be
 * re-requested per screen.
 *
 * @return WP_REST_Response
 */
function ai_rest_meta() {
    // A list, not a map, so WooCommerce's own ordering survives JSON encoding.
    $states    = [];
    $wc_states = (function_exists('WC') && WC()) ? WC()->countries->get_states('BD') : [];
    if (is_array($wc_states)) {
        foreach ($wc_states as $code => $label) {
            $states[] = [
                'code'  => (string) $code,
                'label' => (string) $label,
            ];
        }
    }

    // Slugs are stripped of the 'wc-' prefix so they match what every other
    // endpoint accepts and returns.
    $statuses = [];
    foreach (wc_get_order_statuses() as $slug => $label) {
        $statuses[] = [
            'slug'  => ai_rest_strip_status_prefix($slug),
            'label' => (string) $label,
        ];
    }

    return new WP_REST_Response([
        'states'         => $states,
        'statuses'       => $statuses,
        'currency'       => (string) get_woocommerce_currency(),
        'price_decimals' => (int) wc_get_price_decimals(),
        'plugin_version' => AIOC_VERSION,
    ], 200);
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/meta', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'ai_rest_meta',
        'permission_callback' => 'ai_rest_permission_check',
    ]);
});
