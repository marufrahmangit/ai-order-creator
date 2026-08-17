<?php
/*
Plugin Name: AI Order Creator
Description: Create WooCommerce orders from messy text using Groq AI.
Version: 4.0
Updated: 2026-08-17
Author: Maruf Rahman
Changelog: 4.0 - Fixed address parsing: leftover label junk (e.g. "নাম্বারঃ", "থানাঃ") no longer leaks into the address, numbered list markers ("1.", "2.") no longer get captured as field values, and multi-line address labels (e.g. "ঠিকানা") now capture all continuation lines instead of just the first.
3.9 - Split single-file plugin into a multi-file structure (mechanical refactor, no logic changes).
*/

if (!defined('ABSPATH')) exit;

define('AIOC_PATH', plugin_dir_path(__FILE__));
define('AIOC_URL', plugin_dir_url(__FILE__));

require_once AIOC_PATH . 'includes/logging.php';
require_once AIOC_PATH . 'includes/text-utils.php';
require_once AIOC_PATH . 'includes/phone.php';
require_once AIOC_PATH . 'includes/price.php';
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
