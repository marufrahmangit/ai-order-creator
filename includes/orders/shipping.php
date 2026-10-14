<?php
if (!defined('ABSPATH')) exit;

/**
 * The rates this plugin ships with, used to seed the option and as the fallback
 * when it is absent or unreadable.
 *
 * NOT the live table - call ai_get_shipping_rates() for that. These values are
 * only what a site starts from, and once the setting has been saved once they
 * are never consulted again. Changing them here changes nothing on a site that
 * has already saved its rates.
 *
 * @return array{default:array{cost:int,label:string},by_state:array<string,array{cost:int,label:string}>}
 */
function ai_default_shipping_rates() {
    return [
        'default'  => ['cost' => 150, 'label' => 'Outside Dhaka Flat Rate'],
        'by_state' => [
            'BD-13' => ['cost' => 80,  'label' => 'Dhaka Flat Rate'],
            'BD-18' => ['cost' => 120, 'label' => 'Gazipur Flat Rate'],
            'BD-45' => ['cost' => 120, 'label' => 'Nawabganj Flat Rate'],
        ],
    ];
}

/**
 * Coerce a stored rate table into the shape every caller expects, or null.
 *
 * Returns null rather than a partial table when the value cannot be trusted, so
 * ai_get_shipping_rates() can fall back whole rather than serving half a table.
 * A per-state row missing a usable cost is DROPPED rather than defaulted to
 * zero: an unlisted district falls to the default rate, which is a sane figure,
 * whereas a zero row would charge nothing and look deliberate.
 *
 * @param mixed $raw
 * @return array|null
 */
function ai_normalize_shipping_rates($raw) {
    if (!is_array($raw) || !isset($raw['default']) || !is_array($raw['default'])) {
        return null;
    }

    if (!isset($raw['default']['cost']) || !is_numeric($raw['default']['cost'])) {
        return null;
    }

    $rates = [
        'default' => [
            'cost'  => (float) $raw['default']['cost'],
            'label' => (string) ($raw['default']['label'] ?? ''),
        ],
        'by_state' => [],
    ];

    $by_state = isset($raw['by_state']) && is_array($raw['by_state']) ? $raw['by_state'] : [];
    foreach ($by_state as $code => $rate) {
        $code = trim((string) $code);
        if ($code === '' || !is_array($rate) || !isset($rate['cost']) || !is_numeric($rate['cost'])) {
            continue;
        }
        $rates['by_state'][$code] = [
            'cost'  => (float) $rate['cost'],
            'label' => (string) ($rate['label'] ?? ''),
        ];
    }

    return $rates;
}

/**
 * THE shipping rate table. The only one.
 *
 * SOURCE: the `ai_shipping_rates` option, edited in Order Ops > Settings. It
 * moved out of this file in 7.7 because a rate change had become a recurring
 * task, and in code that meant editing a file and uploading the plugin to two
 * sites for what is a number. A rate change is now a settings change, and
 * needs no plugin upload and NO APP REBUILD - the app reads the table from
 * GET /meta.
 *
 * SEEDED LAZILY, on first read, not on activation. There is no activation hook
 * in this plugin and the plugin is already active on both sites, so an upload
 * does not re-activate it - a register_activation_hook() seed would never fire
 * where it is needed and the sites would come up with no rates at all. Reading
 * through a fallback also survives the option being deleted, and keeps every
 * read path free of writes: nothing is persisted until someone saves the
 * settings form.
 *
 * These rates have nothing to do with WooCommerce's shipping zones or methods -
 * WooCommerce > Settings > Shipping is never consulted. ai_apply_shipping()
 * writes a flat_rate line from this table directly.
 *
 * A second copy anywhere, in PHP or JS or a test, would be a second source of
 * truth, and the one that disagreed would be the one staff read out. Tests read
 * this accessor; they do not restate rates.
 *
 * @return array{default:array{cost:float|int,label:string},by_state:array<string,array{cost:float|int,label:string}>}
 */
