"use client";

import { useEffect } from "react";

/**
 * Al llegar a /login (sesión cerrada o vencida) se borran las páginas autenticadas que el service
 * worker guardó para usar sin señal: en la tablet compartida nadie debe poder abrir copias del usuario
 * anterior. Los estáticos y la cola offline (IndexedDB) no se tocan: no se pierden registros pendientes.
 */
export function ClearPageCache() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    void (async () => {
      for (const name of await caches.keys()) {
        if (!name.startsWith("chipa-") || !name.endsWith("-pages")) continue;
        const cache = await caches.open(name);
        // Se conserva la página pública "Sin conexión" (fallback del service worker).
        for (const req of await cache.keys())
          if (new URL(req.url).pathname !== "/offline") await cache.delete(req);
      }
    })().catch(() => {});
  }, []);
  return null;
}
