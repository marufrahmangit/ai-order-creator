<?php
if (!defined('ABSPATH')) exit;

function ai_extract_price($text) {
    $normalized = ai_convert_bangla_digits($text);

    if (preg_match('/(?:total|price|amount|tk|taka|৳|মূল্য|দাম|টাকা)\s*[:=\-]?\s*((?:\d{2,6}\s*(?:\+|plus)\s*)*\d{2,6})/iu', $normalized, $match)) {
        return ai_clean_line($match[1]);
    }

    if (preg_match('/\d{2,6}\s*(?:\+|plus)\s*\d{2,6}/iu', $normalized, $match)) {
        return ai_clean_line($match[0]);
    }

    if (preg_match('/(?:^|[\s,;:])(\d{2,6})(?:\s*)(?:tk|taka|৳)(?:$|[\s,.;])/iu', $normalized, $match)) {
        return $match[1];
    }

    return null;
}

function ai_looks_like_price_expression($text) {
    $text = ai_normalize_text($text);

    if ($text === '') {
        return false;
    }

    if (preg_match('/(?:price|amount|total|tk|taka|৳|মূল্য|দাম|টাকা)/iu', $text)) {
        return true;
    }

    if (preg_match('/(?:\+|\bplus\b|[xX*])/iu', $text)) {
        return true;
    }

    preg_match_all('/(?<![\/\-])\d{2,6}(?:\.\d{1,2})?(?![\/\-][A-Za-z0-9])/u', $text, $number_matches);
    if (strpos($text, ',') !== false && count($number_matches[0]) >= 2) {
        return true;
    }

    return (bool) preg_match('/^\d{2,6}(?:\.\d{1,2})?$/u', $text);
}

function ai_extract_price_expression_fragment($text) {
    $text = ai_normalize_text($text);

    if ($text === '') {
        return null;
    }

    $pattern = '/(?:(?<![\/\-])\d{2,6}(?:\.\d{1,2})?(?![\/\-][A-Za-z0-9])\s*(?:[xX*]\s*\d{1,3})?)(?:\s*(?:\+|plus|,)\s*(?<![\/\-])\d{2,6}(?:\.\d{1,2})?(?![\/\-][A-Za-z0-9])\s*(?:[xX*]\s*\d{1,3})?)*/iu';

    if (!preg_match_all($pattern, $text, $matches) || empty($matches[0])) {
        return null;
    }

    $best_match = '';
    foreach ($matches[0] as $match) {
        $match = ai_clean_line($match);
        if (strlen($match) > strlen($best_match)) {
            $best_match = $match;
        }
    }

    return $best_match !== '' ? $best_match : null;
}

function ai_extract_price_expression_from_text($text) {
    $normalized = ai_convert_bangla_digits($text);

    // Strip phone numbers as they actually appear (raw spaces/dashes and
    // all, e.g. "0179437-4078") rather than the normalized digit string,
    // which often never occurs verbatim in the source text and would
    // silently fail to remove anything.
    $normalized = preg_replace('/(?:\+?88[\s\-]*)?(?:0?1[3-9](?:[\s\-]*\d){8})\b/', ' ', $normalized);

    foreach (preg_split('/\n+/u', $normalized) as $line) {
        $line = ai_clean_line($line);
        if ($line === '' || !ai_looks_like_price_expression($line)) {
            continue;
        }

        $expression = ai_extract_price_expression_fragment($line);
        if ($expression !== null) {
            return $expression;
        }
    }

    if (ai_looks_like_price_expression($normalized)) {
        return ai_extract_price_expression_fragment($normalized);
    }

    return null;
}

function ai_parse_price_requests($text) {
    $text = ai_normalize_text($text);

    if ($text === '') {
        return [];
    }

    preg_match_all('/(\d{2,6}(?:\.\d{1,2})?)\s*(?:[xX*]\s*(\d{1,3}))?/iu', $text, $matches, PREG_SET_ORDER);
    $requests = [];

    foreach ($matches as $match) {
        $price = ai_normalize_price_value($match[1]);
        $quantity = isset($match[2]) && $match[2] !== '' ? max(1, (int) $match[2]) : 1;

        if ($price === null) {
            continue;
        }

        $requests[] = [
            'price' => $price,
            'quantity' => $quantity,
            'raw' => ai_clean_line($match[0]),
        ];
    }

    return $requests;
}

function ai_normalize_price_value($value) {
    $value = ai_convert_bangla_digits((string) $value);
    $value = str_replace(',', '', $value);
    $value = preg_replace('/[^\d.]/', '', $value);

    if ($value === '' || !is_numeric($value)) {
        return null;
    }

    $number = (float) $value;

    if ((float) (int) $number === $number) {
        return (string) (int) $number;
    }

    return rtrim(rtrim(number_format($number, 2, '.', ''), '0'), '.');
}

function ai_format_price_requests(array $requests) {
    $parts = [];

    foreach ($requests as $request) {
        if (empty($request['price'])) {
            continue;
        }

        $quantity = !empty($request['quantity']) ? (int) $request['quantity'] : 1;
        $parts[] = $quantity > 1
            ? $request['price'] . ' x ' . $quantity
            : $request['price'];
    }

    return implode(' + ', $parts);
}

function ai_remove_price_value_once($text, $price) {
    if ($price === '' || $price === null) {
        return $text;
    }

    // Don't touch a number that's really a house/flat/road/postal-code unit
    // like "50/B" or "Dhaka-1216" just because it also matches the extracted
    // price digits.
    $pattern = '/(?<![\/\-])' . preg_quote((string) $price, '/') . '(?![\/\-][A-Za-z0-9])/u';
    $replaced = preg_replace($pattern, ' ', $text, 1);

    return $replaced !== null ? $replaced : $text;
}
