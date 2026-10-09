# Changelog

All notable changes to AI Order Creator are documented in this file.

## 7.4

- **Fixed four districts that resolved to a name but no state code — so an order for any of them saved with an empty state and therefore NO SHIPPING LINE AT ALL.** Found from a live order whose address ended `নেএকোণা` and came back as *Chandpur*.
  - `bd-locations.php` maps a spelling to a district **name**, and `ai_match_state_code()` then has to find that name in WooCommerce's own BD list. Four values were not in it:

    | file said | WooCommerce says | code |
    |---|---|---|
    | `Netrokona` | `Netrakona` | BD-41 |
    | `Jhalokathi` | `Jhalokati` | BD-25 |
    | `Chapainawabganj` | `Nawabganj` | BD-45 |
    | `Cox''s Bazar` | `Cox's Bazar` | BD-11 |

    Nine aliases between them. **None of WooCommerce's spellings is the one you would guess**, which is why this went unnoticed.
  - **The failure was silent in the worst direction.** The parse preview showed a district. The order saved with an empty state. `ai_apply_shipping()` priced nothing, because it had no state to price. So the order went out **short by 80–150 BDT** with nothing looking wrong anywhere.
  - Every value in the file now matches a WooCommerce label byte for byte.
- **Added the Bengali spellings for Netrakona.** Both `নেত্রকোণা` and `নেত্রকোনা` are in real use — ণ and ন — and the one a customer writes is not a choice this code gets to make. The live misspelling `নেএকোণা`, with the `ত্র` ligature dropped, is listed too: **Bangla gets no fuzzy pass, by design**, so every spelling worth supporting has to be listed exactly. Checked for substring collisions in both directions first, as the file requires.
- **The *Chandpur* in the report was not the matcher.** The deterministic parse correctly resolved **no** district — which is what 7.2 made it do rather than guess. That left `state` empty, which made `ai_should_call_ai()` true, so Groq was asked, and Groq guessed. **Its answer is accepted without being checked against the input text**, so a plausible-looking wrong district passes straight through, and `ai_ensure_state_in_address()` then appends it to the address — which is why the address read `…নেএকোণা, Chandpur`.
  - With the alias added, this input no longer reaches Groq at all.
  - **The general hole is still open**, and is recorded as an open item rather than quietly closed, because closing it means deciding what the AI is allowed to contribute. See *Unverified / open*.
- **`tests/parser/state-matching.test.php`: 53 → 67 assertions**, including the guard that was missing. Every **value** in `bd-locations.php` is compared against WooCommerce's label list **directly**, not through `ai_match_state_code()` — that function's second pass re-runs the alias search on its own argument, so a bad value is rescued whenever another alias happens to point at the right district, which is exactly how these four survived. Confirmed the guard fails when any one target is put back.

## 7.3

- **`GET /orders?search=` now behaves like WooCommerce's own order search.** One box, one substring match across order id, phone, name and address at once — rather than a sequence of typed guesses. The term is passed through **untouched**, with `search_filter => 'all'`.
  - Read out of the WooCommerce 11.0.1 source (`OrdersTableSearchQuery.php`) rather than assumed:
    - **`'all'` expands to every core filter** — `order_id`, `transaction_id`, `customer_email`, `customers`, `products` — OR'd together. An absent filter does the same, and `all` is what the wp-admin dropdown defaults to.
    - **Order id:** `generate_where()` adds `` `id` = N `` whenever the term is exactly `(string) absint($term)`, *independently of the filter*. Exact, not partial — `8735` finds order 8735, `873` does not, and neither does `08735`.
    - **Phone, name, address:** the `customers` filter matches `meta_value LIKE '%term%'` against `_billing_address_index` / `_shipping_address_index`. `OrdersTableDataStore::update_address_index_meta()` writes those as `implode(' ', $order->get_address($type))`, and a **billing address array includes `phone` and `email`**.
  - That last detail is the whole mechanism: **a phone is matched because it sits inside a concatenated string.** It is why a fragment matches *mid-number*, and why neither a phone column nor raw SQL is needed.
  - **Bengali keeps working for the same reason.** A `LIKE` on utf8mb4 is a substring test with nothing tokenizing or normalizing the term. It is a *contiguous* substring, though — `"yasmin farida"` will not find `"farida yasmin"`.
- **Removed the `ai_normalize_bd_phone()` branch**, which turned a valid-looking mobile into an exact `billing_phone` lookup.
  - It was narrower than wp-admin in two ways: it could not match a fragment, and it **never looked at the shipping phone**.
  - Normalizing is also wrong in principle for a substring search. Stored numbers on this store are always plain 11-digit ASCII — customer data is never entered with `+880`, and the parser converts Bangla digits before saving — so a staff member types the digits they can see.
  - `ai_normalize_bd_phone()` is **unchanged and still used** by `GET /customers/last-order`, `ajax.php` and the shared lookup, which all ask for one exact number.
- **Added a 3-character minimum**, as a 400 `aioc_search_too_short` matching `/products`. The query is a leading-wildcard `LIKE`, and `01` is inside nearly every BD phone number.
  - Measured with `mb_strlen()`, so **two Bengali characters are refused** where `strlen()` would have counted six bytes and let them through.
  - **An empty term is not a short term** — the unfiltered list is the normal view of this screen.
  - The minimum is now `AIOC_SEARCH_MIN_LENGTH`, used by both routes instead of a literal `3` in each.
