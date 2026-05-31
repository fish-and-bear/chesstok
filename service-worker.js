const CACHE_NAME = "move-rush-v24";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=24",
  "./app.js?v=24",
  "./puzzles.js?v=24",
  "./vendor/chess.mjs",
  "./manifest.webmanifest",
  "./pieces.svg?v=24",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];
const ASSET_URLS = new Set(ASSETS.map((asset) => new URL(asset, self.location).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      enableNavigationPreload(),
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    ]).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(event));
    return;
  }

  if (!ASSET_URLS.has(request.url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(assetResponse(event));
});

async function enableNavigationPreload() {
  try {
    await self.registration.navigationPreload?.enable?.();
  } catch {}
}

async function navigationResponse(event) {
  try {
    return (await event.preloadResponse) || (await fetch(event.request));
  } catch {
    return (await caches.match("./index.html")) || offlineResponse();
  }
}

async function assetResponse(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;

  try {
    const response = await fetch(event.request);
    if (response.ok && response.type === "basic") {
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone())));
    }
    return response;
  } catch {
    return offlineResponse();
  }
}

function offlineResponse() {
  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}
