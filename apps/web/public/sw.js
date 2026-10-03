/* Service worker de Chipa Cheese: app instalable + funcionamiento sin señal.
 * - Estáticos de Next (/_next/static): cache-first (son inmutables).
 * - Navegaciones a las pantallas de carga en campo (planta, /pedidos/nuevo, vista de la ruta del chofer,
 *   conteo de inventario): network-first con caché. Si ya se visitaron se pueden abrir sin señal; con una
 *   señal pésima se usa la copia guardada pasados unos segundos y la red actualiza la caché de fondo.
 * - Otras navegaciones: red; sin red → /offline.
 * - NUNCA cachea Server Actions (POST / cabecera Next-Action), pedidos RSC, /api ni nada que no sea GET.
 *   Las escrituras sin señal las maneja la cola de IndexedDB (src/lib/offline-queue.ts).
 */
const VERSION = "chipa-v2";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";
/** Con copia guardada, esperar tanto a la red antes de abrir la copia. */
const NETWORK_TIMEOUT_MS = 4000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Pantallas que se cargan en planta y en la calle: se guardan al visitarlas. */
const CACHEABLE_PAGES = [
  /^\/planta(\/|$)/,
  /^\/pedidos\/nuevo\/?$/,
  new RegExp(`^/despacho/rutas/${UUID}/?$`),
  new RegExp(`^/stock/inventario/${UUID}/?$`),
];
const isCacheablePage = (pathname) => CACHEABLE_PAGES.some((re) => re.test(pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Solo respuestas completas de la propia pantalla: no redirecciones (p. ej. al login) ni errores. */
const storable = (res) => res.ok && !res.redirected && res.type === "basic";

function pageNetworkFirst(request) {
  return caches.open(PAGES).then((cache) =>
    cache.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (storable(res)) cache.put(request, res.clone());
        return res;
      });
      if (!hit) return network.catch(() => caches.match(OFFLINE_URL));
      const timeout = new Promise((resolve) => setTimeout(() => resolve(hit), NETWORK_TIMEOUT_MS));
      return Promise.race([network, timeout]).catch(() => hit);
    }),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Server Actions y pedidos de datos RSC de Next: siempre a la red, jamás a la caché.
  if (request.headers.has("next-action") || request.headers.has("rsc")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    if (isCacheablePage(url.pathname)) {
      event.respondWith(pageNetworkFirst(request));
      return;
    }
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
