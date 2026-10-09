# Verification

What has been proven against a real server, and what has not. **Open it when
deploying, when picking up a loose end, or before trusting any claim about
behaviour** — everything here is either evidence or an admission that there is none.

## Verified

Confirmed by real requests against staging.cartmixbd.com. **The whole API layer is
signed off** — step 3 at 5.6/5.7, step 4a at 5.8, step 4b at 5.9. Per-request detail is
in git log; kept below are only the findings that encode a decision or a confirmed
mechanism.

Reads (step 3) — all behaved as specified at scale (4505 orders / 1502 pages): money
and state labels match the admin screen, status prefixes and `per_page` clamping work,
trashed orders are excluded, private products are returned, envelopes are right. The
mechanisms that were in doubt and are now settled on WooCommerce 11.0.1 / HPOS:

- Order search — `'s'` plus a search filter does partial, mid-string matching. At 7.3
  the filter became `'all'` and the term is no longer normalized; see the search entry
  under *Product decisions* in `docs/DECISIONS.md` for the mechanism and the live
  verification.
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
- **Line items with NO state total 175.00, not 0.00, with no shipping line.** Verified
  at 5.9, when `ai_apply_shipping()` early-returned on an empty state and
  `ai_rest_finalize_order()` called `calculate_totals()` itself to cover that case. **7.0
  removed both**: `ai_apply_shipping()` now always recalculates totals, so the separate
  call would only write the same figures twice. The behaviour is unchanged and was
  re-exercised at 7.0 — order 11361, cleared of its district, came back with a
  recalculated total (see the 7.0 block below). Do not put the early return back; see
  *Product decisions* in `docs/DECISIONS.md`.
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
  application password `/token` mints, and staff never touch one directly. (This used to
  claim the Defender truncation was "genuinely bypassed" too. That was reasoned rather
  than tested, and is moot now Defender stays off.)
- Two findings that constrain the app rather than the API, both now recorded under
  *Product decisions* in `docs/DECISIONS.md`: some state labels carry **trailing
  whitespace**, and `/meta`
  includes **`checkout-draft`**.

The rate-limit throttle on `/token` is the one part still unexercised; it stays under
Unverified.

**CORS is verified in both directions and is no longer an open question.** A matching
origin works from a browser (see step 5 below), and a mismatched `Origin` is refused —
`ai_rest_cors_headers()` strips the headers that core's `rest_send_cors_headers()` would
otherwise reflect for any origin, so no `Access-Control-Allow-Origin` comes back.
That second half is what makes the App Origin setting a control rather than decoration.

`/products` — **all 6.2 output behaviour confirmed row by row on staging**, from the
actual responses:

- `?search=three` returns **cheapest first**: 900, 950, 1000, 1050, 1100, 1150, 1200,
  1250 … with **10000 last**. The string-sort defect that put 10000 second is gone. This
  is the whole reason 6.2 existed.
- `?search=three 2500` returns **exactly one row at 2500.00**, and `?search=2500 three`
  returns the **identical row** — compound term order genuinely does not matter.
- `?search=batik gauze 250` returns **one row at 250.00**, matching both text parts and
  the price, so multi-part text alongside a figure works.
- `?search=three 99999` returns an **empty list**. The empty-intersection rule holds with
  no silent widening — the behaviour that was most at risk of being quietly "helpful".
- `?search=three 2500 1000` returns **empty**, correctly falling back to text search on
  two numeric parts rather than guessing which figure is the price.
- `?fields=picker` returns **exactly `id`, `name`, `sku`, `price`, `is_in_stock`** and
  nothing else.

**6.3's cache priming worked, and the prediction held on both counts** — which matters,
because the second count is what makes the first one mean something:

- **Broad text (`?search=three`): 438ms → 88ms**, a 5× improvement, inside the predicted
  60-150ms range. `_prime_post_caches($ids, true, true)` was correctly targeted, and
  **the term flag earned its place**: `get_product_type()` calls
  `get_the_terms($id, 'product_type')` and `read_visibility()` reads
  `product_visibility`, so priming posts and meta alone would have left a query per
  product behind.
