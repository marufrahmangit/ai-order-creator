# Changelog

All notable changes to AI Order Creator are documented in this file.

## 6.5

Two parser fixes, both verified by running the real parsing pipeline under a portable PHP with WooCommerce's BD state list stubbed in.

**Leading list markers broke field extraction.** A bulleted message was not merely cosmetic. The marker sits between the start of the line and the field label, so the `(?:^|\n)\s*label` anchors in `ai_extract_labeled_field()` and `ai_extract_labeled_multiline_field()` stopped matching and the field was never extracted at all.

- The cascade, confirmed rather than assumed: for the reported input the name came back **empty** from the deterministic pass, so `ai_collect_address_candidates()` was handed an empty `$name` and `ai_remove_value_all()` returned early without removing anything. That — not a leading bullet spoiling a segment match — is why the customer name leaked into the address. The bullet also survived as a bare trailing segment once the phone digits were stripped out of its line.
- Markers are stripped as **line prefixes only**, in two classes. Characters that can only ever be bullets (`•` U+2022, `·`, `◦`, `▪`, `●`, `▫`, `‣`, `⁃`, `∙`, `¤`) are stripped whether or not a space follows. Hyphen, asterisk, en dash and em dash are stripped **only when a space follows**, because the space is what makes one a list marker rather than part of the value: a line beginning with a hyphen-attached number (`-১০৭৯`, the exact shape v4.1 had to fix) keeps its sign, and a hyphen inside a line (`Mirpur-10`) is never touched either way.
- `ai_clean_line()` also trims stray bullet glyphs from either end of a segment, for a bullet that appears mid-line and gets stranded when the text is split. A segment left holding nothing but markers or punctuation is now treated as noise, so it cannot survive as an address segment.
- **Fixing the bullets exposed a third defect, fixed here too:** `ai_get_field_start_labels()` was missing the multi-word phone labels (`phone number`, `phone no`, `mobile number`, …). That list decides where a labeled field's value *stops*, so `Phone Number: 01778828637` did not register as the start of a new field and the entire phone line was absorbed into the address as a continuation line.

**Tongi now resolves to Gazipur**, with `tongi`, `tongee`, `tungi`, `tongi bazar`, `টঙ্গী`, `টংগী`, `টঙ্গি`, `টংগি`, plus Kaliakair, Kapasia, Joydebpur and Konabari — the same area-to-district pattern the file already uses for Dhaka-city thana names.

- **The reported Jashore mismatch is not about Tongi.** `tongi` matches nothing at all, exactly or fuzzily, which is why it simply failed to resolve. The culprit class is the Levenshtein fallback in `ai_extract_state_from_text()`, which scans every word of 5+ characters against every ASCII alias allowing one edit at 5–6 characters and two at 7+. Real place names misroute through it: **`kishore` → Jashore**, **`mohakhali` → Noakhali**, **`sreepur` → Sherpur**, **`kaliganj` → Habiganj**, **`shibpur` → Sherpur**, each at distance 2.
- **Mohakhali is now an explicit Dhaka alias.** It was missing while fuzzy-matching Noakhali, so a Mohakhali address was being given the wrong district and with it the wrong flat shipping rate — 150 instead of 80. The exact pass runs before the fuzzy one, so an alias settles it.
- Adding Tongi required **two substring guards**. The exact pass has no word boundary and takes the first alias in insertion order, and `tongi` is a substring of `tongibari` (Munshiganj) while `tungi` is one of `tungipara` (Gopalganj). Both longer names are now listed *before* the Tongi block, so neither starts resolving to Gazipur.
- **Sreepur and Kaliganj are deliberately not added.** Each names an upazila in several districts — Sreepur in Gazipur and Magura, Kaliganj in Gazipur, Satkhira, Jhenaidah and Lalmonirhat — so mapping either to Gazipur would assert a district the text never states. Both currently resolve *wrongly* through the fuzzy fallback; that is recorded as an open item against the matcher rather than papered over in the data.

Also backfilled the **4.8** entry, which was present in the plugin header but missing from this file.

## 6.4

