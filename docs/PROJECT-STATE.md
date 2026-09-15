# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v5.9**, Updated 2026-09-15. Live runs v4.9. Staging runs
**5.8**; step 3 and step 4a are verified against it. 5.9 (the order write endpoints) is
committed but NOT uploaded, so nothing in it is exercised. Step 5 (PWA shell) is next
once 5.9 is verified.

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
  price point. So every variation code path in `products.php` (the expansion loop,
  `ai_rest_variation_row()`, `ai_rest_variation_display_name()`,
  `ai_rest_variation_status_allowed()`) is **untestable in this catalogue**, not merely
  unverified. Don't spend time trying to exercise it here; it would need a variable
  product created specifically to test. The rules above still govern that code if
  variable products are ever added.
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
- Price search uses `wc_get_products(['price' => …])`, confirmed on WooCommerce 11.0.1
  to genuinely narrow the query. `ai_rest_price_match_product_ids()` also re-checks each
  candidate numerically in PHP; that is now defence in depth (it guarantees "250" matches
  a stored "250.00" and bounds the damage if the argument's behaviour ever changes), not
  the primary mechanism. Two fallbacks are parked and **not needed unless that behaviour
  changes**: a `meta_query` with `'type' => 'NUMERIC'` (would need confirming that
  `wc_get_products()` forwards `meta_query`), or reading
  `wc_product_meta_lookup.min_price`, which is numeric but means raw SQL and is excluded
  by convention.
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
| 4b | Write endpoints — create, update, trash, restore | done, not yet on staging | 5.9 |
| 5 | PWA shell — subdomain, auth, order list | not started | — |
| 6 | Create/edit form with product picker | not started | — |
| 7 | Manifest, service worker, install prompt | not started | — |

**Step 3 is fully complete, 3a through 3c, all verified against staging.** Step 4 is
built end to end: 4a (`POST /parse`) is verified at 5.8; 4b (create, update, trash,
restore) shipped in 5.9 and awaits its first staging test. Step 5 follows.

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

Confirmed by real requests against staging.cartmixbd.com. **Step 3 is signed off** —
3a and 3b at 5.6, 3c at 5.7 — **and step 4a at 5.8.** Detail collapsed; see git log for
the full results.

- `GET /ping` — 200, returns user and version.
- `GET /orders` — pagination arithmetic correct over 4505 orders / 1502 pages; money and
  state labels match the admin screen (3600.00 + 80.00 shipping = 3680.00, `BD-13` →
  "Dhaka"); phone search folds `8801…`/`01…` to the same order; name search matches
  mid-name, so `'s'` + `search_filter => 'customers'` does partial matching on HPOS;
  `status` accepts `pending` and `wc-pending` alike and 400s on nonsense; `per_page`
  clamps to 50; trashed orders are excluded.
- `GET /orders/{id}` — full detail correct, as above.
- `GET /products` — returns private-status products, so publish + private works;
  envelope is `{"products": [...]}`; `sku` matching is LIKE/partial and does NOT split
  the term on commas; `limit=0` falls back to 20.
- `GET /products` price-first (5.7) — `?search=2500` returns exactly the product priced
  2500.00, confirming `wc_get_products(['price' => …])` genuinely narrows the query on
  WooCommerce 11.0.1 rather than being ignored; `?search=250` returns the 250.00 product
  first then 12 substring matches, confirming Block A ordering, Block B fallback and
  dedup; `?search=25` 400s with the 3-character message; text search unchanged from 5.6.

- `POST /parse` (step 4a, at 5.8) — multi-line English input extracts name, phone and
  the full multi-line address, confirming `sanitize_textarea_field()` preserves the
  newlines address extraction depends on; state resolves and previews shipping correctly
  for Dhaka (`BD-13`, 80.00), Gazipur (`BD-18`, 120.00) and Madaripur (`BD-36`, 150.00
  Outside Dhaka); Bangla input extracts Bengali name/address and normalizes Bangla
  digits to ASCII (০১৮১২৩৪৫৬৭৮ → 01812345678), resolving ঢাকা to `BD-13`; a name-only
  payload returns 200 with an
  empty phone, per the mirror-WooCommerce validation rule.

Not yet exercised: everything in 5.9 (the write endpoints). Next: upload 5.9, confirm
`/ping` reports 5.9, then exercise create with an empty payload, create with line items,
a partial update, and a trash/restore round trip — the last of these is the one with
unconfirmed mechanics.

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
- **HPOS trash and restore mechanics.** `POST /orders/{id}/trash` uses
  `WC_Order::delete(false)`, which under HPOS should route to the orders-table data
  store's trash path, recording `_wp_trash_meta_status` (prefixed, e.g. `wc-pending`)
  and `_wp_trash_meta_time` and flipping the row's status to `trash`. Reasoned from how
  WooCommerce's data store is built, NOT confirmed against 11.0.1 — there is no
  WooCommerce source available locally. There is also no public HPOS untrash API I could
  confirm, so restore reads that meta and calls `set_status()`, the approach
  WooCommerce's own admin list table uses, falling back to `pending`. Two things to
  check on staging: that `wc_get_order()` returns a trashed order at all (otherwise
  restore 404s instead of restoring), and that the pre-trash status genuinely round
  trips.
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

## Update rule

Update this file in the same commit as any change to code, endpoints, or decisions.
Move items from Unverified to Verified only after a real request against staging
confirms them. Keep it current rather than append-only — delete what's no longer true
instead of accumulating history. Git log is the history; this file is the present state.
