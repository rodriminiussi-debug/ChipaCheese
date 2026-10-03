import { resolve } from "node:path";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../playwright.config";
import { test, expect, asRole, expectToast } from "./fixtures";

/**
 * M6 · Precios, cuentas corrientes, cobros, cheques, importación ARCA y exportación (RF-29 a RF-32).
 * Comparten base con el resto de los specs: todo lo que crean se limpia en afterAll.
 * El servidor corre con APP_TODAY=2026-10-02 y el navegador con page.clock en ese día.
 */
test.describe.configure({ mode: "serial" });

const FIXTURES = resolve(import.meta.dirname, "fixtures");
let startedAt: Date;
let previousHourlyCost: unknown;
const admin = () => postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });

test.beforeAll(async () => {
  const sql = admin();
  [{ now: startedAt }] = (await sql`select now() as now`) as unknown as [{ now: Date }];
  // Otros specs (admin) editan el costo hora: los márgenes de este spec asumen el valor del relevamiento.
  [{ value: previousHourlyCost }] = await sql`select value from app_settings where key = 'labor.hourly_cost'`;
  await sql`update app_settings set value = ${sql.json(5000)} where key = 'labor.hourly_cost'`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = admin();
  try {
    await sql`update app_settings set value = ${sql.json(previousHourlyCost as never)} where key = 'labor.hourly_cost'`;
    await sql`delete from price_list_items where valid_from >= '2026-10-01'`;
    await sql`delete from checks where created_at >= ${startedAt}`;
    await sql`delete from customer_payments where created_at >= ${startedAt}`;
    await sql`delete from sales_invoices where created_at >= ${startedAt}`;
    await sql`delete from route_stops where created_at >= ${startedAt}`;
    await sql`delete from routes where created_at >= ${startedAt}`;
    await sql`delete from order_events where order_id in (select id from orders where notes = 'E2E cobranzas')`;
    await sql`delete from orders where notes = 'E2E cobranzas'`;
    await sql`delete from purchase_invoices where created_at >= ${startedAt}`;
    await sql`update customers set cuit = null where cuit in ('30711111111','30712222227','30713333332')`;
    await sql`update suppliers set cuit = null where cuit in ('30715555553','30716666669')`;
  } finally {
    await sql.end();
  }
});