- **Added `timing_ms` to the `/orders` envelope**, wall-clock milliseconds inside the handler, as `/products` already reports. `all` adds an unindexed `order_item_name LIKE '%term%'` over the order items table, and that cost deserves a number rather than an estimate.
- **New `tests/rest/order-search.test.php`** — runs the real `ai_rest_apply_search_arg()` under PHP across 41 assertions: that the term reaches the args byte for byte in both scripts, that `billing_phone` is never set, and the minimum's boundaries. Discovered automatically by `app/test/run-all.mjs`.
- **Verified against live *before* this change that both reported gaps were already absent:** `search=8735` returned exactly order #8735 by id, and `search=5089` returned the same 7 orders as wp-admin in the same order (12312, 9798, 8735, 8421, 8350, 8313, 7405), each with 5089 inside an 11-digit phone. **So the only behavioural change here is the removal of the normalization branch.**
- **Hazard, recorded at the function and in the doc because nothing in this repo would reveal it.** If HPOS full-text search is ever enabled — `woocommerce_hpos_fts_index_enabled` and `woocommerce_hpos_address_fts_index_created` both `yes` — the `customers` clause becomes `MATCH … AGAINST … IN BOOLEAN MODE`, which does not match mid-word. Mid-phone search would then break **silently, in both this API and wp-admin**. It is a WooCommerce performance setting someone could reasonably enable without connecting it to search behaviour. The mid-number matches above prove it is off on live today.
- **`item_count` as a numeric string is intended and stays.** Reviewed after it was queried: `get_item_count()` sums quantities as floats, so an int cast would truncate `1.5` to `1` and dropping the string would send `3.3000000000000003`. It is the same argument money makes, it has been the documented shape since 7.1, and the app already reads it with `Number()` — covered by `decimal-quantity.test.mjs` for `"2.5"` and `"0.5"`. No change.

### App 0.12.0

- **The search box enforces the 3-character minimum before asking**, so a half-typed term never produces an error. The server's 400 is the backstop; this is the rule staff actually meet.
  - A 1-2 character term clears the list and says *"Type at least 3 characters to search."* rather than leaving the previous results on screen, where a stale list would look exactly like an answer.
  - The rejected term is **not** stored, so the status filter and the pager cannot resend it and collect the 400 the typing path just avoided.
  - Enter still searches immediately, including past a queued debounce, and still sends nothing when the term is too short.
- **New `app/test/order-search.test.mjs`** — asserts the search through the **request URL**, since that is the whole contract: ten term shapes sent byte for byte (ids, phone fragments, full mobiles, Bengali with and without ASCII digits, hyphens, mixed case), that a valid mobile is no longer intercepted, and every branch of the minimum.

## 7.2

- **Fixed: places written without their district resolved to the wrong district.** Shipping is a pure function of the district, so each was a wrong charge on a real order.
  - `"Kishore"` became Jashore. So did a customer *named* Kishore, because with no "District:" label the whole message is scanned.
  - `"Sreepur"` became Sherpur.
  - `"Kaliganj"` became Habiganj.
  - `"Shibpur"` became Sherpur.
  - Each was a different division and a different rate.
- **Cause:** `ai_extract_state_from_text()`'s fuzzy fallback is plain edit distance. It allowed 2 edits for any name of 7+ letters. Bangladeshi place names are a short distinctive start plus a shared ending (-pur, -ganj, -shore, -khali), so the shared ending paid for a different start. All four misroutes were at exactly 2 edits. The right district was 4–8 edits away and never a candidate, because these are different places, not misspellings. A margin over the runner-up would not have helped: the matcher wasn't torn between two districts, it was sure of the wrong one.
- **Fix:** the allowance is now **1 edit, or 2 only for names of 9+ characters**. The four near-misses resolve to **no district**, deliberately. **A wrong district is worse than none**: an empty one is visible in the app's dropdown and gets filled, while a wrong one looks normal and is saved at the wrong rate.
  - **Caveat:** wp-admin's one-step "Create order" doesn't review. There, an empty district means no shipping line. That is still detectable afterwards, unlike a wrong district.
- **New exact aliases:**
  - `gazipore` → Gazipur and `tangile` → Tangail, 2-edit spellings the tighter allowance no longer reaches.
  - `naraingonj` → Narayanganj, which no allowance reached.
  - `shibpur` → Narsingdi, its district.
- **Deliberately not aliases, each recorded in `bd-locations.php` beside where it would go:**
  - `kishore`, a common given name. The exact pass would route every customer named Kishore to Kishoreganj.
  - `sreepur`, which names places in Gazipur and Magura.
  - `kaliganj`, which names places in Gazipur, Satkhira, Jhenaidah and Lalmonirhat.
- **Measured before the change** against 25 real misspellings. The old rule resolved 24 and misrouted all four test places. The new rule stops all four and keeps 22, plus the 3 now listed exactly.
- **New `tests/parser/state-matching.test.php`** (53 checks), run against the real parser under PHP. WooCommerce's 64-row BD list is a fixture, extracted as data and never executed. It asserts:
  - the misroutes and "Kishore" as a name resolve to no district;
  - the 25 misspellings resolve correctly;
  - the full-name cases verified on live keep their district, code and shipping rate;
  - eight near-neighbour district names stay put (gazipur ~ azimpur, meherpur ~ sherpur, noakhali ~ mohakhali, bogra ~ boyra).
  - It was confirmed to fail with the old allowance, with an allowance of 1 everywhere, with a `kishore` alias added, and with a new alias removed.
- **`npm test` runs the PHP suite when it can find a PHP**, via `PHP_BIN` or `php` on the PATH, loading mbstring from a portable PHP's `ext/` itself. With no PHP it prints **SKIPPED**, by name, in the summary, and never skips silently. `REQUIRE_PHP=1` makes a skip a failure. A failing PHP suite fails `npm test`, also confirmed.

