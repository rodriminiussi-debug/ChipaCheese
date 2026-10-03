import ExcelJS from "exceljs";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../playwright.config";
import { test, expect, asRole, expectToast } from "./fixtures";

/**
 * M3 Stock y cobertura (RF-13 a RF-17). Los tests comparten la base: todo lo que crean o mueven
 * se limpia en afterAll para no alterar el saldo demo que usan otros módulos.
 */
test.describe.configure({ mode: "serial" });

let startedAt: Date;
const admin = () => postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });

test.beforeAll(async () => {
  const sql = admin();
  [{ now: startedAt }] = (await sql`select now() as now`) as unknown as [{ now: Date }];
  await sql.end();
});

test.afterAll(async () => {
  const sql = admin();
  try {
    await sql`delete from stock_movements where created_at >= ${startedAt}`;
    await sql`delete from inventory_count_items where count_id in (select id from inventory_counts where created_at >= ${startedAt})`;
    await sql`delete from inventory_counts where created_at >= ${startedAt}`;
    await sql`delete from ingredients where name like 'Insumo E2E%'`;
  } finally {
    await sql.end();
  }
});

test.describe("Stock (producción)", () => {
  test.use({ storageState: asRole("production_manager") });

  test("cobertura en días y alerta de reposición (RF-13, RF-14)", async ({ page, sql }) => {
    // Insumo sintético: 320 kg recibidos, 300 kg consumidos hace 3 días → 10 kg/día, quedan 20 kg.
    // Proveedor Leo Pelle (2 días) + seguridad 10 → punto de pedido 30 → "Reponer", cobertura 2 días.
    const [ing] = await sql`
      insert into ingredients (name, category, unit, min_stock, safety_stock, default_supplier_id)
      values ('Insumo E2E crítico', 'other', 'kg', 0, 10, (select id from suppliers where legal_name = 'Leo Pelle'))
      returning id`;
    await sql`
      insert into stock_movements (type, item_kind, ingredient_id, location_id, qty, occurred_at)
      values
        ('receipt', 'ingredient', ${ing!.id}, (select id from locations where code = 'DEP-SECO'), 320, now() - interval '6 days'),
        ('production_consumption', 'ingredient', ${ing!.id}, (select id from locations where code = 'DEP-SECO'), -300, now() - interval '3 days')`;

    await page.goto("/stock");
    const row = page.getByRole("row", { name: /Insumo E2E crítico/ });
    await expect(row).toContainText("Reponer");
    await expect(row).toContainText("2,0 días");
    await expect(row).toContainText("30,00"); // punto de pedido
    await expect(page.getByRole("alert").filter({ hasText: "Hay que reponer" })).toContainText(
      "Insumo E2E crítico",
    );

    // Ordenado por urgencia: los "Sin stock" van antes que "Reponer".
    const statuses = await page
      .locator("tbody tr")
      .evaluateAll((trs) =>
        trs.map((tr) => (tr.textContent ?? "").match(/Sin stock|Reponer|OK|Sin consumo/)?.[0]),
      );
    expect(statuses.indexOf("Sin stock")).toBeLessThan(statuses.indexOf("Reponer"));
    expect(statuses.lastIndexOf("Reponer")).toBeLessThan(statuses.indexOf("OK"));
  });

  test("detalle por lote, ajuste manual con motivo obligatorio y edición de niveles", async ({ page }) => {
    await page.goto("/stock");
    // Lotes con vencimiento y días a vencer de un insumo del seed.
    await page.getByRole("link", { name: "Leche" }).click();
    await expect(page.getByRole("heading", { name: "Leche" })).toBeVisible();
    const lotes = page.getByRole("table", { name: "Lotes del insumo" });
    await expect(lotes.getByRole("row", { name: /LEC-0928/ })).toContainText("12/10/2026");
    await page.goto("/stock");

    await page.getByRole("link", { name: "Insumo E2E crítico" }).click();
    await expect(
      page.getByRole("table", { name: "Lotes del insumo" }).getByRole("row", { name: /Sin lote/ }),
    ).toContainText("20,00 kg");

    await page.getByLabel("Cantidad (kg)").fill("5");
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
    await expect(page.getByText("Indicá el motivo (obligatorio)")).toBeVisible();

    await page.getByLabel("Motivo *").fill("Se cortó la cadena de frío");
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
    await expectToast(page, "Ajuste registrado");
    await expect(page.getByText("15,00 kg").first()).toBeVisible();
    const movement = page.getByRole("row", { name: /Merma \/ descarte/ });
    await expect(movement).toContainText("-5,00 kg");
    await expect(movement).toContainText("Merma: Se cortó la cadena de frío");

    // No se puede restar más que el saldo.
    await page.getByLabel("Cantidad (kg)").fill("500");
    await page.getByLabel("Motivo *").fill("Prueba de saldo");
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
    await expect(page.getByText("Supera el saldo disponible")).toBeVisible();

    // Stock mínimo y de seguridad.
    await page.getByLabel("Stock mínimo (kg)").fill("100");
    await page.getByLabel("Stock de seguridad (kg)").fill("12");
    await page.getByRole("button", { name: "Guardar niveles" }).click();
    await expectToast(page, "Niveles guardados");
    await page.goto("/stock");
    await expect(page.getByRole("row", { name: /Insumo E2E crítico/ })).toContainText("100,00");
  });

  test("transferencia F3 → LOCAL mueve el saldo por FEFO (RF-16)", async ({ page, sql }) => {
    // Estado actual (otros specs producen/despachan tapitas): calculamos lo esperado desde la base.
    const lotsF3 = await sql<{ code: string; qty: string }[]>`
      select fl.code, v.qty from v_product_stock v
      join products p on p.id = v.product_id join locations l on l.id = v.location_id
      join finished_lots fl on fl.id = v.finished_lot_id
      where p.code = 'CH-TAP-500' and l.code = 'F3' and v.qty > 0 and not fl.on_hold
      order by fl.expiry_date, fl.id`;
    const [{ local }] = await sql<{ local: string }[]>`
      select coalesce(sum(v.qty), 0) as local from v_product_stock v
      join products p on p.id = v.product_id join locations l on l.id = v.location_id
      where p.code = 'CH-TAP-500' and l.code = 'LOCAL'`;
    const f3Before = lotsF3.reduce((a, l) => a + Number(l.qty), 0);
    const localBefore = Number(local);
    const UNITS = 70;
    expect(f3Before).toBeGreaterThanOrEqual(UNITS);
    let pending = UNITS;
    const expected = lotsF3.flatMap((l) => {
      const take = Math.min(pending, Number(l.qty));
      pending -= take;
      return take > 0 ? [{ code: l.code, take }] : [];
    });
    const fmt = (n: number) => n.toLocaleString("es-AR");

    await page.goto("/stock/producto-terminado");
    const row = page.getByRole("row", { name: /Chipá tapitas 0,5 kg/ }).first();
    await expect(row.locator('[data-location="F3"]')).toContainText(fmt(f3Before));

    await page.getByRole("button", { name: "Transferir" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Producto").click();
    await page.getByRole("option", { name: "Chipá tapitas 0,5 kg" }).click();
    await dialog.getByLabel("Unidades").fill(String(UNITS));
    await dialog.getByRole("button", { name: "Confirmar transferencia" }).click();
    await expectToast(page, "Transferencia registrada");

    await expect(row.locator('[data-location="F3"]')).toContainText(fmt(f3Before - UNITS));
    await expect(row.locator('[data-location="LOCAL"]')).toContainText(fmt(localBefore + UNITS));
    // FEFO: salen primero los lotes que vencen antes, y llegan al local con su lote.
    const [{ moved }] = await sql<{ moved: { code: string; qty: string }[] }[]>`
      select coalesce(json_agg(json_build_object('code', fl.code, 'qty', m.qty) order by fl.expiry_date), '[]') as moved
      from stock_movements m join locations l on l.id = m.location_id join finished_lots fl on fl.id = m.finished_lot_id
      where m.type = 'transfer' and l.code = 'LOCAL' and m.qty > 0
        and m.ref_id = (select ref_id from stock_movements where type = 'transfer' order by created_at desc limit 1)`;
    expect(moved.map((m) => ({ code: m.code, take: Number(m.qty) }))).toEqual(expected);

    // Error: más unidades de las que hay en el origen.
    await page.getByRole("button", { name: "Transferir" }).click();
    await dialog.getByLabel("Producto").click();
    await page.getByRole("option", { name: "Chipá tapitas 0,5 kg" }).click();
    await dialog.getByLabel("Unidades").fill("5000");
    await dialog.getByRole("button", { name: "Confirmar transferencia" }).click();
    await expectToast(page, "No hay stock suficiente");
  });

  test("inventario físico: carga parcial, confirmación y ajuste del stock (RF-15)", async ({ page, sql }) => {
    // Saldo actual del lote (producción puede haber consumido sal en otro spec): contamos 1 kg menos.
    const [{ lot, total }] = await sql<{ lot: string; total: string }[]>`
      select
        (select coalesce(sum(v.qty), 0) from v_ingredient_stock v join raw_lots r on r.id = v.raw_lot_id
          join locations l on l.id = v.location_id where r.supplier_lot_code = 'SAL-0901' and l.code = 'DEP-SECO') as lot,
        (select coalesce(sum(v.qty), 0) from v_ingredient_stock v join ingredients i on i.id = v.ingredient_id
          where i.name = 'Sal') as total`;
    const counted = Math.round((Number(lot) - 1) * 1000) / 1000;
    const kg = (n: number) =>
      `${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

    await page.goto("/stock/inventario");
    await page.getByRole("button", { name: "Nuevo conteo de materia prima" }).click();
    await expect(page).toHaveURL(/\/stock\/inventario\/[0-9a-f-]{36}$/);

    const sal = page.getByLabel("Sal · lote SAL-0901 · DEP-SECO", { exact: true });
    await expect(sal).toBeVisible();
    await sal.fill(String(counted));
    await page.getByRole("button", { name: "Guardar avance" }).click();
    await expectToast(page, "Avance guardado");
    await page.reload();
    await expect(sal).toHaveValue(String(counted));
    await expect(page.getByText("Contadas: 1 de")).toBeVisible();

    await page.getByRole("button", { name: "Confirmar inventario" }).click();
    await page.getByRole("button", { name: "Sí, confirmar" }).click();
    await expectToast(page, "Inventario confirmado: 1 ajuste");

    // Reporte de diferencias: cantidad y valorizado (sal $708/kg).
    const report = page.getByRole("table", { name: "Reporte de diferencias de inventario" });
    const row = report.getByRole("row", { name: /Sal/ });
    await expect(row).toContainText("SAL-0901");
    await expect(row).toContainText("-1,00 kg");
    await expect(row).toContainText("-$ 708");

    // El stock quedó en lo contado y el ajuste figura en el libro mayor con su documento origen.
    await page.goto("/stock");
    await expect(page.getByRole("row", { name: /^Sal/ })).toContainText(kg(Number(total) - 1));
    await page.goto("/stock/movimientos");
    await page.getByLabel("Tipo").selectOption("adjustment");
    await page.getByRole("button", { name: "Filtrar" }).click();
    const mov = page.getByRole("row", { name: /Sal/ });
    await expect(mov).toContainText("-1,00 kg");
    await expect(mov).toContainText("Inventario físico");
    await expect(mov).toContainText("SAL-0901");
  });

  test("movimientos: filtros por tipo y lote", async ({ page }) => {
    await page.goto("/stock/movimientos?type=production_consumption");
    await expect(page.getByRole("row", { name: /Fécula de mandioca/ })).toContainText("-75,00 kg");
    await expect(page.getByRole("row", { name: /Recepción/ })).toHaveCount(0);

    await page.goto("/stock/movimientos");
    await page.getByLabel("Lote").fill("FEC-2609");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByRole("row", { name: /Fécula de mandioca/ })).toHaveCount(2);
    await expect(page.getByText(/2 movimientos/)).toBeVisible();
  });

  test("simulador: alcanza o falta materia prima (RF-17)", async ({ page, sql }) => {
    // Independiente del orden de los tests: otros specs (compras) pueden recibir fécula antes.
    const [{ qty }] = await sql<{ qty: string }[]>`
      select coalesce(sum(v.qty), 0) as qty from v_ingredient_stock v
      join ingredients i on i.id = v.ingredient_id where i.name = 'Fécula de mandioca'`;
    const stock = Number(qty);
    const kg = (n: number) =>
      `${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

    await page.goto("/stock/simulador");
    await page.getByLabel("Quiero producir").selectOption("starch_kg");
    await page.getByLabel("Cantidad (kg)").fill(String(stock + 50));
    await page.getByRole("button", { name: "Simular" }).click();

    await expect(page.getByRole("status")).toContainText("No alcanza la materia prima");
    const fecula = page.getByRole("row", { name: /Fécula de mandioca/ });
    await expect(fecula).toContainText(kg(stock + 50));
    await expect(fecula).toContainText(kg(stock));
    await expect(fecula).toContainText("50,00 kg");
    await expect(fecula).toContainText("Falta");
    await expect(page.getByTestId("stat-recipes")).toContainText(/\d/); // depende del insumo limitante

    // En kg de producto: 100 kg de chipá sí alcanzan con el stock actual.
    await page.getByLabel("Quiero producir").selectOption("product_kg");
    await page.getByLabel("Cantidad (kg)").fill("100");
    await page.getByRole("button", { name: "Simular" }).click();
    await expect(page.getByRole("status")).toContainText("Alcanza la materia prima");
  });

  test("descarga el Excel con el stock actual de MP y PT", async ({ page }) => {
    await page.goto("/stock");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Descargar Excel" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^stock-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const path = await download.path();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Materia prima",
      "Materia prima por lote",
      "Producto terminado",
      "Producto terminado por lote",
    ]);
    const mp = wb.getWorksheet("Materia prima")!;
    const names = mp.getColumn(1).values as (string | undefined)[];
    expect(names).toContain("Fécula de mandioca");
    const pt = wb.getWorksheet("Producto terminado")!;
    expect((pt.getColumn(2).values as (string | undefined)[]).some((v) => v?.includes("tapitas"))).toBe(true);
  });
});

test.describe("Permisos de stock", () => {
  test.describe("operario", () => {
    test.use({ storageState: asRole("operator") });
    test("no accede a stock ni a la exportación", async ({ page }) => {
      await page.goto("/stock");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/stock/simulador");
      await expect(page).toHaveURL(/sin-permiso/);
      const res = await page.request.get("/api/stock/export");
      expect(res.status()).toBe(403);
    });
  });

  test.describe("local", () => {
    test.use({ storageState: asRole("store") });
    test("puede consultar pero no ajustar, transferir ni contar", async ({ page }) => {
      await page.goto("/stock/producto-terminado");
      await expect(
        page.getByRole("table", { name: "Stock de producto terminado por ubicación" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Transferir" })).toHaveCount(0);
      await page.goto("/stock/inventario");
      await expect(page.getByRole("button", { name: /Nuevo conteo/ })).toHaveCount(0);
      await page.goto("/stock");
      await page.getByRole("link", { name: "Leche" }).click();
      await expect(page.getByRole("button", { name: "Registrar ajuste" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Guardar niveles" })).toHaveCount(0);
    });
  });

  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("puede exportar (permiso export) aunque no vea las pantallas de stock", async ({ page }) => {
      await page.goto("/stock");
      await expect(page).toHaveURL(/sin-permiso/);
      const res = await page.request.get("/api/stock/export");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("spreadsheetml");
    });
  });
});