- **Added fee support to the order endpoints, readable and writable.** Fees are used often on this store, including **negative fees as discounts**.
- **Read.** The shared order response builder returns `fee_lines` as `[{id, name, total}]` from `$order->get_items('fee')`, so `GET /orders/{id}`, `POST /orders` and `POST /orders/{id}` all carry it at once. This closes a real gap: an order with a fee reported a `total` the client could not reconcile from `line_items` plus `shipping_lines`.
  - `total` is a raw numeric string at 2dp like every other money field and **can be negative**, passed through unchanged — no clamping, no `abs()`.
  - `name` is reported **exactly as stored**, via `get_name('edit')`. The default `view` context substitutes the word "Fee" for an empty name and runs display filters, which is display behaviour this API has no business doing.
- **Write.** Both write endpoints accept `fee_lines` as an array of `{name, total}`, built with `WC_Order_Item_Fee`, `set_name()`, `set_total()` and `$order->add_item()`. They are applied inside the shared payload applier, so they land **before** `ai_rest_finalize_order()` and `calculate_totals()` counts them.
  - Semantics match `line_items` exactly and **independently**: an absent key leaves existing fees alone; a present key removes every fee item and replaces it from the payload; an empty array removes all fees. Replacement **discards fee item ids** — a replaced fee is a new row, not an edited one.
  - An empty `name` is allowed, as WooCommerce allows it. A missing total is 0; a non-numeric total is 0 **with a warning**, because a typo silently turning a discount into nothing is expensive.
- **The two lists are genuinely independent, and were already.** The line-item replacement was scoped to `get_items('line_item')` and `ai_apply_shipping()` to `get_items('shipping')`, so neither disturbs fees, and the new fee removal is scoped to `get_items('fee')`. Nothing in this plugin calls `WC_Abstract_Order::remove_order_items()` with no argument — that empties *every* item type, products, fees, shipping and taxes alike. **No fix was needed.**
- **One WooCommerce behaviour to know about**, not a defect here: `calculate_totals()` caps a negative fee at the order's own value so the total cannot fall below zero, and it does so by **rewriting the fee item's own total**. A discount larger than the order therefore comes back from these endpoints reduced rather than as sent. The response reports what was stored, so the client can see it happened.

## 6.3

- **Bulk-prime the post, meta and term caches before hydrating product objects.** Measured on staging at 6.2: `timing_ms` was **47ms for a numeric search but 438ms for a broad text search**. Sorting by price needs every candidate hydrated before it can be ordered, so `?search=three` turned roughly 180 candidate ids into product objects one at a time — and each `wc_get_product()` hit the database three separate ways:
  - `WC_Product_Data_Store_CPT::read()` → `get_post()`
  - `read_product_data()` → `get_post_meta()`
  - `get_product_type()` → `get_the_terms( $id, 'product_type' )`, plus `read_visibility()` reading `product_visibility`
- New `ai_rest_prime_product_caches()` calls `_prime_post_caches( $ids, true, true )` once for the whole candidate window, filling all three caches in up to three queries. The `wc_get_product()` calls that follow then read from cache. **All three flags matter**: priming posts without terms would leave a term query per product in place, which is a third of the problem untouched.
- Applied at every loop that turns ids into objects — the price-match block, the row loop, and a variable parent's children. The children case is **untestable in this catalogue** (no variable products), but a cache warm has no behavioural effect, so it cannot change what is returned either way.
- `_prime_post_caches()` fetches only ids not already in the cache, so priming overlapping sets — as the numeric path does, once in the price block and again in the row loop — costs almost nothing the second time.
- **WooCommerce offers no product equivalent** of `WC_Order_Data_Store_CPT::prime_caches_for_orders()`; checked against the 11.0 code reference, `WC_Product_Data_Store_CPT` has no priming method at all. Nor would the `wc_product_meta_lookup` table help: it serves the search *queries* (price, stock), not hydration, so priming it would warm something this loop never reads. The product object cache added in WooCommerce 10.5 is request-scoped and deduplicates repeat lookups of the same id, which a single pass over distinct ids never performs.
- The call is guarded with `function_exists()`: `_prime_post_caches()` carries an underscore because it was marked private before WordPress 6.1, where it became public API. If it is ever absent, hydration reverts to the pre-6.3 per-id behaviour rather than failing.
- **Nothing else changed** — not the sort window, the sort order, the query structure, or any response shape. `timing_ms` is what confirms or refutes the gain.

## 6.2

