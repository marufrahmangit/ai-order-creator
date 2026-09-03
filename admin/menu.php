<?php
if (!defined('ABSPATH')) exit;

add_action('admin_menu', function () {
    $aioc_hook = add_submenu_page(
        'woocommerce',
        'AI Order Creator',
        'AI Order Creator',
        'manage_woocommerce',
        'ai-order-creator',
        'ai_order_creator_page'
    );

    add_action('admin_enqueue_scripts', function ($current_hook) use ($aioc_hook) {
        if ($current_hook !== $aioc_hook) {
            return;
        }

        wp_enqueue_script(
            'aioc-last-order-lookup',
            AIOC_URL . 'admin/assets/js/last-order-lookup.js',
            [],
            '4.0',
            true
        );

        wp_localize_script('aioc-last-order-lookup', 'AIOC', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('ai_order_lookup_nonce'),
        ]);
    });
});

add_action('admin_init', function () {
    register_setting('ai_order_creator', 'ai_groq_api_key');
    register_setting('ai_order_creator', 'ai_debug_mode');
    register_setting('ai_order_creator', 'ai_app_origin', [
        'type'              => 'string',
        'sanitize_callback' => 'ai_sanitize_app_origin',
        'default'           => '',
    ]);
});

function ai_order_creator_page() {
    $active_tab = (isset($_GET['tab']) && $_GET['tab'] === 'settings') ? 'settings' : 'creator';
    ?>
    <div class="wrap">
        <h2>AI Order Creator</h2>

        <h2 class="nav-tab-wrapper">
            <a href="<?php echo esc_url(admin_url('admin.php?page=ai-order-creator')); ?>" class="nav-tab <?php echo $active_tab === 'creator' ? 'nav-tab-active' : ''; ?>">Create Order</a>
            <a href="<?php echo esc_url(admin_url('admin.php?page=ai-order-creator&tab=settings')); ?>" class="nav-tab <?php echo $active_tab === 'settings' ? 'nav-tab-active' : ''; ?>">Settings</a>
        </h2>

        <?php if ($active_tab === 'settings'): ?>
            <?php ai_render_settings_tab(); ?>
        <?php else: ?>
            <?php ai_render_order_creator_tab(); ?>
        <?php endif; ?>
    </div>
    <?php
}
