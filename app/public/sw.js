/*
 * Service worker: app shell only.
 *
 * ================================================================
 * THIS WORKER NEVER CACHES AN API RESPONSE. NOT ONCE, NOT BRIEFLY.
 * ================================================================
 *
 * The entire job of this app is reading and writing live order data. A cached
 * order list is not a stale convenience, it is a staff member looking at
 * orders that have already been dealt with, or saving against state that moved
 * underneath them. There is no stale-while-revalidate here, no fallback to a
 * previous response, and no offline queue: a save that cannot reach the server
 * must FAIL VISIBLY so the person retries. Queueing writes invisibly is how a
 * customer ends up with two identical orders.
 *
 * So: the shell is cached, everything else goes to the network untouched.
 *
 * Shipped from app/public/, which Vite copies verbatim - it is a classic
 * worker, not a module, and cannot import anything from app/src/.
 */

/**
 * BUMP THIS WHENEVER THE SHELL CHANGES.
 *
 * It names the cache, and changing it is also what makes this file's bytes
 * differ, which is the only thing that makes a browser notice a new worker. If
 * the shell is rebuilt and this stays the same, installed clients keep serving
 * the OLD index.html and therefore the old hashed bundle, indefinitely. There
 * is no automatic invalidation to fall back on.
 */
const SHELL_VERSION = 'v8';

const SHELL_CACHE = `orderops-shell-${SHELL_VERSION}`;

/**
 * Precached on install. Hashed bundle filenames are deliberately absent - they
 * change every build and this file cannot know them, so they are cached at
 * runtime instead. That is safe precisely because they are content-hashed: a
 * new build produces new URLs rather than new contents at the same URL.
 */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
];

/** Same-origin prefixes that are part of the shell and may be cached. */
const ASSET_PREFIXES = ['/assets/', '/icons/'];

/**
 * How a request should be handled. Pure, and exported-ish for testing: the
 * routing decision is the one piece of this worker whose failure would be
 * silent and serious, so it is a named function rather than inline branches.
 *
 * @param {string} method    Request method.
 * @param {string} url       Absolute request URL.
 * @param {string} swOrigin  The worker's own origin.
 * @param {boolean} isNavigation  Whether this is a navigation request.
 * @returns {'network'|'shell'|'asset'} 'network' means do not intercept at all.
 */
function routeFor(method, url, swOrigin, isNavigation) {
  // Writes are never touched. Not cached, not retried, not queued.
  if (method !== 'GET') return 'network';

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'network';
  }

  // The API lives on another origin (the WordPress host), and cross-origin
  // requests still pass through this handler - so they have to be excluded
  // explicitly, not assumed away.
  if (parsed.origin !== swOrigin) return 'network';

  // And belt-and-braces for the same-origin case, should the app ever be
  // served from the WordPress domain: nothing under /wp-json/ is ever cached
  // or served from cache. See the banner at the top of this file.
  if (parsed.pathname.startsWith('/wp-json/')) return 'network';

  if (isNavigation) return 'shell';

  if (parsed.pathname === '/manifest.webmanifest') return 'asset';
  if (ASSET_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) return 'asset';

  return 'network';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  // Deliberately NO skipWaiting(): the new worker waits, main.js notices and
  // offers an update. Activating straight away would reload the page under
  // someone with a half-filled order form.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('orderops-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** main.js posts this when the user accepts an update. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No connection</title>
<style>
  body { margin:0; font: 16px/1.5 system-ui, sans-serif; background:#f5f6f8; color:#111827;
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  div { max-width: 22rem; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color:#6b7280; margin: 0; }
</style></head>
<body><div>
  <h1>No connection</h1>
  <p>Order Ops needs the network to read or save orders. Reconnect and try again.</p>
</div></body></html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const route = routeFor(
    event.request.method,
    event.request.url,
    self.location.origin,
    event.request.mode === 'navigate',
  );

  // Not ours: do not call respondWith at all, so the browser handles it
  // exactly as it would with no worker installed.
  if (route === 'network') return;

  if (route === 'shell') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        // Cache-first, so a cold launch paints without waiting on the network.
        // The cost is that a shell change needs SHELL_VERSION bumped.
        const cached = await cache.match('/index.html');
        if (cached) return cached;

        try {
          return await fetch(event.request);
        } catch {
          // First-ever visit while offline: nothing is cached yet, so say so
          // rather than letting the browser show its own error page.
          return offlineResponse();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      // Only cache a real success. An opaque or error response cached here
      // would be served for as long as this cache version lives.
      if (response && response.ok && response.type === 'basic') {
        cache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});
