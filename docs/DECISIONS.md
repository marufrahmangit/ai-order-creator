# Decisions and Conventions

Every settled decision and convention this project runs on, with the reasoning.
**Reference, not arrival reading** — open it when you are about to change a
specific area, to find out what was already decided there and why.

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
- **Quantities in REST responses are a raw numeric string too, trimmed rather than
  padded** — `"1"`, `"1.5"`, `"3.56"` — via `ai_rest_quantity()`. This covers line-item
  `quantity` and the list's `item_count`. Same reason as money: `get_item_count()` sums
  floats, and 1.1 + 2.2 would otherwise be sent as `3.3000000000000003`. Trimmed because
  a quantity, unlike money, has no fixed number of decimals to show. The app sends them
  back the same way. **Never `(int)` a quantity anywhere** — that is what silently turned
  1.5 into 1 in both directions until 7.1.
- No raw SQL. Use `wc_get_orders()` / `wc_get_products()`.
- Pagination params clamp rather than 400.
- Never register a bare PHP built-in as a `sanitize_callback` / `validate_callback`:
  WordPress passes three arguments, so any built-in of arity ≤2 is a PHP 8 fatal
  (`intval` 500'd every `/products` request). Use the `ai_rest_sanitize_*` /
  `ai_rest_validate_*` wrappers in `rest.php`; `grep "_callback'.*=> '" | grep -v ai_`
  must stay empty.
- Logic files produce no output. Presentation lives in `admin/views/`.
- **The parser CAN be run locally now, and the plugin CAN be linted.** There is no
  system PHP, but a portable one drops into the scratchpad and works:
  `curl -sL https://downloads.php.net/~windows/releases/php-8.3.35-nts-Win32-vs16-x64.zip`,
  unzip, then run with `-d extension_dir=<dir>/php/ext -d extension=mbstring` —
  mbstring is NOT loaded by default and the parser needs it. `php -l` over every file
  is then a real syntax check, which this project never had.
  - To execute the parser, stub `ABSPATH`, `AIOC_PATH`, `__()`, `get_option()`,
    `ai_log()` and a `WC()` whose `countries->get_states('BD')` returns the real 64-row
    list, then require `includes/parsing/*.php` and call
    `ai_build_deterministic_parse()`. The BD list can be lifted from WooCommerce's
    `i18n/states.php` — note that file begins `defined('ABSPATH') || exit;`, so
    requiring it without `ABSPATH` defined exits silently with status 0.
  - The Groq path still cannot be exercised locally: it needs network and a key. Only
    the deterministic pipeline is reachable, which is where the parsing logic lives.
  - **Parser test inputs need REALISTIC names.** `ai_is_probable_name_line()` is meant to
    reject lines that are not a personal name, and it correctly rejects a placeholder
    like "Test Name". The deterministic parse then returns an EMPTY name — confirmed
    locally: "Test Name" gives `name: ""` with phone, address and district all correct,
    "Rahim Uddin" in the same message gives `name: "Rahim Uddin"`. An empty name is one
    of the triggers for the Groq fallback (`ai_should_call_ai()`), whose answer is merged
    in, so through `/parse` a placeholder name means testing Groq rather than the parser
    — which is the most likely source of the "address returned as the name" seen on
    live with "Test Name" (not reproducible here: Groq needs a key). That looked like a
    bug in the name extractor and was not one. Use a real-looking name such as "Rahim
    Uddin" unless the name rule itself is what is being tested.
  - Equally, **a district test has to leave the district OUT to exercise the fuzzy
    matcher.** `ai_extract_state_from_text()` runs an exact substring pass over the whole
    text first, and only falls back to fuzzy matching when no alias appears anywhere. An
    input that names the district in full ("Sreepur, Gazipur") is decided by the exact
    pass, and says nothing about the fuzzy one.
  - **THE DISTRICT COMES FROM THE CUSTOMER'S TEXT, OR FROM NOWHERE. The AI never
    supplies one.** `ai_get_parsed_order_data()` takes `state` from
    `ai_extract_state_hint_from_text($normalized_text)` and nothing else.
    - Until 7.5 Groq's answer was merged in whenever the deterministic pass found no
      district, and then "validated" by running the matcher over **Groq's answer**. That
      only asks whether the string is a real district name, and Groq returns real
      district names. A live order ending `নেএকোণা` came back as **Chandpur** — a genuine
      district, nobody's district — and `ai_ensure_state_in_address()` appended it to the
      address, so the order carried a district nobody had typed.
    - **The right question is whether the district is IN THE MESSAGE**, and the text hint
      already answers it. When the deterministic pass found nothing that hint is empty by
      construction — same matcher, same text — so Groq's state is discarded every time
      rather than sometimes. Deliberate, not an oversight.
    - `state` is also **not** a reason to call the AI any more. Asking it only to discard
      the answer cost a round trip on every otherwise-complete message naming no
      district. The prompt was tightened too: a model told to find the "best match" also
      pads `address_line_1` with its guess, which no state validation would catch.
    - **The cost, accepted:** Groq sometimes knew an upazila-to-district mapping the
      alias file lacks. The remedy is to add the alias — checkable and permanent —
      rather than to trust a guess that cannot be checked. The gain: the AI can no
      longer override a deliberate refusal, and `Sreepur`/`Kaliganj` are unmapped on
      purpose.
    - **wp-admin's "Create Order with AI" therefore refuses when no district resolves.**
      That button writes with no review step between the preview and the write, so an
      unresolved district there would create an order with no shipping line at all.
      Applying the Outside Dhaka default instead would contradict 4.9/7.0 and would put
      a shipping line on an order with no district to justify it. **`POST /orders` is
      deliberately NOT changed** — the app has a dropdown and a totals warning, and
      validation there mirrors WooCommerce rather than being stricter.
  - **An alias's VALUE in `bd-locations.php` must be a WooCommerce BD label, byte for
    byte — and the right spelling is never the obvious one.** The keys look like the
    interesting half; the value is where the file fails silently.
    `ai_extract_state_from_text()` returns the value, and `ai_match_state_code()` has to
    find it in `WC()->countries->get_states('BD')`. A value that is merely the district's
    usual spelling gives a NAME and no CODE — and an order with no state code **gets no
    shipping line at all**, because `ai_apply_shipping()` has nothing to price. The parse
    preview looks correct and the order is short by 80-150 BDT.
    - Four were wrong this way until 7.4, and in none of them is WooCommerce's spelling
      the expected one: **`Netrakona`** not Netrokona, **`Jhalokati`** not Jhalokathi,
      plain **`Nawabganj`** for Chapainawabganj, and **`Cox's Bazar`** with one
      apostrophe where the file had two. Nine aliases between them.
    - `state-matching.test.php` now compares every value against the label list
      **directly**, not through `ai_match_state_code()`. That function's second pass
      re-runs the alias search on its own argument, so a bad value is rescued whenever
      some other alias points at the right district — which is exactly how these four
      survived. Asserting through it would have passed.
  - **`tests/**/*.test.php` are the committed PHP suites**, discovered by filename and
    run by `npm test` when a PHP is available (above) — currently
    `tests/parser/state-matching.test.php` and `tests/rest/order-search.test.php`. They
    stub only the WordPress and WooCommerce functions the code under test touches, so
    anything needing real WooCommerce or a database stays out of reach and belongs in a
    request against staging instead.
  - **`tests/parser/state-matching.test.php` is the parser one.** It stubs only the WordPress and
    WooCommerce functions the parser touches, with WooCommerce's 64-row BD list as a
    fixture in `tests/parser/fixtures/` - extracted as DATA from `i18n/states.php`, never
    executed, so the `ABSPATH` trap above does not apply. It pins both directions of the
    7.2 change: places without their district resolve to nothing, including "Kishore" as
    a customer's name; 25 real misspellings still resolve; the live full-name cases keep
    their district, code and rate; and the near-neighbour district names stay put.
    Confirmed to fail with the old allowance, with an allowance of 1 everywhere, with a
    `kishore` alias added, and with a new alias removed. A new PHP suite needs only the
    `.test.php` suffix under `tests/`.
- App tests: `npm test` in `app/`. No dependencies, no browser, **fourteen suites, 421
  assertions**. Some read the real source and lift part of it, so they cannot drift from
  the code silently; the rest run a view against a crude DOM shim, which is the only
  thing in this project that executes one at all.
  - **`test/run-all.mjs` is the runner.** It discovers every `test/*.test.mjs` by name,
    runs each in its own Node process, and always runs all of them; the exit code is
    non-zero if any suite exits non-zero, and the summary names which. A new suite needs
    only the `.test.mjs` suffix. It replaced a `&&` chain in which one suite crashing
    stopped every suite after it — so a healthy run looked like a failure and a real
    failure further down was hidden.
  - **A suite that opens a handle must close it before the process ends, and should set
    `process.exitCode` rather than call `process.exit()`.** `api-abort.test.mjs` called
    `process.exit()` with its test server's keep-alive sockets, a deliberately unfinished
    response and a pending timer still open, and on Node 24 / Windows that crashed with a
    libuv `UV_HANDLE_CLOSING` assertion after all 23 checks had passed. It now clears the
    timer, destroys the connections with `closeAllConnections()` and awaits
    `server.close()`. With `exitCode`, anything left open shows up as a hang rather than
    a crash, which points at the leak.
  - `test/api-abort.test.mjs` — runs the real `src/api.js` against a throwaway localhost
    server, pinning the abort-versus-real-failure contract the order list depends on.
  - `test/picker-logic.test.mjs` — lifts the pure half of `views/product-picker.js` and
    asserts the cache-narrowing lookup and the client-side filter, which is where "typing
    feels instant" lives and where a wrong rule would show a product that does not match
    what was typed.
  - `test/sw-routing.test.mjs` — lifts `routeFor()` out of `public/sw.js` and asserts
    that no API request is ever intercepted.
  - `test/phone-parity.test.mjs` — pins `src/phone.js` to values **generated by running
    the real `ai_normalize_bd_phone()` under PHP**. It is the one that cannot lift its
    counterpart, because the other side is PHP, so if `phone.php` changes these values
    must be regenerated rather than edited to pass.
  - `test/view-smoke.test.mjs` — CONSTRUCTS every view. It exists because the 6.7
    order-form crash was invisible to everything else: the bundler was happy, the
    contract check greps source text, and the other suites only touch pure functions.
  - `test/last-order-lookup.test.mjs` — captures the URLs the order form REQUESTS and
    what it then shows, so the lookup's query string and its display rule are both
    asserted rather than inferred from the code that builds them.
  - `test/contrast.test.mjs` — computes WCAG contrast for the text/background pairs the
    app actually puts together, reading the real stylesheet so a colour changed there is
    checked without anyone remembering to. It also asserts structurally that no
    `.badge-*` rule can select outside the badge.
  - `test/reorder.test.mjs` — asserts Reorder through the SAVE PAYLOAD: that items, fees,
    the note and the district are copied, that the old status is not, that shipping and
    identity are not sent, that a typed name survives, and that the first tap on a form
    with items only warns. It also compares the payloads from BOTH entry points for the
    same source order and asserts they are identical, which is the only way to show that
    and not just assert it. The payload is the right place to look because the
    dirty-marking is invisible anywhere else - a copy that forgets it renders perfectly
    and saves nothing.
    - Note it loads `/meta` first, as every real screen does behind `withMeta()`.
      Without that the district copy is correctly skipped, because no district is on
      offer, and the test would quietly be asserting the wrong thing.
  - `test/shipping-preview.test.mjs` — asserts the shipping figure in the form's Totals
    block in all four states: a saved order shows the SERVER's line even where that
    differs from the rate table, an unsaved order shows the selected district's rate and
    updates live as it changes, a district that is set but unlisted gets the default, and
    NO district shows a dash rather than the default. It also asserts that no rate
    literal appears anywhere in `app/src/`, and that the wording under the totals matches
    the case showing. Worth its own file because the Order total is read aloud to a
    customer, and both failure directions — a dash, or the default applied to a blank
    district — are wrong money rather than a cosmetic defect.
    - It compares the AMOUNT out of each formatted figure, not the whole string.
      `formatMoney()` goes through `Intl` and which glyph BDT renders as depends on the
      runtime's ICU data — Node gives `BDT 80.00` where a browser gives `৳80.00`. An
      assertion on the full string tests ICU, not the rate.
  - `test/save-bar.test.mjs` — asserts there is exactly one save button and one save bar
    in the form's DOM, for a new order and a loaded one, and that the layout rule holds at
    BOTH ends: the bar is `fixed`, and `.form-main` reserves room below its content.
    Fixing either alone reintroduces the overlap, which is why both are pinned. Confirmed
    to fail when the old `sticky` rule is put back. Also that the bar is clear of the
    update banner while it is up: the bar and the order list's button lift by the SAME
    `var(--pwa-banner-space)`, the form's reservation grows by it too, the stylesheet's
    default clears a two-row banner worked out from the stylesheet's own figures, and
    `pwa.js` measures the banner on show, on rewording and on resize, and drops the lift
    on dismiss. Each half was confirmed to fail when removed.
  - `test/decimal-quantity.test.mjs` — fractional quantities and New order from the form.
    The rounding cases are pinned to values **generated by running the real
    `ai_rest_line_quantity()` under PHP** with a float-safe stock filter, the same way
    `phone-parity` pins the phone rule, so regenerate them rather than editing them to
    pass. Beyond that it drives the quantity input (rounding, the focus-time fallback,
    the stepper floor), asserts that leaving Price untouched cannot drift the total, reads
    the save payload, checks the list's item-count wording, and asserts no
    `Math.max(1, … quantity)` clamp survives in `src/`. Confirmed to fail when the old
    clamp, the old Price blur or an unguarded New order is put back.
  - `test/icons.test.mjs` — every icon is rebuilt in memory from `logo.png` by the real
    `scripts/make-icons.mjs` and compared byte for byte with the committed file, so a
    logo replaced without rerunning the script cannot ship half-applied. Also: each
    manifest icon exists at its declared size, no drawn pixel of the maskable icon lies
    outside the 40% safe circle and its corners are filled, every icon is opaque, and
    index.html, the service worker's precache and the login screen all point at files
    that exist.
  - `test/login.test.mjs` — the password Show/Hide (default hidden, a button beside the
    field rather than inside it, does not take focus, keeps the field's autocomplete and
    name, and turns the field back into a password field BEFORE the request), and that a
    sign-in persists: it survives a relaunch, a 500 or a wrong password at the login
    screen does not sign anyone out, a 401 on an authenticated request does, and only
    three code paths can remove the credential at all.
  - `test/exit-guards.test.mjs` — every way out of a dirty order form. For each guarded
    exit (‹ Orders, Open #N, + New order, the update banner's Reload): a clean form goes
    straight out, a dirty one warns on the first tap and goes on the second. Also WHERE
    the warning shows (inside the sticky header, not the status line; Reload's in the
    banner's own text), Keep editing, that one exit's warning does not license another
    and takes the other's warning down, that a save or a dismissed banner disarms, that
    `beginScreen()` clears the guard, that Trash goes through on its own confirmation,
    and that no `beforeunload` handler exists in `src/`. Each of those was confirmed to
    fail when the code it covers is reverted.
  - The DOM shim and module loader the view tests share live in `test/dom-shim.mjs`.
    A new module under `src/` must be listed in its `VIEW_MODULES` or the view suites
    fail to resolve it. Its `remove()` really detaches a node, so a test can tell whether
    a banner or sheet is still up.
- **`app/src/phone.js` is the one piece of logic deliberately duplicated between PHP and
  JS**, and it exists only to decide whether a half-typed number is worth a last-order
  request. The server re-normalizes and answers 400 if it disagrees, so the client copy
  is a gate and never a source of truth — nothing on the write path goes through it.
  Keep it line-for-line with `includes/parsing/phone.php`.
- App layout (`app/src/`): `api.js` is the ONLY module that calls `fetch` — one place
  where auth, CORS, error shape and abort handling live. `auth.js` owns the stored
  credential, `meta.js` the session-cached `/meta`, `format.js` money and dates,
  `dom.js` node building, `views/` one file per screen. Views never call `fetch`
  directly. `exit-guard.js` is the app-wide unsaved-changes guard — see Product
  decisions — and `quantity.js` the 2dp quantity rule shared with the plugin.
- **An order is fetched exactly once, on entering the edit view.** Both write routes
  return the full order object, so a save re-renders from the response body and a parse
  changes nothing server-side — neither needs a follow-up `GET`. `main.js` holds a
  route key so a repeat tap on the same target cannot mount a second copy of a screen
  and repeat its load, and cancels the previous screen's READS on navigation.
  **Writes are never given that abort signal**: aborting a `POST` after the server has
  committed loses the response while keeping the change, and for `POST /orders` that
  means losing the new order's id — the natural reaction, trying again, would create a
  second order.
- The order form re-renders only its dynamic parts — the items list, the totals, the
  warnings — and never the field inputs. Rebuilding an input while someone is typing in
  it loses their caret and, on a phone, closes the keyboard. Field values are written
  only when loading an order, after a save, or from `/parse`.
- **The service worker caches the app shell and NOTHING ELSE. No API response, ever.**
  This app's whole job is reading and writing live order data, so a cached order list is
  not a stale convenience — it is a staff member looking at orders already dealt with,
  or saving against state that moved underneath them. There is no
  stale-while-revalidate, no fallback to a previous response, and no offline write
  queue: a save that cannot reach the server **fails visibly** so the person retries
  deliberately. Queueing writes invisibly is how a customer ends up with two identical
  orders.
  - The rule is enforced in `routeFor()` in `app/public/sw.js`, which returns `network`
    for any non-GET, for any cross-origin request (the API is on another origin, and
    those still pass through a worker), and for anything under `/wp-json/`. `network`
    means the worker never calls `respondWith`, so the browser behaves exactly as it
    would with no worker installed. `app/test/sw-routing.test.mjs` pins all of it.
  - The shell is cache-first so a cold launch paints immediately. Hashed bundle names
    are cached at runtime rather than precached, which is safe because they are
    content-hashed: a new build means new URLs, not new contents at an old URL.
- **`SHELL_VERSION` in `app/public/sw.js` MUST be bumped whenever the shell changes.**
  It names the cache, and changing it is also the only thing that makes the worker's
  bytes differ — which is the only thing that makes a browser notice a new worker. Ship
  a rebuilt shell without bumping it and installed clients keep serving the OLD
  `index.html`, and therefore the old bundle, indefinitely. There is no automatic
  invalidation behind this.
- **An update is offered, never applied.** A new worker waits; the app shows a
  dismissible "update is ready" banner and only reloads when tapped. Auto-reloading
  would discard a half-filled order form.
- **Every icon is GENERATED from `app/public/icons/logo.png`** by
  `scripts/make-icons.mjs` — the 192 and 512 manifest icons, the 512 maskable, the 180
  apple-touch-icon, the 32 favicon and the login screen's logo. No dependencies:
  `scripts/png.mjs` is a minimal PNG codec.
  - **It runs automatically before every `npm run build`** (the `prebuild` script), so
    `dist/` always carries icons made from the logo in the tree at that moment and a
    replaced logo cannot ship stale icons. `npm run icons` runs it alone. It writes into
    `public/icons/` in the source tree, so a changed logo shows up as changed icons in
    `git status`, to be committed together; output is deterministic, so an unchanged
    logo produces no diff.
  - **What `icons.test.mjs` compares:** each committed icon against one regenerated IN
    MEMORY from the `logo.png` present when the test runs — not against a stored
    snapshot. So replacing the logo without regenerating fails it (confirmed: a
    recoloured logo fails all six "matches" checks). It does not fail while the two
    agree, which is the point.
  - Still manual: bump `SHELL_VERSION` when the icons change — they are part of the
    cached shell — and commit the regenerated icons.
  - The source is **500x500 RGB with no transparency**, on opaque white. So every icon is
    opaque white with the logo centred, and nothing is cut out of it.
  - The logo is a wide horizontal mark, so the **maskable** icon is not fitted by its
    bounding box but by its FARTHEST DRAWN PIXEL from the centre (243px in the source),
    scaled to 94% of the 40% safe radius. The speed lines and the end of "MIX" are what
    set that, not the box's empty corners.
  - `logo.png` itself ships in `dist/` too, though nothing loads it at runtime. 14KB.
- **The PWA pins the app to the domain root.** `start_url`, `scope`, the icon paths and
  the `/sw.js` registration are all absolute, so `app/dist/` is no longer portable to a
  subdirectory the way `base: './'` in `vite.config.js` was meant to allow. Fine for
  `ops.cartmixbd.com`; it is a deliberate narrowing, not an oversight.
- **A view assembles its layout LAST.** The order is: field controls, then the
  controllers that wire them up, then the layout arranging both. Layout reaching forward
  for something declared below it is a temporal dead zone `ReferenceError` the moment
  the view is constructed — which is what broke the order form completely in 6.7, when
  the repeat-customer card was added to a section that was being built in the middle of
  the declarations. An array literal evaluates immediately; `const` does not hoist a
  value. Keep assembly at the bottom.
- **A colour that only works on one background is a bug waiting for its second
  caller.** `.button.link` was `color: #fff` - correct for the dark app header, the only
  place it existed - and became invisible the moment the last-order card reused it on a
  near-white surface: white on `#fbfcfd` is **1.03:1**. The default is now readable on a
  light surface and the dark header opts in with `.app-header .button.link`. Contrast
  pairs are asserted by number in `app/test/contrast.test.mjs`, because the only thing
  that catches this otherwise is looking, and looking is what had already been done.
- **`position: sticky` reserves no space, so a pinned sticky bar paints over the content
  behind it.** Its flow space stays at its ORIGINAL position, so nothing below it moves.
  The order form's save bar was `sticky; bottom: 0` and sat across the middle of the
  Items section on any form taller than the viewport, obscuring a line's price inputs —
  and read as a second Save button, since the one in the flow was further down the same
  page. Use `fixed` plus reserved padding on the scrolling content, which is what
  `.fab` / `.orders-main` already do. Both halves are required; either alone brings the
  bug back in a different form.
- **Anything pinned to the bottom of the viewport must lift clear of the update banner,
  through the ONE mechanism that exists for it.** The banner is `fixed` at the bottom and
  drawn on top (`z-index: 20`). While it is up, body carries `has-pwa-banner` and
  `--pwa-banner-space`, the banner's MEASURED clearance — its height plus its 12px offset
  plus a 12px gap — which `pwa.js` writes on show, whenever the banner rewords itself,
  and on resize, and removes on dismiss. A pinned element adds a
  `body.has-pwa-banner <selector>` rule using `calc(var(--pwa-banner-space) + env(safe-area-inset-bottom))`,
  and grows whatever space is reserved under it by the same amount. The `.fab` and the
  form's `.form-actions` do exactly that.
  - **Measured, not fixed.** The lift was a fixed 88px, which assumed a one-row banner.
    On a 375px phone the banner wraps, text over buttons, to about 102px, so even the
    list's button sat partly under it. The unsaved-changes wording wraps further. The
    stylesheet's default of 128px only covers the moment before the first measurement.
  - **Why it matters on the form:** the banner appears after a deploy — exactly when
    someone may be mid-order — and until app 0.9.0 it covered Save, the only way to keep
    that order.
- **The app's own words do not name the backend.** Staff do not need to know the store
  runs on WordPress, so no screen says "WordPress" or "wp-admin" — the login hint is
  "Sign in with your username and password." The exceptions are messages where the
  term is what the reader must act on, all of them setup failures rather than daily
  use: `/token`'s "This site does not support application passwords" and "Application
  passwords are disabled for this account" (an admin has to change exactly that), and
  the network error naming the App Origin setting (the setting that has to match).
  The trash confirmation used to say "use wp-admin" to restore, which had also been
  untrue since step 6c; it now points at Trash on the order list.
- The app builds nodes and sets `textContent`; it never assembles HTML from data.
  Order data is staff-pasted free text, so string-built markup would be an injection
  risk. `dom.js` has no `html` option by design.


## Product decisions

- **A wrong district is worse than no district.** The parser resolves a district only
  when it is confident, and otherwise returns none. Decided in 7.2.
  - **Why:** in the app, an empty district is an empty dropdown on the form, which is
    visible and gets filled before saving. A confidently wrong district looks exactly
    like a right one and is saved — and shipping is a pure function of the district, so
    a wrong one is a wrong charge on a real order (80 / 120 / 150 by division).
  - **The caveat: wp-admin's "Create order" parses and creates in one step, with no
    review.** On that path an empty district means **no shipping line at all**, where
    there should be 120-150. Still preferable, because an order with no district and no
    shipping is detectable afterwards, while a wrong district looks normal - but it is a
    real consequence of this decision, not a free one. The app's flow always reviews.
  - **The failure class, which will recur as the alias list grows:** Bangladeshi place
    names are a short distinctive start plus a shared ending (-pur, -ganj, -shore,
    -khali). An edit-distance allowance measured against the WHOLE word lets the shared
    ending pay for a different start: "kali" vs "habi" is half of what distinguishes
    Kaliganj from Habiganj, but only 2 of its 8 letters. And in every misroute found, the
    right district was not even a candidate - 4 to 8 edits away - because the input was
    a different place (an upazila), not a misspelling of a district. So a confidence
    margin over the runner-up does not help this class: the matcher was not torn
    between two districts, it was sure of the wrong one.
  - **The rule since 7.2:** the fuzzy pass allows 1 edit, or 2 only for names of 9+
    characters. A 2-edit near-miss on a short name is exactly the low-confidence case,
    and it now resolves to nothing. Known spellings it stops reaching belong in the
    exact list (`gazipore`, `tangile`, `naraingonj` were added for that); the fuzzy pass
    is only a net for unknown ones. Measured before the change against 25 real
    misspellings: the old rule resolved 24 and misrouted all 4 test places, the new one
    stops all 4 and keeps 22, plus the 3 now listed exactly.
  - **Standing hazard: district names already within each other's reach.** `gazipur` ~
    `azimpur` (a Dhaka area), `meherpur` ~ `sherpur`, `noakhali` ~ `mohakhali` (Dhaka),
    `bogra` ~ `boyra` (Khulna). Each is right today only because it is an exact alias, and
    the exact pass runs first. A misspelling of any of them is one edit from its
    neighbour, so before adding an alias - or loosening the allowance - check it against
    these. `state-matching.test.php` pins all eight.
  - **Deliberately NOT aliases, recorded next to where they would go in
    `bd-locations.php`:** `kishore` (a common given name, and with no "District:" label
    the exact pass scans the whole message, name included, so it would route every
    customer named Kishore to Kishoreganj), `sreepur` (Gazipur and Magura) and
    `kaliganj` (Gazipur, Satkhira, Jhenaidah, Lalmonirhat). All three resolve to no
    district, which is the intended outcome. `shibpur` IS an alias, to Narsingdi.

- **Names. The app staff use is "CartMix Shop Manager"; the plugin is still "Order Ops";
  internal identifiers never change.** Renamed in app 0.11.0.
  - **App, user-facing:** the manifest `name` and the browser tab are "CartMix Shop
    Manager". The home-screen label (`short_name`, and `apple-mobile-web-app-title`,
    which iOS reads instead) is **"CartMix"**: home-screen labels truncate at around 12
    characters, so the full name would come out as "CartMix Sho…", and "Shop Manager"
    sits exactly at that limit (some launchers cut it to "Shop Manag…") and is generic
    beside any other shop app on the phone. "CartMix" never truncates and matches the
    wordmark in the icon above it. The login heading is "Shop Manager", under the
    CartMix logo, so the card reads as the full name without printing "CartMix" twice;
    in-app sentences say "Shop Manager"; the install prompts use the full name, since
    that is what is being installed. `icons.test.mjs` asserts the manifest, the title
    and the iOS label agree, and that no "Order Ops" is left in `app/src`, `index.html`,
    the manifest or `sw.js`.
  - **An already-installed app may keep its old name and icon** until it is removed
    from the home screen and added again. The `v16` shell update delivers the new
    manifest, but whether the launcher re-reads it is the platform's call: Android
    updates an installed app's label on its own schedule; iOS fixes both at the moment
    of adding.
  - **Never renamed, because they are persisted or load-bearing:** the plugin directory
    `ai-order-creator` (renaming it deactivates the plugin on both sites), the `ai_`
    function prefix, the `aioc/v1` namespace, the `AIOC_*` constants, option names such
    as `ai_app_origin`, the text domain, and the repo.
  - **Plugin-side names, deliberately LEFT for one later plugin release:** the header's
    `Plugin Name: Order Ops` (wp-admin's plugin list), `AIOC_APP_PASSWORD_PREFIX`
    ("Order Ops (app) <timestamp>", each staff member's Application Passwords list), and
    the order note "Order created via Order Ops app" written on every order the app
    creates. All three are user-visible only in wp-admin, and all three need a plugin
    upload to both sites, where this rename was app-only. Do them together, with the
    next plugin release that is going out anyway — folding in the Code Snippets entries
    is the obvious one — rather than spending an upload on labels. Changing `Plugin
    Name` is safe: only the directory and main file name affect activation.
    - **The application-password prefix is worth changing then.** Nothing matches on it
      — it is a label, and the owed revoke route will use the `uuid` — so the only cost
      is that each profile lists old "Order Ops (app)" entries beside new ones until
      they are pruned, which is already a manual job (see *Unverified / open* in
      `docs/VERIFICATION.md`). The order
      note changes only for new orders; existing orders keep the note they were given,
      which is history and correct.

- **Where WooCommerce already has a behaviour, copy it rather than designing a new
  one.** This is the governing rule for anything the app does to an order, and it is
  here because ignoring it cost real work. The line-item editor originally offered a
  single editable Total and invented "override" semantics around it — an edited total
  stuck, quantity changes skipped recalculation, clearing the field reverted it. None of
  that exists in WooCommerce. The rule was invented to resolve an ambiguity that only
  existed because two of WooCommerce's fields, Price and Total, had been collapsed into
  one. Restoring the second field removed the ambiguity and the rule with it. **The
  lesson: when a design question about order editing feels genuinely hard, check whether
  WooCommerce's own screen already answers it — the hard question is usually a sign that
  something has been collapsed or renamed.**
- **Shipping is a pure function of billing state**: BD-13 → 80 Dhaka Flat Rate,
  BD-18 → 120 Gazipur Flat Rate, all else → 150 Outside Dhaka Flat Rate. Auto-only; no
  manual override by design.
  - **This is NOT WooCommerce shipping.** *WooCommerce → Settings → Shipping* is not
    consulted by this plugin at all — no zones, no methods, no instances, nothing read
    from them. The rates live in `includes/orders/shipping.php` and `ai_apply_shipping()`
    writes a `flat_rate` line from them directly. Anyone debugging a wrong shipping
    figure by looking at WooCommerce's shipping settings is looking in a place this code
    never reads.
  - **The rates originated as a Code Snippets snippet.** They were folded into the plugin
    in 4.9 and then deleted from Code Snippets, so only one table exists. **Check both
    sites for a resurrected copy if shipping ever behaves oddly** — two tables hooking
    the same thing means whichever runs last wins.
  - **One table, two shapes.** `ai_get_shipping_rates()` returns it as data;
    `ai_get_shipping_rate($state_code)` reads one rate out of it. `/meta` serves the
    whole table to the app. Nothing anywhere restates a rate, and
    `app/test/shipping-preview.test.mjs` asserts no rate literal exists in `app/src/`.
  - **Changing a rate is a code edit plus a plugin upload.** The app then picks the new
    rate up from `/meta` with **no app rebuild and no re-deploy of `app/dist/`** — but
    the plugin still has to be uploaded, and a stale plugin means a stale rate in both
    the app and the saved order, consistently.
  - **Considered and NOT done: moving the rates into a WordPress option with a settings
    field**, the way `ai_app_origin` already works. That would make a rate change an
    admin setting with no upload at all. Not built, because the rates have changed once
    in the life of this project and an option adds a settings UI, a migration from the
    hardcoded values, and a second place a rate can come from. **Recorded as available
    if rates start changing often** — the structure `ai_get_shipping_rates()` returns is
    already the shape an option would store.
  - **An order with no district has NO shipping, and that holds whether it never had one
    or had one and lost it.** `ai_apply_shipping()` removes every existing shipping line
    **unconditionally and first**, then adds one only if there is a state, then always
    recalculates totals. Clearing a district therefore clears the line.
    - **Do not reintroduce an early return for the empty-state case.** One was there
      until 7.0 and caused two separate bugs: an order whose district was cleared kept
      the old rate in its stored total (order 11361 on staging — an empty state with a
      120.00 Gazipur line that re-saving would not clear), and nothing recalculated
      totals, which `ai_rest_finalize_order()` worked around by calling
      `calculate_totals()` itself. That workaround is now gone; with the root cause fixed
      it would be a second write of correct figures. **"Nothing to add" is not the same
      as "nothing to do"**, and an order that previously had a district is exactly where
      they differ.
    - The admin hooks need no separate handling and never did:
      `woocommerce_process_shop_order_meta` and `woocommerce_before_save_order_items`
      both reach this function via `ai_apply_shipping_to_order_id()`, which has no state
      branch of its own. The bug and the fix both apply to wp-admin identically.
  - **One asymmetry, which is easy to get backwards.** `ai_get_shipping_rate('')`
    returns the Outside Dhaka default — but `ai_apply_shipping()` never asks it for an
    empty state, because the add is skipped. So the default is the rate for a district
    that is **set but unrecognized**, not for an order with no district. Anything
    previewing a rate must show nothing for a blank district, or it overstates every
    such order.
- **The form shows the expected shipping before the first save, by LOOKING IT UP, not by
  computing it.** An unsaved order used to show a dash for shipping and an Order total
  short by 80-150 BDT, and that total is read out to a customer on the phone. The
  district fully determines the rate, so there was nothing uncertain to withhold.
  - The figure comes from `/meta`'s `shipping_rates`, keyed by whatever the district
    select currently holds, and updates live as it changes — whether the district was set
    by Reorder, by Parse, or by hand. **Still not a calculation in the app**: the rate is
    the plugin's, fetched.
  - **On a saved order, which figure is right turns on one question: does the stored
    line still describe what a save would produce?**
    - **District untouched → the stored line wins, always.** It may have been adjusted in
      wp-admin to a figure the rate table does not hold, and that adjustment has to
      survive being looked at.
    - **District edited → show what the save will produce** — the table rate for the new
      district, or nothing at all if it was cleared. Until 7.0 the stored line kept
      showing here, so selecting "No district" left its amount in the Order total, and
      changing districts showed the old rate. The explanatory line claimed the district
      had changed while displaying the figure from before it did.
    - **The comparison is against the district the order was LOADED with, not
      `dirty.has('state')`.** That flag stays set once the select has been touched, even
      if it is put back — and putting it back makes the stored line accurate again, so it
      has to come back. `state.loadedState` is what the stored line corresponds to.
  - `state.shipping` in `order-form.js` means **the server's line and only that**, and
    `applyServerOrder()` is its only writer. That is what keeps "has the server told us?"
    answerable, which is the question the whole fallback turns on.
  - **`POST /parse`'s own `shipping_preview` is deliberately not displayed.** For a
    district that resolved it is the same figure from the same table; for one that did
    NOT resolve it is the default rate while the dropdown is still empty — so it would
    put a figure on screen that a save would not apply. Previewing from the district the
    user can actually see keeps one answer visible instead of two.
  - `/meta` is cached in `sessionStorage` under a **versioned key**. A session that
    cached the payload before `shipping_rates` existed would otherwise keep serving a
    preview-less copy to exactly the people who just upgraded. A plugin older than 6.9
    serves no table at all, and the form degrades to the dash rather than inventing a
    figure.
- All WooCommerce statuses are settable from the app, read from
  `wc_get_order_statuses()` rather than hardcoded.
- **The last-order lookup caches its RESULT per number, not just the number.** Deleting
  a digit hides the card without forgetting the lookup, so retyping the same number
  re-shows it from memory and backspacing through a number costs no requests at all. A
  `{found: false}` answer is cached too, so a new customer's number is not asked about
  twice. The cached answer is now independent of which order is open — the question is
  only ever "what is this number's most recent order" — so whether to SHOW it is decided
  at render time, not by re-asking.
- **There is exactly ONE Reorder concept, and it never writes to the server.** Reorder
  opens or fills a NEW order form, pre-filled from an existing order. The order is
  created when the staff member taps Save, and gets its number then, like any other new
  order.
  - **Two entry points, identical behaviour:** the button inside the expanded
    last-order card in the form, and one on each row of the order list. What gets copied
    is defined once in `app/src/reorder.js` and both go through the same
    `applyReorder()`, so there is nothing to keep in step.
  - **A separate "Clone" action was considered and dropped.** It would have created an
    order immediately from a list row. Two actions that both mean "make another one like
    this" - one reviewable, one instant - is a mistap away from an order nobody placed,
    and the names do not tell you which is which. One concept that always lands in a
    reviewable form is less to explain and has no destructive variant. The word is
    deliberately absent from the code.
  - It copies `name`, `phone`, `address_1`, `state`, `customer_note`, `line_items`
    (product_id, quantity, total) and `fee_lines` (name, total, negatives intact).
    **`state` matters more than it looks**: shipping is a pure function of the district,
    so a reorder that dropped it would price the order wrongly until someone noticed an
    empty dropdown. The district is only set to a code `/meta` actually offers — an
    unknown one is skipped rather than invented.
  - From the CARD there is no extra request: the card already holds the full order. From
    a LIST ROW there is one, because the list endpoint returns summaries with no line
    items — hence the row button's loading state.
  - **NOT copied: status** (a new order starts at the form's default, not wherever the
    old one ended up), and **the id, number and date** (this is a new order, not that
    one).
  - **Shipping is deliberately NOT copied, and this is load-bearing rather than
    incidental.** It follows from the district, which IS copied. Copying the source
    order's shipping line would be wrong the moment a rate changed, and wrong again the
    moment someone edited the district after the reorder — in both cases showing a figure
    the save would not apply. The district is copied; the rate is looked up from it.
  - The copied fields are filled **only when empty** — name, phone, address and
    district. Someone may be correcting the customer's details, and overwriting what they
    just typed would be worse than leaving a field blank.
  - Items and fees are marked **dirty** on copy. Both lists are all-or-nothing on
    update, so without that the payload omits them and the copy looks right on screen
    while saving nothing. `app/test/reorder.test.mjs` asserts this through the save
    payload for exactly that reason.
  - Replacing is wholesale, not appending, so a form that already has items or fees
    **asks once first** - the same tap-again step the navigation guard beside it uses.
    Reordering from a list row opens a blank form, so there is nothing to overwrite and
    nothing to confirm.
  - The row's Reorder must **stop event propagation**: the whole row is a tap target that
    opens the edit form, and without it a reorder would also navigate.
  - Stock is deliberately not pre-checked. A copied line may point at a product that has
    since gone out of stock or been deleted, and the write endpoint already handles both
    (adds out-of-stock anyway with a warning, skips a missing product with a warning).
    Those warnings surface after save like any others. Checking at copy time would
    duplicate the server's judgement against an order that is not saved yet.
- **The repeat-customer lookup shows the previous order, collapsed.** When the phone
  field holds a valid BD mobile the form fetches that customer's last order and renders
  a one-line summary below the field, expanding to its items, shipping, fees and total.
  Collapsed by default because the form is already taller than a phone screen.
  - **A new customer shows NOTHING.** `{found: false}` is the common case, and a "no
    previous orders" message would be noise on most orders.
  - **The card always shows the GENUINE most recent order for the number in the field,
    never a substitute.** The endpoint has no `exclude` parameter. Asking it for "the
    last order other than this one" returns the second-most-recent order dressed up as
    the last one — 6.7 did exactly that, and editing order 11354 showed 11323, which is
    misleading rather than merely unhelpful.
  - The card is **suppressed when the returned order is the one already open**, which is
    a display decision made client-side rather than a filter pushed into the query. So
    editing an order with its phone unchanged shows nothing, and changing that phone to
    another customer's number shows their real last order. That second case is what
    earns the card its space while editing — it is the reassignment case.
  - Tapping through to the previous order navigates away, so if the current form has
    unsaved changes it asks once first — the same two-step the trash action uses,
    through the status line rather than a second confirmation UI.
- **One lookup, two response shapes.** `ai_find_last_order_by_phone()` in
  `includes/orders/lookup.php` is shared by the AJAX handler and the REST route. The
  AJAX one keeps returning `wc_price()` HTML because the legacy admin UI expects it; the
  REST one returns the standard order shape. The FORMATTING may differ per caller; the
  lookup must not exist twice.
- **`trash` is not a workflow status and is never presented as one.** It is WordPress's
  own post status, absent from `wc_get_order_statuses()` and from `GET /meta`, so it has
  no place in the status filter beside Processing and Completed — a custom status such as
  `wc-returned` does belong there. `GET /orders?status=trash` is accepted as an explicit
  filter and reached through its own view in the app.
  - **HPOS stores trash UNPREFIXED** (`'status' => 'trash'`) while workflow statuses are
    stored prefixed (`wc-completed`). `OrdersTableQuery::sanitize_status()` only adds the
    prefix when the prefixed form is registered and otherwise passes the value straight
    through, so `wc-trash` reaches SQL verbatim and matches nothing — an empty list, not
    an error. Accept both spellings at the boundary; query with the bare one.
  - With no `status` param the default is unchanged and still excludes trash.
- **A trashed row cannot be opened for editing.** Editing a trashed order is not a
  sensible flow and the API would happily accept the write, so the restriction lives in
  the app: the trash view's rows have no tap target, only Restore. Restore first, then
  edit.
- **No force-delete exists anywhere, in the API or the app, and should not.** Restore is
  the only counterpart to trash. Permanent deletion stays a wp-admin action.
- **A status label always comes from whoever registered the status.**
  `wc_get_order_status_name()` returns the bare slug for `trash`, so
  `ai_rest_order_status_label()` falls back to the registered POST status label and the
  client gets `Trash`. An unlabelled status still degrades to its slug rather than being
  invented.
- **Fees are first-class, and a DISCOUNT IS A NEGATIVE FEE.** `fee_lines` is readable and
  writable on the order endpoints, and nothing in this plugin clamps or `abs()`es a fee
  total in either direction. Without fees the order `total` is not reconcilable from
  `line_items` plus `shipping_lines` — any order carrying one simply would not add up.
- **`line_items`, `fee_lines` and shipping lines are three independent lists.** Each
  replacement loop is scoped to one item type, so sending one list never disturbs
  another. **Never use `WC_Abstract_Order::remove_order_items()` with no argument** — it
  empties every item type at once, which would silently delete fees while "replacing
  products". The scoped `get_items('<type>')` loop is the pattern.
- **A fee's `name` is reported exactly as stored**, via `get_name('edit')`.
  WooCommerce's default `view` context substitutes the word "Fee" for an empty name and
  runs display filters; this API reports data, and an empty name stays empty.
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
  - **Signing in persists; there is no "remember me" and there should not be one.**
    Investigated at app 0.10.0 after a report of repeated logins. The credential is
    removed by exactly three things: Sign out, a 401 on an authenticated request (the
    application password no longer authenticates - typically revoked in wp-admin), and
    a corrupt stored value. Nothing expires it, WordPress application passwords do not
    expire, and the service worker never touches `localStorage`.
    `test/login.test.mjs` asserts all of that.
  - **What LOOKS like being signed out is storage being per-ORIGIN.** `localStorage`
    belongs to scheme + host + port, so `http://localhost:5173` (`npm run dev`),
    `http://localhost:4173` (`npm run preview`) and `https://ops.cartmixbd.com` each hold
    their own, separate sign-in. Moving between them is a fresh login every time, by
    design. Also: an incognito/private window discards its storage when closed;
    clearing site data while debugging the service worker (the trap under *Start here* in
    `docs/PROJECT-STATE.md`)
    wipes the credential with everything else; and on **iOS, a home-screen app keeps its
    storage separate from Safari's**, so signing in in Safari does not sign in the
    installed app, and Safari outside the installed app may drop storage for a site not
    used for a week. The iOS points are platform behaviour stated from knowledge, not
    observed on these devices — confirm on a staff iPhone before relying on them.
  - **Proposed, NOT built: an unchecked-by-default "Keep me signed in"** that stores the
    credential in `sessionStorage` instead, for a staff member signing in on a shared or
    borrowed phone. It is the opposite of "remember me", because persisting is already
    the default and the useful choice is opting out of it. Note that sessionStorage in
    an installed PWA lasts until the app is closed, so "not kept" means signing in after
    every cold launch — which is the point on a shared phone and an irritation anywhere
    else, hence unchecked meaning "keep". Build only if shared phones are real.
- **The login screen's password field has a Show / Hide button. Hidden by default.** A
  worded button BESIDE the field, outside its border, at its right-hand end and full tap
  height — not an icon inside the input, which on a phone reads as part of what was
  typed. It never takes focus (so the keyboard stays up mid-password), it cannot submit,
  and the field is turned back to `type="password"` before the form submits, so a
  password manager offering to save the login sees a password field and the password is
  never left showing. The field keeps `autocomplete="current-password"` throughout.
- **The CartMix logo is on the login screen, and NOT in the header.** The login card is
  white, which is what the logo is drawn for. The header is the dark accent bar, where
  the logo's teal measures **1.41:1** against `#1f2937` — the cart body all but vanishes
  — so it would need a white plate (a white box in a dark bar) or a light-on-dark
  version of the logo that does not exist. It would also spend vertical space above the
  order list on every screen, on a phone, to tell staff whose app they are using. The
  home-screen icon and the sign-in screen carry the brand; the header carries the work.
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
  **Confirmed on staging with four custom statuses** — see `docs/VERIFICATION.md`. This is
  the whole
  reason `/meta` exists, and it now has evidence rather than intent behind it.
  Money formatting likewise uses the endpoint's `currency` and `price_decimals` rather
  than assuming BDT and 2dp. Cache the response for the session, not per screen.
- **There is no relevance SCORING for text searches, deliberately.** A text term's
  matches are ordered by price, not by how well they match. This was an open question
  until 6.2 and is now settled: price is the axis staff think in, and with one product
  per price point the price order is stable and meaningful. Compound terms cover the
  rest — a staff member narrows "three" to "three 2500" rather than scrolling. Reopen
  only if a catalogue with several products at the same price appears.
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
- **Adding a line item by typing a product ID is a STOPGAP for step 6a only**, replaced
  by the picker in 6b. It is marked as temporary in `app/src/views/order-form.js` and in
  the UI itself. The id is sent **blind** — deliberately, not lazily: `GET /products` has
  no id lookup, and `ai_rest_parse_search_term()` reads a wholly numeric term as a PRICE,
  so `?search=9167` returns products *costing* 9167, not product 9167. Resolving through
  it would display a confidently wrong name and price. The server resolves the id on
  save, the re-render fills in the real values, and a non-existent id comes back as a
  warning with the line skipped.
- **Line item editing mirrors WooCommerce — Price and Total are both editable, and
  there is no override concept.** Exactly as WooCommerce's order edit screen behaves:
  changing the quantity recalculates Total as price × quantity; changing Price
  recalculates Total the same way; changing Total sets that line's total directly and
  leaves Price showing what it was. Nothing is sticky, nothing is reverted by clearing a
  field, and no flag tracks which figure is "deliberate".
  - **The API has no per-line price field.** It accepts `product_id`, `quantity` and
    `total`, so Price is a client-side convenience for computing Total and the server
    only ever receives the total. On load, Price is derived as `total / quantity` so the
    two fields agree.
  - Sending `total` for **every** line is what closes a real data-loss path: `line_items`
    is replace-all, so a line sent without a total is re-priced from the catalogue, and
    omitting it meant touching the items at all discarded the figure on screen. The only
    line that cannot carry one is a stopgap row added by id whose price is unknown
    client-side; there the key is omitted so the server prices it. Sending `0` would be
    far worse than omitting — it would zero the line.
  - Typed figures are normalized on blur, never mid-entry, and tolerate spaces and
    thousands separators, because "1,500" is how the amount actually gets typed and
    `Number()` makes `NaN` of it. Unparseable input keeps the previous value rather than
    becoming 0. These are input-handling conveniences, not behaviours WooCommerce lacks.
  - **Price is held at full precision and only SHOWN at 2dp.** On load it is
    `total / quantity`, which often does not come out clean — 1000 / 1.5 is 666.666… —
    and leaving the Price field without editing it must not re-read the rounded text.
    It used to, which turned that total into 1000.005 the moment someone tabbed through,
    and showed up as 2000.01 on the next quantity change. An unchanged Price field now
    changes nothing on blur. Fractional quantities made this common rather than rare.
- **Quantities can be fractional, to 2 decimal places, and the site decides whether
  they can be fractional at all.** Since the decimal plugin went on (see *Environment* in
  `docs/PROJECT-STATE.md`).
  - **Whether a fraction is allowed is WooCommerce's call, not ours.**
    `ai_rest_line_quantity()` passes the submitted figure through `wc_stock_amount()`,
    so the site's `woocommerce_stock_amount` filter decides. Hardcoding float handling
    would have kept accepting 1.5 on a site where WooCommerce had been told not to.
  - **The 2dp limit is applied on top, and a third decimal is ROUNDED, not rejected.**
    The write path's governing rule is "mirror WooCommerce, never stricter", and it
    already fixes a bad line with a warning rather than failing the order. The app
    rounds identically on blur, so the figure on screen before Save is the figure
    stored. Both sides round half away from zero on the DECIMAL value: PHP's `round()`,
    and in JS a shift through the exponent (`Math.round(x * 100) / 100` rounds 1.005
    down in binary floating point).
  - **Zero, negative and unparseable are not quantities.** The server stores 1 for
    them, as it always did, but now with a warning. The app never sends them: an entry
    that does not come out above zero falls back to what the row held when the field
    was focused. Remove is how a row goes away, so − steps by 1 and never reaches zero —
    from 1.5 it goes to 0.5, and at 1 or below it is disabled.
  - **Every quantity the server changes is reported.** Rounded, truncated by the default
    filter, or replaced by 1 — the response warns, naming the product and both figures.
    A quantity becomes money the moment it is multiplied by a price.
  - **Quantity is shown unpadded** — `1`, not `1.00`. It is typed in a field styled like
    Price and Total, centred between the − and + buttons.
  - **`item_count` reads as WooCommerce's sum**: "1 item", "2.5 items", "0.5 items" —
    singular only for exactly 1. Mixing 1.5 of one product with 1 of another into "2.5"
    is not an especially meaningful figure, but it is WooCommerce's `get_item_count()`,
    and reinterpreting it as a count of lines would change the wording of every
    existing whole-number order too. Copy WooCommerce rather than redefine it.
- **A new order can be started from the order form, not only from the list.** **+ New
  order** sits in the form's header as a plain link; Save is the filled primary button
  pinned to the bottom. Opposite ends, opposite styles, deliberately — one keeps the
  work, the other can discard it.
  - With unsaved changes the first tap warns through the status line and the second
    goes ahead — the same guard as every other exit; see the next entry. A clean form,
    including one just saved, goes straight through.
  - Disabled while a save is in flight: the write would still complete, but the staff
    member would lose sight of the new order and its number.
  - `main.js` resets its route key for this one action. From an unsaved new order the
    route is already `form:new`, so the repeat-tap guard would otherwise swallow the tap.
- **Every way out of a dirty order form either warns first or deliberately does not.**
  "Dirty" is `isDirty()`: any field touched, or the items or fees edited, since the form
  was last filled from the server. A field changed and put back still counts. That is the
  same rule the save payload uses, and it errs toward a warning.
  - **The guard is a two-tap, not a dialog.** The first tap shows "Unsaved changes
    here. Tap X again to…"; a second tap on the SAME exit goes.
  - **The warning must be seen in the same glance as the tap, without scrolling.** So it
    is shown WHERE THE TAP WAS, never in the form's status line — that line sits at the
    top of the scrolling content and is off screen on any form taller than the
    viewport, which made the guard read as a dead button until app 0.8.0.
    - **The form's exits warn in a strip inside the sticky header**, with a Keep editing
      button. It is absolutely positioned just below the bar, overlaying the content: a
      strip that made the sticky header taller would shove the content under it down
      mid-scroll, which is page movement by another route. The header is always on screen and holds two of the three form exits.
      Chosen over the fixed save bar (the far end of the screen from those taps, and it
      would put "discard" beside the button that keeps the work), over scrolling the
      status line into view (moves the page, so someone who decides to stay has lost
      their place), and over a transient toast (if it fades while the exit is still
      armed, the second tap goes with no warning showing; if it persists, it is this
      strip).
    - **The update banner's Reload warns in the banner's own text**, for the same
      reason: the banner is where that tap was.
  - **One guard, app-wide, in `src/exit-guard.js`.** The form registers its `isDirty()`
    there on mount; `main.js` clears it in `beginScreen()` on every navigation, so a form
    already left behind cannot make the order list's Reload warn. Every exit — the
    form's and the banner's — calls `requestExit(key, go, {warn, reset})`. The banner
    ASKS the guard rather than the form telling `pwa.js` it is dirty: `pwa.js` stays
    app-wide and knows no views, and there is one copy of the two-tap logic rather than
    two to keep in step.
  - **ONE armed slot for every exit**, so a warning licenses only the exit it was shown
    for: arming ‹ Orders does not wave + New order or Reload through, and arming a
    different exit takes the first warning down wherever it was showing. The slot is
    cleared when the form is refilled from the server (a warning shown before a save
    cannot discard edits made after it), by Keep editing, and by dismissing the banner.
  - **Guarded:** "‹ Orders" (from app 0.7.0; before that one tap discarded the form, on
    the most common way out), the last-order card's "Open #N", "+ New order", and the
    update banner's Reload (from app 0.8.0).
  - **Not an exit, so not guarded here:** the card's Reorder replaces the form's items
    rather than leaving, and has its own replace-confirmation. The product picker is a
    sheet over the form, which stays mounted.
  - **Deliberately not guarded:**
    - **Trash.** It already asks for its own confirmation, and the unsaved edits belong
      to an order that is going away. A second warning would be noise.
    - **A 401.** `api.js` drops the credential and the app routes to login. Nothing in
      the form could be saved at that point anyway; a save would 401 too.
  - **Unguarded, and not guardable without a router:** **the browser or hardware back
    button.** There is no router and the app pushes no history entries, so back leaves
    the app entirely, and in a standalone PWA on Android it closes it. Only a
    `beforeunload` prompt could intercept that.
  - **No `beforeunload` handler, by decision.** It fires on reload and tab close too, and
    browsers show a generic message the page cannot word, so it would be noise on every
    deliberate reload rather than help on the accidental one. `exit-guards.test.mjs`
    asserts none exists. If back-button loss turns out to matter in practice, the fix is
    real history handling: a pushed entry per screen and a guarded `popstate`. That is
    the router `main.js` already says it will need for deep links, not a prompt.
- **The order form edits fees, including negative ones.** A fee row is a name input and
  an amount input; the name may be empty and the amount may be negative, with nothing
  blocking a minus sign or taking an absolute value. The provisional total is items plus
  fees plus shipping, and the Fees row is omitted entirely when there are none rather
  than showing 0.00.
  - **Fee dirty state is tracked separately from line-item dirty state**, never folded
    into one flag. The endpoints treat the two lists as independent replace-all lists,
    so a single flag would make editing a product silently rewrite the fees. An empty
    array is a real instruction - it clears every fee - so "untouched" (omit the key)
    stays distinguishable from "emptied" (send `[]`).
  - A sign toggle sits beside each amount, because **neither iOS keypad offers a minus
    sign** and a discount has to be typeable one-handed. Not in the original brief;
    remove it if the keyboard turns out not to be a problem in practice.
- **The form holds no line, fee or shipping item id.** Replacement discards them
  server-side, and `ai_apply_shipping()` clears and re-adds the shipping line on every
  save, so any id kept client-side would be stale immediately. Line items keep
  `product_id`; shipping keeps only its cost and label.
- **The API reports no order-level subtotal** — only per-line `subtotal`/`total` and the
  order `total` — so the form sums the line totals itself for the "Items" figure. It
  never invents an order total: while nothing has been edited locally it shows the
  server's `total`, which can legitimately differ from items plus shipping because of a
  coupon or a discount. It does not compute shipping either; before the first save it
  looks the district's rate up in `/meta`, which is not the same thing.
- **Field-level validation mirrors WooCommerce, not stricter.** WooCommerce permits
  saving an order with no phone, no address, no line items and no state — details can be
  filled in later. The app must permit the same. Do NOT add required-field validation to
  any write endpoint beyond what WooCommerce itself enforces. Specifically: `POST
  /orders` must accept a partial or empty payload and create the order anyway, exactly
  as the wp-admin "Add order" screen does. `/parse` already behaves this way — it
  succeeds with a name and no phone, returning empty strings for unextracted fields
  (verified on staging at 5.8).
- `POST /parse` returns data and creates nothing. Always parse → review → save; never
  blind-create. Implemented in 5.8. It also returns a `shipping_preview` from the pure
  rate table, which the app no longer displays — see the shipping entry above for why.
- **Leading list markers are stripped as line PREFIXES only, in two classes.** A marker
  sits between the start of a line and its field label, which silently defeats the
  `(?:^|\n)\s*label` anchors the extractors rely on — so a bulleted message loses its
  fields entirely rather than looking slightly untidy. Characters that can only ever be
  bullets are stripped with or without a following space; **hyphen, asterisk, en dash
  and em dash are stripped only when a space follows them**, because the space is what
  makes one a list marker rather than part of a value. A line opening with a
  hyphen-attached number (`-১০৭৯`) must keep its sign, and a hyphen inside a line
  (`Mirpur-10`) must never be touched — v4.1 records the regression that comes of
  getting this wrong.
- **`ai_get_field_start_labels()` decides where a labeled value STOPS.** A label missing
  from that list means the next field gets absorbed into the previous one's value as a
  continuation line. `Phone Number:` did exactly that to the address, because `phone`
  alone cannot match it — the pattern wants a separator immediately after the label.
  Keep it in step with `ai_get_meta_label_words()`.
- **An area-to-district alias must be checked for substring collisions before it is
  added.** `ai_extract_state_from_text()` takes the first alias that appears anywhere in
  the text, with no word boundary, iterating in insertion order. `tongi` is a substring
  of `tongibari` (Munshiganj) and `tungi` of `tungipara` (Gopalganj), so those longer
  names are listed BEFORE the Tongi block in `bd-locations.php`. File order is load
  bearing there.
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
- **The order list's search is ONE substring match across order id, phone, name and
  address, and it matches wp-admin's because staff use both boxes.** A box that behaves
  differently from the one they already know is worse than any individual behaviour
  either could have. `GET /orders?search=` sends the term UNTOUCHED as HPOS's `'s'` with
  `search_filter => 'all'`.
  - **How it works, read from `OrdersTableSearchQuery.php` (WooCommerce 11.0.1) rather
    than assumed.** `'all'` — and an absent filter — expands to every core filter
    (`order_id`, `transaction_id`, `customer_email`, `customers`, `products`) OR'd
    together, and is what the wp-admin dropdown defaults to.
  - **Order ids are matched EXACTLY, by a clause that is added regardless of the
    filter.** `generate_where()` appends `` `id` = N `` whenever the term is exactly
    `(string) absint($term)`. So `8735` finds order 8735, but `873` does not, and
    neither does `08735` — the string comparison fails on the leading zero.
  - **A phone is matched because it sits inside a concatenated string, not because any
    phone column is searched.** The `customers` filter does
    `meta_value LIKE '%term%'` against `_billing_address_index` /
    `_shipping_address_index`, which `OrdersTableDataStore::update_address_index_meta()`
    writes as `implode(' ', $order->get_address($type))` — and a billing address array
    includes `phone` and `email`. That is the whole mechanism, and it is why a fragment
    matches **mid-number** and why **no raw SQL is needed** for it.
  - **Bengali is searchable for the same reason**: a `LIKE` on utf8mb4 is a substring
    test with nothing tokenizing or normalizing the term. It is a **contiguous**
    substring though, so `"yasmin farida"` will not find `"farida yasmin"`.
  - **The term is deliberately NOT normalized.** Stored numbers on this store are always
    plain 11-digit ASCII — customer data is never entered with `+880`, and the parser
    converts Bangla digits before saving — so staff type the digits they can see. Until
    7.3 `ai_normalize_bd_phone()` ran here and made a valid-looking mobile an exact
    `billing_phone` lookup, which was narrower than wp-admin twice over: it could not
    match a fragment, and **it never looked at the shipping phone**.
    `ai_normalize_bd_phone()` is still right for `GET /customers/last-order`, which asks
    for one exact number. Only the list search dropped it.
  - **3-character minimum**, a 400 `aioc_search_too_short` shared with `/products` via
    `AIOC_SEARCH_MIN_LENGTH`. The query is a leading-wildcard `LIKE` and `01` is inside
    nearly every BD phone number. Measured with `mb_strlen()`: two Bengali characters
    are six bytes, so `strlen()` would have let them through. **An empty term is not a
    short term** — the unfiltered list is this screen's normal view. The app enforces the
    same minimum before asking, so the 400 is the backstop rather than the rule staff
    meet.
  - **HAZARD: enabling HPOS full-text search breaks mid-phone search, silently, in both
    this API and wp-admin.** With `woocommerce_hpos_fts_index_enabled` and
    `woocommerce_hpos_address_fts_index_created` both `yes`, the `customers` clause
    becomes `MATCH(first_name, …, email, phone) AGAINST (… IN BOOLEAN MODE)`. Boolean-mode
    full-text does not match mid-word, so a phone fragment would stop matching. It is a
    WooCommerce **performance** setting, which is exactly how it would get switched on by
    someone not connecting it to search behaviour. The mid-number matches verified on
    live prove it is off there today. Nothing in this repo can detect it — the symptom
    would be "search stopped finding phone fragments" with no code change to blame.
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
- The product picker enforces the 3-character minimum client-side, debounces at 300ms
  and cancels in-flight requests per keystroke, so responses cannot arrive out of order.
  It follows `views/orders.js` rather than reimplementing any of it.
- **The picker is a sheet over the order form, not a route.** The form stays mounted
  underneath, which is what keeps unsaved edits alive across opening and closing it.
- **A picked product becomes a NEW line, even when that product is already on the
  order.** Checked against WooCommerce before implementing:
  `WC_Abstract_Order::add_product()` builds a fresh `WC_Order_Item_Product` on every
  call and `add_item()` appends it with no lookup by product id. (The CART merges by
  cart item key — a different code path, and not the one the order editor uses.) Our own
  `ai_rest_add_line_items()` calls `add_product()` per payload entry, so duplicate ids
  become separate lines server-side too; merging client-side would have disagreed with
  both. This reverses the add-by-id stopgap, which merged.
- **Search results are cached per term in memory for the app session.** Server-side
  search is 40-90ms against several hundred ms of round-trip, so the network is the
  latency and the cache is where it goes. A repeat term renders with no request at all;
  a narrowing term (the new term extends a cached one) filters the cached rows and
  renders immediately, then reconciles with the server's answer. The client-side filter
  is deliberately an approximation that errs toward showing FEWER rows, so the worst
  case is a row appearing a moment later, never a wrong row.
  - The trade-off: a price changed in wp-admin mid-session is not seen until the cache
    is dropped, and because each line sends its own `total`, an order could be saved at
    the stale figure. Bounded by the session; sign-out clears it along with `/meta`.
  - Memory only, never persisted.
- **Out-of-stock products are shown greyed and not tappable, never hidden.** Someone
  searching for a thing that exists needs to see that it exists. The API returns them
  with `is_in_stock` false for exactly this reason, and the write endpoints re-check
  stock independently.
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
