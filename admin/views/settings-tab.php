<?php
if (!defined('ABSPATH')) exit;

/**
 * The shipping rates editor, inside the settings form.
 *
 * Reads ai_get_shipping_rates() rather than the option directly, so the screen
 * shows the rates that are actually in force - including the shipped seed on a
 * site where the form has never been saved. Editing and saving that seed is
 * what writes the option for the first time.
 *
 * DISTRICT IS A SELECT, NOT A TEXT FIELD. A rate attached to a code
 * WooCommerce does not know is unreachable: ai_get_shipping_rate() would never
 * match it and the order would quietly take the default. That is the 7.4
 * defect - a plausible value that resolves to nothing - and a free-text field
 * is an invitation to it. The list comes from WooCommerce, so it cannot drift
 * from what an order can actually carry.
 *
 * Rows are added and removed with a little inline JS; the default row has no
 * remove control, because every district not listed falls back to it and an
 * order with no rate at all is not a state this screen may produce.
 */
function ai_render_shipping_rates_section() {
    $rates  = ai_get_shipping_rates();
    $states = (function_exists('WC') && WC()) ? WC()->countries->get_states('BD') : [];
    if (!is_array($states)) {
        $states = [];
    }

    $option = AIOC_SHIPPING_RATES_OPTION;
    ?>
    <h3>Shipping rates</h3>

    <p class="description" style="max-width:46em;">
        These are this plugin's own flat rates. <strong>WooCommerce &rsaquo; Settings
        &rsaquo; Shipping is not used at all</strong> &mdash; no zones, no methods. The
        rate for an order's district is written onto the order as a flat-rate line when
        it is saved.
    </p>

    <?php if (empty($states)) : ?>
        <div class="notice notice-error inline">
            <p>WooCommerce's Bangladesh district list is unavailable, so districts cannot
            be chosen. Check that WooCommerce is active.</p>
        </div>
    <?php endif; ?>

    <table class="widefat striped" style="max-width:52em; margin-bottom:12px;" id="aioc-rates">
        <thead>
            <tr>
                <th style="width:40%;">District</th>
                <th style="width:18%;">Cost (<?php echo esc_html(get_woocommerce_currency()); ?>)</th>
                <th style="width:32%;">Label on the order</th>
                <th style="width:10%;"></th>
            </tr>
        </thead>
        <tbody>
        <?php $row_index = 0; ?>
        <?php foreach ($rates['by_state'] as $code => $rate) : ?>
            <tr>
                <td>
                    <select name="<?php echo esc_attr($option); ?>[by_state][<?php echo (int) $row_index; ?>][code]" style="width:100%;">
                        <?php foreach ($states as $state_code => $state_name) : ?>
                            <option value="<?php echo esc_attr($state_code); ?>" <?php selected($state_code, $code); ?>>
                                <?php echo esc_html(trim((string) $state_name)); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </td>
                <td>
                    <input type="number" step="0.01" min="0" style="width:100%;"
                           name="<?php echo esc_attr($option); ?>[by_state][<?php echo (int) $row_index; ?>][cost]"
                           value="<?php echo esc_attr(wc_format_decimal($rate['cost'], wc_get_price_decimals())); ?>">
                </td>
                <td>
                    <input type="text" style="width:100%;"
                           name="<?php echo esc_attr($option); ?>[by_state][<?php echo (int) $row_index; ?>][label]"
                           value="<?php echo esc_attr($rate['label']); ?>">
                </td>
                <td><button type="button" class="button button-link-delete aioc-remove-rate">Remove</button></td>
            </tr>
            <?php $row_index++; ?>
        <?php endforeach; ?>
        </tbody>
    </table>

    <p><button type="button" class="button" id="aioc-add-rate">Add rate</button></p>

    <table class="form-table" style="max-width:52em;">
        <tr>
            <th scope="row">Default rate</th>
            <td>
                <input type="number" step="0.01" min="0" style="width:8em;"
                       name="<?php echo esc_attr($option); ?>[default][cost]"
                       value="<?php echo esc_attr(wc_format_decimal($rates['default']['cost'], wc_get_price_decimals())); ?>">
                <input type="text" style="width:22em;"
                       name="<?php echo esc_attr($option); ?>[default][label]"
                       value="<?php echo esc_attr($rates['default']['label']); ?>">
                <p class="description">
                    <strong>Applies to every district not listed above</strong> &mdash; not
                    to an order with no district. An order whose district is empty gets
                    <strong>no shipping line at all</strong>, by design, so that a missing
                    district is visible rather than priced at a guess. It cannot be
                    removed.
                </p>
            </td>
        </tr>
    </table>

    <p class="description" style="max-width:46em;">
        <strong>Changing a rate does not change orders that already exist.</strong> Each
        keeps the figure stored on it until it is saved again, in the app or in
        wp-admin &mdash; saving is what re-prices it. The app picks up a new rate on its
        next load with no rebuild or re-upload.
    </p>

    <script>
    (function () {
        var table = document.getElementById('aioc-rates');
        var add = document.getElementById('aioc-add-rate');
        if (!table || !add) return;
        var body = table.tBodies[0];

        // Row names are indexed, and the index only has to be unique within one
        // submission - ai_sanitize_shipping_rates() keys the saved table on the
        // district code and ignores these entirely.
        var next = body.rows.length;

        add.addEventListener('click', function () {
            var first = body.rows[0];
            if (!first) return;
            var row = first.cloneNode(true);
            row.querySelectorAll('[name]').forEach(function (field) {
                field.name = field.name.replace(/\[by_state\]\[\d+\]/, '[by_state][' + next + ']');
                if (field.tagName === 'SELECT') field.selectedIndex = 0;
                else field.value = '';
            });
            next++;
            body.appendChild(row);
        });

        body.addEventListener('click', function (event) {
            if (!event.target.classList.contains('aioc-remove-rate')) return;
            event.target.closest('tr').remove();
        });
    })();
    </script>
    <?php
}

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
        
        <?php settings_errors(AIOC_SHIPPING_RATES_OPTION); ?>

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

            <hr>

            <?php ai_render_shipping_rates_section(); ?>

            <?php submit_button('Save settings'); ?>
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
