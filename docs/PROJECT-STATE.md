# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v6.3**, Updated 2026-09-29. Live runs v4.9. Staging runs
**6.2**. Steps 3, 4 and 5 are verified against staging, the shell confirmed in a browser,
and **CORS is fully verified in both directions**. **6.3 is committed but NOT uploaded**:
it is a performance fix to `/products` hydration, and `timing_ms` on staging is what will
confirm or refute it. **Upload 6.3, compare `timing_ms`, then step 6** (create/edit form
with the product picker). The app is still served from `npm run dev`; nothing has been
deployed to a subdomain yet.

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
- Auth: WP core Application Passwords (Basic auth), user `t45km45ter`. Staff never
  handle one directly - `POST /token` mints it. See Product decisions.
- The Defender plugin truncates the application-password display in wp-admin,
  producing unusable credentials. Currently deactivated on staging. **`POST /token`
  (6.1) is what sidesteps this**: the defect is in wp-admin's *display* of a new
  password, and `/token` reads the plaintext from
  `WP_Application_Passwords::create_new_application_password()`'s return value, so no
  admin screen is involved and truncation cannot reach the credential. Defender is
  therefore no longer expected to block the app's login path - but that is reasoned,
  not tested. Confirm `/token` works with Defender ACTIVE before live, since it also
  hooks `authenticate` and the `wp_login_failed` action that `wp_authenticate()`
  fires.
- **`ai_app_origin` on staging is currently `http://localhost:5173`** — the Vite dev
  server — so CORS grants reach a local dev machine and nothing else. It must become
  `https://ops.cartmixbd.com` when the built app is deployed. **The setting holds one
  origin and cannot cover both at once**, so flipping it breaks local development until
  it is flipped back. Expect to move it back and forth, and suspect it first when the
  app gets a CORS failure after working yesterday.
- **There are now TWO deploys, and they are different in kind.** The plugin is a manual
  upload of SOURCE. The app is a manual upload of BUILD OUTPUT: `ops.cartmixbd.com`
  serves `app/dist/`, which is produced locally by `npm run build` in `app/` and is
  **not in the repo** (`.gitignore`). So what runs on the subdomain is never what is in
  git — checking out a commit tells you what the app was built FROM, not what is live.
  Rebuild and re-upload after every app change; there is no build step on the server.
  The two deploys are independent: shipping app changes does not touch the plugin, and
  vice versa.
  - `VITE_API_BASE` is baked into the bundle at BUILD time, not read at runtime.
    A build made against staging keeps pointing at staging wherever it is uploaded, so
    the environment is chosen by which `.env.local` was in place when `npm run build`
    ran. Check it before uploading to live.
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
  (`manage_woocommerce`) with **exactly one exception**: `POST /token`, which is
  unauthenticated by necessity - it is what issues the credential, so the caller has
  none yet. It uses `ai_rest_permission_public()` and protects itself instead
  (failure throttle, one generic failure message, capability check after
  authentication). Any second public route needs a reason as good as that one.
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
- App tests: `npm test` in `app/`. No dependencies, no browser — it runs the real
  `src/api.js` against a throwaway localhost server. Currently one file,
  `app/test/api-abort.test.mjs`, pinning the abort-versus-real-failure contract the
  order list depends on. There is no PHP test harness; the plugin is still verified by
  curl against staging.
- App layout (`app/src/`): `api.js` is the ONLY module that calls `fetch` — one place
  where auth, CORS, error shape and abort handling live. `auth.js` owns the stored
  credential, `meta.js` the session-cached `/meta`, `format.js` money and dates,
  `dom.js` node building, `views/` one file per screen. Views never call `fetch`
  directly.
- The app builds nodes and sets `textContent`; it never assembles HTML from data.
  Order data is staff-pasted free text, so string-built markup would be an injection
  risk. `dom.js` has no `html` option by design.

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
- **Login is a WordPress username and password, exchanged once for an application
  password via `POST /token`.** Staff use the credentials they already know; nobody is
  asked to generate, find or paste an application password, and the account password is
  sent once and stored nowhere. The app keeps the returned username and application
  password in **`localStorage`, persisting until logout** - staff stay signed in across
  app launches, which is the point of replacing wp-admin on a phone. Logout clears it.
  The origin serves nothing but this app, which is what makes `localStorage` acceptable
  here. Logout is local-only: it forgets the credential without revoking it, so a
  revoke-on-logout route is still owed - the `uuid` in the `/token` response exists for
  that.
