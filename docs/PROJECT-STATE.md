# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v7.1**, Updated 2026-10-08. App **0.11.0**, named **CartMix Shop
Manager** to staff — see "Names" under Product decisions; the plugin is still "Order Ops".
**Live runs 7.1. Staging was last recorded at 7.0.** Live's REST layer has now been
called: `POST /parse` was verified there at 7.1 (see Verified). Nothing else in 6.7-7.1
has been exercised on live yet.

**Build steps 1 through 11 are built AND verified on staging** — the API layer by real
requests, the app in a browser, including as an installed standalone PWA. Steps 8-11
came after the original seven-step plan and were verified at 6.8 and 7.0; what those
checks did NOT cover is listed under Unverified / open.

**Steps 12-17 — decimal quantities (7.1 / app 0.6.0), New order from the form (app
0.6.0), the unsaved-changes guard on every exit from the form (app 0.7.0), that warning
made visible plus the update banner's Reload guarded (app 0.8.0), Save kept clear of
the update banner (app 0.9.0), and the CartMix logo as every icon plus a password
Show/Hide on the login screen (app 0.10.0) — are built and pass every local check, but
have not run on a server or in a browser.** 7.1 is a correctness fix, not a nicety: the *Decimal Product Quantity for
WooCommerce* plugin is now active on BOTH sites, and every plugin up to 7.0 `(int)`-casts
quantity, so **any fractional quantity sent through the app on either site today is
silently saved as a whole number.** Live now has 7.1; staging, as last recorded, does not.

**Live jumped from 6.6 to 7.1 in one upload**, taking 6.7 (`GET /customers/last-order`),
6.8 (its correction), 6.9 (`shipping_rates` in `/meta`), 7.0 (the shipping
data-correctness fix) and 7.1 (fractional quantities) together. Only `/parse` has been
confirmed there so far.

**7.0 carries a data fix that existing orders do not get for free.** Any order whose
district was cleared while 6.x was running still holds a stale shipping line and a total
that includes it. The fix prevents new ones; it does not repair old ones. Each needs one
save after the upload — confirmed on staging, where saving order 11361 cleared its line.
Live has had the same 6.x code, so the same can be true there. See Unverified / open for
what is and is not known about how many.

**What remains before this is usable in production is operational, not code.** See the
list below.

## Start here

**Read this section, then the Build steps table, then Unverified / open. Those three
say what exists, what is proven, and what is merely written down.**

**There is no feature work queued.** Everything in the Build steps table is built and
passes its checks locally; steps 1-11 are verified on staging, 12-17 are not yet. Two of
those checks are in the repo and one is not:

- **`npm test` in `app/`** — fourteen suites, 421 assertions. In the repo. Run this first.
- **`php -l` over all 27 PHP files** — needs the portable PHP described under
  Conventions, which is not in the repo either but takes one download to set up.
- **A contract check** that greps the real PHP and JS source and asserts every field
  name and behavioural rule they must agree on — 196 assertions at 7.0, not rebuilt for
  7.1 (the PHP/JS quantity agreement is pinned in `npm test` instead). **This is a
  scratch tool, rebuilt per session, and is NOT in the repo.** Do not go looking for it.
  It is mentioned because the counts quoted in this document came from it, and because
  rebuilding it is cheap and has caught real drift; but `npm test` is the durable check.

None of them needs a server.

**The next work is deployment and verification, and it is operational, not code.** In
order, because each step depends on the one before:

1. Upload plugin **7.1** to STAGING and confirm `GET /aioc/v1/ping` reports `7.1`. A
   stale version here causes misleading 404s on new routes, so do not skip the check.
2. Verify 7.1 and app 0.7.0 against staging from `npm run dev` — the checks are listed
   under Unverified / open. **The plugin must be uploaded before the app is used for
   this**: app 0.6.0+ against 7.0 still has every fractional quantity `(int)`-cast.
3. ~~Upload 7.1 to live~~ — **done**; live runs 7.1, and `/parse` is verified there.
   Confirm `/ping` reports `7.1` when next on live, since only `/parse` has been called.