- **Numeric (`?search=2500`): 47ms → 40ms**, essentially unchanged, exactly as predicted.
  This is the control. The numeric path hydrates few objects, so most of its cost is the
  two search queries, which 6.3 does not touch. Had it dropped sharply too, the
  diagnosis would have been wrong and the fix would have been working by accident.
- **WooCommerce has no product cache-priming helper.** `WC_Product_Data_Store_CPT` offers
  only `clear_caches()`, which does the opposite; orders got
  `WC_Order_Data_Store_CPT::prime_caches_for_orders()` but products were never given an
  equivalent. So core's `_prime_post_caches()` is the correct tool, not a workaround. It
  is called behind `function_exists()` — it carried an underscore until WordPress 6.1
  made it public API — so an older core falls back to pre-6.3 per-id hydration rather
  than failing.
- **Server-side product search is now 40-90ms against several hundred ms of observed
  round-trip latency to staging, so network dominates.** Further server-side
  optimisation of `/products` is **not worthwhile** — measure before reopening it. The
  latency a staff member actually feels is now the network, and the place to hide it is
  client-side caching in the step 6 picker.

Fees (6.4), confirmed on staging — **the two item lists are independent**, which was the
property most worth proving because getting it wrong deletes data silently:

- Create with two fees, one of them NEGATIVE, totalled correctly. A discount really is
  just a negative fee as far as the whole stack is concerned.
- An update sending **only `line_items` left both fees intact, with their original
  ids** — so the product replacement does not reach them.
- An update sending **only `fee_lines` left the line item intact** and replaced the
  fees — so the fee replacement does not reach the products.
- `fee_lines: []` cleared every fee, confirming an empty array is a real instruction
  rather than the same as omitting the key.

That is the behaviour the scoped `get_items('<type>')` loops buy, and it is why
`remove_order_items()` with no argument must never appear in this plugin.

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

**The app is verified in a browser against staging at plugin 6.6, as an installed
standalone PWA** (steps 1-7; steps 8-11 were verified later, at 6.8 and 7.0 — see below). This closes the whole app-side unknown:

- **The service worker caches the shell only.** Shell assets show `(ServiceWorker)` in
  the size column; `/wp-json/` requests appear as normal network entries. The rule the
  unit test asserts is the behaviour observed.
- **Offline shows "No connection" with a Try again action**, not an empty order list
  that reads as "this store has no orders".
- **The install prompt works and the app runs standalone.**
- **The product picker, the order form** (Price/Quantity/Total interacting as
  WooCommerce does, fees including the sign toggle), **the trash view and restore**, and
  **the twelve-status dropdown** all work.

So all seven of the ORIGINAL build steps are built and verified. Steps 8 to 11 came
afterwards and are verified in their own block at the end of this section.

Step 7 (installability) — what was checkable without a browser, which is further than it
sounds but was not the same thing:

- The manifest parses, and meets Chrome's installability criteria: name, short_name,
  `start_url`, `display: standalone`, 192 and 512 PNG icons plus a 512 maskable. Each
  declared icon file exists and really is the size it claims. `theme_color` and
  `background_color` are the CSS `--accent` and `--bg`, and the `theme-color` meta tag
  agrees with the manifest.
- The production build serves `/manifest.webmanifest` as `application/manifest+json`,
  `/sw.js` as `text/javascript`, and all four icons as `image/png`.
- The bundle registers the worker, and the `import.meta.env.PROD` guard compiles away
  rather than shipping as a runtime check — so no worker is registered in development.
- **There is no Lighthouse PWA score to report. Lighthouse removed the PWA category in
  v12.0 (April 2024)**, after Chrome stopped requiring a service worker for
  installability. The checks above assert those criteria directly instead; the remaining
  confirmation is Chrome DevTools → Application → Manifest, and whether
  `beforeinstallprompt` actually fires.

`POST /parse` at **6.6**, closing the last parser verification gap — both 6.5 fixes
confirmed through the endpoint, not just locally:

- The bulleted input parses clean: markers stripped, and **the customer name no longer
  injected into the address**. That was the whole defect, and its root cause was that an
  empty `$name` made `ai_remove_value_all()` a no-op.
