# Changelog

All notable changes to AI Order Creator are documented in this file.

## 5.4

- Fixed `GET /aioc/v1/products` returning nothing on this store. It filtered to published products only, but the catalogue is kept at post status `private` because the storefront is unused and orders are taken internally.
- Both `publish` and `private` are now accepted on every query path - the `s` name query, the `sku` query, and the variation expansion - via a single `ai_rest_product_statuses()` helper. `draft`, `pending` and `trash` remain excluded. Status is passed explicitly everywhere, since `wc_get_products()` defaults to `publish`.
- Catalog visibility (the `product_visibility` taxonomy) is deliberately not consulted: it governs storefront display, and a product hidden from the catalogue must still be addable to an order.
- The response is now wrapped as `{"products": [...]}` for consistency with the order endpoints, instead of a bare array.
- `limit=0` and non-numeric values now fall back to the default of 20 rather than clamping to 1. The hard max of 50 is unchanged.

## 5.3

- Added `GET /aioc/v1/products` (params `search`, required and at least 2 characters, and `limit`, default 20 and clamped to 50), gated by `ai_rest_permission_check()`.
- Returns a flat list of purchasable rows - one per item a staff member can add to an order. Simple products yield one row each; variable parents are excluded and each variation is returned as its own row, named with its attribute summary (e.g. `Cotton Shirt - Size: L, Colour: Blue`). Grouped, external and all other product types are skipped.
- Product name and SKU are matched independently, and both are returned exactly as stored.
- Out-of-stock items are included with `is_in_stock` false rather than filtered out, so the app can grey them out. Backordered items report `is_in_stock` true and are addable.
- Only published products and variations are returned; drafts, private and trashed are excluded. Prices use the same bare-numeric-string format as the order endpoints.

## 5.2

- Added read-only order endpoints to the `aioc/v1` namespace, both gated by `ai_rest_permission_check()`: `GET /orders` (params `page`, `per_page` capped at 50, `search`, `status`) and `GET /orders/{id}`.
- `search` runs the term through `ai_normalize_bd_phone()`: a valid BD mobile becomes an exact `billing_phone` lookup, anything else is treated as a customer-name search.
- `status` accepts a slug with or without the `wc-` prefix and rejects anything unrecognized with a 400. Trashed orders are excluded from results.
- All monetary values in the REST layer are bare numeric strings - no `wc_price()`, no currency symbols, no HTML. `includes/ajax.php` keeps its formatted output for the existing admin UI.
- Extracted the phone normalization that was inline in `includes/ajax.php` into `ai_normalize_bd_phone()` in `includes/parsing/phone.php`, now shared by the AJAX lookup, `ai_extract_phone_candidates()`, and the REST search.

## 5.1

- A name repeated only in part elsewhere in the message (e.g. "Monika Sarker Moni Monika Biswas" up top and just "Monika Sarker Moni" again further down) is now recognized as a partial repeat of the already-resolved name and excluded from the address, instead of leaking in as its own address segment.

## 5.0

- Renamed the plugin to **Order Ops**. The plugin folder, text domain, and `ai_` function prefixes are unchanged, so the live site stays activated.
- Reorganized `includes/` into `parsing/`, `orders/`, and `rest/` subdirectories, and moved `data/bd-locations.php` to `includes/parsing/data/bd-locations.php`. File moves only - no logic changes.
- Added a REST foundation under the `aioc/v1` namespace, authenticated with WP core Application Passwords (Basic auth) and gated on the `manage_woocommerce` capability via `ai_rest_permission_check()`. No route is public.
- Added a permanent `GET /aioc/v1/ping` route returning `ok`, `user`, and `version`, for verifying auth and CORS end to end.
- Added CORS support scoped to `aioc/v1` routes only, driven by the new **App Origin** setting. An unset or mismatched origin receives no CORS headers - there is no wildcard fallback. `OPTIONS` preflights get a 200 with headers and an empty body.

## 4.9

- Split the create path into logic and presentation: `ai_create_order_from_data()` in `includes/order-creator.php` now returns an order ID or `WP_Error` and produces no output, while the success/error notices and the debug details table moved to `ai_render_order_result()` in `admin/views/creator-result.php`.
- Consolidated the flat shipping rates into a single table in `includes/shipping.php` (`ai_get_shipping_rate()`), applied by `ai_apply_shipping()` from both the creator and the order-edit screen hooks.
- Fixed orders being saved with a total of 0: the create path never called `calculate_totals()`, which applying shipping now does.

## 4.7

- Removed every repeated raw-message occurrence of an extracted name or phone number while building the address, so duplicate details repeated near a signature no longer survive as address junk.

## 4.6

- Added alternate Bengali spellings for Tangail, Rangamati, and Chuadanga to the district/state list, improving detection across common spelling variants.

## 4.5

- Stopped treating a bare `location` as an address-wrapper label, preventing data loss for compound labels such as “Location & Postal Code”.
- Phone parsing now accepts a space or dash between the second and third digits.

## 4.4

- Recognized `M#`, `Mob#`, `Cell#`, and `Ph#` phone-label shorthand.
- Normalized `P,O`/`P,S` and underscore separators, and added `district`, `dist`, and `state` as removable address labels.

## 4.3

- Recognized `Add`/`Add:` as address labels and `Num`/`Num:` as phone labels.
- Added Babu Bazar to the Dhaka locality list.

## 4.2

- Recognized `Cell`, `Cell No`, and `Cell Number` phone labels.
- Removed common Bangla address/phone filler from addresses, added Mohammadia to the Dhaka locality list, and fixed `+880` phone parsing when separated by a space.

## 4.1

- Removed price detection from the deterministic parser and AI flow. Price is not supplied in the input, and its heuristics were misreading hyphen-attached house or plot numbers as prices and corrupting addresses.

## 4.0

- Prevented leftover labels from leaking into addresses, avoided treating numbered-list markers as field values, and made multi-line address labels capture their continuation lines.

## 3.9

- Split the single-file plugin into a multi-file structure (mechanical refactor; no logic changes).
