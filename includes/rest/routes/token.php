<?php
if (!defined('ABSPATH')) exit;

/*
 * POST /aioc/v1/token - the login endpoint.
 *
 * Staff log in with the WordPress username and password they already know.
 * Core Basic auth will not accept those: wp_authenticate_application_password()
 * only ever matches against application passwords, so an account password sent
 * as Basic auth fails no matter how correct it is. This route bridges that gap
 * once - it verifies the account password, mints an application password on the
 * user's behalf, and hands back the plaintext. From then on the app sends that
 * as Basic auth like any other client, and the account password is never stored
 * anywhere, on the device or here.
 *
 * It is the only unauthenticated route in the namespace, so everything below is
 * written on the assumption that anyone on the internet can call it.
 *
 * It also sidesteps the Defender application-password truncation recorded in
 * docs/PROJECT-STATE.md (Environment): that defect is in wp-admin's DISPLAY of a new
 * password. The plaintext here is read from the create call's return value,
 * before any admin screen is involved, so a truncated display cannot produce a
 * truncated credential.
 */

/**
 * Prefix shared by every application password this route creates, so they are
 * identifiable at a glance in Users -> Profile -> Application Passwords.
 */
define('AIOC_APP_PASSWORD_PREFIX', 'Order Ops (app)');

/** Failure-throttle window, in seconds. */
define('AIOC_TOKEN_WINDOW', 15 * MINUTE_IN_SECONDS);

/*
 * Failed attempts allowed per window.
 *
 * The per-IP ceiling is the looser of the two: staff share one office
 * connection, so several people's genuine typos land in the same bucket, and a
 * limit as tight as the per-account one would let one person's fumbling lock
 * out the team. The per-account ceiling is what actually blunts a password
 * guessing run, and it holds however many addresses the attempts come from.
 */
define('AIOC_TOKEN_MAX_FAILURES_IP', 10);
define('AIOC_TOKEN_MAX_FAILURES_USER', 5);

/**
 * The requesting IP, or 'unknown'.
 *
 * REMOTE_ADDR only. X-Forwarded-For and friends are client-supplied headers:
 * trusting them here would let an attacker send a fresh fake one on every
 * request and never fill a bucket, which is worse than having no per-IP limit
 * at all, because it would look like one was working.
 *
 * The cost of that choice is that if this site is ever put behind a CDN or
 * reverse proxy, REMOTE_ADDR becomes the proxy's address and the per-IP bucket
 * turns into a single global one. The per-account bucket is unaffected and
 * remains the real protection. Revisit this only alongside a trusted-proxy
 * setting, never by reading the header directly.
 *
 * @return string
 */
function ai_rest_token_client_ip() {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? trim((string) $_SERVER['REMOTE_ADDR']) : '';

    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : 'unknown';
}

/**
 * Transient key for a throttle bucket.
 *
 * Hashed to keep the key inside the transient name length limit, free of
 * characters an option name cannot hold, and free of a plaintext username.
 *
 * @param string $kind 'ip' or 'user'.
 * @param string $id   The address or username.
 * @return string
 */
function ai_rest_token_bucket_key($kind, $id) {
    return 'aioc_lf_' . $kind . '_' . md5(strtolower((string) $id));
}

/**
 * Read a bucket, or null when it is absent or its window has passed.
 *
 * @param string $key
 * @return array|null ['count' => int, 'first' => int]
 */
function ai_rest_token_bucket_get($key) {
    $bucket = get_transient($key);

    if (!is_array($bucket) || !isset($bucket['count'], $bucket['first'])) {
        return null;
    }

    if ((time() - (int) $bucket['first']) >= AIOC_TOKEN_WINDOW) {
        return null;
    }

    return ['count' => (int) $bucket['count'], 'first' => (int) $bucket['first']];
}

/**
 * Record one failure against a bucket and return its new count.
 *
 * A FIXED window, not a sliding one: the expiry is shortened on each increment
 * so it still lands AIOC_TOKEN_WINDOW seconds after the first failure. Writing
 * the full window back every time would let a run of attempts push the expiry
 * out indefinitely and strand a locked-out account long past the stated wait,
 * which is a support call rather than a security gain.
 *
 * @param string $key
 * @return int
 */
function ai_rest_token_bucket_hit($key) {
    $now    = time();
    $bucket = ai_rest_token_bucket_get($key);

    if ($bucket === null) {
        set_transient($key, ['count' => 1, 'first' => $now], AIOC_TOKEN_WINDOW);
        return 1;
    }

    $bucket['count']++;
    $remaining = AIOC_TOKEN_WINDOW - ($now - $bucket['first']);
    set_transient($key, $bucket, max(1, $remaining));

    return $bucket['count'];
}

