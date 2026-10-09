# Project State

Working brief for resuming this project cold. Present state only — git log is the
history. **Read this file first and in full**; it is written for someone with no
other context. Two companion files hold the detail, and *Start here* says when to
open them.

## What this is

A **mobile-first PWA for WooCommerce staff to create, update and trash orders**, served
from its own subdomain, replacing the use of wp-admin on a phone. Two deliverables in one
repo:

- **The plugin** (`ai-order-creator.php`, `includes/`, `admin/`) — a WordPress plugin
  called **Order Ops**, which exposes the `aioc/v1` REST API the app talks to, and still
  carries the original AI text parser and its wp-admin screens.
- **The app** (`app/`) — a vanilla-ES-modules PWA built with Vite, called **CartMix Shop
  Manager** to staff. Deployed as built output, not source.

The store is **cartmixbd.com**, a Bangladesh retailer. Orders arrive as messy pasted chat
messages in Bangla, English or both; the parser turns one into a draft order. That parser
predates the app and is now one feature inside it, not the whole tool.


## Where things stand

| | repo | staging | live |
|---|---|---|---|
| Plugin | **7.6** | 7.1 | 7.1 |
| App | **0.12.0** | served from `npm run dev` on a laptop | not deployed |

**The repo is five plugin versions ahead of both sites.** 7.2 through 7.6 are committed
and none is uploaded; **one upload covers all five**. What is waiting:

| | what it does | why it matters |
|---|---|---|
| 7.2 | places written without their district resolve to NO district, not a wrong one | a wrong district meant a wrong shipping rate |
| 7.3 | order-list search matches wp-admin's — one substring match over id, phone, name, address; adds `timing_ms` | staff use both boxes |
| **7.4** | **four districts whose alias value was not a WooCommerce label** | **those orders saved with NO shipping line — short by 80-150 BDT** |
| 7.5 | the AI can no longer supply a district the customer never typed; wp-admin's create button refuses without one | a district nobody typed was reaching orders |
| 7.6 | `ধামরাই` added in Bangla; Madan deliberately left out | a missing Bangla alias now costs a dropdown pick |

**7.4 is the reason not to leave this sitting.** It is a money fix, and it does not repair
orders already saved wrong — each needs one save after the upload.

**The app has never been deployed.** There is no subdomain yet; it runs from a dev server
against staging. Nothing in the app can reach live, because `ai_app_origin` there is
expected to be empty, so CORS grants nothing.


## Start here

**You are reading the only handoff.** This file is maintained as the present state of the
project; `git log` is the history. If something here disagrees with the code, the code
wins and this file is wrong — fix it in the same commit.

**Read in this order:** this section, then *Where things stand* above, then *Build steps*
and *Open decisions* below. That is the whole arrival reading, and it is all in this file.

### The three documents

This file is one of three, split because one file had grown past reading in a sitting.
Each has one job:

| file | what it holds | when to open it |
|---|---|---|
| **`docs/PROJECT-STATE.md`** (this one) | what the project is, what is deployed where, what to do next, what is still undecided, and how the work is done | **first, and in full.** On arrival, and again before any deploy |
| **`docs/DECISIONS.md`** | every settled decision and convention, with its reasoning — product behaviour, API shape, app architecture, parser rules, naming | **before changing a specific area.** It answers "was this already decided, and why" — check it before redesigning anything, because most surprises in here were paid for once already |
| **`docs/VERIFICATION.md`** | what has been proven against a real server and what has not — `Verified` and `Unverified / open` | **when deploying, picking up a loose end, or before trusting a claim about behaviour.** `Unverified / open` is also the to-do list for anything half-finished |

The two companions are reference, not narrative. Nothing in them is needed to understand
the project; everything in them is needed before changing it.

### First, confirm the repo is intact — no server needed

```
cd app && npm test
```