## App 0.11.0

App only. The plugin is unchanged at 7.1 and is still named "Order Ops".

- **The app is now "CartMix Shop Manager" to staff.**
  - The manifest `name` and the browser tab show the full name.
  - The home-screen label is **"CartMix"**, via `short_name` and iOS's `apple-mobile-web-app-title`. Labels truncate at around 12 characters, so the full name would be cut, and "Shop Manager" sits right at the limit and is generic. "CartMix" fits everywhere and matches the icon's wordmark.
  - The login heading is "Shop Manager", under the CartMix logo, so the card reads as the full name without repeating "CartMix".
  - The no-connection messages, in the app and in the service worker's offline page, say "Shop Manager". The install prompts use the full name.
  - The app header was unchanged: it shows "Orders" and "Trash", not the app's name.
- **Not renamed:** the plugin directory, the `ai_` prefix, the `aioc/v1` namespace, the `AIOC_*` constants, option names, the text domain and the repo. All are internal, and some are persisted.
- **Plugin-side names are deferred to one later plugin release.** These are the `Plugin Name` header, the `Order Ops (app)` application-password prefix, and the "Order created via Order Ops app" order note. All are visible only in wp-admin and all need an upload to both sites. The reasoning is in `docs/PROJECT-STATE.md`.
- **Past changelog entries keep the old name.** They describe what was true when they were written.
- **An already-installed app may keep its old name until it is removed and re-added,** as with the icon.
- `icons.test.mjs` grows to 41 checks. It now asserts the name, the home-screen label, the iOS label and the title agree, that the label fits, and that no "Order Ops" is left anywhere user-visible in the app. Confirmed to fail when the old name is put back.
- `SHELL_VERSION` is bumped to `v16`, since the manifest and the offline page are part of the cached shell.

## App 0.10.1

App only. The plugin is unchanged at 7.1.

- **The login hint no longer says "WordPress".** It now reads "Sign in with your username and password." Staff don't need to know what the backend is.
- **Fixed: the trash confirmation said restoring wasn't possible from the app.** It read "Restoring is not possible from this app yet — use wp-admin", which has been untrue since step 6c added Restore. It now says "You can restore it from Trash on the order list."
- **Kept deliberately:** the `/token` messages about application passwords, and the network error naming the App Origin setting. In each, the term is what someone has to act on, and each appears only when setup is broken. These are recorded as a convention in `docs/PROJECT-STATE.md`.
- **Icons are regenerated on every build.** `npm run build` now runs `scripts/make-icons.mjs` first, as the `prebuild` script, so a replaced `logo.png` can't ship stale icons. `npm run icons` runs it on its own. It writes into `public/icons/`, so new icons show up in `git status` to be committed. The output is deterministic, so an unchanged logo produces no diff. Confirmed end to end: a recoloured logo built into `dist/` produced new icons, and restoring it left no diff.
  - `test/icons.test.mjs` regenerates each icon in memory from the `logo.png` present when the test runs, and compares it with the committed file. It does not compare against a stored snapshot. A logo replaced without regenerating therefore fails it: confirmed, with all six "matches" checks failing.
- **Deploy note** in `docs/PROJECT-STATE.md`: an upload of `dist/` must replace what is on the subdomain, never merge into it. Several files keep their names across every build, including `index.html`, `sw.js`, the manifest and all the icons, so a skip-existing upload leaves stale copies that look current in a file listing. The note includes a `curl` check to run after uploading.
  - **Content-hashed icon names were considered and not adopted.** `index.html`, `sw.js` and the manifest can't be hashed, so the replace-don't-merge rule is needed anyway. Hashing would also take a build plugin to write the hashed names into the manifest and the service worker's precache list.
- `app/dist.zip` is gitignored.
- `SHELL_VERSION` is bumped to `v15`.

## App 0.10.0

App only. The plugin is unchanged at 7.1.

- **The CartMix logo is now every icon the app ships**, replacing the step 7 placeholders. All of them are generated from `public/icons/logo.png` by the new `scripts/make-icons.mjs`. The script has no dependencies, using a small PNG codec in `scripts/png.mjs`.
  - **Source:** 500×500, RGB, **no transparency**, on opaque white. Every icon is therefore opaque white with the logo centred and its white margin trimmed, and nothing has to be cut out.
  - **Sizes:** 192 and 512 "any" icons, a 180 apple-touch-icon and a new 32 favicon, each with the artwork spanning 88% of the side, or 96% for the favicon.
  - **Maskable 512:** the logo is wide, so fitting its bounding box would not keep it inside the safe zone. The ends of the speed lines and of "MIX" are far from the centre even though the box's corners are empty. It is scaled until the **farthest drawn pixel** sits at 94% of the 40% safe radius, and white fills to the edge, so any mask shape shows background rather than a hole.
  - **Legibility:** clear at 192, and "CART" and "MIX" are just legible at 72px. **At 48px the wordmark blurs into a yellow band**, although the cart's shape and colours still read. That is the limit of a horizontal logo with a wordmark. If it reads poorly on real home screens, the fix is a cart-only mark, not a different crop.
  - `manifest.webmanifest` needed no edit, because its entries name the same files. `index.html` gains the favicon link; the apple-touch-icon link already pointed at the regenerated file. The service worker precaches the favicon and the login logo.
