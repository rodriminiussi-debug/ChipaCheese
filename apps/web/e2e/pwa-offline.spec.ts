import { test, expect, asRole, demoDay } from "./fixtures";

/**
 * Service worker (public/sw.js): las pantallas de campo ya visitadas se abren sin señal y nunca se cachean
 * Server Actions ni /api. El service worker solo se registra en producción, así que este spec corre únicamente
 * con `pnpm build && E2E_PROD=1 pnpm test:e2e e2e/pwa-offline.spec.ts` (en el E2E normal, con `next dev`, se omite).
 */
test.skip(!process.env.E2E_PROD, "requiere el build de producción (E2E_PROD=1)");
// playwright.config bloquea el service worker para el resto de los specs; acá es lo que se prueba.
test.use({ storageState: asRole("admin"), serviceWorkers: "allow" });

test("las pantallas de planta, pedido nuevo y ruta del chofer se abren sin señal si ya se visitaron", async ({
  page,
  context,
  sql,
}) => {
  const [route] = await sql`insert into routes (date, vehicle_id)
    values (${demoDay()}, (select id from vehicles limit 1)) returning id`;
  const screens: [string, RegExp][] = [
    ["/planta/temperaturas", /Temperaturas/],
    ["/planta/produccion", /Producción/],
    ["/pedidos/nuevo", /Nuevo pedido/],
    [`/despacho/rutas/${route!.id}`, /Ruta del/],
  ];

  await page.goto("/pedidos/nuevo");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // a partir de acá la página la controla el service worker
  for (const [url] of screens) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  }

  // Nada de /api ni de Server Actions en la caché.
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys())
      for (const r of await (await caches.open(k)).keys()) out.push(`${r.method} ${new URL(r.url).pathname}`);
    return out;
  });
  expect(cached.filter((c) => c.includes("/api/"))).toEqual([]);
  expect(cached.every((c) => c.startsWith("GET "))).toBe(true);

  await context.setOffline(true);
  for (const [url, title] of screens) {
    await page.goto(url);
    await expect(page.locator("h1").first()).toHaveText(title);
  }
  // Una pantalla que nunca se visitó cae a la página "Sin conexión".
  await page.goto("/clientes");
  await expect(page).toHaveTitle(/Sin conexión/);
});

test("al cerrar sesión se borran las pantallas guardadas (tablet compartida)", async ({ page, context }) => {
  await page.goto("/planta/temperaturas");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.goto("/planta/temperaturas");
  await page.waitForLoadState("networkidle");
  const pagesCached = () =>
    page.evaluate(async () => {
      let n = 0;
      for (const k of await caches.keys())
        if (k.endsWith("-pages"))
          n += (await (await caches.open(k)).keys()).filter(
            (r) => new URL(r.url).pathname !== "/offline",
          ).length;
      return n;
    });
  expect(await pagesCached()).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(pagesCached).toBe(0);

  await context.setOffline(true);
  await page.goto("/planta/temperaturas");
  await expect(page).toHaveTitle(/Sin conexión/);
});
