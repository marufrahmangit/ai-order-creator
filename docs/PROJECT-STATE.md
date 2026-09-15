# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v5.9**, Updated 2026-09-15. Live runs v4.9. Staging runs
**5.9**, matching the committed code. The whole API layer — steps 3 and 4 — is verified
against it. **Step 5 (PWA shell) is next**, and is the first work outside this plugin.

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
- This catalogue contains **no variable products** — every product is simple, one per
  price point. Every variation code path in `products.php` is therefore **untestable in
  this catalogue**, not merely unverified; don't try to exercise it without first
  creating a variable product. The rules above still govern that code if any appear.
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
- Never register a bare PHP built-in as a `sanitize_callback` / `validate_callback`:
  WordPress passes three arguments, so any built-in of arity ≤2 is a PHP 8 fatal
  (`intval` 500'd every `/products` request). Use the `ai_rest_sanitize_*` /
  `ai_rest_validate_*` wrappers in `rest.php`; `grep "_callback'.*=> '" | grep -v ai_`
  must stay empty.
- Logic files produce no output. Presentation lives in `admin/views/`.

## Product decisions

- Shipping is a pure function of billing state: BD-13 → 80 Dhaka Flat Rate,
  BD-18 → 120 Gazipur Flat Rate, all else → 150 Outside Dhaka Flat Rate. One rate
  table in `includes/orders/shipping.php`, called from the admin hooks and every REST
  write path. Auto-only; no manual override by design.
- All WooCommerce statuses are settable from the app, read from
  `wc_get_order_statuses()` rather than hardcoded.
- "Delete" means trash. Endpoints are `POST /orders/{id}/trash` and
  `POST /orders/{id}/restore`. No force-delete is reachable from the app. Confirmed on
  11.0.1/HPOS: `WC_Order::delete(false)` is the correct trash call (not the legacy
  `wp_trash_post()`), `wc_get_order()` does return trashed orders, and restore reading
  `_wp_trash_meta_status` round-trips the pre-trash status.
- One order form, two ways to fill it: paste-and-parse, or type directly. Parsing is
  optional, never required.
- District is a dropdown of WooCommerce BD states, never free text — shipping depends
  on the state code resolving.
- **Field-level validation mirrors WooCommerce, not stricter.** WooCommerce permits
  saving an order with no phone, no address, no line items and no state — details can be
  filled in later. The app must permit the same. Do NOT add required-field validation to
  any write endpoint beyond what WooCommerce itself enforces. Specifically: `POST
  /orders` must accept a partial or empty payload and create the order anyway, exactly
  as the wp-admin "Add order" screen does. `/parse` already behaves this way — it
  succeeds with a name and no phone, returning empty strings for unextracted fields
  (verified on staging at 5.8).
- `POST /parse` returns data and creates nothing. Always parse → review → save; never
  blind-create. Implemented in 5.8; it also returns a `shipping_preview` from the pure
  rate table so staff see the cost before saving.
- Any endpoint taking pasted order text must sanitize with `sanitize_textarea_field()`,
  never `sanitize_text_field()` — the latter strips newlines, and the address parser
  splits on them. Use the `ai_rest_sanitize_textarea()` wrapper.
- Order updates are PARTIAL and use POST, not PUT: only fields present in the body
  change. No write-route argument declares a `default`, because WordPress injects
  defaults into the request, which would make an omitted field indistinguishable from a
  sent one and silently overwrite stored data.
- Supplying `line_items` on update REPLACES all existing product lines; omitting the key
  leaves them untouched. There is no per-item patching — the client holds the full list.
  Replacement discards line item ids and any line item meta.
- Line-item eligibility is a TYPE check (simple or variation), never
  `WC_Product::is_purchasable()`. That function also requires post status `publish`, and
  this catalogue is `private`, so it would reject everything for any user lacking
  `edit_post`.
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
- Price search uses `wc_get_products(['price' => …])`, confirmed on 11.0.1 to narrow the
  query. The PHP re-check in `ai_rest_price_match_product_ids()` is defence in depth —
  it guarantees "250" matches "250.00" and bounds the damage if that ever changes — not
  the primary mechanism. Parked fallbacks, **not needed unless the behaviour changes**:
  a `meta_query` with `'type' => 'NUMERIC'` (needs confirming `wc_get_products()`
  forwards it), or `wc_product_meta_lookup.min_price`, which means raw SQL.
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
| 3b | Read endpoints — product search | done, **verified on staging** at 5.6 | 5.3–5.6 |
| 3c | Price-first product search + 3-char minimum | done, **verified on staging** at 5.7 | 5.7 |
| 4a | `POST /parse` — text in, structured data out, writes nothing | done, **verified on staging** at 5.8 | 5.8 |
| 4b | Write endpoints — create, update, trash, restore | done, **verified on staging** at 5.9 | 5.9 |
| 5 | PWA shell — subdomain, auth, order list | not started | — |
| 6 | Create/edit form with product picker | not started | — |
| 7 | Manifest, service worker, install prompt | not started | — |

**Steps 3 and 4 are complete and verified against staging** — 3a–3c at 5.6/5.7, 4a at
5.8, 4b at 5.9. The REST API is done; step 5 begins the PWA itself.

Step 3b shipped over 5.3 product search, 5.4 product status fix (private catalogue) +
response envelope + limit fallback, 5.5 variation status fix, 5.6 sanitize-callback
arity fatal. Step 3c is 5.7: price-first search for numeric terms, minimum search length
raised to 3.

v5.1 (`089ac2f`) was an unrelated parser fix (partial-duplicate names in the address),
not a build step.

Routes currently registered. `/orders` and `/orders/{id}` each carry both a GET and a
POST endpoint, registered from two different files — `register_rest_route()` merges them
because it defaults to `$override = false`:

- `GET  /aioc/v1/ping` — `includes/rest/rest.php`
- `GET  /aioc/v1/orders` — `includes/rest/routes/orders.php`
- `GET  /aioc/v1/orders/{id}` — `includes/rest/routes/orders.php`
- `GET  /aioc/v1/products` — `includes/rest/routes/products.php`
- `POST /aioc/v1/parse` — `includes/rest/routes/parse.php` (writes nothing; POST only
  because it takes a text body)
- `POST /aioc/v1/orders` — `includes/rest/routes/orders-write.php` (create, 201)
- `POST /aioc/v1/orders/{id}` — partial update, 200
- `POST /aioc/v1/orders/{id}/trash` — 200 `{id, status:"trash"}`
- `POST /aioc/v1/orders/{id}/restore` — 200, full order object

## Verified

Confirmed by real requests against staging.cartmixbd.com. **The whole API layer is
signed off** — step 3 at 5.6/5.7, step 4a at 5.8, step 4b at 5.9. Per-request detail is
in git log; kept below are only the findings that encode a decision or a confirmed
mechanism.

Reads (step 3) — all behaved as specified at scale (4505 orders / 1502 pages): money
and state labels match the admin screen, status prefixes and `per_page` clamping work,
trashed orders are excluded, private products are returned, envelopes are right. The
mechanisms that were in doubt and are now settled on WooCommerce 11.0.1 / HPOS:

- Order search — phone folding (`8801…`/`01…` → same order), and `'s'` +
  `search_filter => 'customers'` does partial mid-name matching.
- Product search — the `sku` arg is LIKE/partial and does NOT split on commas;
  `wc_get_products(['price' => …])` genuinely narrows the query, with price-first
  ordering, Block B fallback and dedup all correct.

Writes (step 4):

- `POST /parse` — `sanitize_textarea_field()` preserves the newlines address extraction
  depends on; Dhaka/Gazipur/Madaripur resolve to `BD-13`/`BD-18`/`BD-36` with 80.00 /
  120.00 / 150.00 previews; Bangla input extracts Bengali name and address and
  normalizes Bangla digits (০১৮১২৩৪৫৬৭৮ → 01812345678), resolving ঢাকা to `BD-13`.
- `POST /orders` — `{}` yields a 201 empty pending order at total 0.00, confirming
  validation mirrors WooCommerce. A full payload prices correctly (product 9167 at
  175.00 × 2 = 350.00, plus 80.00 Dhaka shipping, 430.00 total). A per-line `total`
  override applies to both subtotal and total (999.00 → 1079.00 order total).
  `state=BD-99` is a 400 `aioc_invalid_state`; `product_id=999999` still returns 201
  with the line skipped, a "Product 999999 not found; line skipped." warning, and
  shipping applied.
- **Line items with NO state total 175.00, not 0.00, with no shipping line.** This is
  the `ai_rest_finalize_order()` fix earning its place: `ai_apply_shipping()`
  early-returns on an empty state, so `calculate_totals()` must be called directly in
  that case or the 4.9 zero-total defect returns. Do not remove it.
- `POST /orders/{id}` — sending only `phone` changes only the phone; name, state, line
  items and totals are all preserved, confirming the no-declared-defaults decision.
  Changing `BD-13` → `BD-18` recalculates shipping 80.00 → 120.00 and the total
  1079.00 → 1119.00, with a new shipping line id.
- Trash/restore round trip — trash returns 200 `{"id":…,"status":"trash"}`, and restore
  returns the order at `processing`, its genuine pre-trash status, not the `pending`
  fallback.

Next: step 5, the PWA shell.

## Unverified / open

- **Untestable in this catalogue.** Price search finds variable parents by their
  `_price`, which WooCommerce syncs to the cheapest variation, so a variation priced at
  the term under a parent with a cheaper variation would not be found. Moot here — there
  are no variable products. Relevant only if they are ever added.
- **Untestable in this catalogue.** Variation-level SKUs are only findable by exact
  match, via `wc_get_product_id_by_sku()` in `ai_rest_exact_sku_row()`; the parent-first
  search cannot reach a partial variation SKU. No variable products exist here, so this
  cannot be exercised. Parent/simple SKU partial matching IS verified — see Verified.
- **No relevance ranking for TEXT product searches.** Results come back sorted by name
  (`orderby => title`), so a broad term like "three" returns dozens of near-identical
  rows — this catalogue has one product per price point — and the intended item is often
  outside the first 20. 5.7's price-first ordering is verified and fixes this for wholly
  numeric terms, but does nothing for text terms. Ranking for those is an unresolved
  design question and belongs to **step 6**, with the picker.
- **`GET /orders?search=` does not resolve order ids.** It handles phone and customer
  name only. A numeric term that is not a valid BD mobile falls through to the name
  search, so typing an order number returns unrelated name matches rather than that
  order. Decide in step 5 whether the list screen's search should also resolve ids.
- CORS has never been exercised — curl sends no Origin header. First real test is the
  PWA.
- WordPress core's `rest_send_cors_headers()` reflects any Origin API-wide.
  `ai_rest_cors_headers()` strips those headers for `aioc/v1` routes when the
  configured origin is empty or mismatched. Untested.
- Claude Code's environment has no php binary and no WooCommerce source, so nothing is
  linted or run there. Local checks are structural or simulated only; behaviour must be
  confirmed by curl against staging, as was done for steps 3a and 3b.

## Housekeeping

- Rotate the live site's DB password and all eight wp-config salts — they were exposed.
- README.md and the CHANGELOG.md intro line still say "AI Order Creator" rather than
  "Order Ops".
- CHANGELOG.md is missing the 4.8 entry; the plugin header has it.
- Step 4b verification created test orders on staging; they were trashed afterwards, not
  permanently deleted, so they still sit in staging's trash.

## Update rule

Update this file in the same commit as any change to code, endpoints, or decisions.
Move items from Unverified to Verified only after a real request against staging
confirms them. Keep it current rather than append-only — delete what's no longer true
instead of accumulating history. Git log is the history; this file is the present state.