- **The logo is on the login screen**, above "Order Ops", at 200px wide from a 400px file. It sits on the white sign-in card it was drawn for. **Not in the header:** the logo's teal is 1.41:1 against the dark header bar, so it would need a white plate or a light-on-dark version that doesn't exist, and it would cost vertical space on every screen of a phone.
- **Password Show / Hide on the login screen.** Hidden by default.
  - It is a worded button **beside** the field, outside its border, at its right-hand end and at full tap height, so it is not mistaken for part of the value.
  - It does not take focus, so a phone keeps its keyboard, and it cannot submit the form.
  - It turns the field back to `type="password"` before the form submits, so password managers see a password field and the password is never left showing. `autocomplete="current-password"` is kept throughout, and autocorrect is off on the field.
- **Investigated "remember me": not built.** Sign-in already persists in `localStorage` until Sign out. The only other things that remove it are a 401 on an authenticated request and a corrupt stored value, and nothing expires it. What looks like being signed out is per-origin storage: dev, preview and production each keep their own sign-in. The other causes are private windows, clearing site data, and iOS keeping a home-screen app's storage separate from Safari's. Recorded in `docs/PROJECT-STATE.md`, along with a proposed but unbuilt opt-out "Keep me signed in" for shared phones.
- **New `test/icons.test.mjs`** (36 checks):
  - Every icon is rebuilt in memory from `logo.png` and compared byte for byte.
  - Manifest sizes and purposes are correct.
  - Nothing in the maskable icon lies outside the safe circle, and its corners are filled.
  - Every icon is opaque.
  - `index.html`, the precache list and the login screen point at real files.
- **New `test/login.test.mjs`** (29 checks): the toggle's behaviour, and the persistence evidence above. That covers surviving a relaunch, a 500 or a wrong login password not signing anyone out, a 401 doing so, and the three code paths that can remove the credential.
- Both suites were confirmed to fail when broken: a stale icon, the field left as text at submit, and the toggle taking focus.
- **`npm test`: 14 suites, 421 assertions.** `SHELL_VERSION` is bumped to `v14`; the icons are part of the cached shell.

## App 0.9.0

App only. The plugin is unchanged at 7.1.

- **Fixed: the update banner covered Save on the order form.** Both are pinned to the bottom of the viewport, and the banner is drawn on top (`z-index: 20` over `2`). While it was up, the only way to keep a half-filled order was hidden. That matters more than it looks: the banner appears after a deploy, exactly when someone may be mid-order.
- **The fix reuses the order list's mechanism** rather than adding a second one. While the banner is up, body carries `has-pwa-banner`, and anything pinned to the bottom has a `body.has-pwa-banner …` rule that lifts it. The form's `.form-actions` now has one, using the same expression as the list's `.fab`. Its reserved space (`.form-main`) grows by the same amount, so lifting the bar does not leave Trash behind it.
- **The lift is now the banner's measured height, not a fixed 88px.** The 88px assumed a one-row banner. On a 375px phone the banner wraps to two rows (text over buttons, about 102px), so even the list's button sat partly under it. The unsaved-changes wording from 0.8.0 wraps further.
  - `pwa.js` now writes `--pwa-banner-space` (height + 12px offset + 12px gap) on body when the banner shows, at once when Reload rewords it, and on any resize through a `ResizeObserver`. It removes the variable on dismiss.
  - The stylesheet's default of 128px covers only the moment before the first measurement.
  - Both the list's button and the form's bar read the variable, so they share one mechanism with one number.
- **Tests:** `test/save-bar.test.mjs` grows to 29 checks.
  - From the stylesheet: the bar lifts by the same clearance as the list's button, the reservation grows with it, the default clears a two-row banner computed from the stylesheet's own figures, and the old 88px would not.
  - From `pwa.js` against a stubbed layout: the clearance is set on show, re-measured on rewording and on resize, and removed with the class on dismiss.
  - Each half was confirmed to fail when removed: no save-bar lift (the reported bug), no reservation growth, no re-measure on rewording, and the clearance kept after dismiss.
  - The test shim's `classList` and `style` are now real enough to observe.
- **`npm test`: 12 suites, 356 assertions.** `SHELL_VERSION` is bumped to `v13`.

## App 0.8.0

App only. The plugin is unchanged at 7.1.

- **Fixed: the unsaved-changes warning was off screen when it mattered.** It went in the status line at the top of the form. On a form taller than the viewport, which is the normal case, that line has scrolled away, so tapping "‹ Orders" or "+ New order" from further down looked like nothing happened and the guard read as a broken button.
  - **The warning now sits inside the sticky header**, as a strip just below the header bar, with a **Keep editing** button that takes it down. It is absolutely positioned, so it overlays the top of the content rather than making the header taller. A taller sticky header would push everything under it down mid-scroll.
  - The header is always on screen, and it holds two of the three guarded exits, so the warning lands in the same glance as the tap, with no scrolling and no movement of the page.
  - The strip is `role="alert"`. Its colours are asserted in `contrast.test.mjs`: 5.75:1 for the text, 17.74:1 for the button.
- **Why the header, over the alternatives:**
  - **The save bar** is pinned, but it is at the opposite end of the screen from the header taps. It would also put "discard your changes" beside the button that keeps them, which 0.6.0 deliberately separated.
  - **Scrolling the status line into view** moves the page. Someone who decides to stay has then lost their place in the form, which is the opposite of what the guard is for.
  - **A transient toast** either fades while the exit is still armed, so the second tap goes with no warning showing, or it persists, in which case it is this strip.
