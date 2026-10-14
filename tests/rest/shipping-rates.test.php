<?php
/**
 * Shipping rates as an option: the accessor, the fallback, and the validation
 * that stands between the settings form and the stored table.
 *
 *   php -d extension=mbstring tests/rest/shipping-rates.test.php
 *
 * `npm test` in app/ runs this too when it can find a PHP - see
 * app/test/run-all.mjs - and says SKIPPED, loudly, when it cannot.
 *
 * WHAT MATTERS HERE, in order:
 *
 *   1. /meta's `shipping_rates` shape is UNCHANGED by the move. That is the
 *      whole point: the app reads rates from /meta, so a rate change needs no
 *      app rebuild - but only while the shape holds. A drift here is an app
 *      that silently shows no shipping.
 *   2. A bad or absent option falls back WHOLE to the shipped seed, never to
 *      half a table. Half a table charges the wrong money and looks fine.
 *   3. ai_sanitize_shipping_rates() REJECTS rather than repairs. A rate quietly
 *      coerced to 0, or attached to a district code WooCommerce does not know,
 *      is the 7.4 defect in a new place: plausible, unreachable, wrong.
 *
 * No rate figure is asserted as a literal except in the seed check, which is
 * the one place the seed is the subject. Everything else reads the accessor,
 * so changing a rate in wp-admin cannot fail this suite.
 */

define('ABSPATH', __DIR__ . '/');
define('AIOC_PATH', dirname(__DIR__, 2) . '/');
define('AIOC_SHIPPING_RATES_OPTION', 'ai_shipping_rates');

if (!extension_loaded('mbstring')) {
    fwrite(STDERR, "mbstring is not loaded. Run with -d extension=mbstring.\n");
    exit(2);
}

// ---- just enough WordPress and WooCommerce -------------------------------
$GLOBALS['aioc_options'] = [];
$GLOBALS['aioc_settings_errors'] = [];

function get_option($key, $default = false) {
    return array_key_exists($key, $GLOBALS['aioc_options'])
        ? $GLOBALS['aioc_options'][$key]
        : $default;
}
function add_settings_error($setting, $code, $message, $type = 'error') {
    $GLOBALS['aioc_settings_errors'][] = ['code' => $code, 'message' => $message, 'type' => $type];
}
function ai_log(...$a) {}
function add_action(...$a) {}
function __($s, $d = null) { return $s; }
function wc_get_price_decimals() { return 2; }
function wc_format_decimal($value, $dp = false, $trim = false) {
    if ($dp === false) return (string) $value;
    $out = number_format((float) $value, (int) $dp, '.', '');
    return $trim ? rtrim(rtrim($out, '0'), '.') : $out;
}
function ai_rest_money($value) { return wc_format_decimal($value, wc_get_price_decimals()); }

$GLOBALS['aioc_bd_states'] = json_decode(
    file_get_contents(dirname(__DIR__) . '/parser/fixtures/bd-states.json'), true
)['states'];
class AiocRatesCountries {
    public function get_states($country) { return $country === 'BD' ? $GLOBALS['aioc_bd_states'] : []; }
}
class AiocRatesWC {
    public $countries;
    public function __construct() { $this->countries = new AiocRatesCountries(); }
}
function WC() { static $wc; return $wc ??= new AiocRatesWC(); }

require AIOC_PATH . 'includes/orders/shipping.php';

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

/** Sets the stored option, or removes it when null. */
function store($value) {
    if ($value === null) unset($GLOBALS['aioc_options'][AIOC_SHIPPING_RATES_OPTION]);
    else $GLOBALS['aioc_options'][AIOC_SHIPPING_RATES_OPTION] = $value;
}

/** Runs the sanitize callback and returns [stored_table, first_error_message]. */
function sanitize($submission) {
    $GLOBALS['aioc_settings_errors'] = [];
    $out = ai_sanitize_shipping_rates($submission);
    $err = $GLOBALS['aioc_settings_errors'][0]['message'] ?? null;
    return [$out, $err];
}

/** What GET /meta builds from the table. Mirrors meta.php exactly. */
function meta_shipping_rates() {
    $rates = ai_get_shipping_rates();
    $by_state = [];
    foreach ($rates['by_state'] as $code => $rate) {
        $by_state[(string) $code] = [
            'cost'  => ai_rest_money($rate['cost']),
            'label' => (string) $rate['label'],
        ];
    }
    return [
        'default'  => [
            'cost'  => ai_rest_money($rates['default']['cost']),
            'label' => (string) $rates['default']['label'],
        ],
        'by_state' => $by_state,
    ];
}

// ---- 1. the seed, which is the one place literals belong -----------------
store(null);
$seeded = ai_get_shipping_rates();
check('with no option stored, the shipped seed is in force',
      $seeded, ai_default_shipping_rates());
check('the seed keeps the rates that were in code before 7.7',
      [$seeded['default']['cost'],
       $seeded['by_state']['BD-13']['cost'],
       $seeded['by_state']['BD-18']['cost']],
      [150, 80, 120]);
check('and adds Nawabganj at 120', $seeded['by_state']['BD-45'] ?? null,
      ['cost' => 120, 'label' => 'Nawabganj Flat Rate']);
