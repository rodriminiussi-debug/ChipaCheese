import type postgres from "postgres";
import { test, expect, asRole, expectToast } from "./fixtures";

/**
 * M6 · Ventas del local y cierre de caja (RF-33). El archivo arranca de la base demo intacta
 * (aislamiento por archivo, e2e/fixtures.ts).
 */
test.describe.configure({ mode: "serial" });

// Solo marca de tiempo (no toca la base): filtra lo creado por este archivo.
let startedAt: Date;
test.beforeAll(() => {
  startedAt = new Date(Date.now() - 1000);
});

/** Transferencia F3/F4 → LOCAL del lote más viejo de un producto (como lo hace la pantalla de stock). */
async function transferToStore(sql: postgres.Sql, code: string, from: "F3" | "F4", units: number) {
  const [lot] = await sql`
    select ps.finished_lot_id, ps.product_id from v_product_stock ps
    join products p on p.id = ps.product_id
    join finished_lots l on l.id = ps.finished_lot_id
    where p.code = ${code} and ps.location_id = (select id from locations where code = ${from}) and ps.qty >= ${units}
    order by l.expiry_date limit 1`;
  await sql`
    insert into stock_movements (type, item_kind, product_id, finished_lot_id, location_id, qty, ref_table)
    values ('transfer', 'product', ${lot!.product_id}, ${lot!.finished_lot_id}, (select id from locations where code = ${from}), ${-units}, 'stock_transfer'),
           ('transfer', 'product', ${lot!.product_id}, ${lot!.finished_lot_id}, (select id from locations where code = 'LOCAL'), ${units}, 'stock_transfer')`;
}

const TAP = "Chipá tapitas 0,5 kg";
const LEN = "Chipá lengüitas 0,5 kg";

