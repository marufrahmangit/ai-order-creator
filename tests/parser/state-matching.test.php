<?php
/**
 * District matching, run against the REAL parser under a real PHP.
 *
 *   php -d extension=mbstring tests/parser/state-matching.test.php
 *
 * `npm test` in app/ runs this too when it can find a PHP - see
 * app/test/run-all.mjs - and says SKIPPED, loudly, when it cannot.
 *
 * Only the handful of WordPress and WooCommerce functions the parser touches
 * are stubbed; WooCommerce's own 64-row BD state list is a fixture, extracted
 * as data from i18n/states.php. Everything else is the plugin's code.
 *
 * It pins BOTH directions of the 7.2 fuzzy-matching change, because each is
 * the obvious way to break the other:
 *
 *   - places written WITHOUT their district resolve to NO district, never to
 *     a wrong one - "Kishore" used to become Jashore, "Sreepur" Sherpur,
 *     "Kaliganj" Habiganj, "Shibpur" Sherpur. A wrong district is worse than
 *     none: an empty one is visible in the app's dropdown and gets filled,
 *     a wrong one looks normal and is saved at the wrong shipping rate.
 *   - real misspellings of district names still resolve, which is what the
 *     fuzzy pass exists for.
 *
 * Tightening the allowance further would break the second list; loosening it
 * would bring back the first.
 */

define('ABSPATH', __DIR__ . '/');
define('AIOC_PATH', dirname(__DIR__, 2) . '/');

if (!extension_loaded('mbstring')) {
    fwrite(STDERR, "mbstring is not loaded, and the parser needs it. Run with -d extension=mbstring.\n");
    exit(2);
}

function __($s, $d = null) { return $s; }
function get_option($k, $d = false) { return $d; }
function ai_log(...$a) {}
// shipping.php registers its wp-admin hooks when loaded; nothing here fires them.
function add_action(...$a) {}
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }

/*
 * Stands in for the Groq fallback, and always answers with a district the test
 * messages never mention. groq-client.php is NOT loaded, so these are the only
 * definitions - the real ones need network and a key.
 *
 * $GLOBALS['aioc_test_groq_calls'] counts invocations, which is how the suite
 * asserts that a missing district no longer triggers an API call at all.
 */
$GLOBALS['aioc_test_groq_calls'] = 0;
function ai_call_groq($text, array $hints = []) {
    $GLOBALS['aioc_test_groq_calls']++;
    return ['text' => json_encode([
        'name'           => $hints['name'] ?: 'AI Invented Name',
        'phone'          => $hints['phone'] ?: '01700000000',
        'address_line_1' => $hints['address_line_1'] ?: 'AI invented address',
        'state'          => 'Chandpur',
        'customer_note'  => '',
    ], JSON_UNESCAPED_UNICODE)];
}
function ai_parse_response($raw) { return json_decode($raw, true); }

$GLOBALS['aioc_bd_states'] = json_decode(file_get_contents(__DIR__ . '/fixtures/bd-states.json'), true)['states'];

class AiocTestCountries {
    public function get_states($country) { return $country === 'BD' ? $GLOBALS['aioc_bd_states'] : []; }
}
class AiocTestWC {
    public $countries;
    public function __construct() { $this->countries = new AiocTestCountries(); }
}
function WC() { static $wc; return $wc ??= new AiocTestWC(); }

foreach (['text-utils', 'phone', 'location', 'name', 'address', 'parser'] as $file) {
    require AIOC_PATH . "includes/parsing/$file.php";
}
require AIOC_PATH . 'includes/orders/shipping.php';

$results = [];
function check($name, $actual, $expected) {
    $GLOBALS['results'][] = [$name, $actual === $expected, $actual, $expected];
}

/** What the order would be charged for shipping, as the plugin computes it. */
function shipping_for($state_name) {
    $code = ai_match_state_code($state_name);
    return $code === '' ? null : number_format(ai_get_shipping_rate($code)['cost'] ?? 0, 2, '.', '');
}

