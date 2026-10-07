# Project State

Working brief for resuming this project cold. Present state only — git log is the history.

Plugin header: **Order Ops v6.7**, Updated 2026-10-07. Live runs **6.6**. Staging runs
**6.6**, against which **all seven build steps are built AND verified** — the API layer
end to end, and the app confirmed in a browser as an installed standalone PWA. **6.7
(`GET /customers/last-order` plus the app's repeat-customer card) is committed but NOT
uploaded.**

**What remains before this is usable in production is operational, not code.** See the
list below.

## Start here

**All seven build steps are built and verified.** There is no feature work queued, and
the app has been used end to end in a browser as an installed PWA.

**The next work is deployment, and it is operational.** In order:

1. Upload plugin **6.7** and confirm `/ping` reports it.
2. Verify 6.7: `GET /customers/last-order` for a repeat customer, a new customer
   (`{found: false}`, 200), a bad phone (400), and `exclude` while editing. Then the
   app's repeat-customer card against it.
3. Stand up `ops.cartmixbd.com`, `npm run build`, upload `app/dist/`.
4. Change `ai_app_origin` to `https://ops.cartmixbd.com`. This breaks local development
   until changed back — it holds one origin.
5. Decide whether the app points at live. Live already runs the 6.x plugin, so the
   routes are there — but **live's REST layer has never been exercised at all**, and
   `ai_app_origin` is expected to be empty there, which means no browser can reach it.
   Confirm that before assuming either way: empty is the safe state, and it is also
   what would make a first attempt from the app fail with no CORS headers.

**Testing the production build: `npm run preview` serves on port 4173, not 5173**, so
`ai_app_origin` will not match and every request fails CORS. Use
`npx vite preview --port 5173`, or change the setting for the duration. The symptom is
misleading: **the preflight still returns 200** and only the actual request fails, which
looks like anything but CORS.

**Still outstanding operationally, none of it code:**

- `ops.cartmixbd.com` is **not stood up**. The app is served from `npm run dev`.
- `ai_app_origin` on staging is `http://localhost:5173` and **must change at deploy**.
  It holds one origin, so flipping it breaks local development until flipped back.
- **Live runs the 6.x plugin (6.6), so the `aioc/v1` routes exist there** — but
  **nothing on live has ever been called**. Every verification in this document was
  against staging.
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

- Live: cartmixbd.com — **plugin 6.6**, upgraded when the parser fixes were deployed.
  Both live and staging now run the 6.x plugin, so the `aioc/v1` routes exist on both.
  **Live's REST layer has never been exercised**, though: every verification recorded
  here was done against staging. `ai_app_origin` is expected to be empty on live, so no
  browser can reach the API there.
- Staging: staging.cartmixbd.com — where everything is tested first
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
- Custom order statuses live in a **Code Snippets** snippet that hooks
  `wc_order_statuses`, not in this plugin. **If custom statuses stop appearing in
  `/meta` after a snippet edit, re-save the snippet or clear Code Snippets' cache before
  suspecting this repo** — that is what fixed it once already. Its active-snippets cache
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
- App tests: `npm test` in `app/`. No dependencies, no browser. Two files:
  `test/api-abort.test.mjs` runs the real `src/api.js` against a throwaway localhost
  server, pinning the abort-versus-real-failure contract the order list depends on;
  `test/picker-logic.test.mjs` lifts the pure half of `views/product-picker.js` and
  asserts the cache-narrowing lookup and the client-side filter, which is where "typing
  feels instant" lives and where a wrong rule would show a staff member a product that
  does not match what they typed;   `test/sw-routing.test.mjs` lifts `routeFor()` out of
  `public/sw.js` and asserts that no API request is ever intercepted; and
  `test/phone-parity.test.mjs` pins `src/phone.js` to values produced by the real
  `ai_normalize_bd_phone()` under PHP. The first three work by transforming the real
  source rather than duplicating logic; the fourth cannot, because the other side is
  PHP, so its expected values were GENERATED by running the PHP and must be regenerated
  rather than edited if `phone.php` changes.
- **`app/src/phone.js` is the one piece of logic deliberately duplicated between PHP and
  JS**, and it exists only to decide whether a half-typed number is worth a last-order
  request. The server re-normalizes and answers 400 if it disagrees, so the client copy
  is a gate and never a source of truth — nothing on the write path goes through it.
  Keep it line-for-line with `includes/parsing/phone.php`.
- App layout (`app/src/`): `api.js` is the ONLY module that calls `fetch` — one place
  where auth, CORS, error shape and abort handling live. `auth.js` owns the stored
  credential, `meta.js` the session-cached `/meta`, `format.js` money and dates,
  `dom.js` node building, `views/` one file per screen. Views never call `fetch`
  directly.
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
- **The PWA pins the app to the domain root.** `start_url`, `scope`, the icon paths and
  the `/sw.js` registration are all absolute, so `app/dist/` is no longer portable to a
  subdirectory the way `base: './'` in `vite.config.js` was meant to allow. Fine for
  `ops.cartmixbd.com`; it is a deliberate narrowing, not an oversight.
- The app builds nodes and sets `textContent`; it never assembles HTML from data.
  Order data is staff-pasted free text, so string-built markup would be an injection
  risk. `dom.js` has no `html` option by design.

## Product decisions

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
- Shipping is a pure function of billing state: BD-13 → 80 Dhaka Flat Rate,
  BD-18 → 120 Gazipur Flat Rate, all else → 150 Outside Dhaka Flat Rate. One rate
  table in `includes/orders/shipping.php`, called from the admin hooks and every REST
  write path. Auto-only; no manual override by design.
- All WooCommerce statuses are settable from the app, read from
  `wc_get_order_statuses()` rather than hardcoded.
- **The repeat-customer lookup shows the previous order, collapsed.** When the phone
  field holds a valid BD mobile the form fetches that customer's last order and renders
  a one-line summary below the field, expanding to its items, shipping, fees and total.
  Collapsed by default because the form is already taller than a phone screen.
  - **A new customer shows NOTHING.** `{found: false}` is the common case, and a "no
    previous orders" message would be noise on most orders.
  - While editing, the order on screen is passed as `exclude`, or the lookup finds the
    order already open.
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
  does not compute shipping or invent an order total: while nothing has been edited
  locally it shows the server's `total`, which can legitimately differ from items plus
  shipping because of a coupon or a discount.
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

**All seven steps are built and verified**, the app included. Row 8 is not a build step
from the original plan - it is the repeat-customer lookup added afterwards, and the only
thing in this table not yet on staging.
| 7 | Manifest, service worker, install prompt | done, **verified as an installed PWA** | — |
| 8 | Repeat-customer last-order lookup | done, **not yet on staging** | 6.7 |

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
- `GET  /aioc/v1/orders/{id}` — `includes/rest/routes/orders.php`. Carries `line_items`,
  `shipping_lines` and `fee_lines`; the same builder serves both write routes.
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
standalone PWA.** This closes the whole app-side unknown:

- **The service worker caches the shell only.** Shell assets show `(ServiceWorker)` in
  the size column; `/wp-json/` requests appear as normal network entries. The rule the
  unit test asserts is the behaviour observed.
- **Offline shows "No connection" with a Try again action**, not an empty order list
  that reads as "this store has no orders".
- **The install prompt works and the app runs standalone.**
- **The product picker, the order form** (Price/Quantity/Total interacting as
  WooCommerce does, fees including the sign toggle), **the trash view and restore**, and
  **the twelve-status dropdown** all work.

So all seven build steps are built AND verified. What remains is operational.

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

## Unverified / open

- **Untestable in this catalogue** (no variable products), relevant only if any are
  added: price search matches variable parents on `_price`, which WooCommerce syncs to
  the cheapest variation, so a variation priced at the term under a cheaper parent is
  missed; and variation-level SKUs are findable only by exact match via
  `wc_get_product_id_by_sku()`, the parent-first search never reaching a partial one.
  Parent/simple SKU partial matching IS verified.
- **Nothing in 6.7 has run.** `GET /customers/last-order` and the app's
  repeat-customer card are unexercised. Verify on staging: a repeat customer returns the
  previous order in the standard shape; a new customer returns 200 `{found: false}` and
  the app shows nothing; a malformed phone returns 400 `aioc_invalid_phone`; `exclude`
  while editing suppresses the order on screen; and the AJAX admin tool still works
  after the lookup was extracted out from under it.
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
- **The fuzzy Levenshtein fallback in `ai_extract_state_from_text()` misroutes real
  place names, and that is the actual cause of the reported Jashore mismatch.** It scans
  every word of 5+ characters against every ASCII alias, allowing one edit at 5-6
  characters and two at 7+, and returns on the first word that matches anything.
  Confirmed live misroutes: **`kishore` → Jashore** (so Kishoreganj written as
  "Kishore"), **`sreepur` → Sherpur**, **`kaliganj` → Habiganj**, **`shibpur` →
  Sherpur**. `mohakhali` → Noakhali was the same shape and is now fixed by an exact
  alias; the rest are not. An exact alias always beats the fuzzy pass, so adding one is
  the cheap fix per name — but the general problem is the two-edit budget on seven-letter
  aliases, which is simply too loose for Bangladeshi place names that differ by two
  letters. Worth capping at one edit and measuring what breaks.
- **`Sreepur` and `Kaliganj` are ambiguous and deliberately unmapped.** Sreepur names an
  upazila in Gazipur and in Magura; Kaliganj in Gazipur, Satkhira, Jhenaidah and
  Lalmonirhat. Mapping either to Gazipur would assert a district the text never states.
  Both currently resolve WRONGLY via the fuzzy pass, so "unmapped" is not neutral here —
  it leaves a confidently wrong answer. Decide between adding them to Gazipur anyway
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
- **Step 6a has never run in a browser.** It builds (22.6 kB of JS), every module
  resolves, and a 58-assertion contract check confirms every field name the form reads
  or sends matches what the PHP emits and accepts — but no request has been made. Unseen
  end to end: paste-and-parse populating the fields, the district and status selects
  against real `/meta` data, loading an existing order, the quantity stepper, partial
  update actually leaving untouched fields alone, create, and trash. Also unverified:
  that an edited line total round-trips — type a figure, save, and confirm the returned
  order carries it rather than the catalogue price — and that an overridden line
  survives a quantity change. Fees likewise: adding a fee and a discount, confirming
  the Fees row and the total, that removing every fee and saving actually clears them,
  and that editing a product does not disturb the fees in the round trip. Verify against
  staging with `ai_app_origin` at `http://localhost:5173`.
- **Restore is not reachable from the app.** Trashed orders are excluded from
  `GET /orders`, so there is no route to a trashed order and nowhere to put a restore
  action. `POST /orders/{id}/restore` exists and is verified; the app simply cannot
  reach it. Restoring means wp-admin until the list grows a trash filter.
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
- Claude Code's environment has no php binary and no WooCommerce source, so nothing is
  linted or run there. Local checks are structural or simulated only; behaviour must be
  confirmed by curl against staging, as was done for steps 3a and 3b.

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
