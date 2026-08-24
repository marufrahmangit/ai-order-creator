# AI Order Creator

A WordPress/WooCommerce plugin that creates WooCommerce orders from messy, unstructured customer text (English, Bangla, or mixed) using a deterministic parser backed by the Groq AI API as a fallback.

Built for Bangladesh-based order intake, where customer details typically arrive via chat as free-form text like:

```
Md. Karim, 01712345678, House 10, Road 5, Dhanmondi, Dhaka
নাম: রহিম, ফোন: ০১৮১২৩৪৫৬৭৮, ঠিকানা: মিরপুর-১০, ঢাকা
Fatima 01912345678 Gulshan-2 Dhaka
```

## How It Works

1. **Deterministic parse first** — regex/heuristics extract name, phone, address, and district/state directly from the text (labeled fields, phone patterns, Bangla digit conversion, known BD locations, etc.), with no API call needed for well-formatted input.
2. **AI fallback** — if any required field (name, phone, address, state) is still missing, the text is sent to Groq (`llama-3.3-70b-versatile`) with the deterministic hints, and the AI's JSON response is merged in to fill the gaps.
3. **Order creation** — a WooCommerce order is created (`pending` status) with billing/shipping name, phone, address, and matched state; any customer note is attached as an order note for manual review. Pricing/line items are not extracted — add products manually.
4. **Preview mode** — parsed fields can be previewed before an order is actually created.
5. **Last-order lookup** — the admin screen can look up a customer's most recent order by phone number via AJAX, to catch duplicates/repeat customers.

## Requirements

- WordPress with WooCommerce active (order creation, state matching, and admin menu hook into `woocommerce`)
- A free [Groq API key](https://console.groq.com/keys) (used only when deterministic parsing can't fill all required fields)

## Setup

1. Install/activate the plugin in WordPress.
2. Go to **WooCommerce → AI Order Creator → Settings**.
3. Paste your Groq API key and save. Optionally enable **Debug Mode** to see detailed parse output on screen (all errors are always logged to `wp-content/debug.log`).
4. Use **Test Groq API Connection** to verify the key works.

## Usage

1. Go to **WooCommerce → AI Order Creator**.
2. Paste the raw customer message into the text box.
3. Click **Preview Parsed Data** to check the detected name, phone, address, and state before committing.
4. Click **Create Order with AI** to create the WooCommerce order.
5. Review the created order and add line items/products manually (this plugin does not extract product line items, only customer/order metadata).

## Project Structure

```
ai-order-creator.php          Plugin bootstrap, file includes
admin/
  menu.php                    Admin menu registration, settings, script enqueue
  views/
    creator-tab.php           "Create Order" tab UI
    settings-tab.php          "Settings" tab UI (API key, debug mode, troubleshooting)
    parse-preview.php         Renders the parsed-data preview table
  assets/js/last-order-lookup.js   AJAX lookup of a customer's last order by phone
includes/
  parser.php                  Orchestrates deterministic parse + AI fallback + merging
  groq-client.php              Groq API request/response handling
  order-creator.php           Builds the WooCommerce order from parsed data
  ajax.php                    wp_ajax handler for last-order-by-phone lookup
  name.php / phone.php / address.php / location.php / text-utils.php
                               Field-specific extraction/normalization helpers
  logging.php                 Wrapper around error_log() for debug output
data/
  bd-locations.php            Bangladesh district/state reference data used for matching
```

## Key Implementation Notes

- **Phone numbers**: normalized to Bangla-to-English digits and matched against the `01[3-9]XXXXXXXX` (11-digit) BD mobile format.
- **State/district matching**: extracted district names are matched against WooCommerce's BD state list (`ai_match_state_code`) so `set_billing_state`/`set_shipping_state` receive a valid code; unmatched districts are logged as warnings but don't block order creation.
- **Price**: not extracted or stored — the plugin never receives pricing in the input text, so no price detection is attempted; line items/pricing are added manually after order creation.
- **Security**: nonces are used for order creation and the AJAX lookup; the lookup handler checks `manage_woocommerce` capability.
- **AI is a fallback, not the primary path**: Groq is only called when the deterministic parser can't fill name, phone, address, or state — keeping typical well-formatted messages fast and API-call-free.

## Changelog

- **4.1** — Removed price detection entirely (deterministic parsing, AI prompt, order meta/notes, and preview UI). It was never provided in the input and its regex heuristics were misreading hyphen-attached address numbers (e.g. house/plot numbers like "-১০৭৯") as prices, corrupting the address in the process.
- **4.0** — Fixed address parsing: leftover label junk (e.g. "নাম্বারঃ", "থানাঃ") no longer leaks into the address, numbered list markers ("1.", "2.") are no longer captured as field values, and multi-line address labels (e.g. "ঠিকানা") now capture all continuation lines.
- **3.9** — Split single-file plugin into a multi-file structure (mechanical refactor, no logic changes).