// ---- places written without their district: NO district, never a wrong one ----
foreach ([
    'Kishore'          => 'used to fuzzy-match jashore at 2 edits',
    'House 5, Kishore' => 'the same, inside an address',
    'Sreepur'          => 'used to match sherpur; Sreepur is in Gazipur AND Magura',
    'Sreepur bazar'    => 'the same',
    'Kaliganj'         => 'used to match habiganj; Kaliganj is in four districts',
] as $text => $why) {
    check("\"$text\" resolves to no district ($why)", ai_extract_state_from_text($text), '');
}

// Shibpur is unambiguous - an upazila of Narsingdi - so it is an exact alias.
check('"Shibpur" resolves to Narsingdi, not Sherpur', ai_extract_state_from_text('Shibpur'), 'Narsingdi');

// ---- Kishore as a NAME --------------------------------------------------------
// With no "District:" label the whole message is scanned, name line included.
{
    $r = ai_build_deterministic_parse("Kishore Ahmed\n01712345678\nHouse 5, Sreepur bazar");
    check('a customer named Kishore, address with no district: no district', $r['state'], '');
    check('and the name is still the name', $r['name'], 'Kishore Ahmed');

    $r = ai_build_deterministic_parse("Kishore Ahmed\n01712345678\nRoad 3, Mirpur, Dhaka");
    check('a customer named Kishore in Dhaka is in Dhaka', $r['state'], 'Dhaka');
}

// ---- real misspellings still resolve -------------------------------------------
// Three of these became exact aliases in 7.2: gazipore and tangile, which the
// tighter allowance stopped reaching, and naraingonj, which no allowance ever
// reached. The other 22 are decided by the fuzzy pass itself.
$misspellings = [
    'jassore' => 'Jashore', 'jessor' => 'Jashore', 'josshore' => 'Jashore',
    'chitagong' => 'Chattogram', 'chottogram' => 'Chattogram', 'comila' => 'Cumilla',
    'narayangonj' => 'Narayanganj', 'naraingonj' => 'Narayanganj', 'bramanbaria' => 'Brahmanbaria',
    'moulovibazar' => 'Moulvibazar', 'kustia' => 'Kushtia', 'rajshai' => 'Rajshahi',
    'silhet' => 'Sylhet', 'moymonsingh' => 'Mymensingh', 'gazipore' => 'Gazipur',
    'tangile' => 'Tangail', 'foridpur' => 'Faridpur', 'pabana' => 'Pabna',
    'rongpur' => 'Rangpur', 'norsingdi' => 'Narsingdi', 'kishorgonj' => 'Kishoreganj',
    'gopalgonj' => 'Gopalganj', 'sirajgonj' => 'Sirajganj', 'munsiganj' => 'Munshiganj',
    'manikgonj' => 'Manikganj',
];
check('there are 25 real misspellings under test', count($misspellings), 25);
foreach ($misspellings as $text => $district) {
    check("misspelling \"$text\" still resolves to $district", ai_extract_state_from_text($text), $district);
}

// Spellings that were always exact aliases. Not a test of the fuzzy pass - a
// guard that tightening it cannot touch them.
foreach (['jessore' => 'Jashore', 'joshore' => 'Jashore', 'jeshore' => 'Jashore', 'jesore' => 'Jashore'] as $text => $district) {
    check("exact alias \"$text\" -> $district", ai_extract_state_from_text($text), $district);
}

// ---- the full-name cases verified on LIVE at 7.1 keep their results -------------
foreach ([
    ['Kishoreganj Sadar, Kishoreganj', 'Kishoreganj', 'BD-26', '150.00'],
    ['Sreepur, Gazipur', 'Gazipur', 'BD-18', '120.00'],
] as [$text, $district, $code, $rate]) {
    $state = ai_extract_state_from_text($text);
    check("\"$text\" -> $district", $state, $district);
    check("\"$text\" -> $code", ai_match_state_code($state), $code);
    check("\"$text\" -> $rate shipping", shipping_for($state), $rate);
}

// ---- the standing hazard: district names already within each other's reach -----
// Each of these is close enough to another district's name that only an exact
// alias keeps it right. Pinned so a change to the fuzzy pass or the alias order
// that disturbs one is caught.
foreach (['azimpur' => 'Dhaka', 'gazipur' => 'Gazipur', 'meherpur' => 'Meherpur', 'sherpur' => 'Sherpur',
          'mohakhali' => 'Dhaka', 'noakhali' => 'Noakhali', 'bogra' => 'Bogura', 'boyra' => 'Khulna'] as $text => $district) {
    check("near-neighbour \"$text\" stays $district", ai_extract_state_from_text($text), $district);
}

