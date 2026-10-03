import postgres from "postgres";
import { TEST_DATABASE_URL } from "../playwright.config";
import { test, expect, asRole, expectToast } from "./fixtures";

/**
 * M5 Despacho y reparto (RF-24 a RF-28). Comparte la base con el resto de los E2E: todo lo que crea
 * (pedidos, rutas, remitos, movimientos de stock) se limpia en afterAll para no alterar el saldo demo.
 */
test.describe.configure({ mode: "serial" });

const DAY = "2026-10-02"; // viernes
const TAP = "Chipá tapitas 0,5 kg";
let startedAt: Date;
const admin = () => postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });

test.beforeAll(async () => {
  const sql = admin();
  [{ now: startedAt }] = (await sql`select now() as now`) as unknown as [{ now: Date }];
  await sql`update customers set address = 'Av. Pellegrini 1234' where legal_name = 'Supermercado Arcoiris'`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = admin();
  try {
    await sql`delete from stock_movements where created_at >= ${startedAt}`;
    await sql`delete from dispatch_items where dispatch_id in (select id from dispatches where created_at >= ${startedAt})`;
    await sql`delete from dispatches where created_at >= ${startedAt}`;
    await sql`delete from route_stops where route_id in (select id from routes where created_at >= ${startedAt})`;
    await sql`delete from routes where created_at >= ${startedAt}`;
    await sql`delete from temperature_logs where created_at >= ${startedAt}`;
    await sql`delete from orders where created_at >= ${startedAt}`;
    await sql`update customers set address = null where legal_name = 'Supermercado Arcoiris'`;
  } finally {
    await sql.end();
  }
});

type Sql = postgres.Sql;
/** Pedido de prueba (status dado) con una línea de producto; devuelve id y número. */
async function makeOrder(
  sql: Sql,
  customer: string,
  status: string,
  product: string,
  units: number,
  promised = DAY,
) {
  const [o] = await sql`
    insert into orders (customer_id, promised_date, status, total)
    values ((select id from customers where legal_name = ${customer}), ${promised}, ${status}, ${units * 1000})
    returning id, number`;
  await sql`insert into order_items (order_id, product_id, qty_units, unit_price)
    values (${o!.id}, (select id from products where name = ${product}), ${units}, 1000)`;
  return { id: o!.id as string, number: o!.number as number };
}
const lotStock = async (sql: Sql, lot: string, product: string) => {
  const [r] = await sql`
    select coalesce(sum(ps.qty), 0)::float8 as qty from v_product_stock ps
    join finished_lots l on l.id = ps.finished_lot_id
    join products p on p.id = ps.product_id
    where l.code = ${lot} and p.name = ${product}`;
  return r!.qty as number;
};