function ai_get_shipping_rates() {
    $stored = ai_normalize_shipping_rates(get_option(AIOC_SHIPPING_RATES_OPTION, null));

    return $stored === null ? ai_default_shipping_rates() : $stored;
}

/**
 * The rate for one state code, defaulting to Outside Dhaka.
 *
 * Note what this does NOT decide: whether a shipping line is added at all.
 * An EMPTY state code returns the default here, but ai_apply_shipping() never
 * asks - it returns early and adds no line. So the default applies to a state
 * that is set but unrecognized, not to an order with no district.
 *
 * @param string $state_code WooCommerce state code (e.g. 'BD-13').
 * @return array{cost:int,label:string}
 */
function ai_get_shipping_rate($state_code) {
    $rates = ai_get_shipping_rates();
    $code  = (string) $state_code;

    return isset($rates['by_state'][$code]) ? $rates['by_state'][$code] : $rates['default'];
}

/**
 * Sanitize and VALIDATE the rate table coming out of the settings form.
 *
 * Registered as the setting's sanitize_callback, so it is the only way a rate
 * reaches the option. Named ai_* per the namespace rule that no bare built-in
 * is ever registered as a *_callback.
 *
 * REJECTS RATHER THAN REPAIRS. WordPress has no "refuse this save" return
 * value for a sanitize callback, so a rejected submission adds a settings error
 * and returns the CURRENT stored value - the form comes back with a red notice
 * naming the problem and nothing is written. Quietly coercing a bad figure is
 * what this must not do: a rate silently saved as 0, or attached to a district
 * code that does not exist, charges the wrong money and looks deliberate. That
 * is the 7.4 defect - a value that was plausible and unreachable - in a new
 * place.
 *
 * What is rejected, each with its own message:
 *   - a cost that is not numeric, or is negative
 *   - a district code WooCommerce does not know (the select should make this
 *     impossible, so reaching it means a crafted or stale POST)
 *   - the same district twice
 *   - an empty label, on any row including the default
 *
 * An empty district code with an otherwise empty row is DROPPED, not rejected:
 * that is the blank row the "Add rate" button leaves behind when someone
 * changes their mind, and erroring on it would be hostile.
 *
 * @param mixed $value Raw $_POST value for the option.
 * @return array The table to store, or the current one if the submission is bad.
 */
function ai_sanitize_shipping_rates($value) {
    $current = ai_get_shipping_rates();

    $reject = function ($message) use ($current) {
        add_settings_error(
            AIOC_SHIPPING_RATES_OPTION,
            'aioc_shipping_rates_invalid',
            'Shipping rates not saved: ' . $message,
            'error'
        );
        return $current;
    };

    if (!is_array($value)) {
        return $reject('the form submitted nothing usable.');
    }

    // ---- the default rate, which every unlisted district falls back to ----
    $default_cost  = isset($value['default']['cost']) ? trim((string) $value['default']['cost']) : '';
    $default_label = isset($value['default']['label']) ? trim((string) $value['default']['label']) : '';

    if ($default_cost === '' || !is_numeric($default_cost)) {
        return $reject('the default rate needs a number for its cost.');
    }
    if ((float) $default_cost < 0) {
        return $reject('the default rate cannot be negative.');
    }
    if ($default_label === '') {
        return $reject('the default rate needs a label - it is what the customer sees on the order.');
    }

    $rates = [
        'default'  => ['cost' => (float) $default_cost, 'label' => $default_label],
        'by_state' => [],
    ];

    // ---- per-district rows -------------------------------------------------
    $states = (function_exists('WC') && WC()) ? WC()->countries->get_states('BD') : [];
    $rows = isset($value['by_state']) && is_array($value['by_state']) ? $value['by_state'] : [];

    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }

        $code  = isset($row['code']) ? trim((string) $row['code']) : '';
        $cost  = isset($row['cost']) ? trim((string) $row['cost']) : '';
        $label = isset($row['label']) ? trim((string) $row['label']) : '';

        // An untouched blank row from "Add rate".
        if ($code === '' && $cost === '' && $label === '') {
            continue;
        }

        if ($code === '') {
            return $reject('every rate needs a district. Pick one, or remove the row.');
        }
        if (!is_array($states) || !isset($states[$code])) {
            // The select cannot produce this; a stale or crafted POST can.
            return $reject(sprintf('"%s" is not a Bangladesh district code WooCommerce knows.', $code));
        }
        if (isset($rates['by_state'][$code])) {
            $name = is_array($states) ? trim((string) $states[$code]) : $code;
            return $reject(sprintf('%s appears twice. Each district can have one rate.', $name));
        }
        if ($cost === '' || !is_numeric($cost)) {
            $name = trim((string) $states[$code]);
            return $reject(sprintf('%s needs a number for its cost.', $name));
        }
        if ((float) $cost < 0) {
            $name = trim((string) $states[$code]);
            return $reject(sprintf('%s cannot have a negative cost.', $name));
        }
        if ($label === '') {
            $name = trim((string) $states[$code]);
            return $reject(sprintf('%s needs a label - it is what the customer sees on the order.', $name));
        }

        $rates['by_state'][$code] = ['cost' => (float) $cost, 'label' => $label];
    }

    return $rates;
}