// ---- every alias must resolve to a real STATE CODE, not just a name -----------
//
// The guard that was missing. bd-locations.php maps a spelling to a district
// NAME, and ai_match_state_code() then has to find that name in WooCommerce's
// own BD list. Four values did not exist in that list - 'Netrokona',
// 'Jhalokathi', 'Chapainawabganj' and a "Cox''s Bazar" with a doubled
// apostrophe - so nine aliases between them resolved to a name and NO code.
//
// That fails silently in the worst direction. The parse preview shows a
// district, the order saves with an empty state, and ai_apply_shipping() prices
// nothing because it has no state to price - so the order goes out with no
// shipping line at all. Nothing about it looks wrong until the money is short.
//
// Asserted over the whole file rather than per district, so a new alias cannot
// be added with a plausible-looking value that WooCommerce does not use.
// Compared against the LABEL LIST directly, not through
// ai_match_state_code(). That function has a second pass which re-runs the
// alias search on its own argument, so a bad value gets rescued whenever some
// other alias happens to point at the right district - which is precisely how
// four of these survived. The invariant is that the value IS a label, so that
// is what gets asserted.
$manual_aliases = require AIOC_PATH . 'includes/parsing/data/bd-locations.php';
$wc_labels = array_map(
    fn($label) => strtolower(trim(ai_normalize_apostrophes($label))),
    array_values(WC()->countries->get_states('BD'))
);
$unmatched = [];
foreach ($manual_aliases as $alias => $target) {
    $normalized = strtolower(trim(ai_normalize_apostrophes((string) $target)));
    if (!in_array($normalized, $wc_labels, true)) {
        $unmatched[] = "$alias => $target";
    }
}
check('every VALUE in bd-locations.php is a WooCommerce BD label', $unmatched, []);

// And end to end, which is what actually matters: typing the alias gets a code.
$codeless = [];
foreach ($manual_aliases as $alias => $target) {
    $name = ai_extract_state_from_text((string) $alias);
    if ($name === '' || ai_match_state_code($name) === '') {
        $codeless[] = (string) $alias;
    }
}
check('and every alias still gets a code when TYPED', $codeless, []);

// The four that were broken, pinned by name against WooCommerce's spelling -
// none of which is the one you would guess.
foreach ([
    'netrokona'       => 'BD-41',
    'নেত্রকোণা'       => 'BD-41',
    'নেত্রকোনা'       => 'BD-41',
    'নেএকোণা'         => 'BD-41',
    'jhalokathi'      => 'BD-25',
    'ঝালকাঠি'         => 'BD-25',
    'chapainawabganj' => 'BD-45',
    'চাঁপাইনবাবগঞ্জ'  => 'BD-45',
    "cox''s bazar"    => 'BD-11',
    "cox's bazar"     => 'BD-11',
] as $text => $code) {
    check("\"$text\" resolves to $code", ai_match_state_code(ai_extract_state_from_text($text)), $code);
}

// The live order that found this: a misspelling with the ত্র ligature dropped.
// It used to resolve to nothing, which sent the parser to Groq, which guessed
// Chandpur - a different district entirely, at the same flat rate by luck.
check('the live misspelling resolves to Netrakona',
      ai_extract_state_from_text('বাঁশরী সরকারি প্রাথমিক বিদ্যালয়,বাঁশরী,মদন,নেএকোণা।'),
      'Netrakona');
check('and the whole message needs no AI, so nothing can guess a district',
      ai_should_call_ai(ai_build_deterministic_parse(
          "Mahadi Mahabin মনি 
০১৭৭০০৯০০৩৫
বাঁশরী সরকারি প্রাথমিক বিদ্যালয়,বাঁশরী,মদন,নেএকোণা।"
      )),
      false);