- **The app stays vanilla ES modules. No framework.** React was considered for step 6's
  product picker and rejected: `views/orders.js` already implements the debounce and
  per-keystroke request cancellation the picker needs, and both are now verified working
  in a browser. Converting would throw away verified code to buy nothing the picker is
  short of. Revisit only if a screen appears that genuinely needs shared reactive state,
  not merely because a list is involved.
- The PWA lives in **`app/` in this repo**, built with **Vite** (Node toolchain).
  Superseded the initial no-bundler plan on 2026-09-28, before any app code existed.
  Deploy is the built output, not the source tree, so `app/dist/` is what reaches the
  subdomain — the plugin is still uploaded separately and by hand.
- **`app/.env.local` holds `VITE_API_BASE`** (the staging or live REST root the app
  talks to) and is **intentionally untracked** — it differs per machine and per
  environment, and it is what points a local dev server at staging rather than live.
  **`app/.env.example` is the committed template**: same variable names, placeholder
  values, no real ones. Anyone cloning this copies the example to `.env.local` and
  fills it in. `.gitignore` matches `.env.local` and `.env.*.local` only, so the
  template is never caught by it.
- One order form, two ways to fill it: paste-and-parse, or type directly. Parsing is
  optional, never required.
- District is a dropdown of WooCommerce BD states, never free text — shipping depends
  on the state code resolving.
- **The app populates the district and status dropdowns from `GET /meta`, and hardcodes
  neither list.** Both are read from WooCommerce per request, so a state relabelled
  upstream or a status registered by another plugin propagates without an app rebuild.
  Money formatting likewise uses the endpoint's `currency` and `price_decimals` rather
  than assuming BDT and 2dp. Cache the response for the session, not per screen.
- **Key on `code`, never on `label`. Labels are display-only.** Confirmed at 6.1: some
  WooCommerce BD state labels carry trailing whitespace (`"Faridpur "`, `"Manikganj "`).
  That comes from WooCommerce's own list, not from this plugin, and is deliberately not
  "fixed" in `/meta` — the endpoint reports what WooCommerce holds. So no comparison,
  lookup, sort key or equality test in the app may use a label string. Trim labels for
  display if it matters visually; match on `code` always. The same rule applies to
  status `slug` versus `label`.
- **The app's status dropdown must filter out `checkout-draft`.** WooCommerce registers
  it for abandoned-cart drafts; it is not a status staff should ever set. `/meta`
  returning it is correct — it reports what WooCommerce registers — so the filtering
  belongs in the app, not the endpoint. It arrives among the 8 statuses `/meta` returns.
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
- Staff search products by PRICE and by NAME in roughly equal measure, so both paths
  have to be usable. `/products` matches a numeric term against the real price first,
  then name/SKU. Do not rely on this catalogue's names happening to embed the price;
  that is incidental, not a property of the data.
- **Results are ordered by effective price ascending, then by name.** Title order was
  the default until 6.2 and was actively wrong here: as strings `"10000"` sorts before
  `"1050"`, so the dearest item sat near the top of every text search. The name
  tiebreaker uses a NATURAL comparison for the same reason. Rows with no price at all
  sort last. **The sort applies within each block, never across them** — Block A (exact
  price matches) stays ahead of Block B (name/SKU), and the exact-SKU row leads
  everything.
- **A compound term is an INTERSECTION, and an empty intersection returns an empty
  list.** One numeric part plus at least one text part means "called this AND costing
  that"; word order is irrelevant. Two or more numeric parts fall back to plain text
  rather than guessing. There is deliberately NO widening fallback: a staff member who
  gets nothing retypes, whereas one who gets a silently broadened list has to notice
  that the rows do not answer the question. The 3-character minimum is on the whole
  trimmed term, not each part.
