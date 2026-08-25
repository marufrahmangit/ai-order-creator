<?php
if (!defined('ABSPATH')) exit;

function ai_extract_phone_candidates($text) {
    $text = ai_convert_bangla_digits($text);
    preg_match_all('/(?:\+?88[\s\-]*)?(?:0?[\s\-]*1[\s\-]*[3-9](?:[\s\-]*\d){8})\b/', $text, $matches);
    $phones = [];

    foreach ($matches[0] as $match) {
        $digits = preg_replace('/\D+/', '', $match);

        if (strpos($digits, '8801') === 0) {
            $digits = '0' . substr($digits, 3);
        } elseif (strpos($digits, '801') === 0) {
            $digits = '0' . substr($digits, 2);
        } elseif (strlen($digits) === 10 && strpos($digits, '1') === 0) {
            $digits = '0' . $digits;
        }

        if (preg_match('/^01[3-9]\d{8}$/', $digits)) {
            $phones[] = $digits;
        }
    }

    return array_values(array_unique($phones));
}

function ai_extract_phone_like_candidates($text) {
    $text = ai_convert_bangla_digits($text);
    preg_match_all('/(?:\+?88[\s\-]*)?(?:0?[\s\-]*1[\s\-]*[3-9](?:[\s\-]*\d){7,8})\b/', $text, $matches);
    $phones = [];

    foreach ($matches[0] as $match) {
        $digits = preg_replace('/\D+/', '', $match);

        if (strpos($digits, '8801') === 0) {
            $digits = '0' . substr($digits, 3);
        } elseif (strpos($digits, '801') === 0) {
            $digits = '0' . substr($digits, 2);
        } elseif (strlen($digits) === 10 && strpos($digits, '1') === 0) {
            $digits = '0' . $digits;
        }

        if (preg_match('/^01[3-9]\d{7,8}$/', $digits)) {
            $phones[] = $digits;
        }
    }

    return array_values(array_unique($phones));
}

function ai_strip_phone_values_from_text($text, array $known_phones = []) {
    // Remove phone-like substrings as they actually appear in the text (raw
    // spaces/dashes and all, e.g. "0179437-4078") rather than only the
    // normalized digit string — a normalized phone like "01794374078" often
    // never occurs verbatim once the source had internal separators, so a
    // literal-string removal of it would silently no-op and leave the raw
    // phone text behind.
    $text = preg_replace('/(?:\+?88[\s\-]*)?(?:0?[\s\-]*1[\s\-]*[3-9](?:[\s\-]*\d){7,8})\b/', ' ', (string) $text);

    foreach (array_unique($known_phones) as $phone) {
        $text = ai_remove_value_all($text, $phone);
    }

    return ai_clean_line(preg_replace('/\s{2,}/u', ' ', (string) $text));
}