/**
 * The buckets a given attempt counts against.
 *
 * An empty username contributes to the IP bucket only - keying a shared bucket
 * on '' would pool unrelated callers together.
 *
 * @param string $ip
 * @param string $username
 * @return array List of [key, max] pairs.
 */
function ai_rest_token_buckets($ip, $username) {
    $buckets = [[ai_rest_token_bucket_key('ip', $ip), AIOC_TOKEN_MAX_FAILURES_IP]];

    if ($username !== '') {
        $buckets[] = [ai_rest_token_bucket_key('user', $username), AIOC_TOKEN_MAX_FAILURES_USER];
    }

    return $buckets;
}

/**
 * Seconds the caller must wait, or 0 when they may attempt a login.
 *
 * @param string $ip
 * @param string $username
 * @return int
 */
function ai_rest_token_retry_after($ip, $username) {
    $wait = 0;

    foreach (ai_rest_token_buckets($ip, $username) as $pair) {
        list($key, $max) = $pair;

        $bucket = ai_rest_token_bucket_get($key);
        if ($bucket === null || $bucket['count'] < $max) {
            continue;
        }

        $remaining = AIOC_TOKEN_WINDOW - (time() - $bucket['first']);
        $wait      = max($wait, $remaining);
    }

    return max(0, $wait);
}

/**
 * Count a failed attempt against every applicable bucket.
 *
 * @param string $ip
 * @param string $username
 * @return void
 */
function ai_rest_token_record_failure($ip, $username) {
    foreach (ai_rest_token_buckets($ip, $username) as $pair) {
        ai_rest_token_bucket_hit($pair[0]);
    }
}

/**
 * Forget a caller's failures. Called on a successful login, so a staff member
 * who mistypes twice and then gets it right starts clean.
 *
 * @param string $ip
 * @param string $username
 * @return void
 */
function ai_rest_token_clear_failures($ip, $username) {
    foreach (ai_rest_token_buckets($ip, $username) as $pair) {
        delete_transient($pair[0]);
    }
}

/**
 * The single failure response for every rejected credential.
 *
 * Deliberately identical whether the username does not exist, the password is
 * wrong, or either was blank, and it carries no hint of which. Distinguishing
 * them would turn this route into a free account-name oracle.
 *
 * @return WP_Error
 */
function ai_rest_token_invalid() {
    return new WP_Error(
        'aioc_invalid_credentials',
        __('Invalid username or password.', 'ai-order-creator'),
        ['status' => 401]
    );
}

/**
 * Name for a newly minted application password.
 *
 * Timestamped, because WP_Application_Passwords rejects a name the user
 * already has (application_password_duplicate_name, HTTP 409) - a fixed name
 * would therefore work on a staff member's first login and fail on every one
 * after it. The shared prefix keeps them recognizable; the timestamp makes
 * each unique and says when it was issued.
 *
 * UTC, to match the rest of the API's timestamps.
 *
 * @return string
 */
function ai_rest_token_password_name() {
    return AIOC_APP_PASSWORD_PREFIX . ' ' . gmdate('Y-m-d H:i:s') . ' UTC';
}

