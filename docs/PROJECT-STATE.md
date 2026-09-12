# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v5.7**, Updated 2026-09-12. Live runs v4.9. Staging is
running at least **5.4** — its debug.log carried the `intval` fatal, which only exists
in 5.4+ — but the exact version is unconfirmed; re-check with `/ping`. 5.6 and 5.7 are
committed and not yet uploaded.

## Goal

A mobile-first PWA for WooCommerce staff to create, update, and trash orders, served
from a separate subdomain. Replaces using wp-admin on a phone. The existing AI text
parser becomes one feature inside it, not the whole tool.

## Environment

- Live: cartmixbd.com — plugin stays at v4.9, untouched by this work
- Staging: staging.cartmixbd.com — carries all 5.x work, test here only
- WooCommerce 11.0.1, HPOS enabled, table prefix `wp_`, hosted cPanel/MySQL
- Products are post status `private`; the storefront is unused, orders are taken
  internally. Product queries must include publish AND private.
- Variation post status encodes the Enabled checkbox — `private` means disabled.
  Variations do NOT inherit parent status. Variation queries are publish-only.
- Auth: WP core Application Passwords (Basic auth), user `t45km45ter`
- The Defender plugin truncates the application-password display in wp-admin,
  producing unusable credentials. Currently deactivated on staging. Must be handled
  before the PWA reaches live.
- Deploy is manual file upload to `wp-content/plugins/ai-order-creator/`. The plugin
  DIRECTORY NAME must never change — renaming deactivates it on the live site. After
  every upload, verify with `GET /aioc/v1/ping` and check the returned version matches
  the local plugin header. A stale version causes misleading 404s on new routes.
  `AIOC_VERSION` and the header `Version:` must be bumped together: `/ping` reports the
  constant, so a half-bump reports success while serving stale code.

## Conventions

- Function prefix `ai_` throughout. Do not rename existing functions.
- Layout: `includes/parsing/`, `includes/orders/`, `includes/rest/`,
  `includes/rest/routes/`, `admin/`
- REST namespace `aioc/v1`. Every route uses `ai_rest_permission_check()`
  (`manage_woocommerce`). No public routes.
- All money in REST responses is a raw numeric string at 2dp via
  `wc_format_decimal()` + `wc_get_price_decimals()`. Never `wc_price()`, never HTML,
  never currency symbols. The client formats.
  Note `includes/ajax.php` does the opposite — it feeds the legacy admin UI and is
  deliberately left alone.
- No raw SQL. Use `wc_get_orders()` / `wc_get_products()`.
- Pagination params clamp rather than 400.
- Never register a bare PHP built-in as a `sanitize_callback` or `validate_callback`.
  WordPress invokes them with three arguments (value, request, param name), so any
  built-in with a fixed arity of 2 or fewer is a latent PHP 8 fatal — `intval` cost a
  500 on every `/products` request. Use the single-argument `ai_rest_sanitize_*` /
  `ai_rest_validate_*` wrappers in `includes/rest/rest.php`. Every callback in the REST
  layer is an `ai_*` function, so `grep "_callback'.*=> '" | grep -v "ai_"` should stay
  empty.
- Logic files produce no output. Presentation lives in `admin/views/`.

## Product decisions

- Shipping is a pure function of billing state: BD-13 → 80 Dhaka Flat Rate,
  BD-18 → 120 Gazipur Flat Rate, all else → 150 Outside Dhaka Flat Rate. One rate
  table in `includes/orders/shipping.php`, called from the admin hooks and every REST
  write path. Auto-only; no manual override by design.
- All WooCommerce statuses are settable from the app, read from
  `wc_get_order_statuses()` rather than hardcoded.
- "Delete" means trash. Endpoints are `POST /orders/{id}/trash` and
  `POST /orders/{id}/restore`. No force-delete is reachable from the app.
- One order form, two ways to fill it: paste-and-parse, or type directly. Parsing is
  optional, never required.
- District is a dropdown of WooCommerce BD states, never free text — shipping depends
  on the state code resolving.
- `POST /parse` returns data and creates nothing. Always parse → review → save; never
  blind-create.
- Out-of-stock products are returned to the client with `is_in_stock` false, not
  filtered out. The picker greys them and blocks adding. Write endpoints must re-check
  stock independently.
- Staff search products by PRICE, not by name — they type "2500" to find the item
  costing 2500. `/products` matches a numeric term against the real price first, then
  name/SKU. Do not rely on this catalogue's names happening to embed the price; that is
  incidental, not a property of the data.