- **Fixed: the update banner's Reload discarded a dirty order form with no warning.** It was the last in-app way to lose work.
  - Reload now goes through the same guard as the form's exits. With unsaved work, the first tap rewords the banner itself to "Unsaved changes in this order. Tap Reload again to discard them and update." The banner stays up, and the second tap reloads. The warning goes in the banner because that is where the tap was.
- **How the form's state reaches `pwa.js`:** the banner asks the guard. The guard moved out of the form into a new **`src/exit-guard.js`**. The form registers its `isDirty()` there when it mounts; `main.js` clears the registration in `beginScreen()` on every navigation, so a form already left behind cannot make Reload on the order list warn. `pwa.js` asks `requestExit('reload', …)`.
  - This way neither module imports the other. `pwa.js` stays app-wide and knows nothing about views.
  - Pushing a dirty flag from the form into `pwa.js` instead would have meant a second copy of the two-tap logic, with its own armed state to keep in step.
  - **One armed slot for every exit, Reload included.** A warning licenses only the exit it was shown for. Arming a different exit takes the first warning down wherever it was showing. Dismissing the banner disarms Reload. A save disarms everything.
- **Test shim:** `remove()` now really detaches a node, so a test can tell whether the banner is still up.
- `test/exit-guards.test.mjs` grows to 49 checks. New coverage: the warning's placement in the header and not the status line, read from the stylesheet as sticky header plus overlaying strip, Keep editing, a save taking the warning down, Reload clean and dirty, Reload and ‹ Orders disarming each other, a dismissed banner, and `beginScreen()` clearing the guard. Each was confirmed to fail when the code it covers is reverted.
- **`npm test`: 12 suites, 341 assertions.** `SHELL_VERSION` is bumped to `v12`.

## App 0.7.0

App only. The plugin is unchanged at 7.1.

- **Fixed: "‹ Orders" discarded a dirty form on one tap.** The header link called `onClose` directly, so going back to the list, the most common way out of the form, threw away a half-filled order with no warning. It now uses the same two-tap guard as "+ New order" and the last-order card's "Open #N": with unsaved changes the first tap warns through the status line and the second goes back. A clean form goes straight back.
- **One guard for every exit.** The three exits used to keep their own "armed" flags. They now go through a single `guardedExit()` with one shared slot, which fixes two lingering-warning holes:
  - A warning only licenses the exit it was shown for. Tapping "‹ Orders" once and then "+ New order" warns again rather than starting a new order.
  - The slot is cleared whenever the form is refilled from the server. Before, a warning shown before a save stayed armed, and a single later tap would discard edits made after the save.
- **Audited every way out of a dirty form**; the result is recorded in `docs/PROJECT-STATE.md`.
  - **Guarded:** ‹ Orders, Open #N, + New order.
  - **Deliberately not guarded:**
    - Trash, which has its own confirmation and removes the order the edits belonged to.
    - A 401 sign-out, after which nothing could be saved anyway.
  - **Unguarded and not fixable here:**
    - The browser or hardware back button. The app pushes no history entries, so back leaves the app entirely, and only a `beforeunload` prompt could intercept it. That was decided against: it also fires on reload and tab close, with a generic message no browser lets the page word.
    - The update banner's **Reload**, which discards the form. It is recorded as open.
- **New `app/test/exit-guards.test.mjs`**, 23 checks. It covers clean and dirty behaviour for each guarded exit, that one exit's warning does not license another, that a save clears the warning, and that Trash goes through on its own confirmation. It also asserts that no `beforeunload` handler exists anywhere in `src/`. Confirmed to fail when the header link is pointed back at `onClose`, and when the reset on save is removed. The open-previous-order guard had no coverage before this.
- **`npm test`: 12 suites, 312 assertions.** `SHELL_VERSION` is bumped to `v11`.

## 7.1

- **Fixed: fractional line-item quantities were silently truncated, in both directions.** The *Decimal Product Quantity for WooCommerce* plugin (wpgear) is now active on staging and live, and lets WooCommerce store a quantity of 1.5. This plugin did not let it through:
  - **On the way in**, `ai_rest_add_line_items()` did `(int) $entry['quantity']`, so 1.5 was saved as 1. A wrong order with no error and no warning.
  - **On the way out**, the response builder did `(int) $item->get_quantity()`, so a fractional quantity entered in wp-admin read back as 1. The app derives Price as total ÷ quantity, so it showed a doubled unit price, and because the app sends every line's quantity whenever an order's items are saved, the next such save **wrote the 1 over the real figure**.
  - `item_count` in the list summary was `(int)` of `get_item_count()`, which sums quantities, so 2.5 read as 2.
- **The fix defers to WooCommerce.** The new `ai_rest_line_quantity()` passes the submitted quantity through `wc_stock_amount()`, which applies the site's `woocommerce_stock_amount` filter. That filter is `intval` by default and float-safe while the decimal plugin is active. So 1.5 is stored exactly when WooCommerce would store it. **If the decimal plugin is ever deactivated, quantities go back to whole numbers because WooCommerce says so, not because this code decided.**
- **Quantities are limited to 2 decimal places**, applied on top of `wc_stock_amount()` because the decimal plugin imposes no limit. The new constant `AIOC_QUANTITY_DECIMALS` holds it.
  - **A third decimal is rounded, not rejected.** 3.567 is stored as 3.57. This endpoint's rule is to mirror WooCommerce and never be stricter: it fixes a bad line with a warning rather than failing the whole order. The app rounds the same way when the field loses focus, so the figure on screen before the save is the figure stored.
  - Verified locally under PHP 8.3.35 with both filters stubbed: with `intval`, 1.5 → 1 (warned); with a float-safe filter, 1.5 → 1.5, 3.567 → 3.57 (warned), 1.005 → 1.01 (warned), "2.50" → 2.5.