4. Find and re-save any live order with an empty billing state and a shipping line —
   the 6.x stale-shipping defect. Unverified / open says how to find them.
5. Stand up `ops.cartmixbd.com`, then `npm run build` in `app/` and upload `app/dist/`.
6. Change `ai_app_origin` to `https://ops.cartmixbd.com`. **This breaks local development
   until changed back** — it holds one origin, not a list.
7. Decide whether the app points at live. **Live's REST layer has been exercised only by
   `POST /parse`**, and `ai_app_origin` is expected to be empty there, which means no browser can reach
   it. Confirm that before assuming either way: empty is the safe state, and it is also
   what would make a first attempt from the app fail with no CORS headers.

Steps 1, 2 and 4 can be done today. Steps 5-7 need the subdomain.

**Two traps when testing the production build on localhost, both of which have already
cost a debugging round:**

- **`npm run preview` serves on port 4173, not 5173**, so `ai_app_origin` will not match
  and every request fails CORS. Use `npx vite preview --port 5173`, or change the setting
  for the duration. The symptom is misleading: **the preflight still returns 200** and
  only the actual request fails, which looks like anything but CORS.
- **A service worker registered during a `vite preview` run PERSISTS, and then serves a
  stale cached shell to `npm run dev`** — dev and preview share the `localhost` origin,
  so the worker installed by one controls the other. The symptom does not look like
  caching: unstyled serif text, and a hashed CSS filename in the Network tab while the
  dev server is running. Unregister the worker and clear site data, or leave **Bypass
  for network** ticked in DevTools while developing. The worker is production-only when
  REGISTERED, but nothing un-registers it when you switch back to dev.

**Still outstanding operationally, none of it code:**

- `ops.cartmixbd.com` is **not stood up**. The app is served from `npm run dev`.
- `ai_app_origin` on staging is `http://localhost:5173` and **must change at deploy**.
  It holds one origin, so flipping it breaks local development until flipped back.
- **Live runs 7.1.** Its REST layer has been called only by `POST /parse` — every other
  verification in this document was against staging.
- **`ai_app_origin` is expected to be EMPTY on live**, which means
  `ai_rest_cors_headers()` grants nothing and no browser can reach the API. That is the
  safe default and the reason the app cannot accidentally talk to live today. Worth
  confirming rather than assuming, because an empty setting is also indistinguishable
  from a misconfigured one until something tries.
- `app/dist/` must be rebuilt before any deploy; `VITE_API_BASE` is baked in at build
  time.

**`/products` is done being optimised.** Server-side search now costs 40-90ms against
several hundred ms of round-trip latency, so network dominates and further server-side
work on it is not worthwhile. Remaining latency belongs to the step 6 picker, hidden
client-side.

## Goal

A mobile-first PWA for WooCommerce staff to create, update, and trash orders, served
from a separate subdomain. Replaces using wp-admin on a phone. The existing AI text
parser becomes one feature inside it, not the whole tool.

## Environment

- Live: cartmixbd.com — **plugin 7.1**. Its REST layer has been called only by
  `POST /parse`, verified at 7.1; everything else recorded here was done against
  staging. `ai_app_origin` is expected to be empty on live, so no browser can reach the
  API there — the `/parse` checks did not need one.
- Staging: staging.cartmixbd.com — **plugin 7.0 as last recorded**, where everything is
  tested first
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
- **Defender is deactivated and stays that way — settled, not pending.** It truncated
  the application-password display in wp-admin, producing unusable credentials, which is
  why it was turned off. Recorded here so nobody re-enables it without knowing what
  broke. (`POST /token` reads the plaintext from the create call rather than from any
  admin screen, so it would not be affected by that particular defect either way.)