- A Tongi address resolves to **`BD-18` Gazipur with 120.00 shipping**, so the new alias
  reaches the shipping rate table and not just the state field.

`status=trash` and custom statuses on the write path, confirmed on staging at **6.6**:

- **`GET /orders?status=trash` returns trashed orders**, with `status_label` `"Trash"`.
  That label comes from `ai_rest_order_status_label()`'s post-status fallback, because
  `wc_get_order_status_name()` returns the bare slug `trash` — its special-statuses map
  points `wc-trash` at the slug rather than at a label. HPOS stores the status
  **unprefixed** as `trash`, which is why the query normalizes `wc-trash` down to it.
- **`POST /orders` with `status: "returned"` returns 200 with `status_label`
  `"Returned"`**, so custom statuses work on the WRITE path as well as in `/meta`. The
  app can set them. That closes the last open question about them.

**Custom order statuses propagate end to end, with no app rebuild.** Confirmed on
staging: `GET /meta` returns all **twelve** statuses, the eight WooCommerce ones plus
`not-picked-yet`, `inv-pending`, `inv-processing` and `returned`, each with its label.
They are registered by a Code Snippets snippet through the `wc_order_statuses` filter and
nothing in this plugin knows they exist. That is `/meta`'s design intent demonstrated:
read the lists from WooCommerce per request, hardcode nothing, and a status another
plugin registers simply appears.

- `POST /orders` validates against the same `wc_get_order_statuses()`, so setting an
  order to `returned` through the API should now be accepted by the same mechanism. Not
  separately exercised — worth one request to confirm.
- **A debugging fact worth keeping: core `wc_get_order_statuses()` returns SEVEN
  statuses.** The eighth default, `checkout-draft`, arrives via the `wc_order_statuses`
  filter from WooCommerce Blocks' `DraftOrders`. So seeing eight in `/meta` already
  proves filter callbacks are being applied during a REST request — which is what ruled
  out Code Snippets' REST handling, load ordering and our own caching when the custom
  statuses were missing. If a filtered list ever looks wrong over REST, count the
  statuses first: seven means no filters ran at all, eight or more means they did and the
  problem is the specific callback.
- The earlier failure, where the four custom statuses reached wp-admin but not `/meta`,
  was most likely a stale Code Snippets active-snippets cache: re-saving the snippet
  fixed it, and an `error_log()` in the snippet confirmed it executes on REST requests
  (`admin=0`). Not conclusively proven, so it is recorded under *Environment* in
  `docs/PROJECT-STATE.md` as a
  troubleshooting step rather than as a known mechanism.

Decimal quantities on **staging** at **7.1**, through the API and in a browser:

- A quantity of **1.5** saved and round-tripped as the string **`"1.5"`** — so the decimal
  plugin's `woocommerce_stock_amount` filter lets it through `wc_stock_amount()`, and
  `ai_rest_quantity()` reports it trimmed.
- **3.567** was stored as **3.57**, with the warning saying so.
- In the browser: the quantity field shows **"1.5", not "1.50"**; the line total follows a
  typed **2.25**; the **− button is disabled at 1**; and the order list reads **"1.5 items"**.

`POST /parse` on **LIVE** at **7.1** — the first requests verified against live rather than
staging, so live's 7.1 parser is confirmed working end to end:

- `"Kishoreganj Sadar, Kishoreganj"` → **BD-26 Kishoreganj**, 150.00 Outside Dhaka.
- `"Sreepur, Gazipur"` → **BD-18 Gazipur**, 120.00.
- A message with a realistic name ("Rahim Uddin") returns the name, address and
  district correctly and separately. An earlier run with the literal "Test Name" had
  seemed to put the address in the name; that was the test input, not the parser — see
  "Parser test inputs need REALISTIC names" under *Conventions* in `docs/DECISIONS.md`.
- Both district results match the current code run locally under PHP 8.3 with
  WooCommerce's 64-row BD list. Both name their district in full, so both are decided
  by the exact-alias pass; the fuzzy pass's misroutes, which need the district left
  out, are a separate item under *Unverified / open* below and still reproduce.

