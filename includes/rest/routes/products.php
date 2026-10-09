<?php
if (!defined('ABSPATH')) exit;

/**
 * How many candidate ids from each block get turned into rows before sorting.
 *
 * Ordering by price has to happen after the rows exist, because a row's price
 * comes from the product object - there is no confirmed way to order by price
 * in wc_get_products() without raw SQL. So the sort needs more rows than the
 * caller's limit, and a broad term like "three" can match hundreds of ids.
 *
 * This bounds that work. A term matching more than this many candidates is
 * sorted within the first 500 only, in whatever order the query returned them
 * (title). That degradation is deliberate and bounded; it mirrors the existing
 * cap in ai_rest_price_match_product_ids().
 */
define('AIOC_PRODUCT_SORT_WINDOW', 500);

/**
 * Warm the post, meta and term caches for a set of product ids in one pass.
 *
 * Call this immediately before a loop that turns ids into product objects.
 * Without it, wc_get_product() goes to the database per id, three times over:
 *
 *   - WC_Product_Data_Store_CPT::read() calls get_post()      -> post cache
 *   - read_product_data() calls get_post_meta()               -> meta cache
 *   - get_product_type() calls get_the_terms($id,'product_type'),
 *     and read_visibility() reads product_visibility          -> term cache
 *
 * _prime_post_caches() fills all three in up to three queries total, and its
 * first query fetches only ids not already cached, so calling it again for an
 * overlapping set costs almost nothing. That is why the price block and the
 * row loop can both prime without the second one being wasted work.
 *
 * All three flags matter. Priming posts but not terms would leave
 * get_product_type() issuing a term query per product, which is a third of the
 * problem left in place.
 *
 * WooCommerce has no product equivalent of
 * WC_Order_Data_Store_CPT::prime_caches_for_orders() - checked against the
 * 11.0 code reference, WC_Product_Data_Store_CPT has no priming method at all.
 * Nor would the wc_product_meta_lookup table help here: that table serves the
 * search QUERIES (price, stock), not product hydration, so priming it would
 * warm something this loop never reads. The product object cache added in
 * WooCommerce 10.5 is request-scoped and deduplicates repeat lookups of the
 * same id; this loop visits each id once, so it has nothing to offer either.
 *
 * _prime_post_caches() carries an underscore because it was marked private
 * before WordPress 6.1, where it became public API. Guarded anyway: if it is
 * ever absent, hydration simply reverts to the pre-6.3 per-id behaviour rather
 * than failing.
 *
 * @param int[] $ids
 * @return void
 */
function ai_rest_prime_product_caches(array $ids) {
    if (!function_exists('_prime_post_caches')) {
        return;
    }

    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if (empty($ids)) {
        return;
    }

    _prime_post_caches($ids, true, true);
}

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
 * Whether the request asked for the trimmed picker row shape.
 *
 * Anything other than exactly 'picker' - including an absent or misspelled
 * value - yields the full row. An unrecognised value is not an error, in
 * keeping with this namespace's habit of clamping rather than rejecting: a
 * client that sends fields=pickr gets more data than it wanted, not a 400.
 *
 * @param mixed $fields
 * @return bool
 */
function ai_rest_wants_picker_fields($fields) {
    return strtolower(trim((string) $fields)) === 'picker';
}

/**
 * Build one flat purchasable row.
 *
 * Shared by simple products and variations so the two row shapes cannot drift.
 * Name is passed in because a variation's display name is assembled from its
 * parent, and SKU/price are returned exactly as stored - no formatting, no
 * parent fallback, no assumptions about their content.
 *
 * With $picker true, only the five fields the product picker actually reads
 * are returned. That is not merely a smaller payload: it also skips
 * ai_rest_product_thumbnail() entirely, which would otherwise cost an
 * attachment lookup per row for a field that is null throughout this store.
 *
 * The full shape is byte-for-byte what it was before 6.2 - the default must
 * stay exactly as verified.
 *
 * @param WC_Product $product   The purchasable object (simple product or variation).
 * @param string     $name      Full display name.
 * @param int        $parent_id Variable parent id, or 0.
 * @param bool       $picker    Return the trimmed picker shape.
 * @return array
 */