- **Decimal Product Quantity for WooCommerce (wpgear) is active on BOTH staging and
  live, and fractional quantities depend on it.** It filters `woocommerce_stock_amount`,
  which `wc_stock_amount()` applies inside `WC_Order_Item::set_quantity()`; WooCommerce's
  default for that filter is `intval`. This plugin does not depend on it in code — it
  passes quantities through `wc_stock_amount()` and lets the site's filter decide — so
  **deactivating it on a site quietly turns that site back to whole-number quantities**:
  1.5 is stored as 1, and the write response says so in a warning. That is the intended
  degradation, not a bug, but it is the first thing to check if fractions stop sticking.
  The 2-decimal limit is ours (`AIOC_QUANTITY_DECIMALS`), because that plugin sets none.
- **Code Snippets is a second place code runs on these sites, and it has already been
  load-bearing three times.** **Two snippets are now REQUIRED alongside this plugin**, on
  both sites. Both live in the database, not in this repo, so **neither survives a site
  migration or rebuild unless Code Snippets' data comes with it** — and nothing in the
  repo will notice they are missing.
  - Custom order statuses live in a Code Snippets snippet that hooks `wc_order_statuses`,
    not in this plugin.
  - **"Decimal qty step fix (order edit)"**, on staging AND live, makes fractional
    quantities saveable in **wp-admin**. It is a workaround for a gap in the *Decimal
    Product Quantity* plugin, not for anything in this repo, and the app does not need
    it — the REST path never touches these inputs.
    - **What breaks without it:** WooCommerce renders each order line's quantity as
      `<input type="number" step="1" min="1" name="order_item_qty[N]">`, and the decimal
      plugin does not raise `step`. A value like 1.5 then fails HTML5 validation and the
      browser silently refuses to submit — **the order edit screen's Update button and
      the Add order screen's Create button both look dead**: no request, no visible
      error. The invalid control sits in a panel the browser cannot focus, so it cannot
      show its usual "please enter a valid value" bubble either.
    - **What it does:** sets `step="0.01"` and `min="0.01"` on those inputs, matching
      this plugin's 2dp limit, and runs a `MutationObserver` to re-apply them whenever
      WooCommerce re-renders the order items panel over AJAX. **The observer is
      load-bearing**: a product added to the order arrives in a freshly rendered row
      with `step="1"` again, which is exactly the Add order case.
    - **Diagnostic, because the symptom misleads:** a save button in wp-admin that does
      nothing, with nothing in the console except
      `An invalid form control with name='order_item_qty[N]' is not focusable`, means an
      input's `step` or `min` is rejecting the value. Check the snippet is active, then
      inspect the row's input for `step="1"`.
    - Recorded as reported; the snippet's code is not in this repo and was not read here.
  - **Recommendation: fold BOTH into Order Ops**, the way the shipping table was in 4.9.
    Each is behaviour this plugin's features depend on — `/meta` and the status
    dropdown read the custom statuses, and decimal quantities are only usable in
    wp-admin with the step fix — so each belongs in versioned, reviewed code that ships
    with the plugin rather than in a database row that a migration can drop. The custom
    statuses matter more: if their snippet is lost, orders keep their stored status but
    the status is no longer registered, so they drop out of wp-admin's lists and `/meta`.
    The step fix should only apply while the decimal plugin is active, so a folded-in
    copy should check for it rather than assume. Do it the way 4.9 did: ship the plugin
    version that carries the code, then DELETE the snippet on both sites in the same
    sitting, so two copies are never both running. Not done here.
  - **The shipping rates used to live there too.** They were folded into this plugin in
    4.9 and then DELETED from Code Snippets, so that only one table exists. **If shipping
    or custom statuses ever behave oddly, check Code Snippets on BOTH sites for a
    resurrected copy** — two tables both hooking the same thing means whichever runs last
    wins, and the symptom is a rate or a status that is right in one place and wrong in
    another.
  - **If custom statuses stop appearing in `/meta` after a snippet edit, re-save the
    snippet or clear Code Snippets' cache before suspecting this repo** — that is what
    fixed it once already. Its active-snippets cache
  is keyed per scope group, so a stale entry can leave the snippet running in wp-admin
  while a REST request sees the unfiltered list. Our side holds no status cache at all:
  `meta.php`, `orders.php` and `orders-write.php` each call `wc_get_order_statuses()`
  live, per request.
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
  - **`app/dist/` must be rebuilt before any deploy.** It is untracked, so it is
    whatever was last built on that machine — it does not follow a `git pull`, and it
    does not update when `app/src/` changes. Every app change since the last build,
    step 6a included, is absent from an existing `dist/` until `npm run build` runs
    again. There is no build step on the server to catch this.
  - **An upload of `dist/` must REPLACE what is on the subdomain, never merge into it.**
    Delete the subdomain's contents first (at least `index.html`, `sw.js`,
    `manifest.webmanifest`, `assets/` and `icons/`), or upload with overwrite on.
    Several files keep the SAME NAME across every build — `index.html`, `sw.js`,
    `manifest.webmanifest`, and every file under `icons/`, whose names are still the
    step 7 placeholders' — so an upload that skips existing files leaves the old ones
    in place, and **a stale file with an unchanged name is invisible in a file
    listing**. A stale icon is the mild case; a stale `index.html` serves the old
    bundle, and a stale `sw.js` means installed clients never hear of the update.
    Deleting first also clears old hashed bundles out of `assets/`, which a merge
    otherwise accumulates.
    - **Check after uploading** rather than trusting the listing:
      `curl -s https://ops.cartmixbd.com/sw.js | grep SHELL_VERSION` must show the
      version in `app/public/sw.js`, and
      `curl -s https://ops.cartmixbd.com/icons/icon-192.png | sha256sum` must match
      `sha256sum app/public/icons/icon-192.png` locally.
    - **Content-hashed icon names were considered and NOT adopted.** They would make a
      stale ICON impossible, the way the hashed JS and CSS already are — but they do
      not remove the rule above, because `index.html`, `sw.js` and the manifest cannot
      be hashed: the browser asks for the page and the registered worker at fixed
      URLs. So a merging upload would still leave the two files that matter most
      stale, and the delete-first rule is needed regardless. The cost: icons in
      `public/` are copied verbatim, never hashed, so they would move under `src/`;
      Vite would then hash the `index.html` links (apple-touch-icon, favicon) and the
      login logo's import itself, but NOT the manifest's contents or the service
      worker's precache list, so both would need a small build plugin to write the
      hashed names in — and `icons.test.mjs` would have to check the build output
      rather than the source tree. Worth revisiting if the deploy is ever automated;
      not worth it to cover one file type out of four that the rule covers anyway.
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
      they are pruned, which is already a manual job (see Unverified / open). The order
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
    clearing site data while debugging the service worker (the trap under Start here)
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
  **Confirmed on staging with four custom statuses** — see Verified. This is the whole
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
  they can be fractional at all.** Since the decimal plugin went on (see Environment).
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