/**
 * POST /aioc/v1/token
 *
 * Unauthenticated. Takes an account username (or email) and password, and on
 * success returns a newly created application password in plaintext, which the
 * app stores and sends as Basic auth from then on.
 *
 * The plaintext is returned exactly once and is not recoverable afterwards -
 * WordPress stores only a hash. A lost credential means logging in again,
 * which mints another.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_issue_token(WP_REST_Request $request) {
    $username = trim((string) $request->get_param('username'));
    // Cast only. wp_authenticate() applies sanitize_user() to the username and
    // trim() to the password itself, so whatever normalizing happens is core's
    // and matches wp-login.php exactly. Adding our own on top could only make
    // this route reject a password the login form accepts.
    $password = (string) $request->get_param('password');
    $ip       = ai_rest_token_client_ip();

    $retry_after = ai_rest_token_retry_after($ip, $username);
    if ($retry_after > 0) {
        $minutes = (int) ceil($retry_after / MINUTE_IN_SECONDS);

        // A WP_REST_Response rather than a WP_Error, because this is the one
        // error that needs a header on it. The body is shaped exactly like a
        // WP_Error's, so the client can read every failure the same way.
        $response = new WP_REST_Response([
            'code'    => 'aioc_too_many_attempts',
            'message' => sprintf(
                /* translators: %d: number of minutes to wait. */
                _n(
                    'Too many failed login attempts. Try again in %d minute.',
                    'Too many failed login attempts. Try again in %d minutes.',
                    $minutes,
                    'ai-order-creator'
                ),
                $minutes
            ),
            'data'    => ['status' => 429, 'retry_after' => $retry_after],
        ], 429);

        $response->header('Retry-After', (string) $retry_after);

        return $response;
    }

    if ($username === '' || $password === '') {
        ai_rest_token_record_failure($ip, $username);
        return ai_rest_token_invalid();
    }

    // wp_authenticate() is the full core login stack, not just a hash compare:
    // it runs the 'authenticate' filters, so anything a security or 2FA plugin
    // enforces on wp-login.php is enforced here too, and it fires
    // 'wp_login_failed' on rejection so those plugins see these attempts.
    $user = wp_authenticate($username, $password);

    if (is_wp_error($user) || !($user instanceof WP_User)) {
        ai_rest_token_record_failure($ip, $username);
        return ai_rest_token_invalid();
    }

    // Correct credentials for an account that cannot use the API. Not counted
    // as a failed attempt - nothing was guessed - and answered distinctly,
    // since a staff member hitting this needs to be told to ask for the role
    // rather than to retype their password. It reveals only that the caller's
    // own credentials are valid, which they already knew.
    if (!user_can($user, 'manage_woocommerce')) {
        return new WP_Error(
            'aioc_rest_forbidden',
            __('This account does not have permission to use this app.', 'ai-order-creator'),
            ['status' => 403]
        );
    }

    if (!class_exists('WP_Application_Passwords')) {
        return new WP_Error(
            'aioc_app_passwords_missing',
            __('This site does not support application passwords.', 'ai-order-creator'),
            ['status' => 503]
        );
    }

    // Checked before creating rather than after: if application passwords are
    // switched off for this user, creation still succeeds but the credential
    // can never authenticate, so the app would store a password that silently
    // fails on every request.
    if (function_exists('wp_is_application_passwords_available_for_user')
        && !wp_is_application_passwords_available_for_user($user)) {
        return new WP_Error(
            'aioc_app_passwords_unavailable',
            __('Application passwords are disabled for this account.', 'ai-order-creator'),
            ['status' => 503]
        );
    }

    $name    = ai_rest_token_password_name();
    $created = WP_Application_Passwords::create_new_application_password($user->ID, ['name' => $name]);

    // Two logins inside the same second would collide on the name. Vanishingly
    // unlikely, and harmless to retry once - but an unhandled 409 here reads to
    // staff as "login is broken", with nothing in the response to explain it.
    if (is_wp_error($created) && $created->get_error_code() === 'application_password_duplicate_name') {
        $name    = $name . ' ' . wp_generate_password(4, false);
        $created = WP_Application_Passwords::create_new_application_password($user->ID, ['name' => $name]);
    }

    if (is_wp_error($created)) {
        ai_log('Application password creation failed', $created->get_error_message());

        return new WP_Error(
            'aioc_token_creation_failed',
            __('Could not complete login. Please try again.', 'ai-order-creator'),
            ['status' => 500]
        );
    }

    // create_new_application_password() returns [ plaintext, item ]. The
    // plaintext is 24 characters with no spaces - wp-admin's grouping into
    // blocks of four is display formatting applied later, and core strips
    // spaces on the way back in, so it is safe to send as-is.
    $plaintext = isset($created[0]) ? (string) $created[0] : '';
    $item      = (isset($created[1]) && is_array($created[1])) ? $created[1] : [];

    if ($plaintext === '') {
        ai_log('Application password creation returned no plaintext', $created);

        return new WP_Error(
            'aioc_token_creation_failed',
            __('Could not complete login. Please try again.', 'ai-order-creator'),
            ['status' => 500]
        );
    }

    ai_rest_token_clear_failures($ip, $username);

    $response = new WP_REST_Response([
        // Echoed back because Basic auth needs the canonical user_login, and
        // the caller may have logged in with an email address instead.
        'username'       => $user->user_login,
        'password'       => $plaintext,
        'display_name'   => $user->display_name,
        'user_id'        => (int) $user->ID,
        'name'           => $name,
        // Identifies this credential for a future revoke-on-logout route.
        'uuid'           => (string) ($item['uuid'] ?? ''),
        'plugin_version' => AIOC_VERSION,
    ], 201);

    // Belt and braces on a response body that is a live credential.
    $response->header('Cache-Control', 'no-store');

    return $response;
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/token', [
        'methods'  => WP_REST_Server::CREATABLE,
        'callback' => 'ai_rest_issue_token',
        // The one public route in this namespace. See ai_rest_permission_public().
        'permission_callback' => 'ai_rest_permission_public',
        'args'                => [
            'username' => [
                'type'              => 'string',
                'required'          => true,
                'sanitize_callback' => 'ai_rest_sanitize_text',
            ],
            'password' => [
                'type'     => 'string',
                'required' => true,
                // Passed through untouched - see ai_rest_sanitize_password().
                'sanitize_callback' => 'ai_rest_sanitize_password',
            ],
        ],
    ]);
});
