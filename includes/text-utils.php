<?php
if (!defined('ABSPATH')) exit;

function ai_convert_bangla_digits($value) {
    return strtr((string) $value, [
        '০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4',
        '৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9',
    ]);
}

function ai_normalize_text($text) {
    $text = ai_convert_bangla_digits((string) $text);
    // Treat Bengali danda (।) as a line/segment separator so that patterns
    // like "।মোবাইল:01711330561" are split the same way commas and newlines are.
    $text = str_replace(["\r\n", "\r", "।"], "\n", $text);
    $text = preg_replace("/[ \t]+/u", ' ', $text);
    // Strip leading ordered-list markers like "1." / "2)" from each line (e.g.
    // "1.Name : Nasrin Karim") so they don't get captured as part of a field's
    // value further down the pipeline. Only fires when a letter follows, so
    // real numeric content (phone numbers, postal codes) is never touched.
    $text = preg_replace('/^[ \t]*[0-9]{1,2}[.)][ \t]*(?=[A-Za-z\x{0980}-\x{09FF}])/mu', '', $text);
    $text = preg_replace("/\n{3,}/u", "\n\n", $text);
    return trim((string) $text);
}

function ai_clean_line($line) {
    $line = trim((string) $line, " \t\n\r\0\x0B,;:-");
    // Bengali visarga "ঃ" is commonly used in place of a colon after a label
    // (e.g. "নাম্বারঃ"); a lone one can be left behind once the label word
    // itself is stripped, so trim it too. Not handled via trim()'s charlist
    // above because that operates byte-by-byte and would corrupt multi-byte
    // UTF-8 sequences.
    $line = preg_replace('/^[\s\x{0983}]+|[\s\x{0983}]+$/u', '', $line);
    return preg_replace('/\s{2,}/u', ' ', $line);
}

function ai_get_noise_patterns() {
    return [
        '/\b(?:inbox|sms|msg|message|call|whatsapp|imo|facebook|fb|customer|cust|order|booking)\b/iu',
        '/\b(?:urgent|asap|please|plz|thanks|thank you|ok|okay|confirmed)\b/iu',
        '/\b(?:cod|advance|paid|payment|bkash|nagad|rocket)\b/iu',
        '/\b(?:product|size|color|qty|quantity|piece|pcs|delivery|charge|free delivery)\b/iu',
        '/\b(?:name|phone|phn|mobile|mob|contact|address|adress|addres|addr|district|state|price|total|amount)\s*[:\-\.]?\s*$/iu',
        '/^\s*(?:phn|ph|mob|contact\s*(?:no\.?|number)?)\s*[:\-]?\s*$/iu',
        // Bare "mo" chat shorthand for "mobile", usually trailed by dots
        // instead of a colon (e.g. "mo..01707757301"). Only matches when the
        // whole line/segment is just that — never strips "mo" out of a real
        // word or name.
        '/^\s*mo\s*\.{1,3}\s*$/i',
        // Bengali visarga "ঃ" acts as a colon after these labels (e.g.
        // "নাম্বারঃ"), so it must be accepted alongside ":"/"-" here too,
        // otherwise a bare label line survives as address junk once its
        // value (e.g. the phone number) has been stripped out elsewhere.
        '/^\s*(?:মোবাইল|ফোন|মোবা|নাম্বার|নম্বর|থানা|উপজেলা|জেলা|জিলা|সিটি)\s*[:\-\x{0983}]?\s*$/u',
        '/\b(?:assign this conversation|view ad|sent by|available|confirm|learn more|reply to an ad|replied to an ad)\b/iu',
        '/\b(?:this chat contains a reply to your ad|please let us know how we can help you|lead stage set to)\b/iu',
        '/\b(?:automated response|cartmix replied|attachment)\b/iu',
        '/\b(?:we appreciate your understanding|we.?re currently away and will reply as soon as we can)\b/iu',
    ];
}

function ai_is_noise_line($line) {
    $line = ai_clean_line($line);
    if ($line === '') {
        return true;
    }

    foreach (ai_get_noise_patterns() as $pattern) {
        if (preg_match($pattern, $line)) {
            return true;
        }
    }

    if (preg_match('/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}(?:,\s*\d{1,2}:\d{2})?$/u', $line)) {
        return true;
    }

    if (preg_match('/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*\d{4}/iu', $line)) {
        return true;
    }

    if (preg_match('/^(?:mon|tue|wed|thu|fri|sat|sun)\b/i', $line)) {
        return true;
    }

    if (preg_match('/^(?:mon|tue|wed|thu|fri|sat|sun)\s+\d{1,2}:\d{2}$/iu', $line)) {
        return true;
    }

    if (preg_match('/^(?:yes|ok|available|confirm)$/iu', $line)) {
        return true;
    }

    if (preg_match('/^hi\b.*help you\.?$/iu', $line)) {
        return true;
    }

    return false;
}

function ai_strip_address_label($line) {
    $line = ai_clean_line($line);

    if ($line === '') {
        return '';
    }

    // Only true "wrapping" labels (the label for the address field itself) belong
    // here. Structural sub-labels like Road/House/District/Area describe a PART
    // of the address (e.g. "Road - 5", "House - 10") and must be left intact —
    // stripping them would collapse "Road - 1, House - 29" down to "1, 29".
    $labels = [
        'address', 'adress', 'addres', 'addr', 'location',
        'ঠিকানা', 'এড্রেস',
    ];

    foreach ($labels as $label) {
        // Separator must be a colon (or the Bengali visarga "ঃ" used the same
        // way, e.g. "ঠিকানাঃ") or a dash with at least one adjacent space
        // (e.g. "road - 7", "road- 7"). A bare hyphen like in "road-7" is
        // part of the value, not a separator.
        $pattern = '/^' . preg_quote($label, '/') . '(?:\s*[:.ঃ]\s*|\s+-\s*|-\s+|\s+)(.+)$/iu';
        if (preg_match($pattern, $line, $match)) {
            return ai_clean_line($match[1]);
        }
    }

    return $line;
}

