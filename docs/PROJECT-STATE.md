# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v5.4**, Updated 2026-09-08. Live runs v4.9. Staging last
received **5.3**; 5.4 is committed but NOT yet uploaded, so the private-product fix is
not live on staging.

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

## Build steps

| # | Step | State | Version |
|---|------|-------|---------|
| 1 | Logic/presentation split, shipping consolidation | done | 4.9 (`f0972a8`) |
| 2 | Restructure, Order Ops rename, REST foundation + ping | done | 5.0 (`9ab4bd3`) |
| 3a | Read endpoints — orders list, single order | done, **verified on staging** | 5.2 |
| 3b | Read endpoints — product search | done, awaiting first staging test | 5.3–5.4 |
| 4 | Write endpoints — parse, create, update, trash, restore | not started | — |
| 5 | PWA shell — subdomain, auth, order list | not started | — |
| 6 | Create/edit form with product picker | not started | — |
| 7 | Manifest, service worker, install prompt | not started | — |

Step 3b detail: 5.3 product search, 5.4 product status fix (private catalogue) +
response envelope + limit fallback. 5.4 has not been uploaded to staging, so nothing in
it has been exercised.

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

Next: upload 5.4 to staging, re-check `/ping` reports 5.4, then exercise `/products`
(step 3b) and record the results here.

## Unverified / open

- **Variation status filter contradicts the stated rule.** The Environment section
  above says variation queries are publish-only, because `private` means disabled.
  `includes/rest/routes/products.php` currently accepts publish AND private for
  variations, at `ai_rest_variation_row()` and in the expansion loop inside
  `ai_rest_get_products()` — both call `ai_rest_product_status_allowed()`, which
  returns `['publish','private']`. As written, **disabled variations are returned and
  addable to orders.** The parent and query-level checks should keep both statuses;
  only the two variation checks need to go back to publish-only. Not yet fixed.
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