- **`GET /products` now orders by price ascending**, replacing the alphabetical-by-title ordering. Title order was actively wrong for this catalogue: as strings, `"10000"` sorts before `"1050"`, so `search=three` returned 1000, 10000, 1050, 1100 — putting the most expensive item near the top of every text search.
- Rows sort by effective price, then by name as a tiebreaker. The name comparison is natural rather than byte-wise (`strnatcasecmp`), so embedded figures order numerically there too — the same defect, one level down.
- The sort applies **within each block, never across them**: Block A (exact price matches) still precedes Block B (name/SKU), so an exact price match is never pushed below a cheaper substring match. The exact-SKU row still leads everything.
- A product saved with no price sorts *after* every priced row, rather than being treated as 0 and heading every list.
- **Compound terms.** A term with exactly one numeric part and at least one non-numeric part returns the **intersection**: `three 2500` means products whose name or SKU contains "three" AND whose effective price is 2500. Word order is irrelevant — `2500 three` parses identically.
  - Two or more numeric parts (`three 2500 1000`) fall back to treating the whole term as text rather than guessing which figure is the price.
  - Several text parts alongside one number (`batik gauze 250`) must match *all* the text parts and the price.
  - An empty intersection returns an empty list. There is deliberately no fallback to a broader search: an empty result is the honest answer, and a silently widened list forces the staff member to notice the rows do not match what they asked for.
  - The 3-character minimum applies to the whole trimmed term, not to each part.
  - The exact-SKU lookup is skipped for compound terms — no SKU realistically equals a phrase plus a figure, and a row admitted that way would sit outside the intersection, breaking the empty-means-empty rule.
- **Optional `fields=picker`** returns only `id`, `name`, `sku`, `price` and `is_in_stock`, omitting `parent_id`, `stock_status`, `stock_quantity` and `thumbnail`. It also skips the per-row attachment lookup `thumbnail` requires, for a field that is null throughout this store. Any other value — including a misspelling — yields the full row rather than a 400, in keeping with this namespace clamping rather than rejecting. **The default shape is unchanged**, byte for byte.
- **Added `timing_ms`** to the envelope: wall-clock milliseconds inside the handler, measured from entry to just before the response is built, present in both shapes. It exists to tell query work apart from network round-trip when the picker feels slow on mobile data.
- Replaced `ai_rest_product_search_ids()` with `ai_rest_product_search_blocks()`, which returns the blocks separately instead of flattening them — a flattened list cannot be sorted per block. Term parsing and the intersection are isolated in `ai_rest_parse_search_term()` and `ai_rest_compound_search_ids()`, matching how `ai_rest_price_match_product_ids()` was already kept apart. `ai_rest_product_search_ids()` had no callers outside this file.
- Ordering by price means the rows have to exist before they can be sorted, so row building is now bounded by a new `AIOC_PRODUCT_SORT_WINDOW` (500) per block rather than stopping at the caller's `limit`. A term matching more candidates than that is sorted within the first 500 in title order — bounded, deliberate, and the same cap `ai_rest_price_match_product_ids()` already used. **The cost is real**: a broad text search now loads up to 500 product objects where it previously loaded about 20. `timing_ms` is what will show whether that matters.
- No raw SQL, the `{"products": [...]}` envelope key is unchanged, and the publish+private product / publish-only variation status rules are untouched.

## 6.1

