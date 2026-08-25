<?php
/*
Plugin Name: AI Order Creator
Description: Create WooCommerce orders from messy text using Groq AI.
Version: 4.6
Updated: 2026-08-25
Author: Maruf Rahman
Changelog: 4.6 - Added "টাংগাইল" (Tangail), "রাঙ্গামাটি" (Rangamati), and "চুয়াডাংগা" (Chuadanga) as alternate spellings in the state/district list — Bengali's ঙ্গ-conjunct-vs-ং-anusvara spelling variance meant these districts weren't being detected under their commonly-typed alternate spelling.
4.5 - Stopped treating a bare "location" as the address-wrapper label (it was matching inside compound sub-labels like "Location & Postal Code:" and discarding every address line before it); allowed a space/dash between the 2nd and 3rd phone digits (the one remaining rigid digit boundary in the phone regex) so numbers grouped like "০১ ৯১১ ৪৯৪৮৫১" are recognized and stripped from the address instead of leaking through or failing to extract at all.
4.4 - Recognized "M#"/"Mob#"/"Cell#"/"Ph#" as phone-label shorthand, fixing a latent bug where a label ending in punctuation (e.g. "num.", "m#") with nothing left after it could never match its trailing boundary check; normalized "P,O"/"P,S" (Post Office/Police Station shorthand) and runs of underscores used as a colon substitute so labels like "Dist__Rajshahi"/"Phone__..." are recognized instead of leaking into the address; added "district"/"dist"/"state" as strippable address labels.
4.3 - Recognized "Add"/"Add:" as an address label and "Num"/"Num:" as a phone label so they no longer leak into the address as leftover junk; added "Babu Bazar" to the Dhaka locality list.
4.2 - Recognized "Cell/Cell No/Cell Number" as a phone label; stripped the "আমি থাকি" address preamble and "আমার ফোন/মোবাইল/নাম্বার/নম্বর" filler so they no longer leak into the address; added "Mohammadia" to the Dhaka locality list; fixed the phone regex to consume "+880" even when a space separates it from the rest of the number (e.g. "+880 19 2362 1274"), so it no longer gets left behind in the address.
4.1 - Removed price detection entirely (deterministic and AI): it never appears in the input and was misreading hyphen-attached address numbers (e.g. "-১০৭৯") as prices, corrupting the address in the process.
4.0 - Fixed address parsing: leftover label junk (e.g. "নাম্বারঃ", "থানাঃ") no longer leaks into the address, numbered list markers ("1.", "2.") no longer get captured as field values, and multi-line address labels (e.g. "ঠিকানা") now capture all continuation lines instead of just the first.
3.9 - Split single-file plugin into a multi-file structure (mechanical refactor, no logic changes).
*/

if (!defined('ABSPATH')) exit;

define('AIOC_PATH', plugin_dir_path(__FILE__));
define('AIOC_URL', plugin_dir_url(__FILE__));

require_once AIOC_PATH . 'includes/logging.php';
require_once AIOC_PATH . 'includes/text-utils.php';
require_once AIOC_PATH . 'includes/phone.php';
require_once AIOC_PATH . 'includes/location.php';
require_once AIOC_PATH . 'includes/address.php';
require_once AIOC_PATH . 'includes/name.php';
require_once AIOC_PATH . 'includes/parser.php';
require_once AIOC_PATH . 'includes/groq-client.php';
require_once AIOC_PATH . 'includes/order-creator.php';
require_once AIOC_PATH . 'includes/ajax.php';
require_once AIOC_PATH . 'admin/menu.php';
require_once AIOC_PATH . 'admin/views/settings-tab.php';
require_once AIOC_PATH . 'admin/views/creator-tab.php';
require_once AIOC_PATH . 'admin/views/parse-preview.php';
