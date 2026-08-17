<?php
if (!defined('ABSPATH')) exit;

function ai_call_groq($text, array $deterministic_data = []) {
    $api_key = get_option('ai_groq_api_key');
    
    if (!$api_key) {
        ai_log('ERROR: Groq API key not configured');
        return ['error' => 'Groq API key not set. Please configure it in Settings.'];
    }

    ai_log('Calling Groq API with text', $text);

    $system_prompt = 'You are a Bangladesh order parser for WooCommerce. Extract customer information from messy Bangla, English, or mixed-language chat messages and return ONLY a valid JSON object with these exact fields: {"name":"","phone":"","address_line_1":"","state":"","price":"","customer_note":""}

Rules:
- Ignore unrelated chatter, product notes, greetings, and duplicate fragments.
- Phone: Must be exactly 11 digits starting with 0. Convert Bangla numerals to English digits.
- State: Must be the Bangladesh district/city name that best matches WooCommerce state input, or empty string if not found.
- Name: Customer full name only.
- Address: Keep the full delivery address. If district/state is present in the message, keep it in address_line_1 as well.
- Price: Preserve the price text exactly as mentioned for product pricing. Example: if text says 1100 + 1000, return "1100 + 1000". If text says 1200, return "1200". Do not calculate a total.
- Customer_note: Put any extra useful delivery note, second phone number, or leftover customer instruction here. Leave empty if nothing useful remains.
- Prefer the deterministic hints when they are plausible, but correct them if the raw text clearly shows a better answer.

Return ONLY the JSON object, no markdown, no explanations.';

    $user_payload = "RAW MESSAGE:\n" . $text . "\n\nDETERMINISTIC HINTS:\n" . wp_json_encode($deterministic_data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $request_body = [
        'model' => 'llama-3.3-70b-versatile',
        'messages' => [
            [
                'role' => 'system',
                'content' => $system_prompt
            ],
            [
                'role' => 'user',
                'content' => $user_payload
            ]
        ],
        'temperature' => 0.1,
        'max_tokens' => 500
    ];

    ai_log('Groq request body', $request_body);

    $response = wp_remote_post(
        'https://api.groq.com/openai/v1/chat/completions',
        [
            'headers' => [
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $api_key
            ],
            'body' => wp_json_encode($request_body),
            'timeout' => 30,
            'sslverify' => true
        ]
    );

    if (is_wp_error($response)) {
        ai_log('ERROR: wp_remote_post failed', $response->get_error_message());
        return ['error' => 'Network error: ' . $response->get_error_message()];
    }

    $response_code = wp_remote_retrieve_response_code($response);
    $body_raw = wp_remote_retrieve_body($response);
    
    ai_log('Groq Response Code: ' . $response_code);
    ai_log('Groq Response Body', $body_raw);

    if ($response_code !== 200) {
        $body = json_decode($body_raw, true);
        $error_msg = 'Unknown error';
        
        if (is_array($body) && isset($body['error'])) {
            $error_msg = is_array($body['error'])
                ? ($body['error']['message'] ?? wp_json_encode($body['error']))
                : $body['error'];
        } else {
            $error_msg = $body_raw;
        }
        
        ai_log('ERROR: Groq API returned non-200 status', $error_msg);
        return ['error' => 'Groq API Error (' . $response_code . '): ' . $error_msg];
    }

    $body = json_decode($body_raw, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        ai_log('ERROR: Failed to parse JSON response', json_last_error_msg());
        return ['error' => 'Invalid JSON response from Groq API'];
    }

    if (!isset($body['choices'][0]['message']['content'])) {
        ai_log('ERROR: Unexpected response structure', $body);
        return ['error' => 'Invalid response structure from Groq API'];
    }

    $ai_response = $body['choices'][0]['message']['content'];
    ai_log('Groq AI Response', $ai_response);

    return ['success' => true, 'text' => $ai_response];
}

function ai_parse_response($raw) {
    if (!$raw) {
        ai_log('ERROR: Empty response');
        return false;
    }

    $original = $raw;
    $raw = trim($raw);
    $raw = preg_replace('/```json\s*/i', '', $raw);
    $raw = preg_replace('/```\s*$/s', '', $raw);
    $raw = trim($raw);

    ai_log('Cleaned response for parsing', $raw);

    if (preg_match('/\{.*\}/s', $raw, $matches)) {
        $json_string = $matches[0];
        ai_log('Extracted JSON string', $json_string);
        
        $decoded = json_decode($json_string, true);
        
        if (json_last_error() !== JSON_ERROR_NONE) {
            ai_log('ERROR: JSON decode failed', json_last_error_msg());
            return false;
        }

        ai_log('Successfully parsed JSON', $decoded);
        return $decoded;
    }

    ai_log('ERROR: No JSON found in response', $original);
    return false;
}