Parser fixes (6.5) — verified LOCALLY against a real PHP 8.3.35 with WooCommerce's
64-row BD state list stubbed in, not on staging. Every PHP file in the plugin also
parses clean under `php -l`, which had never been checked before.

- The reported bulleted input now yields name `Atika Parven`, phone `01778828637`,
  address `Shopnonagor residential area 2, Building no 13 (mollika), Dhaka 1216`, state
  `Dhaka` / `BD-13` — no markers anywhere, and the name no longer in the address. Same
  result with `-`, `*`, `·`, `◦`, `▪`, `–` and `—` as the marker.
- `Mirpur-10` survives inside an address, with and without a leading bullet, and a line
  beginning `-1079` / `-১০৭৯` keeps its sign.
- Tongi resolves to Gazipur / `BD-18` in every requested spelling, bare and with the
  district, and a full Tongi address parses end to end.
- `Tongibari` still resolves to Munshiganj and `Tungipara` to Gopalganj, which is what
  the substring guards are for.
- Mohakhali now resolves to Dhaka rather than Noakhali.
- Regression spot-checks hold: district names, Bangla input, Dhaka areas, the numbered
  list form, `Bogra` → Bogura and `Cox's Bazar`.

Steps 8-11 — the repeat-customer lookup, Reorder, the shipping preview and the 7.0
shipping fix — **confirmed on staging and in a browser**. `/ping` reports `7.0`.

- **The 7.0 shipping fix, on order 11361, the reported case.** It had an empty billing
  state and a stale 120.00 Gazipur line. Saving it removed the line and the total dropped
  to **3,600.00**. Clearing a district **in wp-admin** cleared the line too, so the admin
  hooks reach the same function as the app — the claim under *Product decisions* in
  `docs/DECISIONS.md`, now
  observed rather than reasoned.
- **The form's shipping figure follows the district live, and saves what it showed.**
  Setting Dhaka showed 80.00 and saved correctly; Gazipur showed 120.00; changing back to
  Dhaka returned to **80.00 rather than sticking at 120.00**; clearing the district
  removed shipping from the Totals block before the save. That is the
  `state.loadedState` comparison working as designed.
- **Exactly one save bar**, with nothing overlapping it.
- **`GET /meta` at 7.0 carries `shipping_rates`** — `default` 150.00, BD-13 80.00, BD-18
  120.00.
- **`GET /customers/last-order` at 6.8**: a repeat customer returned their previous order,
  an unused number returned 200 `{found: false}`, and a bad number returned 400.
- **Reorder works from both entry points** — the expanded last-order card and an order
  list row — and **a negative fee carries over**, so discounts survive the copy.


## Unverified / open

- **Untestable in this catalogue** (no variable products), relevant only if any are
  added: price search matches variable parents on `_price`, which WooCommerce syncs to
  the cheapest variation, so a variation priced at the term under a cheaper parent is
  missed; and variation-level SKUs are findable only by exact match via
  `wc_get_product_id_by_sku()`, the parent-first search never reaching a partial one.
  Parent/simple SKU partial matching IS verified.
- **On live (7.1), only `POST /parse` has been exercised.** The 6.7-7.1 routes and fixes
  are installed there but unverified on live: last-order lookup, `shipping_rates`, the
  7.0 shipping fix and decimal quantities. All four are verified on staging.
- **What the decimal-quantity checks on staging did not reach** (the verified behaviour
  is under *Verified* above):
  - wp-admin's own order screen showing the 1.5, and a fractional quantity entered IN
    wp-admin loading into the app unchanged — Price as total ÷ quantity — and surviving
    an app save of that order's items.
  - 0 and a negative quantity coming back as 1 with a warning.
  - **The decimal plugin's filter is now observed rather than assumed for "1.5"** — it
    survived as 1.5 — but its source has still not been read, so its handling of other
    precisions is inferred from ours applying 2dp on top.
  - **`add_product()`'s own subtotal for an UNPRICED line** — the add-by-id stopgap,
    which sends no total — calls `wc_get_price_excluding_tax()` with the fractional
    quantity. Read as float-safe in WooCommerce 11, not exercised. Every priced line
    sends its own total, so this touches only that one path.
  - Stock reduction for a fractional line is the decimal plugin's and WooCommerce's
    business, not this plugin's, and is not covered by anything here.
