// Sparks service worker: offline shell + push notifications.
const CACHE = "sparks-__BUILD__";
const SHELL = ["./", "./index.html", "./config.js", "./adapter.js", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first for our own files, cache as a fallback when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      const c = await caches.open(CACHE); c.put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request)) || (await caches.match("./index.html")) || Response.error();
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Sparks", {
    body: d.body || "Someone is thinking of you",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || "sparks",
    renotify: true,
    vibrate: [60, 40, 120],
    data: { url: self.registration.scope }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if ("focus" in c) return c.focus();
    return self.clients.openWindow(e.notification.data && e.notification.data.url || "./");
  })());
});