test.describe("Listas de precios (RF-29)", () => {
  test.use({ storageState: asRole("admin") });

  test("muestra costo y margen, edita un precio conservando el historial y aplica los sugeridos", async ({
    page,
    sql,
  }) => {
    await page.goto("/precios");
    await expect(page.getByRole("heading", { name: "Listas de precios" })).toBeVisible();
    // Costo directo con el rendimiento real de las producciones demo.
    await expect(page.getByText("Costo directo por kg").first()).toBeVisible();
    await expect(page.getByText(/Real: .* en 2 producción/)).toBeVisible();

    await page.getByRole("tab", { name: /Revendedores/ }).click();
    const table = page.getByRole("table", { name: "Precios de Revendedores (mayorista)" });
    const row = table.getByRole("row", { name: /Chipá tapitas 0,5 kg/ });
    await expect(row).toContainText("$ 4.200");
    await expect(row).toContainText("Bajo el margen objetivo");
    await expect(row).toContainText(/24,0\s?%/);

    // Editar precio: el diálogo muestra el margen resultante.
    await page.getByRole("button", { name: "Editar precio de Chipá tapitas 0,5 kg" }).click();
    await page.getByLabel("Precio de venta").fill("4500");
    await expect(page.getByTestId("price-preview")).toContainText(/margen 29,\d%/);
    await page.getByRole("button", { name: "Guardar precio" }).click();
    await expectToast(page, "Precio actualizado");
    await expect(row).toContainText("$ 4.500");
    await expect(row).toContainText("En margen");

    // Historial conservado: dos filas (la del seed y la nueva).
    const rows = await sql`select unit_price::float8 as price from price_list_items
      where product_id = (select id from products where code = 'CH-TAP-500')
        and price_list_id = (select id from price_lists where name = 'Revendedores (mayorista)')
      order by valid_from`;
    expect(rows.map((r) => r.price)).toEqual([4200, 4500]);
    await page.getByRole("button", { name: "Historial de precios de Chipá tapitas 0,5 kg" }).click();
    const history = page.getByRole("table", { name: "Historial de precios" });
    await expect(history).toContainText("$ 4.200");
    await expect(history).toContainText("$ 4.500");
    await page.keyboard.press("Escape");

    // Alerta fuerte bajo el costo.
    await page.getByRole("button", { name: "Editar precio de Chipá tapitas 0,5 kg" }).click();
    await page.getByLabel("Precio de venta").fill("3000");
    await expect(page.getByTestId("price-preview")).toContainText("por debajo del costo");
    await page.getByRole("button", { name: "Guardar precio" }).click();
    await expectToast(page, "Precio actualizado");
    await expect(page.getByRole("alert").filter({ hasText: "Precio por debajo del costo" })).toContainText(
      "Chipá tapitas 0,5 kg",
    );
    await expect(row).toContainText("Bajo el costo");

    // Precio sugerido masivo con confirmación: lleva todo al margen objetivo.
    await page.getByRole("button", { name: /Aplicar precios sugeridos/ }).click();
    await expect(page.getByRole("list", { name: "Cambios de precio" })).toContainText("Chipá tapitas 0,5 kg");
    await page.getByRole("button", { name: "Aplicar precios" }).click();
    await expectToast(page, /actualizado\(s\) al sugerido/);
    await expect(row).toContainText("En margen");
    await expect(page.getByRole("button", { name: /Aplicar precios sugeridos/ })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "Precio por debajo del costo" })).toHaveCount(0);

    // El sándwich no tiene precio de jamón ni de queso: se marca, no se asume $0.
    await expect(table.getByRole("row", { name: /Chisanwich/ })).toContainText("Precio faltante");
  });

  test("edita el margen objetivo de la lista", async ({ page }) => {
    await page.goto("/precios");
    await page.getByRole("tab", { name: /Supermercados/ }).click();
    await page.getByLabel("Margen objetivo (%)").fill("40");
    await page.getByRole("button", { name: "Guardar margen" }).click();
    await expectToast(page, "Margen objetivo actualizado");
    const table = page.getByRole("table", { name: "Precios de Supermercados" });
    await expect(table.getByRole("row", { name: /Chipá tapitas 0,5 kg/ })).toContainText(
      "Bajo el margen objetivo",
    );
    await page.getByLabel("Margen objetivo (%)").fill("18");
    await page.getByRole("button", { name: "Guardar margen" }).click();
    await expectToast(page, "Margen objetivo actualizado");
  });
});