- **`fields=picker` trims the row to `id`, `name`, `sku`, `price`, `is_in_stock`.** The
  picker reads nothing else, and this store's thumbnails are all null. It also skips the
  per-row attachment lookup, so it is cheaper server-side and not only on the wire. Any
  unrecognised value yields the full row rather than a 400. The default shape is
  unchanged and must stay that way — it is the verified one.
- **`timing_ms` in the `/products` envelope** is wall-clock milliseconds inside the
  handler. It exists to answer one question when the picker feels slow: query work, or
  network round-trip? Read it before optimising either. It has already earned its keep
  once — it is what identified the 6.2 hydration cost that 6.3 fixes.
- **Any loop that turns product ids into objects must prime the caches first**, via
  `ai_rest_prime_product_caches()`. `wc_get_product()` reads the post, its meta AND the
  `product_type` / `product_visibility` terms, so an unprimed loop costs three database
  round-trips per product. This is not a micro-optimisation: at 6.2 it was the difference
  between 47ms and 438ms. Prime the whole candidate window in one call, then loop.
- The step 6 product picker must enforce the 3-character minimum client-side, debounce
  input at ~250–300ms, and cancel in-flight requests per keystroke so responses cannot
  arrive out of order.
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
| 3d | Price-ascending ordering, compound terms, `fields=picker`, `timing_ms` | done, on staging; **timings measured**, output checks not reported | 6.2 |
| 3e | Bulk-prime post/meta/term caches before product hydration | done, **not yet on staging** | 6.3 |
| 4a | `POST /parse` — text in, structured data out, writes nothing | done, **verified on staging** at 5.8 | 5.8 |
| 4b | Write endpoints — create, update, trash, restore | done, **verified on staging** at 5.9 | 5.9 |
| 4c | `GET /meta` — states, statuses, currency for the app | done, **verified on staging** at 6.1 | 6.0 |
| 4d | `POST /token` — login; account password → app password | done, **verified on staging** at 6.1 | 6.1 |
| 5 | PWA shell — subdomain, auth, order list | auth + list done, **verified in a browser** against 6.1; **subdomain not yet stood up** | — |
| 6 | Create/edit form with product picker | not started | — |
| 7 | Manifest, service worker, install prompt | not started | — |

**Steps 3 and 4 are complete** — 3a–3c at 5.6/5.7, 4a at 5.8, 4b at 5.9, all verified;
4c (`GET /meta`, 6.0) and 4d (`POST /token`, 6.1) await their first staging test. Step 5
begins the PWA itself.

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
- `GET  /aioc/v1/products?search=&limit=&fields=` — `includes/rest/routes/products.php`.
  `search` is required, 3-character minimum on the whole term. `limit` defaults to 20
  and clamps to 50. `fields=picker` trims the row; anything else gives the full nine
  fields. The envelope carries `products` and `timing_ms`.
- `GET  /aioc/v1/meta` — `includes/rest/routes/meta.php` (states, statuses, currency)
- `POST /aioc/v1/token` — `includes/rest/routes/token.php`. **The only unauthenticated
  route.** Username + password in, a newly minted application password out (201).
  Generic 401 on any bad credential, 403 for a valid login lacking `manage_woocommerce`,
  429 with `Retry-After` when throttled.
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
  validation mirrors WooCommerce. Full payload prices correctly (9167 at 175.00 × 2 =
  350.00 + 80.00 Dhaka = 430.00); a per-line `total` override applies to subtotal and
  total (999.00 → 1079.00). `state=BD-99` 400s `aioc_invalid_state`; `product_id=999999`
  still returns 201 with the line skipped, a warning naming it, and shipping applied.
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

Meta and login (step 4c/4d), confirmed at 6.1 — `/ping` reports `6.1`, so the upload is
the code below:

- `GET /meta` — returns all **64 BD districts**, **8 order statuses** with the `wc-`
  prefix stripped, `currency` `BDT` and `price_decimals` `2`. The app has no reason to
  hardcode any of it.