Fifteen JS suites (458 assertions) plus two PHP suites (133: the parser's 92 and the
order-search args' 41). Suites are discovered by filename, so a new one cannot be
forgotten. Without a PHP on the PATH the PHP suites print **SKIPPED by name** in the
summary rather than vanishing; set `PHP_BIN` to the portable PHP described under
*Conventions* in `docs/DECISIONS.md` to run them, and `REQUIRE_PHP=1` to make a skip
count as failure.

`php -l` over all 29 PHP files is the other local check, and needs that same portable PHP.

> A third check is referred to in places: a **contract check** that greps the real PHP and
> JS source and asserts the field names and behavioural rules they must agree on, ~196
> assertions. **It is a scratch tool, rebuilt per session, and is NOT in this repo.** Do
> not go looking for it. `npm test` is the durable check.

### Then, the work that is actually queued

**There is no feature work queued.** Everything in *Build steps* is built and passes its
local checks. What remains is deployment and verification, in this order because each
depends on the one before:

1. **Upload the plugin to staging and confirm `GET /aioc/v1/ping` reports `7.6`.** A
   stale version here produces misleading 404s on new routes, so do not skip the check.
2. **Verify 7.4 on staging**, which is the money fix: `GET /meta` returns `shipping_rates`
   with BD-13 at 80.00 and BD-18 at 120.00, and an order for Netrakona, Jhalokati,
   Nawabganj or Cox's Bazar now gets a shipping line.
3. **Spot-check 7.2, 7.3, 7.5** — `POST /parse` with "House 5, Kishore" returns no
   district while "Kishoreganj Sadar, Kishoreganj" returns BD-26; `GET /orders?search=`
   with a phone fragment, an order id and a Bangla address fragment.
4. **Check app steps 13-17 against staging from `npm run dev`.** They are app-only and
   have never been seen in a browser. The specifics are under
   *Unverified / open* in `docs/VERIFICATION.md`.
5. **Upload the plugin to live, confirm `/ping`.** Live has had only `POST /parse` called
   against it, ever.
6. **Find and re-save any live order with an empty billing state and a shipping line** —
   the 6.x stale-shipping defect. *Unverified / open* in `docs/VERIFICATION.md` has the
   query.
7. **Stand up `ops.cartmixbd.com`**, then `npm run build` in `app/` and upload
   `app/dist/`. Read the deploy rules under Environment first — an upload must replace,
   not merge.
8. **Change `ai_app_origin` to `https://ops.cartmixbd.com`.** This breaks local
   development until changed back; it holds one origin, not a list.

Steps 4 and 6 can be done today. Steps 7-8 need the subdomain.

### What not to touch

- **The plugin folder name** `ai-order-creator/`. Renaming it deactivates the plugin on
  live. The same goes for the text domain, the `ai_` function prefix, the `aioc/v1`
  namespace and the wp-admin page slug `ai-order-creator` — all are internal identifiers
  that outlive the product name. See *Names* under *Product decisions* in
  `docs/DECISIONS.md`.
- **`ai_normalize_bd_phone()`'s behaviour**, which `app/src/phone.js` duplicates
  line-for-line and `phone-parity.test.mjs` pins to values generated by running the PHP.
  If the PHP changes, regenerate those values; never edit them to pass.
- **`/products`' default response shape and its sort window.** That shape is the verified
  one. `/products` is also done being optimised: server-side search is 40-90ms against
  several hundred ms of round-trip, so the network dominates.
- **The rate table in `includes/orders/shipping.php`** without reading the notes on it.
  It is the single source of shipping truth and `/meta` serves it to the app.
- **The service worker's rule that no `/wp-json/` response is ever cached.** This app
  reads and writes live order data; a cached order list is a staff member acting on state
  that has moved.

### Two traps when testing the production build on localhost

Both have already cost a debugging round.

- **`npm run preview` serves on port 4173, not 5173**, so `ai_app_origin` will not match
  and every request fails CORS. Use `npx vite preview --port 5173`, or change the setting
  for the duration. The symptom misleads: **the preflight still returns 200** and only the
  actual request fails, which looks like anything but CORS.
- **A service worker registered during a `vite preview` run PERSISTS, and then serves a
  stale cached shell to `npm run dev`** — dev and preview share the `localhost` origin, so
  the worker installed by one controls the other. The symptom does not look like caching:
  unstyled serif text, and a hashed CSS filename in the Network tab while the dev server
  is running. Unregister the worker and clear site data, or leave **Bypass for network**
  ticked in DevTools while developing. The worker is production-only when REGISTERED, but
  nothing un-registers it when you switch back to dev.


## Environment

- Live: cartmixbd.com — **plugin 7.1**. Its REST layer has been called only by
  `POST /parse`, verified at 7.1; everything else recorded here was done against
  staging. `ai_app_origin` is expected to be empty on live, so no browser can reach the
  API there — the `/parse` checks did not need one.
- Staging: staging.cartmixbd.com — **plugin 7.1**, where everything is tested first
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
  handle one directly - `POST /token` mints it. See *Product decisions* in
  `docs/DECISIONS.md`.
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
    fixed it once already. Its active-snippets cache is keyed per scope group, so a stale
    entry can leave the snippet running in wp-admin while a REST request sees the
    unfiltered list. Our side holds no status cache at all: `meta.php`, `orders.php` and
    `orders-write.php` each call `wc_get_order_statuses()` live, per request.
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
| 12 | Decimal quantities to 2dp; quantity as an editable field | done, **verified on staging and in a browser** at 7.1 | 7.1 / app 0.6.0 |
| 13 | New order from the order form | done, **unverified in a browser** | app 0.6.0 |
| 14 | Unsaved-changes guard on ‹ Orders; one guard for every exit | done, **unverified in a browser** | app 0.7.0 |
| 15 | Exit warning shown in the header; update banner's Reload guarded | done, **unverified in a browser** | app 0.8.0 |
| 16 | Save bar lifted clear of the update banner, by its measured height | done, **unverified in a browser** | app 0.9.0 |
| 17 | CartMix logo as every icon and on the login screen; password Show/Hide | done, **unverified on a device** | app 0.10.0 |
| 18 | Order-list search matching wp-admin's; `timing_ms` on `/orders` | done, **not yet on staging** | 7.3 / app 0.12.0 |
| 19 | District from the customer's text only; wp-admin create refuses without one | done, **not yet on staging** | 7.5 |

**Rows 18-19 and the three correctness fixes beside them (7.2, 7.4, 7.6) are the only
work neither site has.** The fixes are not build steps and are listed in *Where things
stand* at the top instead, with what each one does and why 7.4 matters most.

**Steps 1-7 are the original plan, and all seven are built and verified** — the API layer
by real requests against staging, the app in a browser as an installed PWA.

**Rows 8 to 11 came afterwards, and are verified too** — on staging at 6.8 and 7.0, and
in a browser. The specifics are under *Verified* in `docs/VERIFICATION.md`; the few
behaviours those checks did not
reach are under *Unverified / open* in `docs/VERIFICATION.md`. Rows 8-11 are installed on
live with 7.1 but
unverified there; only `/parse` has been called on live.

**Row 12 is verified on staging at 7.1.** **Rows 13-17 are the unverified edge** — all
app-only, needing only a browser. They pass locally, fourteen app suites, which is
evidence the code is coherent, not that it works on a device.

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
- `GET  /aioc/v1/orders?page=&per_page=&search=&status=` —
  `includes/rest/routes/orders.php`. `search` is one substring match over order id,
  phone, name and address, sent untouched, with a 3-character minimum (400
  `aioc_search_too_short`); an empty term is the unfiltered list. The envelope carries
  `orders`, `total`, `total_pages`, `page` and `timing_ms` from 7.3.
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


## Open decisions

Four things are waiting on a judgement call rather than on work. Each is written to be
actionable without any other context.

- **Fold the two Code Snippets entries into the plugin.** Both are required for features
  this repo owns, and both live in a database row that a migration can drop silently.
  - *The custom-status snippet* hooks `wc_order_statuses`. Without it, orders keep their
    stored status but the status is no longer registered, so they fall out of wp-admin's
    lists and out of `/meta` — and the app's status dropdown loses them. This is the one
    that matters more.
  - *"Decimal qty step fix (order edit)"* sets `step="0.01"`/`min="0.01"` on wp-admin's
    order-item quantity inputs and re-applies them with a `MutationObserver` after each
    AJAX re-render. Without it, wp-admin's Update and Create buttons silently do nothing
    for a fractional quantity. The app does not need it; the REST path never touches
    those inputs.
  - **How to do it:** the way 4.9 did the shipping table. Ship the plugin version that
    carries the code, then **delete the snippet on both sites in the same sitting**, so
    two copies are never both running. A folded-in step fix should check that the Decimal
    Product Quantity plugin is active rather than assume it.
  - **Why it is not done:** neither snippet's code has been read from here, and folding in
    behaviour nobody has reviewed would replace a known-working database row with an
    unverified copy. Read them first.
- **Three "AI Order Creator" strings remain in wp-admin.** The product is called Order
  Ops; `admin/menu.php` still shows the old name in three places — the submenu page title
  and menu label (lines 7-8) and the `<h2>` on the page itself (line 48).
  - **Change only those three display strings.** The page slug `ai-order-creator`, the
    callback `ai_order_creator_page()` and the capability stay exactly as they are: the
    slug is the admin URL and the menu key, and renaming identifiers is what *Names*
    forbids.
  - Trivial, but deliberately not bundled into a behavioural commit.
  - `README.md` and the `CHANGELOG.md` intro line say "AI Order Creator" too — see
    Housekeeping. Those are repo text, not wp-admin, and are a separate call.
- **Whether wp-admin's create-refusal proves too disruptive.** Since 7.5, "Create Order
  with AI" resolves the district before writing and **refuses** when there is none,
  rather than creating an order with no shipping line. That path has no review step, which
  is why refusing was chosen.
  - 7.5 also stopped the AI supplying a district, so **this refusal fires more often than
    it would have before** — it is exactly the case that used to be filled in by a guess.
  - **If it is disruptive in daily use**, the alternatives, in order of preference: add
    the missing upazila aliases the refusals reveal (cheapest, permanent, and the refusal
    message tells you which); or let staff pick a district on that screen before creating,
    which makes it a review step; or make the app the only create path and retire the tab.
  - **Do not switch it to applying the Outside Dhaka default.** That contradicts 4.9/7.0 —
    no district means no shipping — and would attach a shipping line to an order with no
    district to justify it.
  - Needs real use to judge. Nobody has used it since the change.
- **Whether the alias matcher should respect word boundaries for short keys.** This is
  what blocks adding `মদন`/`madan`, and any other short name.
  - Today the exact pass is an unbounded substring search over the whole text, and the
    ASCII fuzzy pass allows 1 edit from 5 characters. So `মদন` (3 codepoints) fires inside
    `মদনপুর`/`মদনগঞ্জ`, which are in **Narayanganj**, and `madan` collects `madam`,
    `maidan`, `sadan` and `medan`. Both are tested in `state-matching.test.php`, pinned
    as resolving to nothing.
  - A word-boundary rule for keys under some length would let short names in. It is a
    change to the **matcher**, affecting all 327 aliases, so it needs the parser suite to
    pass unchanged plus new cases — not a data edit.
  - Until then, short names stay out and cost a dropdown pick. That is the cheap, correct
    failure.


## How this project has been worked

Recorded because it is not visible in the code, and because it is the reason this file can
be trusted.

- **One change at a time, and the change is finished before the next one starts.** Each
  plugin version in `CHANGELOG.md` is one decision with its reasoning. That is why the
  changelog entries are long: they carry *why*, including options rejected, so a later
  reader does not re-litigate a settled question or undo a fix without knowing its cost.
- **Verified against a real server before moving on.** "It builds" and "the tests pass"
  are necessary and not sufficient. The *Verified* section of `docs/VERIFICATION.md` holds
  only what a real request against staging confirmed; everything else sits in
  *Unverified / open* until it does.
  Several entries in this file were wrong precisely because that step was skipped — see
  *Lessons about this document*.
- **This file is updated in the same commit as the code.** Not afterwards, not in a
  batch. A commit that changes behaviour and leaves the doc stale is the failure mode this
  rule exists to prevent, and it has happened: three version numbers in here went stale
  across two commits before a sweep caught them.
- **WooCommerce's behaviour is read from its source, not assumed.** Where a decision turns
  on what WooCommerce does — `sanitize_status()` passing unknown statuses through,
  `calculate_totals()` capping a negative fee, `add_product()` appending rather than
  merging, the HPOS search clauses — the source was fetched and read, and the file and
  class are cited so the next reader can check the same place. WooCommerce is not vendored
  here, so those are version-specific claims about 11.0.1.
- **Where WooCommerce already has a behaviour, it is copied rather than redesigned.** This
  is the governing rule for anything the app does to an order, and ignoring it cost real
  work once — see the first entry under *Product decisions* in `docs/DECISIONS.md`.
- **A wrong answer is worse than no answer**, consistently, for districts and shipping.
  An empty district shows as an empty dropdown and gets filled; a wrong one looks
  finished. Several versions exist only to enforce that.
- **Tests are written to fail for the right reason.** Where a guard matters, it was
  confirmed to fail with the fix reverted — the sticky save bar, the alias targets, the AI
  district guard. An assertion that has never been seen red is not yet a guard.


## Housekeeping

- Rotate the live site's DB password and all eight wp-config salts — they were exposed.
- README.md and the CHANGELOG.md intro line still say "AI Order Creator" rather than
  "Order Ops". The three wp-admin strings are tracked under Open decisions instead,
  because they are what staff see.
- Step 4b verification created test orders on staging; they were trashed afterwards, not
  permanently deleted, so they still sit in staging's trash.


## Lessons about this document

- **"Decided: not needed" is not a substitute for a request, and one of these entries was
  wrong for weeks because of it.** An open item asserted flatly that
  `GET /orders?search=` could not resolve order ids and that a numeric term fell through
  to an unrelated name search. It was written from a STATIC READING of our own code —
  nobody called the endpoint — and reading WooCommerce's source later showed the id
  clause is added unconditionally, so ids had been searchable the whole time. Two
  requests against live disproved the entry outright: `search=8735` returned exactly
  order #8735, and `search=5089` returned the same 7 orders as wp-admin.
  - The Update rule below already said to move things to Verified only after a real
    request. The failure was stating an unverified NEGATIVE as fact in the first place,
    which the rule does not explicitly forbid — so: **an entry claiming something does
    not work needs the same evidence as one claiming it does.** "I read the code and
    expect X" belongs in Unverified, phrased as an expectation.
  - It also cost nothing to check and would have saved a wrong decision: the entry
    concluded "id resolution is not needed", which closed a question that was never open.


## Update rule

**Update the docs in the same commit as the code.** Not afterwards, not in a batch. A
commit that changes behaviour and leaves a doc stale is the failure this rule exists to
prevent, and it has happened here.

**Which file a change belongs in.** Three files only work if this stays unambiguous:

| what you have | where it goes |
|---|---|
| A new **decision** — behaviour chosen, an option rejected, a convention adopted | `docs/DECISIONS.md`. Record the reasoning and what was rejected, not just the outcome |
| A new **verification result** — a real request confirmed something | `docs/VERIFICATION.md`, under *Verified* |
| Something **tried and not proven**, or a known gap | `docs/VERIFICATION.md`, under *Unverified / open* |
| A **changed fact about the world** — a version uploaded, a setting flipped, a site rebuilt, a snippet added or lost | `docs/PROJECT-STATE.md`, in *Where things stand* or *Environment* |
| A **new build step or fix** worth indexing | `docs/PROJECT-STATE.md`, the *Build steps* table |
| Something **waiting on a judgement call** | `docs/PROJECT-STATE.md`, *Open decisions*. Move it into `DECISIONS.md` once decided |
| A **chore** with no decision in it | `docs/PROJECT-STATE.md`, *Housekeeping* |

**Two rules that keep the three from drifting back together:**

- **`PROJECT-STATE.md` must stay readable in one sitting.** If something there needs more
  than a few lines of reasoning, the reasoning belongs in `DECISIONS.md` and this file
  gets the one-line consequence plus a pointer. That is the whole reason for the split:
  the single file reached 2,096 lines because every reason was written where the fact was.
- **`DECISIONS.md` holds no state.** No versions, no "currently", no "not yet uploaded".
  Those belong here, where someone will look when they change. A decision is true until
  it is changed; state is true until tomorrow.

**Two rules that have not changed:**

- **Move an item from *Unverified / open* to *Verified* only after a real request against
  a real server confirms it.** Reading the code is not confirmation, and an entry claiming
  something does NOT work needs the same evidence as one claiming it does — see *Lessons
  about this document*.
- **Keep all three current rather than append-only.** Delete what is no longer true
  instead of accumulating history. Git log is the history; these files are the present
  state.