function ai_rest_prepare_product_row(WC_Product $product, $name, $parent_id, $picker = false) {
    if ($picker) {
        return [
            'id'          => (int) $product->get_id(),
            'name'        => (string) $name,
            'sku'         => (string) $product->get_sku(),
            'price'       => ai_rest_money($product->get_price()),
            'is_in_stock' => (bool) $product->is_in_stock(),
        ];
    }

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
 * The 'title' ordering here is no longer what the client sees - the handler
 * re-sorts by price - but it is kept so that a term matching more candidates
 * than AIOC_PRODUCT_SORT_WINDOW cuts a stable, repeatable window rather than
 * an arbitrary one.
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
 * Split a search term into its price part and its text parts.
 *
 * Staff search by price and by name in roughly equal measure, and sometimes by
 * both at once - "three 2500" meaning "the one called three that costs 2500".
 * Splitting on whitespace is what makes that expressible without a query
 * syntax anyone has to learn.
 *
 * Modes:
 *
 *   compound - exactly one numeric part AND at least one non-numeric part.
 *              Word order is irrelevant: "three 2500" and "2500 three" parse
 *              identically.
 *   price    - the whole trimmed term is a bare price figure.
 *   text     - everything else, with the WHOLE term kept intact as one text
 *              string. "batik gauze" searches for "batik gauze", not for
 *              "batik" and "gauze" separately, which is the pre-6.2 behaviour
 *              and stays unchanged.
 *
 * Two or more numeric parts ("three 2500 1000") fall back to text rather than
 * guessing which figure is the price. Several text parts alongside one number
 * ("batik gauze 250") is a compound query where every text part must match.
 *
 * @param string $search Already trimmed.
 * @return array{mode: string, text: string[], price: string, term: string}
 */
function ai_rest_parse_search_term($search) {
    $search = trim((string) $search);

    $parts = preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY);
    if (!is_array($parts)) {
        $parts = [];
    }

    $numeric = [];
    $text    = [];
    foreach ($parts as $part) {
        if (ai_rest_is_price_term($part)) {
            $numeric[] = $part;
        } else {
            $text[] = $part;
        }
    }

    if (count($numeric) === 1 && count($text) >= 1) {
        return ['mode' => 'compound', 'text' => $text, 'price' => $numeric[0], 'term' => $search];
    }

    if (ai_rest_is_price_term($search)) {
        return ['mode' => 'price', 'text' => [], 'price' => $search, 'term' => $search];
    }

    return ['mode' => 'text', 'text' => [$search], 'price' => '', 'term' => $search];
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

    $candidates = array_slice($ids, 0, AIOC_PRODUCT_SORT_WINDOW);
    ai_rest_prime_product_caches($candidates);

    foreach ($candidates as $id) {
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
 * Product ids matching every text part AND the price part.
 *
 * The INTERSECTION, not a union: "three 2500" means products called three that
 * cost 2500, and an empty intersection is the honest answer. There is
 * deliberately no fallback to a broader search - a staff member who gets
 * nothing back retypes, whereas one who gets a silently widened list has to
 * notice that the rows do not match what they asked for.
 *
 * Short-circuits as soon as any part contributes nothing, which is what keeps
 * a hopeless compound term ("three 99999") down to a single query.
 *
 * @param string[] $text_parts
 * @param string   $price
 * @return int[]
 */
function ai_rest_compound_search_ids(array $text_parts, $price) {
    $price_ids = ai_rest_price_match_product_ids($price);
    if (empty($price_ids)) {
        return [];
    }

    $text_ids = null;

    foreach ($text_parts as $part) {
        $part_ids = ai_rest_search_parent_product_ids($part);
        if (empty($part_ids)) {
            return [];
        }

        // Every text part must match, so each one narrows the set further.
        $text_ids = ($text_ids === null)
            ? $part_ids
            : array_intersect($text_ids, $part_ids);

        if (empty($text_ids)) {
            return [];
        }
    }

    if ($text_ids === null) {
        return [];
    }

    // array_intersect keeps the first argument's order; the handler sorts
    // afterwards regardless, so this only needs to be deterministic.
    return array_values(array_intersect($price_ids, $text_ids));
}

/**
 * Candidate id blocks for a parsed term, in the order they should appear.
 *
 * Blocks are kept separate rather than flattened because the sort applies
 * WITHIN a block, never across them: an exact price match must not be pushed
 * below a cheaper substring match.
 *
 *   compound - one block, the intersection.
 *   price    - Block A (exact price matches), then Block B (name/SKU).
 *   text     - one block, name/SKU.
 *
 * Replaces ai_rest_product_search_ids(), which flattened A and B together and
 * so could not support a per-block sort.
 *
 * @param array $term From ai_rest_parse_search_term().
 * @return array<int, int[]>
 */
function ai_rest_product_search_blocks(array $term) {
    if ($term['mode'] === 'compound') {
        return [ai_rest_compound_search_ids($term['text'], $term['price'])];
    }

    if ($term['mode'] === 'price') {
        return [
            ai_rest_price_match_product_ids($term['price']),
            ai_rest_search_parent_product_ids($term['term']),
        ];
    }

    return [ai_rest_search_parent_product_ids($term['term'])];
}

/**
 * Sort key for a row's price, or null when it has none.
 *
 * A product saved with no price at all yields an empty `price` string. Those
 * sort AFTER every priced row: they carry no information for a price-ordered
 * list, and putting them first would push real matches down the screen on
 * every search.
 *
 * @param array $row
 * @return float|null
 */
function ai_rest_row_price_rank(array $row) {
    $raw = (string) ($row['price'] ?? '');

    return $raw === '' ? null : (float) $raw;
}

/**
 * Compare two rows: price ascending, then name.
 *
 * Name is compared naturally rather than byte-wise, because byte order is the
 * very defect this ordering replaces - as a string, "10000" sorts before
 * "1050". strnatcasecmp() puts embedded figures in numeric order, so equal
 * priced rows read sensibly too.
 *
 * @param array $a
 * @param array $b
 * @return int
 */
function ai_rest_compare_product_rows(array $a, array $b) {
    $price_a = ai_rest_row_price_rank($a);
    $price_b = ai_rest_row_price_rank($b);

    if ($price_a === null || $price_b === null) {
        // Both unpriced falls through to the name comparison.
        if ($price_a !== $price_b) {
            return $price_a === null ? 1 : -1;
        }
    } elseif (abs($price_a - $price_b) >= 0.00001) {
        return $price_a < $price_b ? -1 : 1;
    }

    return strnatcasecmp((string) ($a['name'] ?? ''), (string) ($b['name'] ?? ''));
}

/**
 * Sort one block's rows by price ascending, then name.
 *
 * @param array[] $rows
 * @return array[]
 */
function ai_rest_sort_product_rows(array $rows) {
    usort($rows, 'ai_rest_compare_product_rows');

    return $rows;
}

/**
 * Turn one block's candidate ids into rows.
 *
 * Simple products yield one row each; a variable parent is not purchasable, so
 * it yields a row per enabled variation instead and never one of its own.
 * Every other product type is skipped outright.
 *
 * $seen is shared across blocks and mutated, which is what deduplicates the
 * final list - including against the exact-SKU row the handler adds first.
 *
 * @param int[] $ids
 * @param array $seen   Id => true, by reference.
 * @param bool  $picker Trimmed row shape.
 * @return array[]
 */
function ai_rest_rows_for_ids(array $ids, array &$seen, $picker = false) {
    $rows = [];

    $candidates = array_slice($ids, 0, AIOC_PRODUCT_SORT_WINDOW);

    // The whole window in three queries, before a single wc_get_product().
    // This loop is where the sort window costs what it costs: a broad text
    // term hydrates every candidate so it can be sorted by price.
    ai_rest_prime_product_caches($candidates);

    foreach ($candidates as $candidate_id) {
        if (count($rows) >= AIOC_PRODUCT_SORT_WINDOW) {
            break;
        }

        $product = wc_get_product($candidate_id);
        if (!$product instanceof WC_Product || !ai_rest_product_status_allowed($product)) {
            continue;
        }

        if ($product->is_type('simple')) {
            $id = (int) $product->get_id();
            if (isset($seen[$id])) {
                continue;
            }

            $seen[$id] = true;
            $rows[]    = ai_rest_prepare_product_row($product, $product->get_name(), 0, $picker);
            continue;
        }

        if (!$product->is_type('variable')) {
            continue;
        }

        $children = $product->get_children();

        // Same priming for a parent's variations, which are ids this loop only
        // learns after the parent is read. UNTESTABLE in this catalogue - it
        // has no variable products - but it is a cache warm with no behavioural
        // effect, so it cannot change what is returned either way.
        ai_rest_prime_product_caches($children);

        foreach ($children as $variation_id) {
            if (count($rows) >= AIOC_PRODUCT_SORT_WINDOW) {
                break 2;
            }

            $id = (int) $variation_id;
            if (isset($seen[$id])) {
                continue;
            }

            $variation = wc_get_product($id);
            if (!$variation instanceof WC_Product_Variation) {
                continue;
            }

            if (!ai_rest_variation_status_allowed($variation)) {
                continue;
            }

            $seen[$id] = true;
            $rows[]    = ai_rest_prepare_product_row(
                $variation,
                ai_rest_variation_display_name($variation, $product),
                (int) $product->get_id(),
                $picker
            );
        }
    }

    return $rows;
}

/**
 * Row for a single variation, or null if it is not usable.
 *
 * @param WC_Product_Variation $variation
 * @param bool                 $picker
 * @return array|null
 */
function ai_rest_variation_row(WC_Product_Variation $variation, $picker = false) {
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
        $parent->get_id(),
        $picker
    );
}

/**
 * Resolve an exact SKU hit, covering variation-level SKUs.
 *
 * ai_rest_search_parent_product_ids() only ever matches parents, so a SKU that
 * belongs to a variation rather than its parent would otherwise be unfindable.
 * wc_get_product_id_by_sku() looks across products and variations alike. This
 * is exact-match only - see docs/VERIFICATION.md.
 *
 * @param string $search
 * @param bool   $picker
 * @return array|null A row, or null if nothing usable matched.
 */
function ai_rest_exact_sku_row($search, $picker = false) {
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
        return ai_rest_variation_row($product, $picker);
    }

    if ($product->is_type('simple') && ai_rest_product_status_allowed($product)) {
        return ai_rest_prepare_product_row($product, $product->get_name(), 0, $picker);
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
    $started = microtime(true);

    $search = trim((string) $request->get_param('search'));

    // The minimum applies to the whole trimmed term, not to each part of a
    // compound one - "abc 250" is a 7-character search.
    if (mb_strlen($search) < AIOC_SEARCH_MIN_LENGTH) {
        return new WP_Error(
            'aioc_search_too_short',
            sprintf(
                /* translators: %d: the minimum number of characters. */
                __('The search term must be at least %d characters.', 'ai-order-creator'),
                AIOC_SEARCH_MIN_LENGTH
            ),
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

    $picker = ai_rest_wants_picker_fields($request->get_param('fields'));
    $term   = ai_rest_parse_search_term($search);

    $seen = [];
    $rows = [];

    // An exact SKU hit leads, so a scanned or pasted SKU surfaces first.
    //
    // Skipped for a compound term: the term there is a phrase plus a figure,
    // which no SKU realistically equals, and a row admitted this way would sit
    // outside the intersection - breaking the rule that an empty intersection
    // returns an empty list rather than something approximate.
    if ($term['mode'] !== 'compound') {
        $exact = ai_rest_exact_sku_row($search, $picker);
        if ($exact !== null) {
            $seen[$exact['id']] = true;
            $rows[]             = $exact;
        }
    }

    foreach (ai_rest_product_search_blocks($term) as $block_ids) {
        // The block's queries have already run by this point, so this saves
        // product loading rather than SQL. Worth it anyway: Block B can be
        // hundreds of ids that the limit would discard.
        if (count($rows) >= $limit) {
            break;
        }

        $rows = array_merge($rows, ai_rest_sort_product_rows(ai_rest_rows_for_ids($block_ids, $seen, $picker)));
    }

    // The limit applies to the combined list, so Block A fills it first.
    $rows = array_slice($rows, 0, $limit);

    return new WP_REST_Response([
        'products' => $rows,
        // Wall-clock milliseconds inside this handler. Diagnostic: it
        // separates query work from network round-trip when the picker feels
        // slow on mobile data.
        'timing_ms' => (int) round((microtime(true) - $started) * 1000),
    ], 200);
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
            'fields' => [
                'type'              => 'string',
                'sanitize_callback' => 'ai_rest_sanitize_text',
                // No default and no enum: an unrecognised value yields the
                // full row rather than a 400. See ai_rest_wants_picker_fields().
                'validate_callback' => 'ai_rest_validate_any',
            ],
        ],
    ]);
});