- **New order from the form is unseen in a browser.** Check that it reads as distinct
  from Save on a phone, that the two-tap warning is visible without scrolling, and that
  tapping it on a just-saved new order opens a blank form rather than doing nothing.
- **The exit guards are unseen in a browser** (app 0.7.0 / 0.8.0). Check on a phone,
  scrolled to the bottom of a long form: that tapping ‹ Orders shows the strip under the
  header at once, that the sticky header really does stay pinned (it is `sticky` inside
  `.order-form`, which spans the page), that the strip - which overlays the top of the
  content rather than pushing it down - does not hide something the user needs in order
  to decide, and that Keep editing is easy to hit.
  The Reload path can only be seen with a production build and a second deploy behind
  it — see the service-worker traps under *Start here* in `docs/PROJECT-STATE.md`.
- **Save clearing the update banner is unseen on a device** (app 0.9.0). The geometry is
  asserted from the stylesheet and the measurement from a stubbed layout; nothing has
  laid it out for real. Check on a phone, with a production build and a second deploy
  behind it: that Save sits visibly above the banner, that the gap between them does not
  read as broken, that the bar follows the banner up when Reload rewords it into the
  longer warning, and that Trash at the bottom of a long form can still be scrolled clear
  of both. `getBoundingClientRect()` on a `position: fixed` element and
  `ResizeObserver` are both long-standing in every browser this targets, but iOS Safari
  is where a mismatch would show.
- **The new icons are unseen on a device** (app 0.10.0). Checked here only as rendered
  pixels: the maskable icon cut to a circle and shrunk to home-screen sizes. **At 48px
  the "CARTMIX" wordmark blurs into a yellow band**; the cart's shape, its teal and the
  orange wheels still read, and at 72px "CART" and "MIX" are just legible. That is the
  limit of a horizontal logo with a wordmark, not of the scaling: if the icon reads
  poorly on real home screens, the fix is a cart-only mark from whoever owns the logo,
  not a different crop of this one. Also check: Android's launcher picks the maskable
  icon, iOS the apple-touch-icon (re-add to the home screen to see a change — iOS caches
  it), and an existing install shows the new icon after the `v14` shell update.
- **The browser and hardware back buttons leave the app with no warning.** By decision
  — see the exit-guard entry under *Product decisions* in `docs/DECISIONS.md` — not an
  oversight.
- **How many orders carry a stale shipping line is NOT KNOWN, and cannot be answered from
  this repo** — on live especially. The 7.0 fix stops new ones; it does not repair
  existing ones, each of which needs one save (confirmed on staging with order 11361,
  the one reported instance, which is now repaired). Nothing here has database access,
  so the count is unknown rather than small. What would answer it: orders whose billing
  state is empty while a shipping line exists. Under HPOS that means `wp_wc_orders`
  joined to `wp_wc_order_addresses` (`address_type = 'billing'`, empty `state`) against
  `wp_woocommerce_order_items` (`order_item_type = 'shipping'`) — or, matching this
  project's no-raw-SQL convention, a `wc_get_orders()` pass checking
  `get_billing_state()` against `get_items('shipping')`. Run it on live after the 7.0
  upload, and once on staging to confirm nothing besides 11361 was affected there.
- **What the steps 8-11 checks did not reach.** The verified behaviour is listed under
  Verified; these specifics were not part of it:
  - Shipping preview: that a district **outside** the rate table previews 150.00, and
    that a SAVED order whose shipping was adjusted in wp-admin keeps showing the adjusted
    figure rather than the table's while its district is untouched.
  - Repeat-customer card: that editing an order with its phone unchanged shows NO card,
    while changing the phone to another customer's number shows theirs; that a new
    customer's number shows nothing in the app (the endpoint's `{found: false}` is
    verified); and that the legacy AJAX admin tool still works after the lookup was
    extracted out from under it in 6.7.
  - Reorder: that a copied line whose product has since gone out of stock produces the
    server's warning after save, and that the replace-confirmation on a form that already
    has items reads clearly.
