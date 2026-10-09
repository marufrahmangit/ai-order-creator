<?php
/**
 * The order-list search arguments, built by the REAL ai_rest_apply_search_arg()
 * under a real PHP.
 *
 *   php -d extension=mbstring tests/rest/order-search.test.php
 *
 * `npm test` in app/ runs this too when it can find a PHP - see
 * app/test/run-all.mjs - and says SKIPPED, loudly, when it cannot.
 *
 * WHAT THIS PINS, and why each one is worth pinning:
 *
 *   - search_filter is 'all', not 'customers'. 'all' is what the wp-admin
 *     dropdown defaults to, and matching it is the whole point: staff use both
 *     boxes, and a box that behaves differently is worse than either
 *     behaviour on its own.
 *   - The term is passed through BYTE FOR BYTE. Normalizing it was the 7.2
 *     defect: a valid-looking mobile became an exact billing_phone lookup,
 *     which could not match a fragment and never looked at the shipping phone.
 *     Bengali, spaces, mixed digits, a leading zero - all must survive, since
 *     the search is a substring test and any edit changes what it finds.
 *   - billing_phone is NEVER set. That argument is an equality test, and its
 *     presence would silently narrow every search that produced one.
 *   - The 3-character minimum is a 400, and an EMPTY term is not a short term:
 *     the unfiltered list is the normal view of this screen.
 *
 * It cannot assert what SQL comes out - that needs WooCommerce and a database.
 * The reasoning from these args to the rows returned is recorded against
 * ai_rest_apply_search_arg() and was verified against live at 7.2.
 */

define('ABSPATH', __DIR__ . '/');
define('AIOC_PATH', dirname(__DIR__, 2) . '/');
define('AIOC_SEARCH_MIN_LENGTH', 3);
define('AIOC_QUANTITY_DECIMALS', 2);
define('AIOC_REST_NAMESPACE', 'aioc/v1');
define('AIOC_VERSION', 'test');

if (!extension_loaded('mbstring')) {
    fwrite(STDERR, "mbstring is not loaded. Run with -d extension=mbstring.\n");
    exit(2);
}

function __($s, $d = null) { return $s; }
function add_action(...$a) {}
function ai_log(...$a) {}

/** Just enough WP_Error to tell an error from an argument array. */
class WP_Error {
    public $code;
    public $message;
    public $data;
    public function __construct($code = '', $message = '', $data = '') {
        $this->code    = $code;
        $this->message = $message;
        $this->data    = $data;
    }
    public function get_error_code() { return $this->code; }
    public function get_error_message() { return $this->message; }
}
function is_wp_error($thing) { return $thing instanceof WP_Error; }

class WP_REST_Server { const READABLE = 'GET'; }

require AIOC_PATH . 'includes/rest/routes/orders.php';

$results = [];
function check($name, $actual, $expected) {
    global $results;
    $results[] = [
        'name'     => $name,
        'pass'     => json_encode($actual) === json_encode($expected),
        'actual'   => $actual,
        'expected' => $expected,
    ];
}

/** The args a search term produces, on top of a representative base. */
function args_for($term) {
    return ai_rest_apply_search_arg(['limit' => 20, 'page' => 1], $term);
}

// ---- the shape of a search ------------------------------------------------
$plain = args_for('5089');
check('a term becomes the HPOS "s" arg', $plain['s'] ?? null, '5089');
check('with search_filter => all, as wp-admin defaults to',
      $plain['search_filter'] ?? null, 'all');
check('billing_phone is never set - it is an equality test',
      array_key_exists('billing_phone', $plain), false);
check('the base args are left alone',
      [$plain['limit'], $plain['page']], [20, 1]);

// ---- the term survives verbatim ------------------------------------------
$verbatim = [
    'an order id'                  => '8735',
    'a phone fragment'             => '5089',
    'a full 11-digit mobile'       => '01771160171',
    'a 10-digit mobile'            => '1771160171',
    'a mobile with a leading zero' => '01712345678',
    'a district name'              => 'Chattogram',
    'a two-word customer name'     => 'farida yasmin',
    'Bengali with an ASCII digit'  => 'সেক্টর 18 উত্তরা',
    'Bengali alone'                => 'উত্তরা',
    'mixed case'                   => 'Farida YASMIN',
    'an internal hyphen'           => 'Mirpur-10',
    'an email'                     => 'a@b.com',
];
foreach ($verbatim as $what => $term) {
    check("$what is passed through byte for byte", args_for($term)['s'] ?? null, $term);
}

// A valid mobile is the case the old code intercepted. It must now be an
// ordinary substring search like everything else.
$mobile = args_for('01771160171');
check('a valid mobile is NOT turned into an exact lookup',
      [$mobile['s'] ?? null, $mobile['search_filter'] ?? null, array_key_exists('billing_phone', $mobile)],
      ['01771160171', 'all', false]);

// ---- surrounding whitespace is not part of the term ----------------------
check('a term is trimmed', args_for('  5089  ')['s'] ?? null, '5089');

// This function does not touch inner spacing. Note it is not the last word on
// the subject: WordPress runs sanitize_text_field() on the param first, and
// that collapses runs of spaces, so a double space never reaches here in
// production. Asserted as the function's own behaviour, not as the endpoint's.
check('inner spacing is not altered by this function',
      args_for('farida  yasmin')['s'] ?? null, 'farida  yasmin');

// ---- empty is not short --------------------------------------------------
foreach (['' => 'an empty term', '   ' => 'whitespace only'] as $term => $what) {
    $args = args_for($term);
    check("$what adds no search at all", is_wp_error($args), false);
    check("$what leaves the args untouched", $args, ['limit' => 20, 'page' => 1]);
}

// ---- the minimum ---------------------------------------------------------
foreach (['0', '01', 'অ', 'অব'] as $short) {
    $args = args_for($short);
    check("\"$short\" is rejected as too short", is_wp_error($args), true);
    check("\"$short\" uses the same code as /products",
          is_wp_error($args) ? $args->get_error_code() : null, 'aioc_search_too_short');
    check("\"$short\" is a 400",
          is_wp_error($args) ? ($args->data['status'] ?? null) : null, 400);
}

// The minimum counts CHARACTERS, not bytes. A 3-character Bengali term is 9
// bytes; strlen() would have let it through while rejecting nothing, and a
// 2-character one is 6 bytes, which strlen() would have WRONGLY accepted.
check('three Bengali characters are long enough', is_wp_error(args_for('ঢাকা')), false);
check('two are not', is_wp_error(args_for('অব')), true);
check('the minimum is measured in characters, not bytes',
      mb_strlen('অব') < AIOC_SEARCH_MIN_LENGTH && strlen('অব') >= AIOC_SEARCH_MIN_LENGTH,
      true);

// ---- exactly at the boundary --------------------------------------------
foreach (['873', 'abc', 'ঢাকা'] as $boundary) {
    check("\"$boundary\" at the minimum is accepted",
          is_wp_error(args_for($boundary)) ? 'rejected' : args_for($boundary)['s'], $boundary);
}

// ---- report --------------------------------------------------------------
$failed = 0;
foreach ($results as $r) {
    if (!$r['pass']) {
        $failed++;
        printf(
            "FAIL  %s\n        expected %s, got %s\n",
            $r['name'],
            json_encode($r['expected'], JSON_UNESCAPED_UNICODE),
            json_encode($r['actual'], JSON_UNESCAPED_UNICODE)
        );
    } else {
        printf("PASS  %s\n", $r['name']);
    }
}

printf("\n%d/%d passed\n", count($results) - $failed, count($results));
exit($failed === 0 ? 0 : 1);
