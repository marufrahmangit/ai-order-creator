<?php
if (!defined('ABSPATH')) exit;

define('AIOC_REST_NAMESPACE', 'aioc/v1');

/**
 * Shared permission callback for every aioc/v1 route. No route is public.
 *
 * Authentication itself is WP core Application Passwords (Basic auth) - by the
 * time this runs core has either resolved the user or left them anonymous.
 * This deliberately implements no token, session, or API-key handling of its
 * own; it only checks capability.
 *
 * @return true|WP_Error
 */
function ai_rest_permission_check() {
    if (current_user_can('manage_woocommerce')) {
        return true;
    }

    return new WP_Error(
        'aioc_rest_forbidden',
        __('You do not have permission to use this API.', 'ai-order-creator'),
        ['status' => 403]
    );
}

/**
 * Auth/CORS smoke-test route. Intentionally permanent.
 *
 * @return WP_REST_Response
 */
function ai_rest_ping() {
    return new WP_REST_Response([
        'ok'      => true,
        'user'    => wp_get_current_user()->user_login,
        'version' => AIOC_VERSION,
    ], 200);
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/ping', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'ai_rest_ping',
        'permission_callback' => 'ai_rest_permission_check',
    ]);
});

/**
 * The configured app origin, or '' if unset.
 *
 * @return string
 */
function ai_rest_allowed_origin() {
    return untrailingslashit(trim((string) get_option('ai_app_origin', '')));
}

/**
 * Sanitize the App Origin setting: scheme + host (+ optional port) only, with
 * no path or trailing slash, so it can be compared byte-for-byte against an
 * incoming Origin header.
 *
 * @param string $value Raw submitted value.
 * @return string Normalized origin, or '' if unusable.
 */
function ai_sanitize_app_origin($value) {
    $value = trim((string) $value);
    if ($value === '') {
        return '';
    }

    $parts = wp_parse_url($value);
    if (empty($parts['scheme']) || empty($parts['host'])) {
        return '';
    }

    $origin = strtolower($parts['scheme']) . '://' . strtolower($parts['host']);
    if (!empty($parts['port'])) {
        $origin .= ':' . (int) $parts['port'];
    }

    return $origin;
}

/**
 * CORS headers for aioc/v1 routes only, plus the OPTIONS preflight response.
 *
 * Scoped on purpose: this must never widen CORS for the rest of the REST API,
 * so every path returns early unless the request being served is one of ours.
 *
 * With no ai_app_origin configured, or on an origin mismatch, we send nothing
 * and strip any CORS headers core already queued for this response - there is
 * no wildcard fallback.
 *
 * @param bool            $served  Whether the request has already been served.
 * @param WP_HTTP_Response $result  Result to send.
 * @param WP_REST_Request  $request Request used to generate the response.
 * @return bool
 */
function ai_rest_cors_headers($served, $result = null, $request = null) {
    if (!$request instanceof WP_REST_Request) {
        return $served;
    }

    $route = ltrim($request->get_route(), '/');
    if (strpos($route, AIOC_REST_NAMESPACE . '/') !== 0 && $route !== AIOC_REST_NAMESPACE) {
        return $served;
    }

    $allowed = ai_rest_allowed_origin();
    $origin  = untrailingslashit((string) get_http_origin());

    if ($allowed === '' || $origin === '' || $origin !== $allowed) {
        // Core's rest_send_cors_headers() reflects whatever Origin was sent,
        // with Allow-Credentials: true. Drop that for our routes so an
        // unconfigured or mismatched origin gets no CORS grant at all.
        header_remove('Access-Control-Allow-Origin');
        header_remove('Access-Control-Allow-Credentials');
        header_remove('Access-Control-Allow-Methods');
        header_remove('Access-Control-Allow-Headers');
        return $served;
    }

    header('Access-Control-Allow-Origin: ' . $allowed);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Vary: Origin', false);

    if (strtoupper($request->get_method()) === 'OPTIONS') {
        status_header(200);
        return true; // Short-circuits the body: 200 with headers only.
    }

    return $served;
}

add_filter('rest_pre_serve_request', 'ai_rest_cors_headers', 10, 3);