- **The picker's close affordance sits at the top of the sheet, not in thumb reach.**
  With a full-height sheet and the keyboard up, the head row is the only region the
  keyboard cannot cover, so Close lives beside the search box. Escape and a backdrop tap
  also close it. If one-handed use proves awkward in practice, a swipe-down gesture is
  the obvious addition.
- **The orders list may include `checkout-draft` carts.** Our default status arg is
  `array_keys(wc_get_order_statuses())`, which INCLUDES `wc-checkout-draft`, whereas
  WooCommerce's own empty/'any' handling excludes anything flagged
  `exclude_from_search` — `checkout-draft` among them. Invisible on this store because
  the storefront is unused and there are no abandoned carts, so nothing to fix today, but
  the default is wider than WooCommerce's. The app filters the status out of its dropdown;
  the list query does not.
- **District fuzzy matching: fixed in 7.2, NOT yet on either site.** The four misroutes
  of places written without their district are gone in the repo, verified only locally
  under PHP 8.3 by `tests/parser/state-matching.test.php`:
  - `"Kishore"`, `"House 5, Kishore"` and a customer NAMED Kishore → **no district**
    (were Jashore)
  - `"Sreepur"`, `"Sreepur bazar"` → **no district** (were Sherpur)
  - `"Kaliganj"` → **no district** (was Habiganj)
  - `"Shibpur"` → **Narsingdi**, now an exact alias (was Sherpur)

  **Deliberately left resolving to nothing:** Kishore, Sreepur and Kaliganj, for the
  reasons under "A wrong district is worse than no district" in `docs/DECISIONS.md` -
  staff pick from the empty dropdown. If it turns out nearly every bare "Sreepur" or
  "Kaliganj" this store sees is Gazipur, mapping them is a business call that trades a
  rare 30 BDT under-charge on a Magura, Satkhira or Jhenaidah order for not having to
  pick; the code change is one line each.

  **What the tighter allowance gave up:** 2-edit misspellings of names under 9
  characters. `gazipore`, `tangile` and `naraingonj` were added as exact aliases for
  that; others will surface as an empty district, which is visible. How often staff
  messages omit the district at all is still not known.
- **WooCommerce's own BD state labels leak trailing whitespace into the alias map.**
  `ai_get_state_aliases()` keys on `strtolower($name)`, so `"Faridpur "` and
  `"Manikganj "` become aliases with a trailing space that no substring search can
  match. Harmless today because the manual file carries clean duplicates, but it is the
  same trailing-whitespace finding already recorded under *Product decisions* in
  `docs/DECISIONS.md`, showing up
  in a second place.
- **WooCommerce caps a negative fee at the order's own value** inside
  `calculate_totals()`, rewriting the fee item's total so the order cannot go below
  zero. A discount larger than the order therefore comes back smaller than it was sent.
  That is WooCommerce's behaviour, not this plugin's, and the app deliberately does not
  try to detect or warn about it — the re-render after saving simply shows the figure
  the server kept. Recorded so it is not rediscovered as a bug.
- **Fee round-trips have not been checked end to end**, though the form and both
  endpoints are built and the rest of step 6a is verified in a browser. Unconfirmed:
  that removing every fee and saving actually clears them server-side, and that editing a
  product does not disturb the fees in the same round trip. The two lists are
  independently scoped in the code and the contract check asserts the payload semantics,
  so this is a verification gap rather than a suspected defect.
- **More upazila names would be worth adding to `bd-locations.php`, now that the AI no
  longer fills the gap.** 7.5 made the district come from the text only, so an address
  naming an upazila the file does not list resolves to nothing and a staff member picks
  from the dropdown. That is the safe outcome, but each missing name is a small, fixable
  cost. Confirmed missing and NOT ambiguous: `ধামরাই` (Dhamrai, Dhaka) and `মদন` (Madan,
  Netrakona). `শ্রীপুর` and `নবাবগঞ্জ` stay unmapped on purpose — each names an upazila in
  several districts, and mapping either would assert a district the text never states.
  - The file's own rules apply to each addition: the value must be a WooCommerce label
    byte for byte, and a new key must be checked for substring collisions in both
    directions. `state-matching.test.php` enforces the first.
  - Worth doing from real order data rather than a gazetteer: the names that matter are
    the ones customers actually write.