- Added `POST /aioc/v1/token`, the login endpoint. Staff sign in with the ordinary WordPress username and password they already know; the app never asks anyone to find or paste an application password.
- Core Basic auth cannot accept an account password - `wp_authenticate_application_password()` only ever matches application passwords - so this route bridges the gap once. It verifies the submitted credentials with `wp_authenticate()`, then mints an application password via `WP_Application_Passwords::create_new_application_password()` and returns the plaintext, alongside the canonical `user_login` (the caller may have signed in with an email address), `display_name`, `user_id`, the password's `name` and its `uuid`. The app stores username and password and sends them as Basic auth from then on. The account password is used for that one request and is stored nowhere - not on the device, not here.
- This is also what sidesteps the Defender application-password truncation: that defect is in wp-admin's *display* of a newly created password, and the plaintext here comes from the create call's return value, before any admin screen is involved.
- Created passwords are named with a shared `Order Ops (app)` prefix plus a UTC timestamp. The prefix makes them identifiable in Users → Profile → Application Passwords; the timestamp makes each one unique, which is required because core rejects a name the user already has (`application_password_duplicate_name`, 409) - a fixed name would work on a staff member's first login and fail on every one after it. A same-second collision is retried once with a short random suffix.
- Logging in on a second device does not disturb the first: each login mints its own credential. They therefore accumulate, and nothing revokes them yet - the app's logout only forgets the credential locally. The returned `uuid` is there so a future revoke-on-logout route can target one.
- Being the only unauthenticated route in the namespace, it carries its own protection:
  - **Failure throttle.** A transient counter per IP (10 failures per 15 minutes) and per username (5), whichever trips first. Locked-out callers get a 429 with `Retry-After` and a message stating the wait. The window is fixed rather than sliding, so a run of attempts cannot push the expiry out past the stated wait. A successful login clears both counters. WordPress provides nothing for this, so it is written here.
  - **One generic failure.** An unknown username, a wrong password and a blank field all return the same 401 `aioc_invalid_credentials` with the same message, so the route cannot be used to enumerate account names.
  - **Capability check after authentication.** A valid login on an account without `manage_woocommerce` gets a 403, not a credential. It is not counted as a failed attempt, since nothing was guessed.
  - Rate-limit buckets are keyed on a hash, so no plaintext username is written to the options table. Only `REMOTE_ADDR` is used for the IP; `X-Forwarded-For` is deliberately ignored, since a client-supplied header can be varied per request to defeat the limit entirely.
- Added `ai_rest_sanitize_password()`, which casts to string and nothing else. `sanitize_text_field()` strips tags, decodes entities and collapses whitespace, any of which silently corrupts a legitimate password and turns a correct login into a generic failure the user cannot diagnose. Nothing is persisted from the value, so there is nothing to sanitize for.
- Added `ai_rest_permission_public()` rather than registering `__return_true`, keeping the namespace rule that every `*_callback` is an `ai_` function and making the single public route greppable.
- Application password availability is checked before creating, via `wp_is_application_passwords_available_for_user()`. Creation succeeds even when they are disabled for a user, so without this the app would store a credential that fails on every subsequent request.
- `Cache-Control: no-store` is set on the success response, whose body is a live credential.
- Decided against resolving order ids in `GET /orders?search=`: staff search by phone, which works today. It stays an open item.

## 6.0