test.describe("Cuenta corriente, cobros y cheques (RF-30, RF-31)", () => {
  test.use({ storageState: asRole("admin") });

  test("La Reina del seed: saldo con el cheque de $200.000 y antigüedad", async ({ page }) => {
    await page.goto("/cobranzas");
    await expect(page.getByRole("heading", { name: "Cobranzas" })).toBeVisible();
    const row = page
      .getByRole("table", { name: "Saldos por cliente" })
      .getByRole("row", { name: /La Reina/ });
    await expect(row).toContainText("$ 268.000");
    await page.getByRole("link", { name: "Supermercado La Reina" }).click();
    await expect(page.getByTestId("stat-balance")).toContainText("$ 268.000");
    await expect(page.getByTestId("stat-overdue")).toContainText("$ 0");
    const statement = page.getByRole("table", { name: "Movimientos de la cuenta corriente" });
    await expect(statement.getByRole("row", { name: /Factura A 0002-00001234/ })).toContainText("$ 468.000");
    await expect(statement.getByRole("row", { name: /Cobro · Cheque/ })).toContainText("N° 45879632");
  });

  test("registra una factura de un pedido entregado y un cobro con cheque; al saldar el pedido pasa a cobrado", async ({
    page,
    sql,
  }) => {
    const [order] = await sql`
      insert into orders (customer_id, promised_date, status, total, notes, delivered_at)
      values ((select id from customers where legal_name = 'Vía Dolce'), '2026-09-30', 'delivered', 121000, 'E2E cobranzas', now())
      returning id, number`;
    await page.goto("/cobranzas");
    await page.getByRole("button", { name: "Cargar factura" }).click();
    const dialog = page.getByRole("dialog", { name: "Cargar factura emitida" });
    await dialog.getByLabel("Cliente").click();
    await page.getByRole("option", { name: "Vía Dolce" }).click();
    await dialog.getByLabel("Punto de venta").fill("2");
    await dialog.getByLabel("Número", { exact: true }).fill("4301");
    await dialog.getByLabel("Fecha de emisión").fill("2026-09-30");
    await dialog.getByLabel("Neto gravado").fill("100000");
    await dialog.getByLabel("IVA de la factura").fill("21000");
    await expect(dialog.getByLabel("Total")).toHaveValue("121000");
    await dialog.getByLabel("Pedido entregado (opcional)").click();
    await page.getByRole("option", { name: new RegExp(`Pedido #${order!.number}`) }).click();
    await dialog.getByRole("button", { name: "Guardar factura" }).click();
    await expectToast(page, "Factura cargada");

    // El pedido pasó a facturado y la factura quedó con vencimiento = emisión (Vía Dolce paga contado).
    const [o1] = await sql`select status from orders where id = ${order!.id}`;
    expect(o1!.status).toBe("invoiced");
    const [inv] = await sql`select due_date::text as due, vat_total::float8 as vat, source from sales_invoices
      where number = '00004301'`;
    expect(inv).toMatchObject({ due: "2026-09-30", vat: 21000, source: "manual" });

    // Cuenta corriente: debe $ 121.000 y está vencida.
    await page
      .getByRole("table", { name: "Saldos por cliente" })
      .getByRole("link", { name: "Vía Dolce" })
      .click();
    await expect(page.getByTestId("stat-balance")).toContainText("$ 121.000");
    await expect(page.getByTestId("stat-overdue")).toContainText("$ 121.000");

    // Cobro parcial con dos cheques (uno a 3 días, otro a 40).
    await page.getByRole("button", { name: "Registrar cobro" }).click();
    const pay = page.getByRole("dialog", { name: "Registrar cobro" });
    await pay.getByRole("radio", { name: "Cheque" }).click();
    const c1 = pay.getByRole("group", { name: "Cheque 1" });
    await c1.getByLabel("Banco").fill("Banco Nación");
    await c1.getByLabel("N° de cheque").fill("70001");
    await c1.getByLabel("Importe del cheque").fill("60000");
    await c1.getByLabel("Fecha de cobro").fill("2026-10-05");
    await pay.getByRole("button", { name: "Agregar otro cheque" }).click();
    const c2 = pay.getByRole("group", { name: "Cheque 2" });
    await c2.getByLabel("Banco").fill("Banco Santa Fe");
    await c2.getByLabel("N° de cheque").fill("70002");
    await c2.getByLabel("Importe del cheque").fill("40000");
    await c2.getByLabel("Fecha de cobro").fill("2026-11-11");
    await expect(pay.getByTestId("checks-total")).toContainText("$ 100.000");
    await pay.getByRole("button", { name: "Guardar cobro" }).click();
    await expectToast(page, "Cobro registrado: $ 100.000");
    await expect(page.getByTestId("stat-balance")).toContainText("$ 21.000");
    expect((await sql`select status from orders where id = ${order!.id}`)[0]!.status).toBe("invoiced");

    // Cartera de cheques: ordenada por fecha de cobro, con alerta de los próximos 7 días.
    await page.goto("/cobranzas/cheques");
    await expect(page.getByRole("alert").filter({ hasText: "próximos 7 días" })).toContainText("$ 60.000");
    const checks = page.getByRole("table", { name: "Cartera de cheques" });
    const numbers = await checks
      .locator("tbody tr")
      .evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-check")));
    expect(numbers).toEqual(["70001", "45879632", "70002"]);
    await expect(checks.getByRole("row", { name: /70001/ })).toContainText("Se cobra en 3 d");

    // Cobro del saldo restante en efectivo: el pedido pasa a cobrado.
    await page.goto("/cobranzas");
    await page.getByRole("link", { name: "Vía Dolce" }).click();
    await page.getByRole("button", { name: "Registrar cobro" }).click();
    await page.getByRole("dialog", { name: "Registrar cobro" }).getByLabel("Importe").fill("21.000");
    await page.getByRole("button", { name: "Guardar cobro" }).click();
    await expectToast(page, /pedido #\d+ cobrado/);
    await expect(page.getByTestId("stat-balance")).toContainText("$ 0");
    expect((await sql`select status from orders where id = ${order!.id}`)[0]!.status).toBe("paid");
  });

  test("un cheque rechazado vuelve a deber y se avisa en la cuenta", async ({ page }) => {
    await page.goto("/cobranzas/cheques");
    await page.getByRole("button", { name: "Acciones del cheque 70001" }).click();
    await page.getByRole("menuitem", { name: "Marcar depositado" }).click();
    await expectToast(page, "Cheque depositado");
    await page.getByRole("button", { name: "Acciones del cheque 70001" }).click();
    await page.getByRole("menuitem", { name: "Marcar rechazado" }).click();
    await page.getByRole("button", { name: "Sí, rechazado" }).click();
    await expectToast(page, "Cheque rechazado");

    await page.goto("/cobranzas");
    await page.getByRole("link", { name: "Vía Dolce" }).click();
    await expect(page.getByTestId("stat-balance")).toContainText("$ 60.000");
    await expect(page.getByRole("alert").filter({ hasText: "Cheques rechazados" })).toContainText("70001");
    // Ya no figura entre los cheques activos pero sí en el filtro de rechazados.
    await page.goto("/cobranzas/cheques");
    await expect(page.getByRole("row", { name: /70001/ })).toHaveCount(0);
    await page.goto("/cobranzas/cheques?estado=rejected");
    await expect(page.getByRole("row", { name: /70001/ })).toContainText("Rechazado");
  });

  test("valida la factura duplicada y los datos obligatorios", async ({ page }) => {
    await page.goto("/cobranzas");
    await page.getByRole("button", { name: "Cargar factura" }).click();
    const dialog = page.getByRole("dialog", { name: "Cargar factura emitida" });
    await dialog.getByRole("button", { name: "Guardar factura" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Elegí el cliente" })).toBeVisible();
    await expect(dialog.getByRole("alert").filter({ hasText: "Punto de venta inválido" })).toBeVisible();
    // Factura A 0002-00001234 ya existe (la del seed).
    await dialog.getByLabel("Cliente").click();
    await page.getByRole("option", { name: "Supermercado La Reina" }).click();
    await dialog.getByLabel("Punto de venta").fill("2");
    await dialog.getByLabel("Número", { exact: true }).fill("1234");
    await dialog.getByLabel("Neto gravado").fill("100");
    await dialog.getByLabel("IVA de la factura").fill("21");
    await dialog.getByRole("button", { name: "Guardar factura" }).click();
    await expectToast(page, "Ya existe la factura A 0002-00001234");
  });
});

test.describe("Responsive", () => {
  test.use({ storageState: asRole("admin") });

  test("precios y cobranzas no tienen scroll horizontal en el celular", async ({ page, sql }) => {
    const [reina] = await sql`select id from customers where legal_name = 'Supermercado La Reina'`;
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/precios", "/cobranzas", "/cobranzas/cheques", `/cobranzas/clientes/${reina!.id}`]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(
        true,
      );
    }
  });
});

test.describe("Cobros en ruta (RF-31)", () => {
  test.use({ storageState: asRole("logistics") });

  test("el chofer ve los clientes de la ruta con su saldo y cobra", async ({ page, sql }) => {
    const [route] = await sql`insert into routes (date) values ('2026-10-02') returning id`;
    await sql`insert into route_stops (route_id, seq, kind, customer_id)
      values (${route!.id}, 1, 'delivery', (select id from customers where legal_name = 'Supermercado La Reina')),
             (${route!.id}, 2, 'supplier_pickup', null)`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/cobranzas/ruta/${route!.id}`);
    await expect(page.getByRole("heading", { name: "Cobranza en ruta" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const card = page.getByRole("listitem").filter({ hasText: "Supermercado La Reina" });
    await expect(card).toContainText("$ 268.000");
    await card.getByRole("button", { name: "Cobrar" }).click();
    const pay = page.getByRole("dialog", { name: "Registrar cobro" });
    await pay.getByLabel("Importe").fill("50000");
    await pay.getByRole("button", { name: "Guardar cobro" }).click();
    await expectToast(page, "Cobro registrado: $ 50.000");
    await expect(page.getByTestId("route-collected")).toHaveText("$ 50.000");
    await expect(card).toContainText("$ 218.000");
    const [p] =
      await sql`select route_id, method, received_by_id is not null as has_user from customer_payments
      where route_id = ${route!.id}`;
    expect(p).toMatchObject({ route_id: route!.id, method: "cash", has_user: true });
  });

  test("logística no carga facturas ni cambia cheques, y no ve precios", async ({ page }) => {
    await page.goto("/cobranzas");
    await expect(page.getByRole("button", { name: "Cargar factura" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Importar ARCA" })).toHaveCount(0);
    await page.goto("/cobranzas/cheques");
    await expect(page.getByRole("button", { name: /Acciones del cheque/ })).toHaveCount(0);
    await page.goto("/cobranzas/importar");
    await expect(page).toHaveURL(/sin-permiso/);
    await page.goto("/precios");
    await expect(page).toHaveURL(/sin-permiso/);
  });
});

test.describe("Importar Mis Comprobantes (RF-32)", () => {
  test.use({ storageState: asRole("admin") });

  test("vista previa, importación idempotente y reporte de los sin cliente", async ({ page, sql }) => {
    await sql`update customers set cuit = '30711111111' where legal_name = 'Supermercado La Reina'`;
    await sql`update customers set cuit = '30712222227' where legal_name = 'La Esperanza'`;
    await sql`update customers set cuit = '30713333332' where legal_name = 'Vía Dolce'`;

    await page.goto("/cobranzas/importar");
    await page
      .getByLabel("Archivo CSV de «Mis Comprobantes»")
      .setInputFiles(resolve(FIXTURES, "mis-comprobantes-emitidos.csv"));
    await page.getByRole("button", { name: "Vista previa" }).click();
    const summary = page.getByTestId("arca-summary");
    await expect(summary).toContainText("Nueva: 3");
    await expect(summary).toContainText("Ya cargada: 1");
    await expect(summary).toContainText("Sin cliente: 1");
    await expect(summary).toContainText("No soportada: 1");
    await expect(page.getByRole("alert").filter({ hasText: "Comprobantes sin cliente" })).toContainText(
      "Kiosco Desconocido SRL",
    );
    expect(
      (await sql`select count(*)::int as n from sales_invoices where source = 'arca_import'`)[0]!.n,
    ).toBe(0);

    await page.getByRole("button", { name: "Importar 3 comprobante(s)" }).click();
    await expectToast(page, "3 comprobante(s) importado(s)");
    const imported =
      await sql`select invoice_type, number, cae from sales_invoices where source = 'arca_import' order by number`;
    expect(imported.map((r) => `${r.invoice_type} ${r.number}`).sort()).toEqual([
      "A 00001301",
      "A 00001302",
      "NC_A 00000077",
    ]);
    expect(imported.find((r) => r.number === "00001301")!.cae).toBe("76123456789012");

    // Segunda vez: nada nuevo, no se duplica.
    await page.goto("/cobranzas/importar");
    await page
      .getByLabel("Archivo CSV de «Mis Comprobantes»")
      .setInputFiles(resolve(FIXTURES, "mis-comprobantes-emitidos.csv"));
    await page.getByRole("button", { name: "Vista previa" }).click();
    await expect(page.getByTestId("arca-summary")).toContainText("Ya cargada: 4");
    await expect(page.getByRole("button", { name: /Importar \d+ comprobante/ })).toHaveCount(0);
    expect(
      (await sql`select count(*)::int as n from sales_invoices where source = 'arca_import'`)[0]!.n,
    ).toBe(3);

    // La nota de crédito importada baja la deuda de La Esperanza (121.000 − 12.100).
    await page.goto("/cobranzas");
    await expect(
      page.getByRole("table", { name: "Saldos por cliente" }).getByRole("row", { name: /La Esperanza/ }),
    ).toContainText("$ 108.900");
  });

  test("los recibidos solo se concilian contra las compras cargadas", async ({ page, sql }) => {
    await sql`update suppliers set cuit = '30715555553' where legal_name = 'Leo Pelle'`;
    await sql`insert into purchase_invoices (supplier_id, invoice_type, point_of_sale, number, issue_date, total, status)
      values ((select id from suppliers where legal_name = 'Leo Pelle'), 'A', '0005', '00004521', '2026-09-10', 605000, 'confirmed'),
             ((select id from suppliers where legal_name = 'Leo Pelle'), 'A', '0005', '00004602', '2026-09-15', 240000, 'confirmed')`;
    await page.goto("/cobranzas/importar");
    await page.getByLabel("Tipo de archivo").click();
    await page.getByRole("option", { name: "Comprobantes recibidos" }).click();
    await page
      .getByLabel("Archivo CSV de «Mis Comprobantes»")
      .setInputFiles(resolve(FIXTURES, "mis-comprobantes-recibidos.csv"));
    await page.getByRole("button", { name: "Vista previa" }).click();
    const summary = page.getByTestId("arca-summary");
    await expect(summary).toContainText("Encontrada: 1");
    await expect(summary).toContainText("Diferencia de importe: 1");
    await expect(summary).toContainText("Falta cargar: 1");
    await expect(page.getByRole("button", { name: /Importar/ })).toHaveCount(0);
    expect((await sql`select count(*)::int as n from purchase_invoices`)[0]!.n).toBe(2);
  });
});

test.describe("Exportación para la contadora", () => {
  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });

    test("ve las cuentas corrientes y exporta, pero no edita", async ({ page }) => {
      await page.goto("/cobranzas");
      await expect(page.getByRole("heading", { name: "Cobranzas" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cargar factura" })).toHaveCount(0);
      await page.getByRole("link", { name: "Supermercado La Reina" }).click();
      await expect(page.getByRole("button", { name: "Registrar cobro" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cargar factura" })).toHaveCount(0);
      await page.goto("/cobranzas/cheques");
      await expect(page.getByRole("button", { name: /Acciones del cheque/ })).toHaveCount(0);
      await page.goto("/cobranzas/importar");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/precios");
      await expect(page).toHaveURL(/sin-permiso/);

      const res = await page.request.get("/api/billing/export?month=2026-09");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("spreadsheetml");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
      const sheet = wb.getWorksheet("Facturas emitidas")!;
      const texts = sheet.getColumn(5).values as (string | undefined)[];
      expect(texts).toContain("Supermercado La Reina");
      expect(wb.getWorksheet("Cobros")!.getColumn(8).values).toContain("45879632");
      expect((await page.request.get("/api/billing/export?month=2026-13")).status()).toBe(400);
    });
  });

  test.describe("jefa de producción y local", () => {
    test.describe("producción", () => {
      test.use({ storageState: asRole("production_manager") });
      test("no ve cobranzas ni precios ni la exportación", async ({ page }) => {
        for (const url of ["/cobranzas", "/cobranzas/cheques", "/precios"]) {
          await page.goto(url);
          await expect(page, url).toHaveURL(/sin-permiso/);
        }
        expect((await page.request.get("/api/billing/export")).status()).toBe(403);
      });
    });
    test.describe("local", () => {
      test.use({ storageState: asRole("store") });
      test("solo ve el local", async ({ page }) => {
        await page.goto("/cobranzas");
        await expect(page).toHaveURL(/sin-permiso/);
        await page.goto("/precios");
        await expect(page).toHaveURL(/sin-permiso/);
        await page.goto("/local");
        await expect(page.getByRole("heading", { name: "Local" })).toBeVisible();
      });
    });
  });
});