- **A quantity that is changed on the way in now says so.** Whenever the stored figure differs from the one sent, the response carries a warning naming the product and both figures. That covers a rounded figure, one truncated by the default filter, and a zero, negative or unparseable entry, which is stored as 1. Before this, a bad quantity was clamped to 1 silently.
- **Response shape change: `quantity` and `item_count` are now trimmed numeric strings** — `"1"`, `"1.5"`, `"3.56"` — via the new `ai_rest_quantity()`. They are no longer integers.
  - This is for the reason money is a string. `get_item_count()` sums floats, and 1.1 + 2.2 would otherwise be sent as `3.3000000000000003`. Trimmed rather than padded to 2dp, because a quantity has no fixed number of decimals to show.
  - App 0.6.0 reads the new shape. **Upload this plugin before deploying app 0.6.0.** Against 7.0, the new app's string quantities are `(int)`-cast exactly as before, so 1.5 would still save as 1.
- The REST argument declaration needed no change. `line_items` is declared `'type' => 'array'` with no `items` schema, so WordPress never inspects or coerces the quantity inside it.
- `includes/ajax.php` is unchanged. It already passed `get_quantity()` through raw to the legacy admin UI.

### App 0.6.0

- **Quantity is an editable field**, in the same style as Price and Total, with − and + kept on either side as a convenience. Each button steps by 1.
  - You type freely, and the figure is normalized only when the field loses focus. Spaces and thousands separators are stripped; the decimal point is not. Rounded to 2 places, the same way the plugin rounds. Anything that does not come out above zero, or does not parse, falls back to what the row held **when the field was focused**, not to whatever half-typed figure parsed along the way.
  - Shown unpadded: `1`, `1.5`, `3.56`, never `1.00`.
  - − never reaches zero. From 1.5 it goes to 0.5; at 1 or below it is disabled. Remove is how a row goes away.
  - Rounding goes through the decimal exponent rather than `Math.round(x * 100) / 100`, which rounds 1.005 the wrong way in binary floating point. This agrees with PHP.
- **Fixed: every quantity was clamped to at least 1.** That happened on load, on Reorder and on every step, so a stored 0.5 became 1 in the form.
- **Fixed: focusing Price and leaving it changed the line total.** A loaded price is total ÷ quantity at full precision, but only *shown* at 2dp. Leaving the field re-read the rounded text, so 1000 ÷ 1.5 shown as 666.67 turned the total into 1000.005 without anyone typing. Fractional quantities made this far more likely. An unchanged Price field now changes nothing on blur.
- **Line-item quantities are sent as trimmed numeric strings**, matching the API's new response shape.
- **The order list reads `item_count` as WooCommerce's sum**: "1 item", "2.5 items", "0.5 items". It is compared as a number, since the API now sends a string. The last-order card shows quantities the same way.
- **New: start a new order from the order form**, without going back to the list. **+ New order** sits in the header as a plain link, while Save is the filled button pinned to the bottom. They are at opposite ends of the screen in opposite styles because one keeps work and the other can discard it.
  - With unsaved changes, the first tap only warns through the status line and the second tap goes ahead. This is the same two-step the form already uses before opening a previous order.
  - It is disabled while a save is in flight.
  - From an unsaved new order the route is already `form:new`, which the repeat-tap guard would swallow, so `main.js` resets the route for this action.
- **`npm test` runs 11 suites, 289 assertions.** The new `test/decimal-quantity.test.mjs` covers the rounding rule pinned to the PHP output, the input, the fallback, the stepper floor, the price-precision fix, the payload, the list wording and New order. It also asserts that no `Math.max(1, … quantity)` clamp survives in `src/`.
  - The existing suites' fixtures used integer quantities, which is no longer the API's shape. They now use the strings the API sends, and the Reorder suite carries a fractional line through the save payload.
  - The new suite was checked by breaking the code. Restoring the old clamp, removing the Price fix or skipping the New order confirmation each makes it fail.
- `SHELL_VERSION` is bumped to `v10`.

## 7.0

- **Fixed: clearing an order's district left the old shipping line on it, and in its total.** Order 11361 on staging carries a 120.00 `Gazipur Flat Rate` line with an empty billing state, and saving again did not clear it. This is a data-correctness bug, not a display one — the stored total was wrong.
  - **Cause:** `ai_apply_shipping()` returned early on an empty state *before* the removal loop, so a state going from BD-18 to empty kept the BD-18 rate.
  - **Fix:** the removal is now unconditional and runs first. Only the *adding* of a new line depends on there being a state, and `calculate_totals()` runs on both paths. **No district means no shipping, and that now holds whether the order never had one or had one and lost it.**
  - **This was the second bug from that one early return.** The first was skipping `calculate_totals()` entirely, which `ai_rest_finalize_order()` worked around by calling it directly. The root cause is fixed rather than worked around again, and **that workaround is removed as redundant** — with the fix in place it would be a second write of figures that are already correct.
  - **The admin path needed no separate work.** `woocommerce_process_shop_order_meta` and `woocommerce_before_save_order_items` both reach this function through `ai_apply_shipping_to_order_id()`, which has no state branch of its own — so clearing the district in wp-admin had the identical bug and is fixed identically.
  - Verified by running the real function against a stub order across seven cases: the reported state, several stale lines at once, a new order with no state, one district changed to another, a re-save unchanged, a new order with a district, and an unrecognized district taking the default. Every case ends with the right lines and **exactly one** `calculate_totals()` call, which is what makes the removed second call redundant rather than merely unnecessary.
  - **Orders already carrying a stale line do not fix themselves.** Each needs one save after this upload. How many exist on staging is not something this repo can answer — see the note under *Unverified / open* in `docs/PROJECT-STATE.md` for the query that would.