// ---- 7.5: the district comes from the TEXT, or from nowhere -------------------
//
// The AI fallback used to supply it whenever the matcher found none, and its
// answer was "validated" by running the matcher over the ANSWER - which only
// asks "is this a real district?", and Groq returns real districts. A live
// order ending "নেএকোণা" came back as Chandpur: a genuine district, nobody's
// district, appended to the address and priced as if typed.
//
// ai_call_groq() is stubbed above to always answer Chandpur, so any of these
// returning Chandpur means the guard is gone.
function parsed_state($text) {
    $result = ai_get_parsed_order_data($text);
    return $result['data']['state'] ?? '';
}

foreach ([
    'an unmapped upazila'   => "Rahim
01711111111
বাঁশরী স্কুল, মদন",
    'a deliberately ambiguous name' => "Rahim
01711111111
বাজার রোড, শ্রীপুর",
    'no district at all'    => "Rahim
01711111111
House 4, Road 2",
    'an English upazila'    => "Rahim
01711111111
Madan bazar road",
] as $what => $text) {
    check("$what gets NO district rather than the AI's guess", parsed_state($text), '');
}

/*
 * Groq is still called when it can genuinely help - a message with no address -
 * and its district has to be discarded then too.
 *
 * These are two separate assertions on purpose. The 7.5 change has two halves
 * that each independently stop the reported bug, so a single combined check
 * would pass with one of them reverted and name the wrong cause:
 *
 *   - state is no longer a reason to CALL the AI, so a complete message naming
 *     no district never asks it. That alone covers the live order.
 *   - the AI's state is discarded even when it IS called. That is the half that
 *     only this case can reach.
 */
$GLOBALS['aioc_test_groq_calls'] = 0;
$bare_phone_state = parsed_state('01711111111');
check('a bare phone still reaches the AI, which is the point of the fallback',
      $GLOBALS['aioc_test_groq_calls'] > 0, true);
check("and the AI's district is discarded even when it IS called",
      $bare_phone_state, '');

// And the saving: a complete message naming no district must not call the API
// merely to have its answer thrown away.
$GLOBALS['aioc_test_groq_calls'] = 0;
parsed_state("Rahim
01711111111
বাঁশরী স্কুল, মদন");
check('a missing district alone does not call the AI', $GLOBALS['aioc_test_groq_calls'], 0);
check('and state is not one of the conditions for calling it',
      ai_should_call_ai(['name' => 'A', 'phone' => '01711111111', 'address_line_1' => 'X', 'state' => '']),
      false);
check('while a missing address still is',
      ai_should_call_ai(['name' => 'A', 'phone' => '01711111111', 'address_line_1' => '', 'state' => 'Dhaka']),
      true);

// A district the text DOES name is unaffected - that is the whole point.
foreach ([
    "Mahadi
01711111111
বাঁশরী বিদ্যালয়,বাঁশরী,মদন,নেএকোণা।" => 'Netrakona',
    "Rahim
01711111111
মদন, নেত্রকোণা"                        => 'Netrakona',
    "Rahim
01711111111
মিরপুর, ঢাকা"                          => 'Dhaka',
    "Rahim
01711111111
টঙ্গী বাজার"                            => 'Gazipur',
    "Rahim
01711111111
House 4
District: Gazipur"            => 'Gazipur',
] as $text => $district) {
    check("a district in the message still resolves ($district)", parsed_state($text), $district);
}

// The admin create tab writes the order with no review step, so it must refuse
// rather than create one with no district and therefore no shipping. Asserted
// structurally - it produces HTML and needs WordPress to run.
$creator = file_get_contents(AIOC_PATH . 'admin/views/creator-result.php');
check('the admin create path resolves the district BEFORE writing',
      strpos($creator, '$state_code = ai_match_state_code') < strpos($creator, '$result = ai_create_order_from_data'),
      true);
check('and refuses when there is none',
      strpos($creator, "if (\$state_code === '') {") !== false
      && strpos($creator, 'No order created.') !== false,
      true);

$failed = 0;
foreach ($results as [$name, $pass, $actual, $expected]) {
    if (!$pass) $failed++;
    echo ($pass ? 'PASS' : 'FAIL') . "  $name" .
        ($pass ? '' : "\n        expected " . json_encode($expected) . ', got ' . json_encode($actual)) . "\n";
}
echo "\n" . (count($results) - $failed) . '/' . count($results) . " passed\n";
exit($failed === 0 ? 0 : 1);
