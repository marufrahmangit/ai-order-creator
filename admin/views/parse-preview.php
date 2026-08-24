<?php
if (!defined('ABSPATH')) exit;

function ai_render_parse_preview(array $parsed) {
    if (!empty($parsed['warnings'])) {
        foreach ($parsed['warnings'] as $warning) {
            echo '<div class="notice notice-warning"><p><strong>Note:</strong> ' . esc_html($warning) . '</p></div>';
        }
    }

    echo '<div style="background:#fff; border:1px solid #ccd0d4; padding:16px; margin:16px 0; max-width:900px;">';
    echo '<h3 style="margin-top:0;">Parse Preview</h3>';
    echo '<table class="widefat striped" style="max-width:700px;">';
    echo '<tr><th>Field</th><th>Detected Value</th></tr>';
    echo '<tr><td><strong>Name</strong></td><td>' . esc_html($parsed['data']['name'] ?? '') . '</td></tr>';
    echo '<tr><td><strong>Phone</strong></td><td>' . esc_html($parsed['data']['phone'] ?? '') . '</td></tr>';
    echo '<tr><td><strong>Address</strong></td><td>' . esc_html($parsed['data']['address_line_1'] ?? '') . '</td></tr>';
    echo '<tr><td><strong>State</strong></td><td>' . esc_html($parsed['data']['state'] ?? '') . '</td></tr>';
    echo '<tr><td><strong>Customer Note</strong></td><td>' . nl2br(esc_html($parsed['data']['customer_note'] ?? '')) . '</td></tr>';
    echo '</table>';

    if (!empty($parsed['debug_mode'])) {
        echo '<div style="background:#f0f0f0; padding:15px; margin:15px 0; border-left:4px solid #0073aa;">';
        echo '<h4>Normalized Input</h4>';
        echo '<pre>' . esc_html($parsed['normalized_text']) . '</pre>';
        if (!empty($parsed['raw_ai_response'])) {
            echo '<h4>Raw Groq Response</h4>';
            echo '<pre>' . esc_html($parsed['raw_ai_response']) . '</pre>';
        }
        echo '<h4>Final Parsed Data</h4>';
        echo '<pre>' . esc_html(print_r($parsed['data'], true)) . '</pre>';
        echo '</div>';
    }

    echo '</div>';
}
