<?php
if (!defined('ABSPATH')) exit;

function ai_render_order_creator_tab() {
    $submitted_text = !empty($_POST['order_text']) ? wp_unslash($_POST['order_text']) : '';
    ?>
        <?php if (!get_option('ai_groq_api_key')): ?>
            <div class="notice notice-warning">
                <p><strong>API Key Required</strong></p>
                <p>Please <a href="<?php echo esc_url(admin_url('admin.php?page=ai-order-creator&tab=settings')); ?>">configure your Groq API key</a> first.</p>
            </div>
        <?php endif; ?>
        
        <p>Paste messy customer information below. The AI tool will extract name, phone, address, district, and price details in milliseconds.</p>
        
        <form method="post">
            <?php wp_nonce_field('ai_create_order_action', 'ai_create_order_nonce'); ?>
            <textarea name="order_text" rows="8" style="width:100%; max-width:800px; font-size:14px;"
                placeholder="Example:&#10;Md. Karim, 01712345678, House 10, Road 5, Dhanmondi, Dhaka&#10;&#10;Or Bangla:&#10;নাম: রহিম, ফোন: ০১৮১২৩৪৫৬৭৮, ঠিকানা: মিরপুর-১০, ঢাকা"><?php echo esc_textarea($submitted_text); ?></textarea>
            <br><br>
            <input type="submit" name="ai_preview_order"
                   class="button button-secondary button-large"
                   value="Preview Parsed Data">
            <input type="submit" name="ai_create_order"
                   class="button button-primary button-large"
                   value="Create Order with AI">
            <p class="description" style="margin-top:8px;">Use preview first to verify the detected name, phone, address, state, and price before creating the order.</p>
        </form>

        <div id="ai-last-order-card" style="max-width:800px;"></div>

        <hr>
        
        <h3>Supported Formats</h3>
        <table class="widefat" style="max-width:800px;">
            <thead>
                <tr>
                    <th>Format</th>
                    <th>Example</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>English (comma-separated)</td>
                    <td><code>Md. Karim, 01712345678, House 10, Road 5, Dhanmondi, Dhaka</code></td>
                </tr>
                <tr>
                    <td>Bangla (mixed)</td>
                    <td><code>নাম: রহিম, ফোন: ০১৮১২৩৪৫৬৭৮, ঠিকানা: মিরপুর-১০, ঢাকা</code></td>
                </tr>
                <tr>
                    <td>Short format</td>
                    <td><code>Fatima 01912345678 Gulshan-2 Dhaka</code></td>
                </tr>
                <tr>
                    <td>Structured</td>
                    <td><code>Name: Rahim<br>Phone: 01812345678<br>Address: Mirpur-10, Dhaka</code></td>
                </tr>
            </tbody>
        </table>
        
        <hr>
        
        <h3>How It Works</h3>
        <ol>
            <li><strong>Paste</strong> any messy customer info (Bangla/English/mixed)</li>
            <li><strong>AI</strong> extracts name, phone (11 digits), address, district, and price expressions</li>
            <li><strong>WooCommerce order</strong> is created automatically with billing details</li>
            <li><strong>Price extraction</strong> keeps the detected price text available on the order for manual review</li>
            <li><strong>Manual review</strong> - check the order details and add products as needed</li>
        </ol>
    <?php

    if ((isset($_POST['ai_preview_order']) || isset($_POST['ai_create_order'])) && !empty($_POST['order_text'])) {
        if (!isset($_POST['ai_create_order_nonce']) || !wp_verify_nonce($_POST['ai_create_order_nonce'], 'ai_create_order_action')) {
            echo '<div class="notice notice-error"><p>Security check failed.</p></div>';
            return;
        }


        if (isset($_POST['ai_preview_order'])) {
            $parsed = ai_get_parsed_order_data($submitted_text);
            if (!$parsed['success']) {
                echo '<div class="notice notice-error"><p><strong>Error:</strong> ' . esc_html($parsed['error']) . '</p></div>';
                if (!empty($parsed['debug_mode'])) {
                    echo '<pre style="background:#fff3cd; padding:15px; border-left:4px solid #ffc107;">Check wp-content/debug.log for detailed error information</pre>';
                }
                return;
            }

            ai_render_parse_preview($parsed);
            return;
        }

        ai_process_order_text($submitted_text);
    }
}
