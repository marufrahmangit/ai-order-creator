        (function () {
            var BANGLA = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
            var ajaxUrl = AIOC.ajaxUrl;
            var nonce   = AIOC.nonce;

            function normalizeBangla(text) {
                return text.replace(/[০-৯]/g, function(ch) { return BANGLA[ch] || ch; });
            }

            function extractPhone(text) {
                text = normalizeBangla(text);
                var m = text.match(/(?:\+?88[\s\-]*)?(?:0?[\s\-]*1[\s\-]*[3-9](?:[\s\-]*\d){8})\b/);
                if (!m) return '';
                var d = m[0].replace(/\D+/g, '');
                if (d.indexOf('8801') === 0) d = '0' + d.slice(3);
                else if (d.indexOf('801') === 0) d = '0' + d.slice(2);
                else if (d.length === 10 && d.indexOf('1') === 0) d = '0' + d;
                return /^01[3-9]\d{8}$/.test(d) ? d : '';
            }

            function renderCard(data) {
                var card = document.getElementById('ai-last-order-card');
                if (!data.found) {
                    card.innerHTML = '<div style="background:#fff8e1;border:1px solid #ffc107;padding:12px 16px;border-radius:4px;margin:10px 0;"><span style="color:#666;">No previous orders found for this number.</span></div>';
                    return;
                }
                var d = data;
                var rows = [
                    ['Customer', esc(d.billing_name)],
                    ['Date', esc(d.date)],
                    ['Status', esc(d.status)],
                    ['Address', esc(d.billing_address)],
                    ['Total', esc(d.total)],
                    d.ai_price ? ['Price Note', esc(d.ai_price)] : null,
                ].filter(Boolean);

                var tableRows = rows.map(function(r) {
                    return '<tr><td style="padding:4px 10px;width:110px;color:#555;white-space:nowrap;"><strong>' + r[0] + '</strong></td><td style="padding:4px 10px;">' + r[1] + '</td></tr>';
                }).join('');

                var itemsHtml = '';
                if (d.items && d.items.length) {
                    var BADGE = {
                        shipping: '<span style="font-size:10px;background:#e0f0e0;color:#3a7d3a;border-radius:2px;padding:1px 5px;margin-left:5px;font-style:normal;">delivery</span>',
                        fee:      '<span style="font-size:10px;background:#f0e8d0;color:#7d5a1e;border-radius:2px;padding:1px 5px;margin-left:5px;font-style:normal;">fee</span>',
                    };
                    itemsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;">'
                        + '<thead><tr>'
                        + '<th style="text-align:left;padding:4px 10px;border-bottom:1px solid #cce0f5;color:#555;">Item</th>'
                        + '<th style="text-align:center;padding:4px 10px;border-bottom:1px solid #cce0f5;color:#555;">Qty</th>'
                        + '<th style="text-align:right;padding:4px 10px;border-bottom:1px solid #cce0f5;color:#555;">Total</th>'
                        + '</tr></thead><tbody>'
                        + d.items.map(function(it) {
                            var type = it.type || 'product';
                            var isExtra = type !== 'product';
                            var rowStyle = isExtra ? 'background:#f5f9ff;' : '';
                            var badge = BADGE[type] || '';
                            return '<tr style="' + rowStyle + '">'
                                + '<td style="padding:4px 10px;">' + esc(it.name) + badge + '</td>'
                                + '<td style="padding:4px 10px;text-align:center;color:#888;">' + (it.qty ? esc(String(it.qty)) : '') + '</td>'
                                + '<td style="padding:4px 10px;text-align:right;">' + esc(it.total) + '</td>'
                                + '</tr>';
                          }).join('')
                        + '</tbody></table>';
                }

                card.innerHTML = '<div style="background:#f0f7ff;border:1px solid #0073aa;padding:14px 16px;border-radius:4px;margin:10px 0;font-size:13px;">'
                    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
                    + '<h4 style="margin:0;color:#0073aa;font-size:14px;">Last Order for ' + esc(data.phone || '') + '</h4>'
                    + '<a href="' + d.edit_url + '" target="_blank" style="text-decoration:none;background:#0073aa;color:#fff;padding:5px 12px;border-radius:3px;font-size:12px;white-space:nowrap;">&#8599; View Order #' + d.order_id + '</a>'
                    + '</div>'
                    + '<table style="width:100%;border-collapse:collapse;">' + tableRows + '</table>'
                    + itemsHtml
                    + '</div>';
            }

            function esc(str) {
                return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            }

            function lookupPhone(phone) {
                var card = document.getElementById('ai-last-order-card');
                card.innerHTML = '<div style="color:#888;font-style:italic;padding:8px 0;font-size:13px;">Looking up customer history for ' + esc(phone) + '&hellip;</div>';
                var body = new FormData();
                body.append('action', 'ai_lookup_last_order');
                body.append('nonce', nonce);
                body.append('phone', phone);
                fetch(ajaxUrl, { method: 'POST', body: body, credentials: 'same-origin' })
                    .then(function(r) { return r.json(); })
                    .then(function(resp) {
                        if (!resp.success) {
                            document.getElementById('ai-last-order-card').innerHTML = '';
                            return;
                        }
                        resp.data.phone = phone;
                        renderCard(resp.data);
                    })
                    .catch(function() {
                        document.getElementById('ai-last-order-card').innerHTML = '';
                    });
            }

            var textarea = document.querySelector('textarea[name="order_text"]');
            if (textarea) {
                var lastPhone = '';
                var timer = null;
                textarea.addEventListener('input', function () {
                    clearTimeout(timer);
                    timer = setTimeout(function () {
                        var phone = extractPhone(textarea.value);
                        if (phone && phone !== lastPhone) {
                            lastPhone = phone;
                            lookupPhone(phone);
                        } else if (!phone && lastPhone !== '') {
                            lastPhone = '';
                            document.getElementById('ai-last-order-card').innerHTML = '';
                        }
                    }, 450);
                });
            }
        })();
