<?php
if (!defined('ABSPATH')) exit;

function ai_merge_address_parts(...$values) {
    $parts = [];

    foreach ($values as $value) {
        if (!is_string($value) || $value === '') {
            continue;
        }

        $segments = preg_split('/(?:\n+|,\s*)/u', $value);
        foreach ($segments as $segment) {
            $segment = ai_strip_address_label($segment);
            $segment = ai_strip_meta_label_tokens($segment);
            $segment = ai_clean_line($segment);
            if ($segment === '') {
                continue;
            }

            $segment_key = mb_strtolower($segment, 'UTF-8');
            if (!isset($parts[$segment_key])) {
                $parts[$segment_key] = $segment;
            }
        }
    }

    return implode(', ', array_values($parts));
}

function ai_ensure_state_in_address($address, $state) {
    $address = ai_clean_line($address);
    $state = ai_clean_line($state);

    if ($address === '' || $state === '' || ai_address_has_state($address, $state)) {
        return $address;
    }

    return ai_clean_line($address . ', ' . $state);
}

function ai_score_address_line($line, $state) {
    $line = ai_clean_line($line);
    if ($line === '' || ai_is_noise_line($line)) {
        return -100;
    }

    $score = 0;

    if (preg_match('/\d/', $line)) {
        $score += 2;
    }

    if (strpos($line, ',') !== false) {
        $score += 2;
    }

    if (substr_count($line, ',') >= 2) {
        $score += 4;
    }

    if (preg_match('/\b(?:road|rd|house|flat|lane|area|sector|block|bazar|thana|upazila|union|para|sarani|zone|r\/a)\b/iu', $line)) {
        $score += 5;
    }

    // Boundary excludes actual letters/vowel-signs/digits (U+0985-U+09FE), not
    // the leading diacritics U+0980-U+0984 (candrabindu/anusvara/visarga) - a
    // keyword like "থানা" must still be recognized even with "ঃ" glued to it.
    if (preg_match('/(?<![\x{0985}-\x{09FE}])(?:রোড|বাড়ি|বাসা|ফ্ল্যাট|এলাকা|থানা|উপজেলা|ইউনিয়ন|পাড়া|সেক্টর|ব্লক|জোন)(?![\x{0985}-\x{09FE}])/u', $line)) {
        $score += 5;
    }

    if ($state !== '' && stripos($line, $state) !== false) {
        $score += 3;
    }

    if (preg_match('/^\d{2,6}$/', $line)) {
        $score -= 6;
    }

    return $score;
}

function ai_collect_address_candidates($text, $name, $phone, $state) {
    $working = ai_normalize_text($text);
    $working = ai_remove_value_all($working, $name);

    foreach (ai_get_noise_patterns() as $pattern) {
        $working = preg_replace($pattern, ' ', $working);
    }

    $segments = preg_split('/\n+/u', $working);
    $parts = [];
    $best_line = '';
    $best_score = -100;
    $usable_segment_count = 0;

    foreach ($segments as $segment) {
        $segment = ai_clean_line($segment);
        if ($segment === '') {
            continue;
        }

        $segment = ai_strip_phone_values_from_text($segment, [$phone]);
        if ($segment === '') {
            continue;
        }

        $usable_segment_count++;

        if (ai_is_noise_line($segment)) {
            continue;
        }

        $is_state_line = $state !== '' && ai_extract_state_from_text($segment) === $state;
        $normalized_segment = ai_strip_address_label($segment);
        $normalized_segment = ai_strip_meta_label_tokens($normalized_segment);
        $normalized_has_keywords = $normalized_segment !== $segment;

        if (ai_is_probable_name_line($normalized_segment) && count($parts) === 0 && !$is_state_line && !$normalized_has_keywords && count($segments) === 1) {
            continue;
        }

        if (preg_match('/^\d{2,6}$/', $normalized_segment)) {
            continue;
        }

        $score = ai_score_address_line($normalized_segment, $state);
        if ($score > $best_score) {
            $best_score = $score;
            $best_line = $normalized_segment;
        }

        $parts[] = $normalized_segment;
    }

    if (!empty($parts)) {
        return ai_merge_address_parts(implode("\n", array_unique($parts)));
    }

    if ($usable_segment_count > 1 && $best_line !== '') {
        return $best_line;
    }

    return $best_score >= 0 ? $best_line : '';
}