test.describe("Local (RF-33)", () => {
  test.use({ storageState: asRole("store") });

  test("sin stock en el local no se puede vender y avisa cómo cargarlo", async ({ page }) => {
    await page.goto("/local");
    await expect(page.getByRole("heading", { name: "Local" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "No hay stock en el local" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toBeDisabled();
    await page.getByRole("tab", { name: "Stock del local" }).click();
    await expect(page.getByText("No hay producto en el local")).toBeVisible();
  });

  test("vende desde el celular: cantidades +/−, medio de pago, total y descuento de stock del local", async ({
    page,
    sql,
  }) => {
    await transferToStore(sql, "CH-TAP-500", "F3", 5);
    await transferToStore(sql, "CH-LEN-500", "F4", 4);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/local");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toContainText("5 en el local");
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toContainText("$ 4.800");

    // Tres tapitas: dos toques + un "+" y un "−" de más.
    await page.getByRole("button", { name: `Agregar ${TAP}` }).click();
    await page.getByRole("button", { name: `Agregar ${TAP}` }).click();
    await page.getByRole("button", { name: `Sumar una unidad de ${TAP}` }).click();
    await page.getByRole("button", { name: `Sumar una unidad de ${TAP}` }).click();
    await page.getByRole("button", { name: `Quitar una unidad de ${TAP}` }).click();
    await expect(page.getByLabel(`Cantidad de ${TAP}`)).toHaveText("3");
    await expect(page.getByTestId("pos-total")).toHaveText("$ 14.400");

    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expectToast(page, "Venta registrada: $ 14.400");
    await expect(page.getByTestId("pos-total")).toHaveText("$ 0");
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toContainText("2 en el local");

    const [sale] =
      await sql`select id, total::float8 as total, method from store_sales order by created_at desc limit 1`;
    expect(sale).toMatchObject({ total: 14400, method: "cash" });
    const moves = await sql`select type, qty::float8 as qty, l.code as loc from stock_movements m
      join locations l on l.id = m.location_id where m.ref_id = ${sale!.id}`;
    expect(moves).toEqual([{ type: "store_sale", qty: -3, loc: "LOCAL" }]);

    // Segunda venta con transferencia.
    await page.getByRole("button", { name: `Agregar ${LEN}` }).click();
    await page.getByRole("button", { name: `Agregar ${LEN}` }).click();
    await page.getByRole("radio", { name: "Transferencia" }).click();
    await expect(page.getByTestId("pos-total")).toHaveText("$ 9.600");
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expectToast(page, "Venta registrada: $ 9.600");
    const [second] = await sql`select method from store_sales order by created_at desc limit 1`;
    expect(second!.method).toBe("transfer");

    // No deja pasar el stock del local en la pantalla.
    for (let i = 0; i < 4; i++)
      await page.getByRole("button", { name: `Agregar ${TAP}` }).click({ force: true });
    await expect(page.getByLabel(`Cantidad de ${TAP}`)).toHaveText("2");
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toBeDisabled();
    await page.getByRole("button", { name: "Vaciar la venta" }).click();
  });

  test("si el stock cambió mientras tanto, el servidor rechaza la venta con un mensaje claro", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    await page.getByRole("button", { name: `Agregar ${TAP}` }).click();
    // Alguien más se llevó lo que quedaba del local.
    await sql`delete from stock_movements where type = 'transfer' and product_id = (select id from products where code = 'CH-TAP-500')
      and location_id = (select id from locations where code = 'LOCAL') and created_at >= ${startedAt}`;
    await sql`insert into stock_movements (type, item_kind, product_id, finished_lot_id, location_id, qty)
      select 'adjustment', 'product', product_id, finished_lot_id, location_id, -sum(qty)
      from v_product_stock where product_id = (select id from products where code = 'CH-TAP-500')
        and location_id = (select id from locations where code = 'LOCAL') group by product_id, finished_lot_id, location_id having sum(qty) <> 0`;
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /No hay stock/ })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Vaciar la venta" }).click();
  });

  test("historial del día y del mes, y cierre de caja con diferencia", async ({ page, sql }) => {
    await page.goto("/local");
    await expect(page.getByTestId("stat-today")).toContainText("$ 24.000");
    await page.getByRole("tab", { name: "Ventas" }).click();
    const today = page.getByRole("table", { name: "Ventas de hoy" });
    await expect(today.getByRole("row", { name: /3 × Chipá tapitas 0,5 kg/ })).toContainText("Efectivo");
    await expect(today.getByRole("row", { name: /2 × Chipá lengüitas 0,5 kg/ })).toContainText(
      "Transferencia",
    );
    const month = page.getByRole("table", { name: "Ventas por día del mes" });
    await expect(month.getByRole("row", { name: /02\/10\/2026/ })).toContainText("$ 24.000");
    await expect(month.getByRole("row", { name: /02\/10\/2026/ })).toContainText("Abierta");

    await page.getByRole("tab", { name: "Cierre de caja" }).click();
    await expect(page.getByTestId("expected-cash")).toHaveText("$ 14.400");
    await expect(page.getByTestId("expected-transfer")).toHaveText("$ 9.600");
    await page.getByLabel("Efectivo contado").fill("14000");
    await expect(page.getByTestId("cash-difference")).toContainText("-$ 400");
    await expect(page.getByTestId("cash-difference")).toContainText("falta plata");
    await page.getByRole("button", { name: "Cerrar caja" }).click();
    await expectToast(page, "Caja cerrada: diferencia de -$ 400");
    await expect(page.getByRole("alert").filter({ hasText: "La caja de hoy está cerrada" })).toBeVisible();
    await expect(page.getByTestId("closing-difference")).toHaveText("-$ 400");

    const [closing] =
      await sql`select date::text as date, expected_cash::float8 as expected, counted_cash::float8 as counted,
      expected_transfer::float8 as transfer from cash_closings where created_at >= ${startedAt}`;
    expect(closing).toEqual({ date: "2026-10-02", expected: 14400, counted: 14000, transfer: 9600 });

    // Uno por día: no hay formulario para volver a cerrar y el historial lo marca.
    await page.getByRole("tab", { name: "Ventas" }).click();
    await expect(page.getByRole("table", { name: "Ventas por día del mes" })).toContainText(
      "Cerrada con diferencia",
    );
  });

  test("las pantallas del local no tienen scroll horizontal en el celular", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/local");
    for (const tab of ["Vender", "Ventas", "Cierre de caja", "Stock del local"]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), tab).toBe(
        true,
      );
    }
  });
});

test.describe("Permisos del local", () => {
  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("consulta el historial pero no vende ni cierra la caja", async ({ page }) => {
      await page.goto("/local");
      await expect(page.getByRole("tab", { name: "Vender" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Ventas" })).toBeVisible();
      await page.getByRole("tab", { name: "Cierre de caja" }).click();
      await expect(page.getByRole("button", { name: "Cerrar caja" })).toHaveCount(0);
    });
  });

  test.describe("operario", () => {
    test.use({ storageState: asRole("operator") });
    test("no accede al local", async ({ page }) => {
      await page.goto("/local");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
