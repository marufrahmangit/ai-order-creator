<?php
if (!defined('ABSPATH')) exit;

/**
 * Thumbnail URL at 'thumbnail' size, or null.
 *
 * For a variation this falls through to the parent image when the variation
 * has none of its own - that is WC_Product_Variation::get_image_id()'s own
 * behaviour, not something added here.
 *
 * @param WC_Product $product
 * @return string|null
 */
function ai_rest_product_thumbnail(WC_Product $product) {
    $image_id = $product->get_image_id();
    if (!$image_id) {
        return null;
    }

    $url = wp_get_attachment_image_url($image_id, 'thumbnail');

    return $url ?: null;
}

/**
 * Build one flat purchasable row.
 *
 * Shared by simple products and variations so the two row shapes cannot drift.
 * Name is passed in because a variation's display name is assembled from its
 * parent, and SKU/price are returned exactly as stored - no formatting, no
 * parent fallback, no assumptions about their content.
 *
 * @param WC_Product $product   The purchasable object (simple product or variation).
 * @param string     $name      Full display name.
 * @param int        $parent_id Variable parent id, or 0.
 * @return array
 */
function ai_rest_prepare_product_row(WC_Product $product, $name, $parent_id) {
    return [
        'id'             => (int) $product->get_id(),
        'parent_id'      => (int) $parent_id,
        'name'           => (string) $name,
        'sku'            => (string) $product->get_sku(),
        'price'          => ai_rest_money($product->get_price()),
        'is_in_stock'    => (bool) $product->is_in_stock(),
        'stock_status'   => (string) $product->get_stock_status(),
        'stock_quantity' => $product->managing_stock() ? (int) $product->get_stock_quantity() : null,
        'thumbnail'      => ai_rest_product_thumbnail($product),
    ];
}

/**
 * Display name for a variation: parent name plus the attribute summary.
 *
 * e.g. "Cotton Shirt - Size: L, Colour: Blue". A variation with no resolvable
 * attributes degrades to the bare parent name.
 *
 * @param WC_Product_Variation $variation
 * @param WC_Product           $parent
 * @return string
 */
function ai_rest_variation_display_name(WC_Product_Variation $variation, WC_Product $parent) {
    $summary = '';

    if (method_exists($variation, 'get_attribute_summary')) {
        $summary = (string) $variation->get_attribute_summary();
    }

    if (trim($summary) === '' && function_exists('wc_get_formatted_variation')) {
        $summary = (string) wc_get_formatted_variation($variation, true, true, false);
    }

    $summary = trim($summary);
    $name    = $parent->get_name();

    return $summary !== '' ? $name . ' - ' . $summary : $name;
}

/**
 * Post statuses a product or variation must have to be addable to an order.
 *
 * 'private' is included deliberately: this store keeps its catalogue private
 * because the storefront is unused and orders are taken internally. 'draft',
 * 'pending' and 'trash' stay excluded.
 *
 * Catalog visibility (the product_visibility taxonomy, i.e. the
 * exclude-from-catalog / exclude-from-search terms) is intentionally NOT
 * consulted anywhere in this file - that governs storefront display only, and
 * a product hidden from the catalogue must still be addable to an order.
 *
 * @return string[]
 */
function ai_rest_product_statuses() {
    return ['publish', 'private'];
}

/**
 * Whether a product or variation's own post status allows it to be returned.
 *
 * @param WC_Product $product
 * @return bool
 */
function ai_rest_product_status_allowed(WC_Product $product) {
    return in_array($product->get_status(), ai_rest_product_statuses(), true);
}

/**
 * Parent-level product ids matching the term by name or by SKU.
 *
 * Two separate queries, merged: wc_get_products()'s 's' searches post title
 * and content but not SKU, while its 'sku' arg is a LIKE against _sku. Running
 * them independently is what makes "name OR SKU" work without raw SQL.
 *
 * Only simple and variable types are requested; grouped, external and any
 * other type are never candidates.
 *
 * @param string $search
 * @return int[]
 */
function ai_rest_search_parent_product_ids($search) {
    $base = [
        'status'  => ai_rest_product_statuses(),
        'type'    => ['simple', 'variable'],
        'limit'   => -1,
        'return'  => 'ids',
        'orderby' => 'title',
        'order'   => 'ASC',
    ];

    $by_name = wc_get_products(array_merge($base, ['s' => $search]));
    $by_sku  = wc_get_products(array_merge($base, ['sku' => $search]));

    $ids = array_merge(
        is_array($by_name) ? $by_name : [],
        is_array($by_sku) ? $by_sku : []
    );

    return array_values(array_unique(array_map('intval', $ids)));
}