function ai_get_meta_label_words() {
    return [
        'customer name', 'cust name', 'name', 'নাম',
        'contact number', 'contact no', 'contact',
        'mobile no', 'mobile number', 'mobile num', 'mob no', 'mob number', 'mobile',
        'phone no', 'phone number', 'phone num', 'ph no', 'ph number',
        'mob', 'phn', 'ph', 'phone',
        'মোবাইল নং', 'মোবাইল নাম্বার', 'ফোন নং', 'ফোন নাম্বার',
        'ফোন', 'মোবাইল', 'নাম্বার', 'নম্বর',
        // Administrative-area labels: their value (e.g. "জয়পুরহাট") already
        // ends up in the separate State field, but the label word itself is
        // noise once it shows up inline inside the address text.
        'থানা', 'উপজেলা', 'জেলা', 'জিলা', 'সিটি',
        'address', 'adress', 'addres', 'addr', 'location', 'ঠিকানা', 'এড্রেস',
    ];
}

function ai_strip_meta_label_tokens($text) {
    $text = (string) $text;
    if ($text === '') {
        return $text;
    }

    $labels = ai_get_meta_label_words();
    usort($labels, function ($a, $b) {
        return mb_strlen($b, 'UTF-8') <=> mb_strlen($a, 'UTF-8');
    });

    foreach ($labels as $label) {
        if (preg_match('/[\x{0980}-\x{09FF}]/u', $label)) {
            // Bengali labels: PCRE's \b only recognizes ASCII word characters,
            // so use an explicit script-aware boundary instead. The boundary
            // excludes actual letters/vowel-signs/digits (U+0985-U+09FE) but
            // NOT the leading diacritics U+0980-U+0984 (candrabindu/anusvara/
            // visarga) — those commonly stand in for a colon right after a
            // label (e.g. "থানাঃ"), and should not block the match. Also
            // consume that separator so no stray punctuation is left behind.
            $pattern = '/(?<![\x{0985}-\x{09FE}])' . preg_quote($label, '/') . '(?![\x{0985}-\x{09FE}])(?:\s*[:\-.\x{0983}]\s*)?/iu';
        } else {
            $pattern = '/\b' . preg_quote($label, '/') . '\b(?:\s*[:\-.]\s*)?/iu';
        }
        $text = preg_replace($pattern, ' ', $text);
    }

    return ai_clean_line(preg_replace('/\s{2,}/u', ' ', $text));
}

function ai_extract_labeled_field($text, array $labels) {
    foreach ($labels as $label) {
        $pattern = '/(?:^|\n|,)\s*' . preg_quote($label, '/') . '(?:\s*[:\-\.ঃ]\s*|\s+)([^\n,]+)/iu';
        if (preg_match($pattern, $text, $match)) {
            return ai_clean_line($match[1]);
        }
    }

    return '';
}

function ai_get_field_start_labels() {
    return [
        'name', 'customer name', 'cust name', 'নাম',
        'phone', 'mobile', 'mob', 'phn', 'ph', 'contact number', 'contact no', 'contact', 'number',
        'ফোন', 'মোবাইল', 'নাম্বার', 'নম্বর',
        'address', 'adress', 'addres', 'addr', 'location', 'ঠিকানা', 'এড্রেস',
        'district', 'state', 'city', 'জেলা', 'জিলা', 'সিটি',
        'price', 'total', 'amount', 'দাম', 'মূল্য',
    ];
}

function ai_line_starts_with_field_label($line) {
    foreach (ai_get_field_start_labels() as $label) {
        $pattern = '/^' . preg_quote($label, '/') . '\s*[:\-.ঃ]/iu';
        if (preg_match($pattern, $line)) {
            return true;
        }
    }

    return false;
}

function ai_extract_labeled_multiline_field($text, array $labels) {
    foreach ($labels as $label) {
        $pattern = '/(?:^|\n)[ \t]*' . preg_quote($label, '/') . '(?:\s*[:\-\.ঃ]\s*|\s+)([^\n]*)/iu';
        if (preg_match($pattern, $text, $match, PREG_OFFSET_CAPTURE)) {
            $lines = [$match[1][0]];
            $offset = $match[1][1] + strlen($match[1][0]);
            $rest_lines = explode("\n", substr($text, $offset));
            array_shift($rest_lines); // drop the fragment before the first newline

            // Keep pulling in continuation lines (e.g. "Road no 9", "House no
            // 67") until a blank line or the start of the next labeled field
            // ends the block — the label's value isn't always on one line.
            foreach ($rest_lines as $line) {
                $trimmed = trim($line);
                if ($trimmed === '') {
                    break;
                }
                if (ai_line_starts_with_field_label($trimmed)) {
                    break;
                }
                $lines[] = $line;
            }

            $cleaned = array_filter(array_map('ai_clean_line', $lines), function ($l) {
                return $l !== '';
            });

            return ai_clean_line(implode(', ', $cleaned));
        }
    }

    return '';
}

function ai_remove_value_once($text, $value) {
    if ($value === '') {
        return $text;
    }

    return preg_replace('/' . preg_quote($value, '/') . '/u', ' ', $text, 1);
}
