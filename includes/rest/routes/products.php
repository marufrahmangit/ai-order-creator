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
 * Whether a variation's own post status allows it to be returned.
 *
 * Publish-only, deliberately narrower than ai_rest_product_status_allowed():
 * a variation's post status encodes its Enabled checkbox, so 'private' there
 * means disabled, and a disabled variation must never be addable to an order.
 *
 * Variations do NOT inherit their parent's status, so this stays correct for
 * this store's private catalogue - a private parent's enabled variations are
 * still 'publish'. The parent itself is checked with the wider product rule.
 *
 * @param WC_Product_Variation $variation
 * @return bool
 */
function ai_rest_variation_status_allowed(WC_Product_Variation $variation) {
    return $variation->get_status() === 'publish';
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
 * Whether a search term is a bare price figure.
 *
 * Digits with an optional single decimal part. Deliberately stricter than
 * is_numeric(), which would also accept "-5", "1e3" and leading "+".
 *
 * @param string $search
 * @return bool
 */
function ai_rest_is_price_term($search) {
    return (bool) preg_match('/^\d+(\.\d+)?$/', $search);
}

/**
 * Plausible stored representations of a price term.
 *
 * _price is written through wc_format_decimal(), so the same figure can sit in
 * the database as "2500" or "2500.00" depending on how it was saved. Passing
 * the set narrows the SQL; exact correctness is enforced in PHP afterwards.
 *
 * @param string $search
 * @return string[]
 */
function ai_rest_price_meta_candidates($search) {
    $decimals = wc_get_price_decimals();
    $value    = (float) $search;

    $candidates = [
        (string) $search,
        (string) wc_format_decimal($value, $decimals),
        (string) wc_format_decimal($value, $decimals, true),
        (string) wc_format_decimal($value),
    ];

    return array_values(array_unique(array_filter($candidates, 'strlen')));
}

/**
 * Product ids whose effective current price equals a numeric term.
 *
 * Block A of the search. Matches on the product's real price, independent of
 * its name or SKU. get_price() returns the effective price - the sale price
 * when a product is on sale - which is the same figure the row's `price` field
 * reports.
 *
 * wc_get_products()'s 'price' argument maps onto a _price meta comparison.
 * Staging testing at v5.7 on WooCommerce 11.0.1 confirmed it does genuinely
 * narrow the query - it is the primary mechanism, not a no-op.
 *
 * The PHP re-check below is therefore defence in depth rather than what makes
 * this work. It still earns its place: the meta comparison is a STRING match,
 * so it guarantees "250" matches a stored "250.00", and if the argument's
 * behaviour ever changes and the query degrades to "all products", the endpoint
 * returns only true price matches instead of the whole catalogue. The candidate
 * scan is capped so that degraded case stays bounded.
 *
 * Isolated here so the lookup can be swapped or removed without touching the
 * handler, the same way ai_rest_apply_search_arg() is in the orders route.
 *
 * @param string $search
 * @return int[]
 */
function ai_rest_price_match_product_ids($search) {
    if (!ai_rest_is_price_term($search)) {
        return [];
    }

    $ids = wc_get_products([
        'status'  => ai_rest_product_statuses(),
        'type'    => ['simple', 'variable'],
        'limit'   => -1,
        'return'  => 'ids',
        'orderby' => 'title',
        'order'   => 'ASC',
        'price'   => ai_rest_price_meta_candidates($search),
    ]);

    if (!is_array($ids)) {
        return [];
    }

    $target  = (float) $search;
    $matched = [];

    foreach (array_slice($ids, 0, 500) as $id) {
        $product = wc_get_product($id);
        if (!$product instanceof WC_Product) {
            continue;
        }

        // Numeric comparison, so "250" matches a stored "250.00".
        if (abs((float) $product->get_price() - $target) < 0.00001) {
            $matched[] = (int) $id;
        }
    }

    return $matched;
}

/**
 * Ordered candidate ids for a search term: price matches first, then name/SKU.
 *
 * Block A then Block B, deduplicated keeping the first occurrence, so price
 * matches fill the limit before name/SKU matches get the remaining slots. A
 * non-numeric term skips Block A entirely and the result is exactly the
 * previous name/SKU ordering.
 *
 * @param string $search
 * @return int[]
 */
function ai_rest_product_search_ids($search) {
    return array_values(array_unique(array_merge(
        ai_rest_price_match_product_ids($search),
        ai_rest_search_parent_product_ids($search)
    )));
}

/**
 * Row for a single variation, or null if it is not usable.
 *
 * @param WC_Product_Variation $variation
 * @return array|null
 */
function ai_rest_variation_row(WC_Product_Variation $variation) {
    if (!ai_rest_variation_status_allowed($variation)) {
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
 * is exact-match only - see docs/PROJECT-STATE.md.
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

    if (mb_strlen($search) < 3) {
        return new WP_Error(
            'aioc_search_too_short',
            __('The search term must be at least 3 characters.', 'ai-order-creator'),
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

    foreach (ai_rest_product_search_ids($search) as $parent_id) {
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

            if (!ai_rest_variation_status_allowed($variation)) {
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
                'sanitize_callback' => 'ai_rest_sanitize_text',
            ],
            'limit' => [
                'type'              => 'integer',
                'default'           => 20,
                'sanitize_callback' => 'ai_rest_sanitize_int',
                // Bypasses the default integer validation so a non-numeric
                // value falls back to the default instead of erroring.
                'validate_callback' => 'ai_rest_validate_any',
            ],
        ],
    ]);
});