### App 0.5.0

- **Fixed: on a saved order, editing the district did not update the displayed shipping.** Selecting "No district" left the stored line showing, and changing one district for another showed the old rate, so the Order total was wrong until after a save. The 6.9 live-update covered unsaved orders only.
  - The form now records the district the order was **loaded** with. While the select still matches it, the server's stored line wins — a shipping amount adjusted in wp-admin has to survive being looked at. As soon as the select differs, the figure shown is what the save will actually produce: the table rate for the new district, or **nothing** if it was cleared.
  - This is a different question from `dirty.has('state')`, which stays set once the select has been touched even if it is put back. Changing the district and changing it back makes the stored line accurate again, so it comes back — asserted.
  - The explanatory line already claimed *"the district changed, so shipping is recalculated"* while showing the old figure. It is now true, and a cleared district says the line is **removed** rather than recalculated, which is what actually happens.
- **Fixed: the save bar painted over the form's content, reading as a second Save button.** `position: sticky; bottom: 0` keeps its space in the flow at its *original* position, so nothing below it moves and the pinned bar paints straight over whatever is behind it — on a form taller than the viewport, across the middle of the Items section, obscuring a line's price inputs.
  - Now `position: fixed` with the form reserving room below its content, which is the `.fab` / `.orders-main` pattern already used here. Exactly one bar, always in reach, never on top of anything.
  - The two `.form-main` padding rules were also consolidated into one. The later one silently overrode the earlier shorthand's `padding-bottom`, 300 lines apart.
- **New `app/test/save-bar.test.mjs`.** Asserts exactly one save button and one save bar in the DOM for both a new and a loaded order, and both halves of the layout rule — fixed positioning *and* the reserved space — since fixing either alone reintroduces the overlap. Confirmed to fail when the `sticky` rule is put back.

## 6.9

- **Added `shipping_rates` to `GET /meta`,** so the app can show the expected shipping on an order that has not been saved yet.
  - The bug it fixes: a new order with a district selected showed a dash for shipping and an **Order total short by 80–150 BDT**. That total is read out to a customer on the phone. The district fully determines the rate, so there was nothing uncertain to withhold.
  - Shape: `{default: {cost, label}, by_state: {"BD-13": {cost, label}, …}}`. Costs are raw numeric strings at 2dp through the existing `ai_rest_money()`, like every other money field in this API. `by_state` is an object, not a list, because the client looks a code up directly.
  - **Derived, never restated.** `ai_get_shipping_rate()` used to hide the table inside a `switch`. The table is now `ai_get_shipping_rates()`, returning it as data, and `ai_get_shipping_rate()` reads from that. Its contract is unchanged — same `int` costs, same labels, same Outside Dhaka default for an unmatched code — confirmed by running it against `BD-13`, `BD-18`, `BD-01`, `''` and a nonsense code.
  - One source of truth, in both directions: a rate edited in `includes/orders/shipping.php` reaches the app through `/meta` with **no app rebuild**. The plugin still has to be uploaded.
- **These rates are not WooCommerce shipping.** *WooCommerce → Settings → Shipping* is never consulted by this plugin — no zones, no methods, no instances. `ai_apply_shipping()` writes a `flat_rate` line from this table directly. Worth stating in the API because `/meta` otherwise contains only things read from WooCommerce at request time, and `shipping_rates` is the one exception.
- **An asymmetry now documented at both ends, because it is easy to get backwards.** `ai_get_shipping_rate('')` returns the Outside Dhaka default — but `ai_apply_shipping()` never asks it for an empty state. It returns early and adds **no shipping line at all**.
  - So `default` is the rate for a district that is **set but unrecognized**, not for an order without one.
  - A client that showed `150.00` for a blank district would overstate every unsaved order with no district picked — the same class of bug as the dash, in the other direction. The app shows nothing there, matching what a save actually does.
- Corrected a stale comment in `parse.php`. It claimed that endpoint's `shipping_preview` was "the correct preview" for an unresolved district. It is the default rate, which is not what a save would apply. The app now previews from the district its own dropdown is showing, so there is one answer on screen rather than two.

### App 0.4.0

- **The Totals block now shows the expected shipping before the first save**, read from `/meta`'s table by the district currently selected, and included in the Order total. It updates live as the district changes — whether the district was set by Reorder, by Parse, or by hand.
  - **Nothing is computed in the app.** The rate is looked up, not derived, and no rate literal appears in `app/src/`; a test asserts that, because a second copy would be a second source of truth and the one that disagreed with the plugin is the one staff would read out.
  - **A saved order still shows the server's actual shipping line**, even where that differs from the table — someone may have adjusted it in wp-admin. `state.shipping` now means *the server's line and only that*, which is what makes "has the server told us?" answerable; `applyServerOrder()` is the only writer.
  - **No district selected shows nothing, not the default rate.** That matches `ai_apply_shipping()`, which adds no line at all for an empty billing state.
  - `POST /parse`'s own `shipping_preview` is deliberately no longer used for display. For a district that resolved it is the same figure; for one that did not it is the default rate while the dropdown is still empty — two answers on screen, one of them wrong.