- **Thumbnails would reintroduce a per-row lookup.** `ai_rest_product_thumbnail()` calls
  `wp_get_attachment_image_url()`, which loads an ATTACHMENT post that priming the
  product ids does not cover. Harmless today — every thumbnail in this store is null, so
  no lookup happens, and `fields=picker` skips the field entirely. If images are ever
  added, the full shape regains N attachment loads and would need a second priming pass
  over the collected image ids.
- **Block B's queries run even when Block A already fills the limit.** Blocks are
  resolved eagerly, so a numeric search always costs the name/SKU queries too, even when
  its price matches alone would fill the page. Kept eager because it makes the query
  count per path fixed and predictable. **Not worth changing**: the numeric path measures
  40ms against several hundred ms of network, so the saving would be invisible. Recorded
  only so the next reader knows it is a choice rather than an oversight.
- **`/products` search-query counts**, by static reading (unchanged by 6.3): plain text
  **3** (1 exact-SKU lookup + 2 name/SKU); plain numeric **4** (1 + 1 price + 2
  name/SKU); compound with one text part **3** (no SKU lookup + 1 price + 2), rising by
  2 per extra text part, and collapsing to **1** when the price part matches nothing,
  because the intersection short-circuits. **On top of those, 6.3 adds up to three
  priming queries per hydration loop** — post, meta and object-term — which is the whole
  point: three queries in place of up to three *per product*. They are flat, so they do
  not scale with how many candidates a term matches.
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
- **What CAN and cannot be checked without a server.** A portable PHP in the scratchpad
  makes `php -l` over all 27 files real, and lets the deterministic parser and the rate
  table actually execute (see *Conventions* in `docs/DECISIONS.md` for how to set it up).
  What is still
  unreachable locally: WooCommerce itself, so anything touching `wc_get_orders()`,
  `wc_get_products()`, `WC_Order` or `wc_get_order_statuses()` is structural or simulated
  only, and the Groq path, which needs network and a key. Behaviour against WooCommerce
  must be confirmed by curl against staging, as was done for steps 3a and 3b.
- **Recorded here but NOT verifiable from this repo.** Everything below is written down
  because it was observed once; none of it can be re-checked by reading the code, so
  treat it as a claim with a date on it rather than a fact:
  - **Which plugin version each site runs** (live 7.1, staging 7.1 — the repo is at
    7.6). Only `GET /aioc/v1/ping` can answer this. Check it before trusting any other statement
    about the servers.
  - **`ai_app_origin`'s value on either site** — `http://localhost:5173` on staging,
    expected empty on live. Both are settings in wp-admin. The live one in particular is
    an expectation, not an observation: nobody has looked.
  - **That the Decimal Product Quantity plugin is active on both sites.** Reported, not
    observed from here.
  - **That Defender is deactivated**, and that it was what truncated the
    application-password display.
  - **That the "Decimal qty step fix (order edit)" snippet exists and is active on both
    sites.** Reported, not observed from here.
  - **That the custom-status snippet exists in Code Snippets and is active**, and that
    the shipping snippet was deleted from it in 4.9. The deletion especially: the
    plugin's copy of the table is in the repo, but nothing in the repo can show whether
    a snippet was removed from a site.
  - **That staging's trash still holds the step 4b test orders.**
  - **WooCommerce's internal behaviours** quoted throughout — `sanitize_status()` passing
    unknown statuses through, `calculate_totals()` capping a negative fee, HPOS storing
    trash unprefixed, `add_product()` appending rather than merging. These were read from
    the WooCommerce 11.0 source, which is not vendored here, so they are version-specific
    and will not be re-checked by any local test.
  - **The 4505 orders / 1502 pages scale figures**, and every timing in milliseconds.
    Staging data, at one moment.