- **`POST /token` works end to end.** A real WordPress account username and password
  returned a full 24-character application password, the canonical `user_login`, a
  timestamped `name` and a `uuid` — and that minted credential then authenticated
  successfully against `/ping`. So the whole premise holds: core Basic auth accepts the
  application password `/token` mints, staff never touch one directly, and the
  Defender display truncation is genuinely bypassed.
- Two findings that constrain the app rather than the API, both now recorded under
  Product decisions: some state labels carry **trailing whitespace**, and `/meta`
  includes **`checkout-draft`**.

The rate-limit throttle on `/token` is the one part still unexercised; it stays under
Unverified.

**CORS is verified in both directions and is no longer an open question.** A matching
origin works from a browser (see step 5 below), and a mismatched `Origin` is refused —
`ai_rest_cors_headers()` strips the headers that core's `rest_send_cors_headers()` would
otherwise reflect for any origin, so no `Access-Control-Allow-Origin` comes back.
That second half is what makes the App Origin setting a control rather than decoration.

`/products` at 6.2, measured on staging:

- `timing_ms` is **47ms for a numeric search** and **438ms for a broad text search**
  (`?search=three`, roughly 180 candidates). The gap is the sort window: ordering by
  price needs every candidate hydrated first, and at 6.2 each one was a separate
  `wc_get_product()`. 6.3 primes the caches to fix it — unverified until uploaded.
- The behavioural checks (ordering output, compound intersections, `fields=picker` key
  set, default shape unchanged) were **not reported back**, so they stay under
  Unverified. The endpoint demonstrably runs at 6.2; what it returns has not been
  confirmed row by row.

Step 5 — the PWA shell, confirmed in a browser against plugin 6.1, served from
`npm run dev` at `http://localhost:5173` with `ai_app_origin` set to that exact origin:

- **CORS worked on first contact.** Every `OPTIONS` preflight returned 200 and every
  authenticated request succeeded. This is the first exercise of
  `ai_rest_cors_headers()`, its `OPTIONS` short-circuit, and the exact-origin match —
  all three had only ever been reasoned about. It also confirms the app needs no
  cookies: `credentials: 'omit'` plus Basic auth is sufficient, so
  `rest_cookie_invalid_nonce` never arises.
- **`POST /token` over `fetch` returned 201 and the login flow completed.** The minted
  application password persisted in `localStorage` and authenticated the requests that
  followed — the same exchange curl proved, now proved through a browser.
- `GET /meta` is fetched once after login and reused for the session, not per screen.
- `GET /orders` renders with money formatted from `/meta`'s `currency` and
  `price_decimals`, the status filter works (checked with `on-hold` and `pending`),
  pagination works, and search debounces with `AbortController` cancelling the
  in-flight request per keystroke.

**Debugging note — a caught `AbortError` per keystroke is correct.** The cancellation
pattern means every superseded search rejects with an `AbortError`, which
`views/orders.js` catches and deliberately ignores. With Chrome devtools' "Pause on
caught exceptions" enabled, execution halts at `pending?.abort()` and looks like a bug.
It is not one. Confirmed by test, not just by reading: an abort throws a `DOMException`
named `AbortError` that is not an `ApiError` and is discarded, while a genuine HTTP
failure throws an `ApiError` whose message is shown and a transport failure throws one
with `isNetwork` set. Aborting mid-body-read behaves the same way, which matters because
that path does not pass through `api.js`'s `try`/`catch` around `fetch()`.

## Unverified / open

- **Untestable in this catalogue** (no variable products), relevant only if any are
  added: price search matches variable parents on `_price`, which WooCommerce syncs to
  the cheapest variation, so a variation priced at the term under a cheaper parent is
  missed; and variation-level SKUs are findable only by exact match via
  `wc_get_product_id_by_sku()`, the parent-first search never reaching a partial one.
  Parent/simple SKU partial matching IS verified.
- ~~No relevance ranking for TEXT product searches.~~ **Resolved in 6.2** by ordering
  results by price ascending rather than by title, and by compound terms, which let a
  staff member narrow "three" to "three 2500" instead of scrolling. There is still no
  relevance *scoring* — a text term's matches are ordered by price, not by how well they
  match — and that is now a deliberate choice rather than an open question: price is the
  axis staff think in, and this catalogue has one product per price point, so price
  ordering is effectively a stable, meaningful sort. Revisit only if a catalogue with
  several products at one price appears.