check('every seeded district code is one WooCommerce knows',
      array_values(array_diff(array_keys($seeded['by_state']), array_keys($GLOBALS['aioc_bd_states']))),
      []);
check('nothing is written to the option just by reading',
      array_key_exists(AIOC_SHIPPING_RATES_OPTION, $GLOBALS['aioc_options']), false);

// ---- 2. /meta's shape, which the app depends on --------------------------
store(null);
$meta = meta_shipping_rates();
check('/meta still has exactly default and by_state',
      array_keys($meta), ['default', 'by_state']);
check('/meta default still has exactly cost and label',
      array_keys($meta['default']), ['cost', 'label']);
check('/meta costs are 2dp numeric STRINGS, not numbers',
      [$meta['default']['cost'], $meta['by_state']['BD-13']['cost']], ['150.00', '80.00']);
check('every by_state cost is a 2dp string',
      array_values(array_unique(array_map(
          fn($r) => (bool) preg_match('/^\d+\.\d{2}$/', $r['cost']), $meta['by_state']))),
      [true]);

// The same holds for an ADMIN-EDITED table, including a fractional cost.
store(['default'  => ['cost' => 200, 'label' => 'Nationwide'],
       'by_state' => ['BD-13' => ['cost' => 60.5, 'label' => 'Dhaka City']]]);
$meta = meta_shipping_rates();
check('an edited table serves the edited figures',
      [$meta['default']['cost'], $meta['by_state']['BD-13']['cost']], ['200.00', '60.50']);
check('and keeps the same shape', array_keys($meta), ['default', 'by_state']);
check('a district dropped from the table falls to the default',
      ai_get_shipping_rate('BD-18'), ['cost' => 200.0, 'label' => 'Nationwide']);

// ---- 3. the rule 7.0 settled, which the option must not blur -------------
store(null);
check("an unmatched district gets the DEFAULT rate",
      ai_get_shipping_rate('BD-26')['label'], $seeded['default']['label']);
check('and so does an unrecognized code', ai_get_shipping_rate('nonsense')['cost'],
      $seeded['default']['cost']);
// ai_get_shipping_rate('') also returns the default, but ai_apply_shipping()
// never asks it - it adds no line at all for an empty state. That asymmetry is
// pinned in state-matching.test.php and documented on the function.
check("an empty code still returns the default from the ACCESSOR",
      ai_get_shipping_rate('')['cost'], $seeded['default']['cost']);
check('ai_apply_shipping still returns early on an empty state, adding no line',
      strpos(file_get_contents(AIOC_PATH . 'includes/orders/shipping.php'),
             'if (empty($state_code))') !== false, false);
check('the removal is still unconditional and before the add',
      strpos(file_get_contents(AIOC_PATH . 'includes/orders/shipping.php'), "foreach (\$order->get_items('shipping')")
      < strpos(file_get_contents(AIOC_PATH . 'includes/orders/shipping.php'), 'if (!empty($state_code))'),
      true);

// ---- 4. a bad option falls back WHOLE ------------------------------------
foreach ([
    'a string'                  => 'garbage',
    'an integer'                => 7,
    'an empty array'            => [],
    'no default key'            => ['by_state' => ['BD-13' => ['cost' => 10, 'label' => 'x']]],
    'a non-numeric default'     => ['default' => ['cost' => 'abc', 'label' => 'x']],
    'a default that is not an array' => ['default' => 'nope'],
] as $what => $bad) {
    store($bad);
    check("$what falls back to the whole seed", ai_get_shipping_rates(), ai_default_shipping_rates());
}

// A row with an unusable cost is DROPPED, so that district falls to the
// default - a sane figure - rather than being stored at zero, which would
// charge nothing and look deliberate.
store(['default'  => ['cost' => 150, 'label' => 'Outside Dhaka Flat Rate'],
       'by_state' => ['BD-13' => ['cost' => 80, 'label' => 'Dhaka'],
                      'BD-18' => ['cost' => 'oops', 'label' => 'Gazipur']]]);
$partial = ai_get_shipping_rates();
check('a row with a bad cost is dropped, not zeroed', array_keys($partial['by_state']), ['BD-13']);
check('and that district falls back to the default rate',
      ai_get_shipping_rate('BD-18')['cost'], 150.0);

// ---- 5. the sanitize callback: what it accepts ---------------------------
store(ai_default_shipping_rates());

[$saved, $err] = sanitize([
    'default'  => ['cost' => '150', 'label' => 'Outside Dhaka Flat Rate'],
    'by_state' => [
        ['code' => 'BD-13', 'cost' => '80',  'label' => 'Dhaka Flat Rate'],
        ['code' => 'BD-45', 'cost' => '120', 'label' => 'Nawabganj Flat Rate'],
    ],
]);
check('a good submission saves', $err, null);
check('keyed on the district code, not the row index',
      array_keys($saved['by_state']), ['BD-13', 'BD-45']);
check('costs stored as numbers', $saved['by_state']['BD-13']['cost'], 80.0);
check('a fractional cost survives',
      sanitize(['default' => ['cost' => '99.50', 'label' => 'D'], 'by_state' => []])[0]['default']['cost'],
      99.5);