- The step 6 product picker must enforce the same 3-character minimum client-side
  (don't fire a request below it), debounce input at roughly 250–300ms, and cancel
  in-flight requests on each new keystroke so responses can't arrive out of order.
- Search minimum is 3 characters, so prices below 100 are not searchable by price.
  Accepted trade-off; revisit if sub-100 items appear.
- Product status rules are split on purpose (`includes/rest/routes/products.php`):
  `ai_rest_product_statuses()` returns publish + private and is used for the
  `wc_get_products()` status arg, the parent check and the exact-SKU path;
  `ai_rest_variation_status_allowed()` is publish-only, because a variation's status
  means enabled/disabled. Do not collapse these into one rule (5.4 did; 5.5 undid it).

## Build steps

| # | Step | State | Version |
|---|------|-------|---------|
| 1 | Logic/presentation split, shipping consolidation | done | 4.9 (`f0972a8`) |
| 2 | Restructure, Order Ops rename, REST foundation + ping | done | 5.0 (`9ab4bd3`) |
| 3a | Read endpoints — orders list, single order | done, **verified on staging** | 5.2 |
| 3b | Read endpoints — product search | done, never yet succeeded on staging; re-test needed | 5.3–5.7 |
| 4 | Write endpoints — parse, create, update, trash, restore | not started | — |
| 5 | PWA shell — subdomain, auth, order list | not started | — |
| 6 | Create/edit form with product picker | not started | — |
| 7 | Manifest, service worker, install prompt | not started | — |

Step 3b detail: 5.3 product search, 5.4 product status fix (private catalogue) +
response envelope + limit fallback, 5.5 variation status fix, 5.6 sanitize-callback
arity fatal, 5.7 price-first search + 3-char minimum. `/products` has never returned a
successful response on staging — it 500d under 5.4/5.5, and 5.6/5.7 are not uploaded.
Nothing in 5.4–5.7 is exercised.

v5.1 (`089ac2f`) was an unrelated parser fix (partial-duplicate names in the address),
not a build step.

Routes currently registered, all `GET`, all read-only:

- `GET /aioc/v1/ping` — `includes/rest/rest.php`
- `GET /aioc/v1/orders` — `includes/rest/routes/orders.php`
- `GET /aioc/v1/orders/{id}` — `includes/rest/routes/orders.php`
- `GET /aioc/v1/products` — `includes/rest/routes/products.php`

## Verified

Confirmed by real requests against staging.cartmixbd.com. **Step 3a (order read
endpoints) is fully verified.**

- `GET /ping` — 200, returns user and version.
- `GET /orders?per_page=3` — 4505 orders total, 1502 pages. Pagination arithmetic
  correct.
- `GET /orders/11323` — line item 3600.00 + shipping 80.00 = total 3680.00, matching
  the admin order screen. Billing state `BD-13` resolved to label "Dhaka".
- `GET /orders?search=01771160171` and `?search=8801771160171` — both return the same
  single order, confirming `ai_normalize_bd_phone()` prefix folding.
- `GET /orders?search=Fahmida` — matches mid-name ("Sumaiya Fahmida Neha"), confirming
  `'s'` + `search_filter => 'customers'` does partial name matching on HPOS. This was
  previously flagged unverified; it works.
- `GET /orders?status=pending` and `?status=wc-pending` — identical results, 48 orders,
  so `wc-` prefix normalization works.
- `GET /orders?status=nonsense` — 400 `aioc_invalid_status`.
- `GET /orders?per_page=100` — exactly 50 rows. Clamping works.
- Trash exclusion — two trashed orders absent from unfiltered results.
- `GET /products` with publish-only status returned an empty array. This is what
  identified the private-product-status problem that 5.4 fixes.
- `GET /products` returned 500 under 5.4/5.5, from an uncaught `ArgumentCountError` in
  `WP_REST_Request::sanitize_params()` — the `intval` sanitize callback. Confirmed in
  staging's debug.log; fixed in 5.6.

Next: upload 5.6, confirm `/ping` reports 5.6, then exercise `/products` (step 3b) and
record the results here. It has never returned a successful response.

## Unverified / open

- **How to query products by price.** `ai_rest_price_match_product_ids()` passes a
  `price` argument to `wc_get_products()`, which maps onto a `_price` meta comparison —
  a STRING match, so it alone would not match "250" against a stored "250.00". Whether
  WooCommerce 11.0.1 supports the argument at all is unconfirmed. The function therefore
  re-checks every candidate numerically in PHP, capped at 500 candidates, so results are
  correct either way and a silently-ignored argument degrades rather than floods. If
  staging shows the argument is ignored, the options are: pass a `meta_query` with
  `'type' => 'NUMERIC'` (needs confirming that `wc_get_products()` forwards `meta_query`),
  or read `wc_product_meta_lookup.min_price`, which is numeric but means raw SQL and is
  excluded by convention. Settle this before step 6.
- Price search finds variable parents by their `_price`, which WooCommerce syncs to the
  cheapest variation. A variation priced at the term under a parent with a cheaper
  variation is therefore not found. Unquantified — depends on whether this catalogue
  uses variable products with mixed prices.
- Whether `wc_get_products(['sku' => $term])` does partial or exact matching
- Whether that `sku` arg splits the term on commas
- Variation-level SKUs are only findable by exact match, via
  `wc_get_product_id_by_sku()` in `ai_rest_exact_sku_row()`. The parent-first search
  cannot reach a partial variation SKU.
- CORS has never been exercised — curl sends no Origin header. First real test is the
  PWA.
- WordPress core's `rest_send_cors_headers()` reflects any Origin API-wide.
  `ai_rest_cors_headers()` strips those headers for `aioc/v1` routes when the
  configured origin is empty or mismatched. Untested.
- Claude Code's environment has no php binary and no WooCommerce source, so nothing is
  linted or run there. Local checks are structural or simulated only; behaviour must be
  confirmed by curl against staging, as was done for step 3a.

## Housekeeping

- Rotate the live site's DB password and all eight wp-config salts — they were exposed.
- README.md and the CHANGELOG.md intro line still say "AI Order Creator" rather than
  "Order Ops".
- CHANGELOG.md is missing the 4.8 entry; the plugin header has it.

## Update rule

Update this file in the same commit as any change to code, endpoints, or decisions.
Move items from Unverified to Verified only after a real request against staging
confirms them. Keep it current rather than append-only — delete what's no longer true
instead of accumulating history. Git log is the history; this file is the present state.