- **`GET /orders?search=` does not resolve order ids.** It handles phone and customer
  name only. A numeric term that is not a valid BD mobile falls through to the name
  search, so typing an order number returns unrelated name matches rather than that
  order. **Decided: id resolution is not needed** — staff search by phone, which works
  today. Kept here rather than deleted, because the fall-through is still a latent
  surprise if anyone does type an order number into the list search.
- **What `/products` RETURNS at 6.2 is still unconfirmed**, even though the endpoint
  runs and its timings are measured. Still to check on staging, row by row:
  `search=three` (cheapest first, 10000 last), `search=2500` (Block A then Block B),
  `search=three 2500` and `search=2500 three` (identical intersections),
  `search=three 2500 1000` (falls back to text), `search=three 99999` (empty, NOT
  widened), `fields=picker` (exactly five keys), and the default shape (nine keys,
  unchanged). There is no PHP binary in the Claude Code environment, so the only local
  evidence is structural plus a PORT of the pure logic into Python (52 assertions), which
  can catch a wrong rule but not a PHP syntax or API error.
- **The 6.3 priming gain is predicted, not measured.** Expected: the text path's ~180
  hydrations stop costing ~540 database round-trips and cost about three, so **438ms
  should fall sharply** — somewhere in the 60–150ms range, the remainder being PHP
  object construction rather than queries. The **numeric path should barely move from
  47ms**: it hydrates only a handful of objects, so most of its time is the two
  full-catalogue search queries, which 6.3 does not touch. If the text figure does not
  drop, the cost was never in hydration and this fix is aimed at the wrong thing —
  `timing_ms` settles it either way.
- **Thumbnails would reintroduce a per-row lookup.** `ai_rest_product_thumbnail()` calls
  `wp_get_attachment_image_url()`, which loads an ATTACHMENT post that priming the
  product ids does not cover. Harmless today — every thumbnail in this store is null, so
  no lookup happens, and `fields=picker` skips the field entirely. If images are ever
  added, the full shape regains N attachment loads and would need a second priming pass
  over the collected image ids.
- **Block B's queries run even when Block A already fills the limit.** Blocks are
  resolved eagerly, so a numeric search always costs the name/SKU queries too, even when
  its price matches alone would fill the page. Kept eager because it makes the query
  count per path fixed and predictable; making it lazy is a safe, unobservable
  optimisation if the extra query ever shows up in `timing_ms`.
- **`/products` query counts**, by static reading of 6.2 (SQL-issuing calls, excluding
  per-product object loads): plain text **3** (1 exact-SKU lookup + 2 name/SKU);
  plain numeric **4** (1 + 1 price + 2 name/SKU); compound with one text part **3**
  (no SKU lookup + 1 price + 2), rising by 2 per extra text part, and collapsing to
  **1** when the price part matches nothing, because the intersection short-circuits.
  So compound costs no more than the numeric path — one fewer, in fact.
- **The `/token` rate limit has never been exercised.** The happy path is verified;
  the throttle is not. Untested: that 5 wrong passwords for one username produce a 429
  with `Retry-After`; that a 6th attempt under a *different* username from the same IP
  is still allowed until the IP bucket fills at 10; that a success clears both buckets;
  and that the fixed window really does expire rather than extend. Test it **last** in
  any session — filling the IP bucket locks out correct logins from that address for 15
  minutes too, including yours. Clear the `aioc_lf_*` transients rather than waiting it
  out.
- **`/token` leaks account existence through timing, not through its responses.**
  `wp_authenticate()` returns faster for an unknown username than for a known one with
  a wrong password, because no hash is compared. The responses themselves are
  identical, and the throttle bounds how much an attacker can sample. Not mitigated;
  recorded so it is not rediscovered as a bug.
- **Application passwords accumulate.** Every login mints one and nothing revokes them
  — deliberately, so signing in on a phone does not sign out a laptop. Expect a growing
  list under the `Order Ops (app)` prefix in the user profile, and prune it by hand
  until a revoke route exists.
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
