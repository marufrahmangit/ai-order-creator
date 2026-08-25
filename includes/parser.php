<?php
if (!defined('ABSPATH')) exit;

function ai_build_deterministic_parse($text) {
    $normalized = ai_normalize_text($text);

    $name = ai_extract_labeled_field($normalized, ['name', 'customer name', 'cust name', 'নাম']);
    $phone = ai_extract_labeled_field($normalized, ['phone', 'mobile', 'mob', 'phn', 'ph', 'contact number', 'contact no', 'contact', 'number', 'cell no', 'cell no.', 'cell number', 'cell phone', 'cell', 'num', 'num.', 'ফোন', 'মোবাইল', 'নাম্বার']);
    $address = ai_strip_meta_label_tokens(ai_extract_labeled_multiline_field($normalized, ['address', 'adress', 'addres', 'addr', 'add', 'ঠিকানা', 'এড্রেস']));
    $state = ai_extract_labeled_field($normalized, ['district', 'state', 'city', 'জেলা', 'জিলা', 'সিটি']);

    $phones = ai_extract_phone_candidates($phone ?: $normalized);
    if (empty($phones)) {
        $phones = ai_extract_phone_like_candidates($phone ?: $normalized);
    }
    $phone = $phones[0] ?? '';

    if ($state === '') {
        $state = ai_extract_state_from_text($normalized);
    } else {
        $state = ai_extract_state_from_text($state) ?: $state;
    }

    if ($name === '') {
        $name = ai_extract_name_from_lines($normalized, $state);
    }

    if ($address === '') {
        $address = ai_collect_address_candidates($normalized, $name, $phone, $state);
    }

    $address = ai_ensure_state_in_address($address, $state);

    return [
        'name' => ai_clean_line($name),
        'phone' => $phone,
        'address_line_1' => ai_clean_line($address),
        'state' => ai_clean_line($state),
        'price' => '',
        'price_items' => [],
        'customer_note' => '',
    ];
}

function ai_merge_parsed_data(array $primary, array $secondary) {
    foreach ($secondary as $key => $value) {
        if (!array_key_exists($key, $primary)) {
            $primary[$key] = $value;
            continue;
        }

        $is_empty = $primary[$key] === '' || $primary[$key] === null;
        if ($is_empty && $value !== '' && $value !== null) {
            $primary[$key] = $value;
        }
    }

    return $primary;
}

function ai_should_call_ai(array $data) {
    return empty($data['name']) || empty($data['phone']) || empty($data['address_line_1']) || empty($data['state']);
}

function ai_get_parsed_order_data($text) {
    $debug_mode = get_option('ai_debug_mode') === '1';
    
    ai_log('=== ORDER PARSE START ===');
    ai_log('Input text', $text);

    $normalized_text = ai_normalize_text($text);
    $data = ai_build_deterministic_parse($normalized_text);
    ai_log('Deterministic parse', $data);

    $raw = '';
    $warnings = [];
    if (ai_should_call_ai($data)) {
        $result = ai_call_groq($normalized_text, $data);

        if (isset($result['error'])) {
            $error = $result['error'];
            ai_log('ERROR: Groq API call failed', $error);
            if (empty($data['name']) || empty($data['phone'])) {
                return [
                    'success' => false,
                    'error' => $error,
                    'normalized_text' => $normalized_text,
                    'raw_ai_response' => '',
                    'data' => $data,
                    'debug_mode' => $debug_mode,
                ];
            }

            $warnings[] = 'AI fallback failed. Proceeding with deterministic extraction only.';
        } else {
            $raw = $result['text'];

            $ai_data = ai_parse_response($raw);
            if ($ai_data) {
                unset($ai_data['price'], $ai_data['price_items']);
                $data = ai_merge_parsed_data($data, $ai_data);
            } else {
                ai_log('ERROR: Failed to parse AI response', $raw);
                $warnings[] = 'AI returned an invalid format. Showing deterministic extraction only.';
            }
        }
    }

    $phones = ai_extract_phone_candidates($data['phone'] ?? '');
    if (empty($phones)) {
        $phones = ai_extract_phone_candidates($normalized_text);
    }
    if (empty($phones)) {
        $phones = ai_extract_phone_like_candidates($data['phone'] ?? '');
    }
    if (empty($phones)) {
        $phones = ai_extract_phone_like_candidates($normalized_text);
    }
    $data['phone'] = $phones[0] ?? '';
    $state_hint = ai_extract_state_hint_from_text($normalized_text);
    $data['state'] = ai_extract_state_hint_from_text($data['state'] ?? '') ?: $state_hint;
    $data['price'] = '';
    $data['price_items'] = [];
    $existing_address = isset($data['address_line_1']) ? ai_clean_line($data['address_line_1']) : '';
    if ($existing_address === '') {
        $existing_address = ai_collect_address_candidates(
            $normalized_text,
            $data['name'] ?? '',
            $data['phone'] ?? '',
            $data['state'] ?? ''
        );
    }
    $data['address_line_1'] = ai_merge_address_parts($existing_address);
    $data['address_line_1'] = ai_strip_phone_values_from_text($data['address_line_1'], $phones);
    $data['address_line_1'] = ai_ensure_state_in_address($data['address_line_1'], $data['state'] ?? '');
    $data['customer_note'] = isset($data['customer_note']) && $data['customer_note'] !== ''
        ? ai_clean_line($data['customer_note'])
        : '';

    ai_log('Final processed data', $data);

    if (empty($data['name']) && empty($data['phone'])) {
        ai_log('ERROR: Missing required fields (name and phone)');
        return [
            'success' => false,
            'error' => 'Could not extract name or phone number from the text',
            'normalized_text' => $normalized_text,
            'raw_ai_response' => $raw,
            'data' => $data,
            'debug_mode' => $debug_mode,
        ];
    }

    ai_log('=== ORDER PARSE COMPLETED ===');

    return [
        'success' => true,
        'normalized_text' => $normalized_text,
        'raw_ai_response' => $raw,
        'data' => $data,
        'warnings' => $warnings,
        'debug_mode' => $debug_mode,
    ];
}