/**
 * Replace the order's shipping lines with the flat rate for its billing state.
 *
 * NO DISTRICT MEANS NO SHIPPING, and that has to hold whether the order never
 * had a district or had one and lost it. So the removal is UNCONDITIONAL and
 * happens first, and the totals are always recalculated. Only the adding of a
 * new line depends on there being a state.
 *
 * This function used to return early on an empty state, before removing
 * anything, which caused two separate bugs: an order whose district was cleared
 * kept the old rate on it and in its total (order 11361 on staging, left with a
 * 120.00 Gazipur line and no district), and nothing recalculated totals, which
 * ai_rest_finalize_order() worked around by calling calculate_totals() itself.
 * Both came from the same early return. Do not reintroduce it - "skip when
 * there is nothing to add" is not the same as "skip when there is nothing to
 * do", and an order that had a district is the case where they differ.
 *
 * @param WC_Order $order
 * @return void
 */
function ai_apply_shipping(WC_Order $order) {
    $state_code = $order->get_billing_state();

    // First, and whatever the state is. A line left behind here is a figure on
    // a customer's invoice that nothing in this plugin will remove later.
    foreach ($order->get_items('shipping') as $item_id => $shipping_item) {
        $order->remove_item($item_id);
    }

    $rate = null;
    if (!empty($state_code)) {
        $rate = ai_get_shipping_rate($state_code);

        $shipping = new WC_Order_Item_Shipping();
        $shipping->set_method_id('flat_rate');
        $shipping->set_method_title($rate['label']);
        $shipping->set_total($rate['cost']);
        $order->add_item($shipping);
    }

    // WC_Abstract_Order::calculate_totals() ends with $this->save(), so it
    // persists the removed and added shipping lines along with the
    // recalculated totals. Do not add a save() here - it would be a redundant
    // second write. It runs on BOTH paths: with no state there is still a
    // removal to persist and a total to bring down.
    $order->calculate_totals();

    ai_log(
        $rate === null ? 'Shipping cleared: no billing state' : 'Shipping applied',
        [
            'order' => $order->get_id(),
            'state' => $state_code,
            'cost'  => $rate === null ? 0 : $rate['cost'],
            'label' => $rate === null ? '' : $rate['label'],
        ]
    );
}

/**
 * Hook bridge: both admin hooks hand us an order ID, ai_apply_shipping() wants
 * the order object.
 *
 * @param int $order_id
 * @return void
 */
function ai_apply_shipping_to_order_id($order_id) {
    if (!is_admin()) {
        return;
    }

    $order = wc_get_order($order_id);
    if (!$order instanceof WC_Order) {
        return;
    }

    ai_apply_shipping($order);
}

add_action('woocommerce_process_shop_order_meta', 'ai_apply_shipping_to_order_id', 60);
add_action('woocommerce_before_save_order_items', 'ai_apply_shipping_to_order_id');