- Added `GET /aioc/v1/meta` so the app never hardcodes a list WooCommerce owns. It returns `states` (the full BD list, in WooCommerce's own order), `statuses` (every registered order status, `wc-` prefix stripped so the slugs match what the other endpoints accept and return), `currency`, `price_decimals` and `plugin_version`.
- Every list is read from WooCommerce at request time, so a state relabelled upstream or an order status registered by another plugin appears automatically, with no app rebuild. `currency` and `price_decimals` let the client format money to the store's settings instead of assuming BDT and 2dp.
- The response is cacheable client-side for the length of a session; nothing in it changes during normal operation.
- Moved `ai_rest_strip_status_prefix()` from `includes/rest/routes/orders-write.php` into `includes/rest/rest.php`, since the meta and write routes now both use it. No behaviour change.

## 5.9

- Added the order write endpoints, completing step 4: `POST /orders` (create, 201), `POST /orders/{id}` (partial update, 200), `POST /orders/{id}/trash` and `POST /orders/{id}/restore`.
- Validation mirrors WooCommerce rather than being stricter. An empty payload creates an empty order, exactly as the wp-admin "Add order" screen does. The only rejections are values WooCommerce itself would not recognise: an unknown BD state code or order status, each a 400. Everything is validated before any order is created, so a rejected request leaves nothing behind.
- Updates are **partial** - only fields present in the body change, which is why these are POST and not PUT. Supplying `line_items` replaces all existing product lines rather than patching them, discarding line item ids and meta; omitting the key leaves items untouched.
- Out-of-stock products are added anyway with a warning naming the product, since WooCommerce admin allows it. A product id that does not exist, or is grouped/external/a variable parent, is skipped with a warning rather than failing the whole request.
- Shipping is always reapplied via `ai_apply_shipping()` from the single rate table, on create and on every update. Because that function returns early when the billing state is empty, `calculate_totals()` is called directly in that case so a stateless order with line items cannot persist with a total of 0.
- Trash uses `WC_Order::delete(false)`, the HPOS-correct path, not the legacy `wp_trash_post()`. Restore reads the pre-trash status back from `_wp_trash_meta_status`, falling back to `pending`. No force delete is accepted or passed anywhere.
- Responses reuse `ai_rest_prepare_order_detail()` so the order shape cannot drift from `GET /orders/{id}`.

## 5.8

- Added `POST /aioc/v1/parse`, the first step-4 endpoint - though it writes nothing. It takes raw pasted text, runs the existing `ai_get_parsed_order_data()` unchanged, and returns the extracted name, phone, address, state (raw text plus resolved WooCommerce code and label) and customer note.
- The response includes a `shipping_preview` computed from the pure `ai_get_shipping_rate()` rate table, so staff see the shipping cost before saving. No order is created, updated or touched, and `ai_apply_shipping()` is deliberately not called.
- An unmatched state is not an error: `state_code` comes back empty with the Outside Dhaka default rate, and the client's district dropdown resolves it.
- Parse failure returns 422 with the parser's own message. The parser only fails when both name and phone are missing, so partial extraction succeeds and reports `warnings`.
- `normalized_text`, `raw_ai_response` and the always-empty `price` / `price_items` keys are omitted, keeping the mobile payload small.
- `text` is sanitized with `sanitize_textarea_field()` rather than `sanitize_text_field()`, which strips the newlines the address parser splits on.
- Corrected a stale docblock in `includes/rest/routes/products.php` that still described the `wc_get_products()` `price` argument as unverified. Staging testing at 5.7 confirmed it narrows the query; the PHP re-check is defence in depth, not the primary mechanism.

## 5.7

- `GET /aioc/v1/products` now searches by price, which is how staff actually look products up. A wholly numeric term first matches products whose effective current price equals it - sale price included, consistent with the `price` field in each row - and then falls through to the existing name/SKU substring search.
- The two blocks are concatenated price-first, deduplicated keeping the first occurrence, and the limit applies to the combined list, so price matches fill it before name/SKU matches take the remaining slots.
- Comparison is numeric, so `250` matches a stored `250.00`. A non-numeric term skips the price block entirely and text search behaves exactly as before.
- The price lookup is isolated in `ai_rest_price_match_product_ids()` so it can be swapped or removed without touching the handler. It re-checks every candidate's price in PHP, so correctness does not depend on the unverified `wc_get_products()` `price` argument, and a silently-ignored argument cannot flood the response with non-matching products.
- Minimum search length raised from 2 to 3 characters. The 400 `aioc_search_too_short` code is unchanged; the message now says 3.

## 5.6

- Fixed a fatal error that made every request to `GET /aioc/v1/products` return a 500 before the handler ran. The `limit` parameter used `intval` as its `sanitize_callback`, but WordPress invokes sanitize and validate callbacks with three arguments (value, request, parameter name) and `intval()` accepts at most two, so PHP 8 raised an uncaught `ArgumentCountError` inside `WP_REST_Request::sanitize_params()`.
- Every argument callback in the REST layer now goes through a single-argument `ai_rest_*` wrapper defined in `includes/rest/rest.php`. No bare PHP built-in is registered as a callback anywhere, which also makes the rule greppable.
- `absint`, `sanitize_text_field` and `__return_true` are WordPress userland functions that ignore extra arguments and were never broken, but are wrapped as well so there is one uniform pattern and no judgement call at the call site.
- Parameter clamping is unchanged: `limit` casts to int, falls back to 20 below 1, and is capped at 50.

## 5.5

- Fixed disabled variations being addable to orders via `GET /aioc/v1/products`. A variation's post status encodes its Enabled checkbox, so `private` there means disabled - variations do not inherit their parent's status. The 5.4 status widening was applied too broadly and let disabled variations through.
- Variation status checks are now publish-only, via a dedicated `ai_rest_variation_status_allowed()` that is deliberately narrower than the product-level rule.
- The `wc_get_products()` status argument, the parent status check and the exact-SKU path still accept both `publish` and `private`, which is what keeps this store's private catalogue reachable.

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

## 4.8

- Recognized bare "Number" as a strippable phone label — it was already recognized for extracting the phone value itself, but missing from the separate list used to clean up the leftover label word, so "Number:" survived as junk in the address after its digits were stripped.

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