- **Fixed the note under the totals.** On a brand-new order it read "the district changed, so shipping recalculates" — nothing had changed, and there was no previous district to change from. The wording now follows the case actually showing: a changed district on a *saved* order, a flat rate applied on save, or no district selected and therefore no shipping.
- `/meta` is cached in `sessionStorage` under a versioned key, so a session that cached the payload before `shipping_rates` existed refetches instead of serving a preview-less copy to exactly the people who just upgraded. An older plugin that serves no table degrades to the dash rather than inventing a figure.
- Reorder still does not copy shipping, and that is now load-bearing rather than incidental: the rate follows from the district, so copying the source order's line would be wrong the moment a rate changed or the district was edited after the reorder.


## 6.8

- **Removed the `exclude` parameter from `GET /customers/last-order`.** It was added in 6.7 so the app could ask for "this customer's last order other than the one I'm editing" — and that is the wrong question. The answer to it is the **second-most-recent** order presented as if it were the last one: editing order 11354 showed 11323, which is not that customer's last order. Misleading rather than merely unhelpful.
  - The endpoint now answers exactly one question — *what is the most recent order for this phone number* — and never returns a substitute.
  - `ai_find_last_order_by_phone()` loses its `$exclude_order_id` argument with it, along with the limit-of-two and the defensive re-check that existed only to serve it. The AJAX caller never passed it.
  - **Whether the answer is worth displaying is the client's decision**, and the app now makes it: the card is hidden when the returned order's id equals the order being edited. Pushing that into the query is what turned it into "show the second-most-recent order".
  - This keeps the useful case working for free: change the phone on an existing order to another customer's number and their real last order appears, because its id is not this order's. That is the reassignment case, and it is the one time the card earns its space while editing.
  - No dead parameters are left in the API.

## 6.7

- **Added `GET /aioc/v1/customers/last-order`**, the repeat-customer lookup the legacy admin tool has always had. That one is bound to a session and a nonce, so the app could not use it.
  - `phone` is required and normalized through the existing `ai_normalize_bd_phone()`. Anything that is not a recognizable BD mobile is a 400 `aioc_invalid_phone`.
  - Optional `exclude` leaves one order out. The app needs it while editing an order — without it the lookup finds the order already open on screen.
  - **A customer with no previous order returns 200 with `{ "found": false }`, not a 404.** "This customer is new" is a normal answer to a reasonable question, not a failure, and the app shows nothing at all in that case — so an error status would make it handle a non-error as one.
  - A found order comes back through `ai_rest_prepare_order_detail()`, the **same** builder `GET /orders/{id}` uses. There is no second order shape in this API, and the client already knows how to read it — `line_items`, `shipping_lines`, `fee_lines` and all.
- **Extracted the shared lookup.** `ai_find_last_order_by_phone()` now lives in a new `includes/orders/lookup.php` and is called by both the AJAX handler and the REST route. `includes/ajax.php` keeps its own response formatting untouched — it feeds the old admin UI, which expects `wc_price()` HTML — but the lookup no longer exists twice.
  - **Trashed orders are excluded by passing no `status` at all.** WooCommerce treats an absent status as every valid status except those flagged `exclude_from_search`, which is exactly `trash` and `checkout-draft`. That is deliberately *not* the explicit `array_keys(wc_get_order_statuses())` list `GET /orders` passes: that list includes `wc-checkout-draft`, so using it here would start surfacing abandoned carts as somebody's last order.
  - The `exclude` id is both passed to the query and re-checked in PHP — the same defence in depth `ai_rest_price_match_product_ids()` applies to its price argument. If the query arg is ever ignored, the caller still never sees the order it asked to skip.
  - `includes/ajax.php` was **already** using `ai_normalize_bd_phone()` from the 5.2 refactor, so there was no inline normalization left to remove.
- App side: the order form looks up the previous order when the phone field holds a valid BD mobile — on blur, and debounced at 400ms while typing, with the in-flight request cancelled on each new one. It renders a collapsible card below the phone field, collapsed to a one-line summary by default so it cannot push the form off a phone screen, expanding to the order's items, shipping, fees and total. Tapping through to that order asks first if the current form has unsaved changes.

## 6.6

- **`GET /orders` now accepts `status=trash`**, so the app can offer a trash view. Both `trash` and `wc-trash` are accepted at the boundary and normalized to the bare `trash` for the query.
  - **HPOS stores it unprefixed.** `OrdersTableDataStore::trash_order()` writes `'status' => 'trash'`, while workflow statuses are stored prefixed (`wc-completed`). That asymmetry is load bearing: `OrdersTableQuery::sanitize_status()` only adds the `wc-` prefix when the prefixed form is a *registered* status and otherwise passes the value through verbatim — so `wc-trash` would have reached the SQL unchanged and matched no rows, returning an empty list rather than an error. Accepting both spellings and querying with the bare one is what avoids that silent failure.
  - **Default behaviour is unchanged.** With no `status` param the explicit registered list is still passed, and trashed orders stay out of the results.
  - **Trash is not a workflow status and is not treated as one.** It is WordPress's own post status, it never appears in `wc_get_order_statuses()` or in `GET /meta`, and it has no business in a filter dropdown next to Processing and Completed. A custom workflow status such as `wc-returned` does belong there.
- **Added `ai_rest_order_status_label()`.** `wc_get_order_status_name()` returns the bare slug `trash` for a trashed order — its internal "special statuses" map points `wc-trash` at the slug itself rather than at a translated label. The label now falls back to the registered **post** status label, so a trashed order's summary reports `Trash`. Nothing is hardcoded: the string comes from whoever registered the status, which is the rule the district and status lists already follow. A genuinely unlabelled status still degrades to its slug.

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