test.describe("Despacho y reparto (logística)", () => {
  test.use({ storageState: asRole("logistics") });

  test("arma la ruta del día, genera el remito con lotes FEFO, entrega, cierra con km y temperatura, y ve costo/kg y el registro BPM", async ({
    page,
    sql,
    request,
  }) => {
    const a = await makeOrder(sql, "Supermercado Arcoiris", "ready", TAP, 80); // 40 kg: 60 + 20 por FEFO
    const b = await makeOrder(sql, "Club Náutico", "in_production", "Chipá lengüitas 0,5 kg", 4);
    const f = await makeOrder(sql, "La Esperanza", "ready", TAP, 6); // Funes: reparte los martes

    // --- RF-24: propuesta por zona --------------------------------------------------------------
    await page.goto(`/despacho/nueva?fecha=${DAY}`);
    await expect(page.getByRole("heading", { name: "Nueva ruta" })).toBeVisible();
    const rosario = page.getByTestId("zone-group").filter({ hasText: "Rosario" });
    await expect(rosario).toContainText("Lun · Mié · Vie");
    await expect(rosario.getByText("no tiene reparto")).toHaveCount(0);
    await expect(rosario.getByRole("checkbox", { name: /Supermercado Arcoiris/ })).toBeChecked();
    // El pedido en producción se propone pero marcado "no listo" y sin tildar.
    await expect(rosario.getByRole("checkbox", { name: /Club Náutico/ })).not.toBeChecked();
    await expect(rosario.getByTestId("proposal-order").filter({ hasText: "Club Náutico" })).toContainText(
      "No listo",
    );
    // Funes no reparte los viernes: aviso y sin tildar.
    const funes = page.getByTestId("zone-group").filter({ hasText: "Funes" });
    await expect(funes).toContainText("Reparte: Mar");
    await expect(funes.getByText("Funes no tiene reparto los viernes")).toBeVisible();
    await expect(funes.getByRole("checkbox", { name: /La Esperanza/ })).not.toBeChecked();
    await expect(page.getByTestId("route-totals")).toContainText("1 entrega");
    await expect(page.getByTestId("route-totals")).toContainText("40 kg");

    // Retiro en un proveedor, agregado a mano con nota.
    await page.getByRole("combobox", { name: "Proveedor" }).click();
    await page.getByRole("option", { name: "Leo Pelle" }).click();
    await page.getByLabel("Nota del retiro").fill("Retirar 25 kg de fécula");
    await page.getByRole("button", { name: "Agregar retiro" }).click();
    await expect(page.getByTestId("route-totals")).toContainText("+ 1 retiro");
    await page.getByRole("button", { name: "Crear ruta" }).click();
    await expectToast(page, "Ruta creada");
    await expect(page).toHaveURL(/\/despacho\/rutas\/[0-9a-f-]{36}$/);
    const routeId = page.url().split("/").pop()!;

    // --- Vista de la ruta: paradas, Maps, Cobros y orden ---------------------------------------
    await expect(page.getByRole("heading", { name: /Ruta del Vie 02\/10\/2026/ })).toBeVisible();
    await expect(page.getByTestId("route-summary")).toContainText("1 entrega · 1 retiro en proveedores");
    await expect(page.getByTestId("route-summary")).toContainText("40 kg");
    await expect(page.getByTestId("route-summary")).toContainText("80 bultos");
    const stops = page.getByTestId("stop-card");
    await expect(stops).toHaveCount(2);
    await expect(stops.nth(0)).toContainText("Supermercado Arcoiris");
    await expect(stops.nth(1)).toContainText("Leo Pelle");
    const maps = stops.nth(0).getByRole("link", { name: /Av\. Pellegrini 1234/ });
    expect(await maps.getAttribute("href")).toMatch(
      /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=.*Pellegrini/,
    );
    await expect(page.getByRole("link", { name: "Cobros" })).toHaveAttribute(
      "href",
      `/cobranzas/ruta/${routeId}`,
    );
    // Subir y bajar paradas.
    await stops.nth(0).getByRole("button", { name: "Bajar parada 1" }).click();
    await expect(stops.nth(0)).toContainText("Leo Pelle");
    await expect(stops.nth(1)).toContainText("Supermercado Arcoiris");
    await stops.nth(1).getByRole("button", { name: "Subir parada 2" }).click();
    await expect(stops.nth(0)).toContainText("Supermercado Arcoiris");

    // Hoja de ruta imprimible.
    await page.getByRole("link", { name: "Hoja de ruta" }).click();
    await expect(page.getByRole("heading", { name: "Hoja de ruta" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Supermercado Arcoiris/ })).toContainText("40 kg");
    await expect(page.getByRole("button", { name: "Imprimir hoja de ruta" })).toBeVisible();
    await page.goBack();

    // --- RF-26: iniciar la salida ---------------------------------------------------------------
    await page.getByLabel("Km inicial (tablero)").fill("12000");
    await page.getByRole("button", { name: "Iniciar ruta" }).click();
    await expectToast(page, "Ruta iniciada");
    await expect(page.getByText(/En curso — salió \d\d:\d\d con 12000 km/)).toBeVisible();
    await sql`update routes set started_at = now() - interval '3 hours 29 minutes 55 seconds' where id = ${routeId}`;

    // --- RF-25: remito con lotes FEFO -----------------------------------------------------------
    expect([await lotStock(sql, "260901-1", TAP), await lotStock(sql, "261001-1", TAP)]).toEqual([60, 100]);
    await page.getByRole("button", { name: "Generar remito", exact: true }).first().click();
    await expectToast(page, /Remito N° \d{8} generado/);
    const dispatchBlock = page.getByTestId("stop-dispatch");
    await expect(dispatchBlock).toContainText(`60 × ${TAP} — lote 260901-1 (vence 01/03/2027)`);
    await expect(dispatchBlock).toContainText(`20 × ${TAP} — lote 261001-1 (vence 01/04/2027)`);
    // El lote que vence primero se vació y el pedido quedó despachado.
    expect([await lotStock(sql, "260901-1", TAP), await lotStock(sql, "261001-1", TAP)]).toEqual([0, 80]);
    const [order] = await sql`select status from orders where id = ${a.id}`;
    expect(order!.status).toBe("dispatched");
    const moves = await sql`select type, qty::float8 as qty from stock_movements
      where ref_table = 'dispatches' order by qty`;
    expect(moves).toEqual([
      { type: "dispatch", qty: -60 },
      { type: "dispatch", qty: -20 },
    ]);

    // Remito imprimible: número, cliente, CUIT, dirección, lotes y vencimientos, firma.
    await page.getByRole("link", { name: "Ver remito" }).click();
    await expect(page.getByTestId("remito-number")).toHaveText(/Remito N° \d{8}/);
    const remito = page.getByTestId("remito");
    await expect(remito).toContainText("Supermercado Arcoiris");
    await expect(remito).toContainText("Av. Pellegrini 1234");
    await expect(remito).toContainText("260901-1");
    await expect(remito).toContainText("01/03/2027");
    await expect(remito).toContainText("261001-1");
    await expect(remito).toContainText("Firma de conformidad");
    await expect(remito).toContainText("Utilitario con equipo de frío (AA000AA)");
    await page.goBack();

    // --- RF-25: entrega con nombre y firma dibujada ---------------------------------------------
    await page.getByRole("button", { name: "Entregar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirmar entrega" })).toBeDisabled();
    await dialog.getByLabel("Recibió (nombre y apellido)").fill("María Gómez");
    const canvas = dialog.getByTestId("signature-canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100, { steps: 5 });
    await page.mouse.move(box.x + 200, box.y + 50, { steps: 5 });
    await page.mouse.up();
    await dialog.getByRole("button", { name: "Confirmar entrega" }).click();
    await expectToast(page, "Entrega registrada");
    await expect(stops.nth(0)).toContainText("Recibió María Gómez");
    const [dispatch] =
      await sql`select status, received_by_name, proof_file_key, delivered_at is not null as delivered
      from dispatches where order_id = ${a.id}`;
    expect(dispatch).toMatchObject({ status: "delivered", received_by_name: "María Gómez", delivered: true });
    expect(dispatch!.proof_file_key).toMatch(/\.png$/);
    // La conformidad se sirve con sesión (en dev la primera compilación de la ruta puede tardar).
    await expect(async () => {
      const proof = await request.get(`/api/files/${dispatch!.proof_file_key}`);
      expect(proof.status()).toBe(200);
      expect(proof.headers()["content-type"]).toBe("image/png");
    }).toPass({ timeout: 30_000 });
    const [done] = await sql`select status from orders where id = ${a.id}`;
    expect(done!.status).toBe("delivered");

    // Retiro en el proveedor: marcar parada hecha.
    const pickup = stops.filter({ hasText: "Leo Pelle" });
    await expect(pickup).toContainText("Retirar 25 kg de fécula");
    await pickup.getByRole("button", { name: "Marcar hecha" }).click();
    await expect(pickup).toContainText("Hecha");
    await expect(page.getByTestId("route-summary")).toContainText("2/2 paradas hechas");

    // --- RF-26: cierre con km final, combustible, otros costos y temperatura -----------------------
    await page.getByLabel("Km final (tablero)").fill("11990");
    await page.getByLabel("Temperatura del equipo de frío (°C)").fill("-20");
    await page.getByRole("button", { name: "Cerrar ruta" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /km final no puede ser menor/ }),
    ).toBeVisible();
    await page.getByLabel("Km final (tablero)").fill("12085");
    await page.getByLabel("Combustible (litros)").fill("9,5");
    await page.getByLabel("Combustible ($)").fill("18000");
    await page.getByRole("button", { name: "Cerrar ruta" }).click();
    await expectToast(page, "Ruta cerrada");
    const summary = page.getByTestId("run-summary");
    await expect(summary).toContainText("12000 → 12085");
    await expect(summary).toContainText("3,5"); // horas
    await expect(summary).toContainText("-20,0 °C");

    const [temp] = await sql`select t.value_c::float8 as value, t.out_of_range, e.code, u.username
      from temperature_logs t join equipment e on e.id = t.equipment_id join users u on u.id = t.user_id
      where e.code = 'VEH-FRIO' order by t.created_at desc limit 1`;
    expect(temp).toMatchObject({ value: -20, out_of_range: false, code: "VEH-FRIO", username: "logistica" });
    const [closed] =
      await sql`select status, km_start::float8 as ks, km_end::float8 as ke, cold_unit_temp_c::float8 as temp
      from routes where id = ${routeId}`;
    expect(closed).toMatchObject({ status: "done", ks: 12000, ke: 12085, temp: -20 });

    // --- RF-27: costo por ruta y por kg ---------------------------------------------------------
    // 18.000 de combustible + 3,5 h × 5.000 = 35.500 sobre 40 kg entregados = 887,50 por kg.
    await page.goto("/despacho/costos?mes=2026-10");
    await expect(page.getByTestId("sum-routes")).toContainText("1");
    await expect(page.getByTestId("sum-kg")).toContainText("40 kg");
    await expect(page.getByTestId("sum-cost")).toContainText("$ 35.500");
    await expect(page.getByTestId("sum-cost-kg")).toContainText("$ 887,50");
    const row = page.getByTestId("cost-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Ruta chica"); // menos de 50 kg
    await expect(row).toHaveAttribute("data-small", "true");
    await expect(page.getByRole("status").filter({ hasText: "menos de 50 kg" })).toBeVisible();

    // --- RF-28: registro de despacho BPM ---------------------------------------------------------
    // Los remitos llevan la hora real del servidor (el día congelado solo afecta a "hoy"): rango amplio.
    const range = "desde=2000-01-01&hasta=2099-12-31";
    await page.goto(`/despacho/registro?${range}`);
    const table = page.getByTestId("registry-table");
    await expect(table.getByRole("row", { name: /260901-1/ })).toContainText("60");
    await expect(table.getByRole("row", { name: /260901-1/ })).toContainText(/\d\d\/\d\d\/20\d\d/);
    await expect(table.getByRole("row", { name: /260901-1/ })).toContainText("Supermercado Arcoiris");
    await expect(table.getByRole("row", { name: /260901-1/ })).toContainText(
      "Utilitario con equipo de frío (AA000AA)",
    );
    await expect(table.getByRole("row", { name: /260901-1/ })).toContainText("Logística (chofer)");
    await expect(table.getByRole("row", { name: /261001-1/ })).toContainText("20");
    const pdf = await request.get(`/api/despacho/registro?${range}&formato=pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    const xlsx = await request.get(`/api/despacho/registro?${range}&formato=xlsx`);
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");

    // No quedaron los otros pedidos en la ruta ni se tocaron.
    const left =
      await sql`select id from orders where id in (${b.id}, ${f.id}) and status in ('in_production','ready')`;
    expect(left).toHaveLength(2);
  });

  test("la vista del chofer en el celular: sin scroll horizontal, botones grandes, rechazo con devolución de stock y error por falta de stock", async ({
    page,
    sql,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ok = await makeOrder(sql, "Club Náutico", "ready", TAP, 30);
    const huge = await makeOrder(sql, "Supermercado La Reina", "ready", TAP, 5000);
    const [route] = await sql`
      insert into routes (date, vehicle_id, driver_id)
      values (${DAY}, (select id from vehicles limit 1), (select id from users where username = 'logistica'))
      returning id`;
    await sql`insert into route_stops (route_id, seq, kind, order_id, customer_id)
      select ${route!.id}, x.seq, 'delivery', x.oid, o.customer_id
      from (values (1, ${ok.id}::uuid), (2, ${huge.id}::uuid)) as x(seq, oid)
      join orders o on o.id = x.oid`;

    await page.goto(`/despacho/rutas/${route!.id}`);
    await expect(page.getByTestId("stop-card")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const generate = page.getByRole("button", { name: "Generar remito", exact: true }).first();
    expect((await generate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("link", { name: "Cobros" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Sin dirección cargada/ }).first()).toHaveAttribute(
      "href",
      /google\.com\/maps/,
    );

    // Falta de stock: el error explica qué falta y no se genera nada.
    await page.getByTestId("stop-card").nth(1).getByRole("button", { name: "Generar remito" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /No hay stock suficiente.*faltan/ }),
    ).toBeVisible();
    const none = await sql`select 1 from dispatches where order_id = ${huge.id}`;
    expect(none).toHaveLength(0);

    // Remito del pedido chico y rechazo total: el stock vuelve al mismo lote.
    const before = [await lotStock(sql, "260901-1", TAP), await lotStock(sql, "261001-1", TAP)];
    await generate.click();
    await expectToast(page, /Remito N° \d{8} generado/);
    // FEFO: sale del lote que vence primero y todavía tiene stock (el primer test pudo vaciar el 260901-1).
    const lot = before[0]! >= 30 ? "260901-1" : "261001-1";
    expect(await lotStock(sql, lot, TAP)).toBe(before[lot === "260901-1" ? 0 : 1]! - 30);
    await page.getByRole("button", { name: "Rechazar" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motivo del rechazo").fill("Freezer roto, no puede recibir");
    await dialog.getByRole("button", { name: "Confirmar rechazo" }).click();
    await expectToast(page, "Rechazo registrado");
    expect([await lotStock(sql, "260901-1", TAP), await lotStock(sql, "261001-1", TAP)]).toEqual(before);
    const [d] = await sql`select status, notes from dispatches where order_id = ${ok.id}`;
    expect(d).toMatchObject({ status: "rejected", notes: "Freezer roto, no puede recibir" });
    const ret = await sql`select qty::float8 as qty, l.code from stock_movements m
      join finished_lots l on l.id = m.finished_lot_id join locations loc on loc.id = m.location_id
      where m.type = 'return' and loc.code = 'F3'`;
    expect(ret).toEqual([{ qty: 30, code: lot }]);
    await expect(page.getByTestId("stop-card").first()).toContainText("Rechazado: Freezer roto");
    // El dominio no deja retroceder el pedido: sigue despachado con el motivo en su historial.
    const [o] = await sql`select status from orders where id = ${ok.id}`;
    expect(o!.status).toBe("dispatched");
    const [ev] =
      await sql`select note from order_events where order_id = ${ok.id} order by at desc, id limit 1`;
    expect(ev!.note).toContain("Freezer roto, no puede recibir");
    // Se puede reentregar.
    await expect(page.getByRole("button", { name: "Generar remito", exact: true }).first()).toBeVisible();
  });

  test("entrega con foto de la conformidad sacada con la cámara del celular", async ({
    page,
    sql,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const o = await makeOrder(sql, "Club Náutico", "ready", "Chipá lengüitas 0,5 kg", 6);
    const [route] = await sql`
      insert into routes (date, vehicle_id) values (${DAY}, (select id from vehicles limit 1)) returning id`;
    await sql`insert into route_stops (route_id, seq, kind, order_id, customer_id)
      select ${route!.id}, 1, 'delivery', ${o.id}, customer_id from orders where id = ${o.id}`;
    await page.goto(`/despacho/rutas/${route!.id}`);
    await page.getByRole("button", { name: "Generar remito", exact: true }).first().click();
    await expectToast(page, /Remito N° \d{8} generado/);
    await page.getByRole("button", { name: "Entregar" }).click();
    const dialog = page.getByRole("dialog");
    // El input abre la cámara trasera en el celular.
    await expect(dialog.getByLabel("Foto de la conformidad")).toHaveAttribute("capture", "environment");
    await dialog.getByLabel("Recibió (nombre y apellido)").fill("Pedro Díaz");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await dialog.getByLabel("Foto de la conformidad").setInputFiles({
      name: "remito.png",
      mimeType: "image/png",
      buffer: png,
    });
    await dialog.getByRole("button", { name: "Confirmar entrega" }).click();
    await expectToast(page, "Entrega registrada");
    await expect(page.getByRole("link", { name: "Ver conformidad" })).toBeVisible();
    const [d] =
      await sql`select status, received_by_name, proof_file_key from dispatches where order_id = ${o.id}`;
    expect(d).toMatchObject({ status: "delivered", received_by_name: "Pedro Díaz" });
    // La foto se achica y se guarda como JPEG.
    expect(d!.proof_file_key).toMatch(/\.jpg$/);
    await expect(async () => {
      const res = await request.get(`/api/files/${d!.proof_file_key}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/jpeg");
    }).toPass({ timeout: 30_000 });
    const [order] = await sql`select status from orders where id = ${o.id}`;
    expect(order!.status).toBe("delivered");
  });

  test("valida el km final y pide la temperatura; el pedido no listo no se puede remitir", async ({
    page,
    sql,
  }) => {
    const wip = await makeOrder(sql, "Club Náutico", "in_production", TAP, 4);
    const [route] = await sql`
      insert into routes (date, vehicle_id) values (${DAY}, (select id from vehicles limit 1)) returning id`;
    await sql`insert into route_stops (route_id, seq, kind, order_id, customer_id)
      select ${route!.id}, 1, 'delivery', ${wip.id}, customer_id from orders where id = ${wip.id}`;
    await page.goto(`/despacho/rutas/${route!.id}`);
    await expect(page.getByTestId("stop-card")).toContainText("No listo");
    await expect(page.getByRole("button", { name: "Generar remito", exact: true })).toHaveCount(0);
    await page.getByLabel("Km inicial (tablero)").fill("500");
    await page.getByRole("button", { name: "Iniciar ruta" }).click();
    await expectToast(page, "Ruta iniciada");
    await page.getByLabel("Km final (tablero)").fill("560");
    await page.getByRole("button", { name: "Cerrar ruta" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /temperatura del equipo de frío/ }),
    ).toBeVisible();
  });
});