## Build steps

| # | Step | State | Version |
|---|------|-------|---------|
| 1 | Logic/presentation split, shipping consolidation | done | 4.9 (`f0972a8`) |
| 2 | Restructure, Order Ops rename, REST foundation + ping | done | 5.0 (`9ab4bd3`) |
| 3a | Read endpoints — orders list, single order | done, **verified on staging** | 5.2 |
| 3b | Read endpoints — product search | done, **verified on staging** at 5.6 | 5.3–5.6 |
| 3c | Price-first product search + 3-char minimum | done, **verified on staging** at 5.7 | 5.7 |
| 3d | Price-ascending ordering, compound terms, `fields=picker`, `timing_ms` | done, **verified on staging** at 6.2 | 6.2 |
| 3e | Bulk-prime post/meta/term caches before product hydration | done, **verified on staging** at 6.3 | 6.3 |
| 4a | `POST /parse` — text in, structured data out, writes nothing | done, **verified on staging** at 5.8 | 5.8 |
| 4b | Write endpoints — create, update, trash, restore | done, **verified on staging** at 5.9 | 5.9 |
| 4c | `GET /meta` — states, statuses, currency for the app | done, **verified on staging** at 6.1 | 6.0 |
| 4d | `POST /token` — login; account password → app password | done, **verified on staging** at 6.1 | 6.1 |
| 5 | PWA shell — subdomain, auth, order list | auth + list done, **verified in a browser** against 6.1; **subdomain not yet stood up** | — |
| 6a | Order form — fields, paste-and-parse, line items, totals, save, trash | done, **verified in a browser** | — |
| 6b | Product picker — sheet over the form, cached search | done, **verified in a browser** | — |
| 6c | Trash view and restore | done, **verified in a browser** | 6.6 |
| 7 | Manifest, service worker, install prompt | done, **verified as an installed PWA** | — |
| 8 | Repeat-customer last-order lookup | done, **verified on staging** at 6.8 | 6.8 |
| 9 | Reorder — from the last-order card and from each list row | done, **verified in a browser** | app 0.3.0 |
| 10 | Expected shipping on an unsaved order | done, **verified on staging and in a browser** at 7.0 | 6.9 / app 0.4.0 |
| 11 | Shipping cleared with the district; save bar fixed | done, **verified on staging and in a browser** at 7.0 | 7.0 / app 0.5.0 |
| 12 | Decimal quantities to 2dp; quantity as an editable field | done, **not yet on staging, unverified in a browser** | 7.1 / app 0.6.0 |
| 13 | New order from the order form | done, **unverified in a browser** | app 0.6.0 |
| 14 | Unsaved-changes guard on ‹ Orders; one guard for every exit | done, **unverified in a browser** | app 0.7.0 |
| 15 | Exit warning shown in the header; update banner's Reload guarded | done, **unverified in a browser** | app 0.8.0 |
| 16 | Save bar lifted clear of the update banner, by its measured height | done, **unverified in a browser** | app 0.9.0 |
| 17 | CartMix logo as every icon and on the login screen; password Show/Hide | done, **unverified on a device** | app 0.10.0 |

