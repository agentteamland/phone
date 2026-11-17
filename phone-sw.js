// The phone client's service worker (#2102). A push says only that ATL is waiting,
// in the interface language; its payload, which passes through the phone maker's push
// service, carries only the time the server sent it. Each arrival is kept with that
// time, to measure how late pushes are (the last 500).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// GitHub Pages lets a phone keep the page for ten minutes, and the page names the
// release's files, so a release showed up to ten minutes late. Opening the app asks
// the server whether the page changed (a cheap 304 when it did not).
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request, { cache: "no-cache" }));
});

function record(sent) {
  return new Promise((resolve) => {
    const open = indexedDB.open("atl-push", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("arrivals", { autoIncrement: true });
    open.onerror = () => resolve();
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("arrivals", "readwrite");
      const store = tx.objectStore("arrivals");
      store.add({ sent, arrived: Date.now() });
      const count = store.count();
      count.onsuccess = () => {
        if (count.result > 500) {
          const first = store.openCursor();
          first.onsuccess = () => first.result && first.result.delete();
        }
      };
      tx.oncomplete = () => (db.close(), resolve());
      tx.onerror = () => (db.close(), resolve());
    };
  });
}

// The text in the interface language the page left in Cache Storage (phone.ts
// shareLanguage), else the phone's own languages, as lang.ts resolves "auto".
const WAITING = { en: "ATL is waiting", tr: "ATL bekliyor" };

async function language() {
  try {
    const r = await caches.match("/language", { cacheName: "atl-language" });
    const l = r && (await r.text());
    if (l === "en" || l === "tr") return l;
  } catch {
    /* no stored language: fall back to the phone's */
  }
  for (const p of self.navigator.languages || []) {
    const base = p.toLowerCase().split(/[-_]/)[0];
    if (base === "en" || base === "tr") return base;
  }
  return "en";
}

self.addEventListener("push", (e) => {
  let sent = 0;
  try {
    sent = e.data ? e.data.json().sent || 0 : 0;
  } catch {
    /* an unreadable payload still notifies */
  }
  e.waitUntil(
    Promise.all([record(sent), language()]).then(([, l]) =>
      self.registration.showNotification(WAITING[l], { tag: "atl", renotify: true, icon: "/phone-icon-192.png", badge: "/phone-badge-96.png" }),
    ),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    }),
  );
});
