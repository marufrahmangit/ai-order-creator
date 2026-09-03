<?php
if (!defined('ABSPATH')) exit;

function ai_is_probable_name_line($line) {
    $line = ai_clean_line($line);
    if ($line === '') {
        return false;
    }

    if (ai_is_noise_line($line)) {
        return false;
    }

    if (preg_match('/\d/', $line)) {
        return false;
    }

    if (preg_match('/\b(?:road|rd|house|flat|lane|area|sector|block|bazar|district|thana|upazila|union|para|sarani|zone)\b/iu', $line)) {
        return false;
    }

    // Boundary excludes actual letters/vowel-signs/digits (U+0985-U+09FE), not
    // the leading diacritics U+0980-U+0984 (candrabindu/anusvara/visarga) - a
    // label like "থানাঃ" must still be recognized even with "ঃ" glued to it.
    if (preg_match('/(?<![\x{0985}-\x{09FE}])(?:রোড|বাড়ি|বাসা|ফ্ল্যাট|এলাকা|থানা|জেলা|ইউনিয়ন|পাড়া|সেক্টর|ব্লক|জোন)(?![\x{0985}-\x{09FE}])/u', $line)) {
        return false;
    }

    return mb_strlen($line, 'UTF-8') >= 3;
}

function ai_extract_name_from_lines($text, $state) {
    $lines = preg_split('/\n+/u', ai_normalize_text($text));

    foreach ($lines as $line) {
        $line = ai_clean_line($line);
        if ($line === '') {
            continue;
        }

        if (ai_is_noise_line($line)) {
            continue;
        }

        // Gate on the ORIGINAL line, not the stripped one: a line like
        // "থানাঃ আক্কেলপুর" carries a "থানা" keyword that correctly disqualifies
        // it as a name, but that keyword disappears once ai_strip_meta_label_tokens
        // removes the label word - checking only the stripped text would let a
        // bare thana/district value be mistaken for the customer's name.
        if (!ai_is_probable_name_line($line)) {
            continue;
        }

        $stripped = ai_strip_meta_label_tokens($line);
        if ($stripped === '') {
            continue;
        }

        if ($state !== '' && stripos($stripped, $state) !== false && preg_match('/\d/', $stripped)) {
            continue;
        }

        if (ai_is_probable_name_line($stripped)) {
            return $stripped;
        }
    }

    return '';
}
