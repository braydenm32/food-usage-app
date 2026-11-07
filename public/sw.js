// Larder service worker: offline shell + notifications (background reminders arrive here as pushes).
// Bump the version when the caching rules or shell change; old caches are deleted on activate.
const VERSION = 8;
const CACHE = `larder-v${VERSION}`;
// The account page's HTML is a client-rendered shell with nothing personal in it, so it can open
// offline (and show the sync status) like the rest.
const SHELL = ["/", "/pantry", "/add", "/recipes", "/list", "/settings", "/plan", "/insights", "/nutrition", "/kitchen", "/welcome", "/account"];
/** Pages never stored: invite links carry a token. */
const PRIVATE = /^\/join\//;
/**
 * Where a page is stored. Sign-in returns land on /account with a one-time code (or an error) in
 * the address, so that page is always stored under its bare path, never with the query.
 */
const cacheKey = (request, url) => (url.pathname === "/account" ? "/account" : request);

/** Only cache complete, same-origin successes (no errors, redirects or opaque responses). */
const cacheable = (res) => res && res.ok && res.type === "basic";

/** Script and style files a page loads, so a page never visited before still starts offline. */
function assetsIn(html) {
  const out = new Set();
  const re = /(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g;
  let m;
  while ((m = re.exec(html))) out.add(m[1]);
  return [...out];
}

async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set();
  await Promise.all(
    SHELL.map(async (path) => {
      try {
        const res = await fetch(path, { cache: "no-cache" });
        if (!cacheable(res)) return;
        await cache.put(path, res.clone());
        for (const a of assetsIn(await res.text())) assets.add(a);
      } catch {
        // Offline during install: the page is cached on its first visit instead.
      }
    }),
  );
  await Promise.all(
    [...assets].map((a) =>
      cache
        .match(a)
        .then((hit) => hit || fetch(a).then((res) => (cacheable(res) ? cache.put(a, res) : undefined)))
        .catch(() => {}),
    ),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network first for pages, cache first for static assets; API calls are never cached.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (cacheable(res)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  if (PRIVATE.test(url.pathname)) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (cacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(cacheKey(request, url), copy));
          }
          return res;
        })
        // Offline: the same page (ignoring ?cook=1 and the like), else its section, else Today.
        .catch(() =>
          caches.match(request, { ignoreSearch: true }).then(
            (hit) => hit || caches.match(`/${url.pathname.split("/")[1]}`).then((section) => section || caches.match("/")),
          ),
        ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Larder", {
      body: data.body || "Some food needs using soon.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
      // A new digest replaces the last one rather than piling up.
      tag: data.tag || "larder-digest",
    }),
  );
});

// Open the page the notification is about, reusing a Larder window when one is open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever open a page of Larder itself: anything else (another site, a bad URL) opens Today.
  const raw = (event.notification.data && event.notification.data.url) || "/";
  let target = new URL("/", self.location.origin).href;
  try {
    const url = new URL(String(raw), self.location.origin);
    if (url.origin === self.location.origin) target = url.href;
  } catch {
    // Keep "/".
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (wins) => {
      const same = wins.find((w) => w.url === target);
      if (same) return same.focus();
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin && "navigate" in w);
      if (win) {
        await win.focus();
        return win.navigate(target).catch(() => self.clients.openWindow(target));
      }
      return self.clients.openWindow(target);
    }),
  );
});

// The browser replaced this device's push subscription: an open window saves the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window" })
      .then((wins) => wins.forEach((w) => w.postMessage({ type: "larder-push-resubscribe" }))),
  );
});