test.describe("Permisos del módulo", () => {
  test.describe("local", () => {
    test.use({ storageState: asRole("store") });
    test("el local no accede a despacho", async ({ page, request }) => {
      await page.goto("/despacho");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/despacho/registro");
      await expect(page).toHaveURL(/sin-permiso/);
      expect((await request.get("/api/despacho/registro")).status()).toBe(403);
    });
  });

  test.describe("responsable técnico", () => {
    test.use({ storageState: asRole("technical_lead") });
    test("consulta y exporta el registro de despacho pero no arma rutas", async ({ page, request }) => {
      await page.goto("/despacho/registro");
      await expect(
        page
          .getByRole("link", { name: "Exportar PDF" })
          .or(page.getByRole("button", { name: "Exportar PDF" })),
      ).toBeVisible();
      const pdf = await request.get("/api/despacho/registro?formato=pdf");
      expect(pdf.status()).toBe(200);
      await page.goto("/despacho");
      await expect(page.getByRole("link", { name: "Nueva ruta" })).toHaveCount(0);
      await page.goto("/despacho/nueva");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });

  test.describe("logística", () => {
    test.use({ storageState: asRole("logistics") });
    test("logística ve el módulo y puede armar rutas", async ({ page }) => {
      await page.goto("/despacho");
      await expect(page.getByRole("heading", { name: "Despacho y reparto" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Nueva ruta" })).toBeVisible();
    });
  });
});