**Steps 1-7 are the original plan, and all seven are built and verified** — the API layer
by real requests against staging, the app in a browser as an installed PWA.

**Rows 8 to 11 came afterwards, and are verified too** — on staging at 6.8 and 7.0, and
in a browser. The specifics are under Verified; the few behaviours those checks did not
reach are under Unverified / open. Rows 8-11 are installed on live with 7.1 but
unverified there; only `/parse` has been called on live.

**Rows 12-17 are the unverified edge.** 12 needs 7.1 uploaded before it can be exercised
at all; 13-17 are app-only and need only a browser. All pass locally — `php -l`, the
PHP quantity rule run under a real PHP with both stock filters, fourteen app suites —
which is evidence the code is coherent, not that it works against WooCommerce.

**The API layer is complete and signed off.** Step 3 at 5.6/5.7 with 3d/3e verified at
6.2/6.3, step 4a at 5.8, 4b at 5.9, 4c and 4d at 6.1 — every endpoint confirmed by real
requests against staging. Step 5, the PWA shell, is verified in a browser. Nothing in
the API is waiting on anything, so step 6 is pure app work unless the picker turns up a
need the endpoints do not already serve.

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
- `GET  /aioc/v1/orders/{id}` — `includes/rest/routes/orders.php`. Line-item `quantity`
  (and the list's `item_count`) are trimmed numeric strings from 7.1. Carries `line_items`,
  `shipping_lines` and `fee_lines`; the same builder serves both write routes.
- `GET  /aioc/v1/products?search=&limit=&fields=` — `includes/rest/routes/products.php`.
  `search` is required, 3-character minimum on the whole term. `limit` defaults to 20
  and clamps to 50. `fields=picker` trims the row; anything else gives the full nine
  fields. The envelope carries `products` and `timing_ms`.
- `GET  /aioc/v1/meta` — `includes/rest/routes/meta.php`. States, statuses, currency,
  `price_decimals`, `plugin_version`, and `shipping_rates` as
  `{default: {cost, label}, by_state: {"BD-13": {cost, label}, …}}`. Everything except
  `shipping_rates` is read from WooCommerce per request; that one comes from this
  plugin's own rate table.
- `GET  /aioc/v1/customers/last-order?phone=` — `includes/rest/routes/customers.php`.
  `phone` is required; 400 `aioc_invalid_phone` if it is not a recognizable BD mobile,
  200 `{found: false}` for a customer with no previous order, otherwise the standard
  order shape from the same builder `GET /orders/{id}` uses. No `exclude` parameter —
  6.8 removed it deliberately.
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
- **Line items with NO state total 175.00, not 0.00, with no shipping line.** Verified
  at 5.9, when `ai_apply_shipping()` early-returned on an empty state and
  `ai_rest_finalize_order()` called `calculate_totals()` itself to cover that case. **7.0
  removed both**: `ai_apply_shipping()` now always recalculates totals, so the separate
  call would only write the same figures twice. The behaviour is unchanged and was
  re-exercised at 7.0 — order 11361, cleared of its district, came back with a
  recalculated total (see the 7.0 block below). Do not put the early return back; see
  Product decisions.
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
  Product decisions: some state labels carry **trailing whitespace**, and `/meta`
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
  (`admin=0`). Not conclusively proven, so it is recorded under Environment as a
  troubleshooting step rather than as a known mechanism.

`POST /parse` on **LIVE** at **7.1** — the first requests verified against live rather than
staging, so live's 7.1 parser is confirmed working end to end:

- `"Kishoreganj Sadar, Kishoreganj"` → **BD-26 Kishoreganj**, 150.00 Outside Dhaka.
- `"Sreepur, Gazipur"` → **BD-18 Gazipur**, 120.00.
- A message with a realistic name ("Rahim Uddin") returns the name, address and
  district correctly and separately. An earlier run with the literal "Test Name" had
  seemed to put the address in the name; that was the test input, not the parser — see
  "Parser test inputs need REALISTIC names" under Conventions.
- Both district results match the current code run locally under PHP 8.3 with
  WooCommerce's 64-row BD list. Both name their district in full, so both are decided
  by the exact-alias pass; the fuzzy pass's misroutes, which need the district left
  out, are a separate item under Unverified / open and still reproduce.

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
  hooks reach the same function as the app — the claim under Product decisions, now
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
  are installed there but unverified: last-order lookup, `shipping_rates`, the 7.0
  shipping fix and decimal quantities. Staging, last recorded at 7.0, has not run 7.1
  at all.
- **Decimal quantities (7.1 / app 0.6.0) are unexercised against WooCommerce.** Verified
  only by running `ai_rest_line_quantity()` under a real PHP with both filters stubbed,
  and by the app suites. On staging, check:
  - Saving 1.5 stores 1.5 — in the response, AND in wp-admin's order screen, which is
    where the decimal plugin's own handling shows. 3.567 comes back as 3.57 with a
    warning; 0 and a negative come back as 1 with a warning.
  - A fractional quantity entered in wp-admin loads into the app unchanged, with Price
    as total ÷ quantity, and survives an app save of that order's items.
  - The list shows "2.5 items" for 1.5 + 1, and `item_count` is the string `"2.5"`.
  - **What the decimal plugin's filter actually returns is assumed, not read.** The
    code relies on it returning a float-safe number for "1.5"; its source was not
    inspected. If it rounds to its own precision, or returns a string, ours still
    applies 2dp on top — but confirm by observation rather than assuming.
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
  it — see the service-worker traps under Start here.
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
  — see the exit-guard entry under Product decisions — not an oversight.
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
- **The fuzzy fallback in `ai_extract_state_from_text()` misroutes a place written
  WITHOUT its district — and only then.** Matching is correct whenever the district is
  named: the exact-alias pass runs first over the whole text and wins, which is what
  live confirmed at 7.1 ("Kishoreganj Sadar, Kishoreganj" → BD-26, "Sreepur, Gazipur" →
  BD-18). The fuzzy pass runs only when no alias appears anywhere; it scans every word
  of 5+ characters against every ASCII alias, allowing one edit at 5-6 characters and
  two at 7+, and returns on the first word that matches anything. **These inputs, with
  no district in them, misroute on the current code** (run locally under PHP 8.3 with
  WooCommerce's BD list, after the live checks):
  - `"Kishore"` and `"House 5, Kishore"` → **Jashore** (Kishoreganj abbreviated)
  - `"Sreepur"` and `"Sreepur bazar"` → **Sherpur**
  - `"Kaliganj"` → **Habiganj**
  - `"Shibpur"` → **Sherpur**

  Controls behave: "Jessore" and "Joshore" → Jashore, which is what the fuzzy pass is
  for. `mohakhali` → Noakhali was the same shape and is fixed by an exact alias. How
  often staff messages omit the district is not known; the reported Jashore mismatch is
  the only observed case. An exact alias is the cheap fix per name; the general one is
  the two-edit budget on seven-letter aliases, which is loose for place names that
  differ by two letters. Worth capping at one edit and measuring what breaks.
- **`Sreepur` and `Kaliganj` are ambiguous and deliberately unmapped.** Sreepur names an
  upazila in Gazipur and in Magura; Kaliganj in Gazipur, Satkhira, Jhenaidah and
  Lalmonirhat. Mapping either to Gazipur would assert a district the text never states.
  Written WITHOUT a district, both currently resolve WRONGLY via the fuzzy pass (see the
  item above), so "unmapped" is not neutral there — it leaves a confidently wrong
  answer. Written with one, as in "Sreepur, Gazipur", they are right. Decide between adding them to Gazipur anyway
  (most likely for a Dhaka-based store) and tightening the fuzzy matcher so they fall
  through to unresolved.
- **WooCommerce's own BD state labels leak trailing whitespace into the alias map.**
  `ai_get_state_aliases()` keys on `strtolower($name)`, so `"Faridpur "` and
  `"Manikganj "` become aliases with a trailing space that no substring search can
  match. Harmless today because the manual file carries clean duplicates, but it is the
  same trailing-whitespace finding already recorded under Product decisions, showing up
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
- **`GET /orders?search=` does not resolve order ids.** It handles phone and customer
  name only. A numeric term that is not a valid BD mobile falls through to the name
  search, so typing an order number returns unrelated name matches rather than that
  order. **Decided: id resolution is not needed** — staff search by phone, which works
  today. Kept here rather than deleted, because the fall-through is still a latent
  surprise if anyone does type an order number into the list search.
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
  table actually execute (see Conventions for how to set it up). What is still
  unreachable locally: WooCommerce itself, so anything touching `wc_get_orders()`,
  `wc_get_products()`, `WC_Order` or `wc_get_order_statuses()` is structural or simulated
  only, and the Groq path, which needs network and a key. Behaviour against WooCommerce
  must be confirmed by curl against staging, as was done for steps 3a and 3b.
- **Recorded here but NOT verifiable from this repo.** Everything below is written down
  because it was observed once; none of it can be re-checked by reading the code, so
  treat it as a claim with a date on it rather than a fact:
  - **Which plugin version each site runs** (live 7.1, staging 7.0 as last recorded). Only
    `GET /aioc/v1/ping` can answer this. Check it before trusting any other statement
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

## Housekeeping

- Rotate the live site's DB password and all eight wp-config salts — they were exposed.
- README.md and the CHANGELOG.md intro line still say "AI Order Creator" rather than
  "Order Ops".
- Step 4b verification created test orders on staging; they were trashed afterwards, not
  permanently deleted, so they still sit in staging's trash.

## Update rule

Update this file in the same commit as any change to code, endpoints, or decisions.
Move items from Unverified to Verified only after a real request against staging
confirms them. Keep it current rather than append-only — delete what's no longer true
instead of accumulating history. Git log is the history; this file is the present state.
