// Ban web: lay moi tu mang truoc, mat mang thi dung ban da luu. Goi Gemini khong bao gio luu.
const CACHE = "thay-ai-web-v2";
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(
  ["./", "index.html", "may_chu_ao.js", "curriculum.json", "manifest.json", "static/icon-192.png", "static/icon-512.png",
   "static/logo.png"]))
  .then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(
  ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
    return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./"))));
});
