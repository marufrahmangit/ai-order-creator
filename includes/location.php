<?php
if (!defined('ABSPATH')) exit;

function ai_get_state_aliases() {
    static $aliases = null;

    if ($aliases !== null) {
        return $aliases;
    }

    $aliases = [];
    $states = function_exists('WC') && WC() ? WC()->countries->get_states('BD') : [];

    foreach ($states as $code => $name) {
        $aliases[strtolower($name)] = $name;
    }

    $manual = require AIOC_PATH . 'data/bd-locations.php';

    foreach ($manual as $alias => $name) {
        $aliases[strtolower(trim($alias))] = $name;
    }

    return $aliases;
}

function ai_extract_state_from_text($text) {
    $haystack = mb_strtolower(ai_normalize_text($text), 'UTF-8');
    $aliases  = ai_get_state_aliases();

    // Exact substring match first (fast path).
    foreach ($aliases as $alias => $state_name) {
        if ($alias !== '' && mb_strpos($haystack, $alias) !== false) {
            return $state_name;
        }
    }

    // Fuzzy word match as fallback for ASCII district names (handles
    // alternate romanizations like jesore/jeshore/joshore for Jashore).
    $words = preg_split('/[\s,;\n]+/u', $haystack, -1, PREG_SPLIT_NO_EMPTY);
    foreach ($words as $word) {
        if (mb_strlen($word, 'UTF-8') < 5) {
            continue;
        }

        $best_name = '';
        $best_dist = PHP_INT_MAX;

        foreach ($aliases as $alias => $state_name) {
            // Only fuzzy-match ASCII aliases; Bangla requires exact match.
            if (!preg_match('/^[a-z\'. ]+$/i', $alias)) {
                continue;
            }
            $alias_len = strlen($alias);
            if ($alias_len < 5) {
                continue;
            }
            // Allow 1 edit for 5–6 char aliases, 2 edits for 7+ char aliases.
            $max_dist = $alias_len >= 7 ? 2 : 1;
            $dist = levenshtein($word, $alias);

            if ($dist <= $max_dist && $dist < $best_dist) {
                $best_dist = $dist;
                $best_name = $state_name;
            }
        }

        if ($best_name !== '') {
            return $best_name;
        }
    }

    return '';
}

function ai_normalize_apostrophes($value) {
    // Different apostrophe-like characters (curly quotes, backticks, etc.)
    // are common in copy-pasted district names (e.g. "Cox's Bazar") and in
    // whatever WooCommerce's own state list happens to use. Collapse them
    // all to a plain straight apostrophe before comparing.
    return str_replace(["\xE2\x80\x99", "\xE2\x80\x98", '`', '´'], "'", (string) $value);
}

function ai_match_state_code($state_name) {
    if (empty($state_name) || !function_exists('WC') || !WC()) {
        return '';
    }

    $state_name = ai_normalize_apostrophes($state_name);
    $states = WC()->countries->get_states('BD');
    foreach ($states as $code => $name) {
        if (strcasecmp(trim($state_name), trim(ai_normalize_apostrophes($name))) === 0) {
            return $code;
        }
    }

    $canonical = ai_normalize_apostrophes(ai_extract_state_from_text($state_name));
    if ($canonical && strcasecmp($canonical, $state_name) !== 0) {
        foreach ($states as $code => $name) {
            if (strcasecmp(trim($canonical), trim(ai_normalize_apostrophes($name))) === 0) {
                return $code;
            }
        }
    }

    return '';
}

function ai_extract_state_hint_from_text($text) {
    $state = ai_extract_labeled_field($text, ['district', 'state', 'city', 'jela', 'zila', 'জেলা', 'জিলা']);

    if ($state === '') {
        $state = ai_extract_state_from_text($text);
    } else {
        $state = ai_extract_state_from_text($state) ?: $state;
    }

    return ai_clean_line($state);
}

function ai_address_has_state($address, $state) {
    $address = ai_clean_line($address);
    $state = ai_clean_line($state);

    if ($address === '' || $state === '') {
        return false;
    }

    // Only a literal mention of the district name counts as "already has the
    // state". Addresses commonly name a neighbourhood/area that maps to a
    // district (e.g. "Banglamotor" -> Dhaka) without ever saying "Dhaka" —
    // that district name should still get appended to the address text.
    return stripos($address, $state) !== false;
}
