/* BUILD_CONFIG */

const PREFIX = "handy-shell-";
const CACHE = PREFIX + BUILD.version;
const assets = new Set(BUILD.assets);
const appRoute = pathname => pathname === "/" || /^\/(admin|book|profile)(\/|$)/.test(pathname);
const legal = { "/privacy": "/privacy.html", "/terms": "/terms.html" };

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(BUILD.assets.map(url => new Request(url, { cache: "reload" })))));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && (key.startsWith(PREFIX) || ["omnificology-app-v1", "omnificology-runtime-v1"].includes(key))) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  if (/^\/(api|oauth|__)(\/|$)/.test(url.pathname)) return;
  const cachedPath = legal[url.pathname] || url.pathname;
  if (event.request.mode === "navigate" && appRoute(url.pathname)) {
    // Serve the shell and chunks from the same build, even during deployment.
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match("/index.html") || fetch(event.request)));
  } else if (assets.has(cachedPath)) {
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match(cachedPath) || fetch(event.request)));
  }
});

self.addEventListener("message", event => {
  if (event.data?.type === "HANDY_UPDATE_NOW") self.skipWaiting();
});

function notificationTarget(value) {
  try {
    const url = new URL(value || "/", self.location.origin);
    if (url.origin === self.location.origin && appRoute(url.pathname)) return url.href;
  } catch { /* Use home. */ }
  return new URL("/", self.location.origin).href;
}

self.addEventListener("push", event => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (!data || typeof data.title !== "string" || !data.title.trim()) return;
  event.waitUntil(self.registration.showNotification(data.title.slice(0, 100), {
    body: typeof data.body === "string" ? data.body.slice(0, 180) : "",
    icon: "/icons/android-icon-192x192.png",
    tag: typeof data.tag === "string" ? data.tag.slice(0, 100) : undefined,
    data: { url: notificationTarget(data.url) },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url === target);
    return existing ? existing.focus() : self.clients.openWindow(target);
  })());
});