/**
 * Row for a single variation, or null if it is not usable.
 *
 * @param WC_Product_Variation $variation
 * @return array|null
 */
function ai_rest_variation_row(WC_Product_Variation $variation) {
    if (!ai_rest_product_status_allowed($variation)) {
        return null;
    }

    $parent = wc_get_product($variation->get_parent_id());
    if (!$parent instanceof WC_Product || !ai_rest_product_status_allowed($parent) || !$parent->is_type('variable')) {
        return null;
    }

    return ai_rest_prepare_product_row(
        $variation,
        ai_rest_variation_display_name($variation, $parent),
        $parent->get_id()
    );
}

/**
 * Resolve an exact SKU hit, covering variation-level SKUs.
 *
 * ai_rest_search_parent_product_ids() only ever matches parents, so a SKU that
 * belongs to a variation rather than its parent would otherwise be unfindable.
 * wc_get_product_id_by_sku() looks across products and variations alike. This
 * is exact-match only - see the accompanying report.
 *
 * @param string $search
 * @return array|null A row, or null if nothing usable matched.
 */
function ai_rest_exact_sku_row($search) {
    if (!function_exists('wc_get_product_id_by_sku')) {
        return null;
    }

    $id = wc_get_product_id_by_sku($search);
    if (!$id) {
        return null;
    }

    $product = wc_get_product($id);
    if (!$product instanceof WC_Product) {
        return null;
    }

    if ($product instanceof WC_Product_Variation) {
        return ai_rest_variation_row($product);
    }

    if ($product->is_type('simple') && ai_rest_product_status_allowed($product)) {
        return ai_rest_prepare_product_row($product, $product->get_name(), 0);
    }

    return null;
}

/**
 * GET /aioc/v1/products
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function ai_rest_get_products(WP_REST_Request $request) {
    $search = trim((string) $request->get_param('search'));

    if (mb_strlen($search) < 2) {
        return new WP_Error(
            'aioc_search_too_short',
            __('The search term must be at least 2 characters.', 'ai-order-creator'),
            ['status' => 400]
        );
    }

    // A missing, zero, negative or non-numeric limit falls back to the
    // default rather than clamping to 1.
    $limit = (int) $request->get_param('limit');
    if ($limit < 1) {
        $limit = 20;
    }
    $limit = min(50, $limit);

    // Keyed by id, which is what deduplicates the final list.
    $rows = [];

    // An exact SKU hit leads, so a scanned or pasted SKU surfaces first.
    $exact = ai_rest_exact_sku_row($search);
    if ($exact !== null) {
        $rows[$exact['id']] = $exact;
    }

    foreach (ai_rest_search_parent_product_ids($search) as $parent_id) {
        if (count($rows) >= $limit) {
            break;
        }

        $product = wc_get_product($parent_id);
        if (!$product instanceof WC_Product || !ai_rest_product_status_allowed($product)) {
            continue;
        }

        if ($product->is_type('simple')) {
            $id = $product->get_id();
            if (!isset($rows[$id])) {
                $rows[$id] = ai_rest_prepare_product_row($product, $product->get_name(), 0);
            }
            continue;
        }

        // A variable parent is not purchasable, so it is never a row itself -
        // only its variations are. Every other type is skipped outright.
        if (!$product->is_type('variable')) {
            continue;
        }

        foreach ($product->get_children() as $variation_id) {
            if (count($rows) >= $limit) {
                break 2;
            }

            if (isset($rows[(int) $variation_id])) {
                continue;
            }

            $variation = wc_get_product($variation_id);
            if (!$variation instanceof WC_Product_Variation) {
                continue;
            }

            if (!ai_rest_product_status_allowed($variation)) {
                continue;
            }

            $rows[$variation->get_id()] = ai_rest_prepare_product_row(
                $variation,
                ai_rest_variation_display_name($variation, $product),
                $product->get_id()
            );
        }
    }

    return new WP_REST_Response(['products' => array_values($rows)], 200);
}

add_action('rest_api_init', function () {
    register_rest_route(AIOC_REST_NAMESPACE, '/products', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'ai_rest_get_products',
        'permission_callback' => 'ai_rest_permission_check',
        'args'                => [
            'search' => [
                'type'              => 'string',
                'required'          => true,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'limit' => [
                'type'              => 'integer',
                'default'           => 20,
                'sanitize_callback' => 'intval',
                // Bypasses the default integer validation so a non-numeric
                // value falls back to the default instead of erroring.
                'validate_callback' => '__return_true',
            ],
        ],
    ]);
});
