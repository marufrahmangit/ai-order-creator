<?php
if (!defined('ABSPATH')) exit;

function ai_render_settings_tab() {
    // Handle test API call
    if (isset($_POST['test_api'])) {
        check_admin_referer('ai_test_api');

        echo '<div class="notice notice-info"><p><strong>Testing Groq API connection...</strong></p></div>';

        $test_result = ai_call_groq('Test: Karim, 01712345678, Dhaka');

        if (isset($test_result['success'])) {
            echo '<div class="notice notice-success"><p>API Connection Successful!</p>';
            echo '<pre>' . esc_html($test_result['text']) . '</pre></div>';
        } else {
            echo '<div class="notice notice-error"><p>API Test Failed: ' . esc_html($test_result['error']) . '</p></div>';
        }
    }

    ?>
        <div class="notice notice-info">
            <p><strong>Get Your Free Groq API Key</strong></p>
            <ol>
                <li>Visit: <a href="https://console.groq.com/keys" target="_blank">https://console.groq.com/keys</a></li>
                <li>Sign up (free, no credit card required)</li>
                <li>Click "Create API Key"</li>
                <li>Copy the key (starts with <code>gsk_...</code>)</li>
                <li>Paste it below</li>
            </ol>
            <p><strong>Why Groq?</strong> Very generous free tier, extremely fast responses, perfect for Bangladesh order parsing!</p>
        </div>
        
        <form method="post" action="options.php">
            <?php settings_fields('ai_order_creator'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row">Groq API Key</th>
                    <td>
                        <input type="text" name="ai_groq_api_key"
                               value="<?php echo esc_attr(get_option('ai_groq_api_key')); ?>"
                               style="width:500px;" 
                               placeholder="gsk_...">
                        <p class="description">
                            Get your free key from <a href="https://console.groq.com/keys" target="_blank">Groq Console</a>
                        </p>
                    </td>
                </tr>
                
                <tr>
                    <th scope="row">App Origin</th>
                    <td>
                        <input type="text" name="ai_app_origin"
                               value="<?php echo esc_attr(get_option('ai_app_origin')); ?>"
                               style="width:500px;"
                               placeholder="https://app.example.com">
                        <p class="description">
                            Origin allowed to call the <code>aioc/v1</code> REST API from a browser.
                            Include the scheme and omit any trailing slash, e.g.
                            <code>https://app.example.com</code>. Leave empty to send no CORS
                            headers at all.
                        </p>
                    </td>
                </tr>

                <tr>
                    <th scope="row">Debug Mode</th>
                    <td>
                        <label>
                            <input type="checkbox" name="ai_debug_mode" value="1" 
                                   <?php checked(get_option('ai_debug_mode'), '1'); ?>>
                            Show detailed debug output on screen
                        </label>
                        <p class="description">Recommended for first-time setup. All errors are logged to debug.log regardless.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save API Key'); ?>
        </form>
        
        <hr>
        
        <h3>Test Your Connection</h3>
        <form method="post">
            <?php wp_nonce_field('ai_test_api'); ?>
            <p>Click below to verify your API key is working correctly.</p>
            <input type="submit" name="test_api" class="button button-primary" value="Test Groq API Connection">
        </form>
        
        <hr>
        
        <h3>Troubleshooting</h3>
        <ul>
            <li><strong>401 Error:</strong> Invalid API key - regenerate from Groq Console</li>
            <li><strong>429 Error:</strong> Rate limit - wait a moment and try again</li>
            <li><strong>Network Error:</strong> Check your server can connect to api.groq.com</li>
            <li><strong>Debug Log Location:</strong> <code><?php echo WP_CONTENT_DIR . '/debug.log'; ?></code></li>
        </ul>
        
        <hr>
        
        <h3>Manual Test (cURL)</h3>
        <p>Test your API key directly in terminal:</p>
        <pre style="background:#f5f5f5; padding:10px; overflow-x:auto; font-size:12px;">curl https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer <?php echo esc_attr(get_option('ai_groq_api_key') ?: 'YOUR_API_KEY'); ?>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-oss-120b",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'</pre>
    <?php
}