check('zero is a legitimate cost - free delivery is a real offer',
      sanitize(['default' => ['cost' => '0', 'label' => 'Free'], 'by_state' => []])[1], null);
check('a blank row left behind by "Add rate" is dropped, not rejected',
      sanitize(['default' => ['cost' => '150', 'label' => 'D'],
                'by_state' => [['code' => '', 'cost' => '', 'label' => '']]]),
      [['default' => ['cost' => 150.0, 'label' => 'D'], 'by_state' => []], null]);
check('whitespace around values is trimmed',
      sanitize(['default' => ['cost' => ' 150 ', 'label' => '  Outside  '], 'by_state' => []])[0]['default'],
      ['cost' => 150.0, 'label' => 'Outside']);

// ---- 6. the sanitize callback: what it REFUSES ---------------------------
$before = ai_get_shipping_rates();

foreach ([
    'a non-numeric default cost' => [
        ['default' => ['cost' => 'abc', 'label' => 'D'], 'by_state' => []], 'number'],
    'a negative default cost' => [
        ['default' => ['cost' => '-5', 'label' => 'D'], 'by_state' => []], 'negative'],
    'an empty default label' => [
        ['default' => ['cost' => '150', 'label' => ''], 'by_state' => []], 'label'],
    'a district code WooCommerce does not know' => [
        ['default' => ['cost' => '150', 'label' => 'D'],
         'by_state' => [['code' => 'BD-99', 'cost' => '80', 'label' => 'X']]], 'not a Bangladesh district'],
    'the same district twice' => [
        ['default' => ['cost' => '150', 'label' => 'D'],
         'by_state' => [['code' => 'BD-13', 'cost' => '80', 'label' => 'A'],
                        ['code' => 'BD-13', 'cost' => '90', 'label' => 'B']]], 'twice'],
    'a non-numeric row cost' => [
        ['default' => ['cost' => '150', 'label' => 'D'],
         'by_state' => [['code' => 'BD-13', 'cost' => 'free', 'label' => 'X']]], 'number'],
    'a negative row cost' => [
        ['default' => ['cost' => '150', 'label' => 'D'],
         'by_state' => [['code' => 'BD-13', 'cost' => '-1', 'label' => 'X']]], 'negative'],
    'an empty row label' => [
        ['default' => ['cost' => '150', 'label' => 'D'],
         'by_state' => [['code' => 'BD-13', 'cost' => '80', 'label' => '  ']]], 'label'],
    'a row with no district chosen' => [
        ['default' => ['cost' => '150', 'label' => 'D'],
         'by_state' => [['code' => '', 'cost' => '80', 'label' => 'X']]], 'needs a district'],
    'nothing usable at all' => ['not an array', 'nothing usable'],
] as $what => [$submission, $expected_fragment]) {
    [$out, $err] = sanitize($submission);
    check("REFUSED: $what", $err !== null, true);
    check("  ... and says why ($expected_fragment)",
          $err !== null && stripos($err, $expected_fragment) !== false, true);
    check('  ... and keeps the stored table untouched', $out, $before);
}

// A refusal must name the DISTRICT, not the row number: the person reading it
// is looking at a table of district names, not at indexes.
[, $err] = sanitize(['default' => ['cost' => '150', 'label' => 'D'],
                     'by_state' => [['code' => 'BD-13', 'cost' => 'x', 'label' => 'X']]]);
check('a refusal names the district, not a row number',
      $err !== null && strpos($err, trim((string) $GLOBALS['aioc_bd_states']['BD-13'])) !== false, true);

// ---- 7. nothing hardcodes a rate any more --------------------------------
$shipping_src = file_get_contents(AIOC_PATH . 'includes/orders/shipping.php');
$seed_block = substr($shipping_src,
    strpos($shipping_src, 'function ai_default_shipping_rates'),
    strpos($shipping_src, 'function ai_normalize_shipping_rates') - strpos($shipping_src, 'function ai_default_shipping_rates'));
$rest = str_replace($seed_block, '', $shipping_src);
check('the only rate figures in shipping.php are in the seed',
      (bool) preg_match('/\'cost\'\s*=>\s*\d/', $rest), false);

$meta_src = file_get_contents(AIOC_PATH . 'includes/rest/routes/meta.php');
check('meta.php states no rate of its own',
      (bool) preg_match('/\b(80|120|150)\b/', $meta_src), false);
check('and derives the table from the accessor',
      strpos($meta_src, 'ai_get_shipping_rates()') !== false, true);

// ---- report --------------------------------------------------------------
$failed = 0;
foreach ($results as $r) {
    if (!$r['pass']) {
        $failed++;
        printf("FAIL  %s\n        expected %s, got %s\n", $r['name'],
            json_encode($r['expected'], JSON_UNESCAPED_UNICODE),
            json_encode($r['actual'], JSON_UNESCAPED_UNICODE));
    } else {
        printf("PASS  %s\n", $r['name']);
    }
}
printf("\n%d/%d passed\n", count($results) - $failed, count($results));
exit($failed === 0 ? 0 : 1);
