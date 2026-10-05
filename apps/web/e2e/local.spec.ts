import type postgres from "postgres";
import { test, expect, asRole, demoDay, expectToast } from "./fixtures";

/**
 * M6 · El Local para el día a día (RF-33): venta de chipá, reventa y elaborados con lector de código de barras y
 * cuatro medios de pago, anulación, alertas de stock por demanda, pedido de reposición a la planta, cierre de caja
 * por medio de pago y permisos. El archivo arranca de la base demo intacta (aislamiento por archivo,
 * e2e/fixtures.ts); los tests comparten estado y corren en orden.
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

/** Unidades de un producto en LOCAL. */
async function localQty(sql: postgres.Sql, code: string) {
  const [r] = await sql`select coalesce(sum(qty), 0)::float8 as qty from v_product_stock ps
    join products p on p.id = ps.product_id
    where p.code = ${code} and ps.location_id = (select id from locations where code = 'LOCAL')`;
  return r!.qty as number;
}

const ar = (iso: string) => iso.split("-").reverse().join("/");

const TAP = "Chipá tapitas 0,5 kg";
const LEN = "Chipá lengüitas 0,5 kg";
const GAS = "Gaseosa 500 ml";
const AGUA = "Agua mineral 500 ml";
const HOR = "Chipá horneado 250 g (para llevar)";

test.describe("Local (RF-33)", () => {
  test.use({ storageState: asRole("store") });

  test("sin stock de chipá en el local no se vende chipá, pero sí la reventa; las alertas esperan las primeras ventas", async ({
    page,
  }) => {
    await page.goto("/local");
    await expect(page.getByRole("heading", { name: "Local", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Agregar ${HOR}` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Agregar ${GAS}` })).toContainText("48 en el local");
    await expect(page.getByTestId("store-alerts")).toContainText(
      "Todavía no hay ventas para medir la demanda",
    );
    await page.getByRole("tab", { name: "Stock del local" }).click();
    await expect(page.getByText("No hay producto en el local")).toHaveCount(0); // hay gaseosas y aguas
    await expect(page.getByRole("table", { name: "Stock del local por producto" })).toContainText(TAP);
  });

  test("vende desde el celular: cantidades +/−, total, medio de pago y descuento de stock del local", async ({
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
    await expect(page.getByRole("button", { name: `Agregar ${HOR}` })).toContainText("Alcanza para 10");

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

    // Segunda venta: dos lengüitas cobradas con tarjeta (se puede cobrar con tarjeta, no es un error).
    await page.getByRole("button", { name: `Agregar ${LEN}` }).click();
    await page.getByRole("button", { name: `Agregar ${LEN}` }).click();
    await expect(page.getByRole("radio", { name: "Tarjeta" })).toBeVisible();
    await page.getByRole("radio", { name: "Tarjeta" }).click();
    await expect(page.getByTestId("pos-total")).toHaveText("$ 9.600");
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expectToast(page, "Venta registrada: $ 9.600");
    const [second] = await sql`select s.method, p.method as pay_method, p.amount::float8 as amount
      from store_sales s join store_sale_payments p on p.sale_id = s.id order by s.created_at desc limit 1`;
    expect(second).toEqual({ method: "card", pay_method: "card", amount: 9600 });

    // No deja pasar el stock del local en la pantalla.
    for (let i = 0; i < 4; i++)
      await page.getByRole("button", { name: `Agregar ${TAP}` }).click({ force: true });
    await expect(page.getByLabel(`Cantidad de ${TAP}`)).toHaveText("2");
    await expect(page.getByRole("button", { name: `Agregar ${TAP}` })).toBeDisabled();
    await page.getByRole("button", { name: "Vaciar la venta" }).click();
  });

  test("lector de código de barras: escanear una gaseosa suma 1 y descuenta la reventa del local", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    const scan = page.getByLabel("Código de barras");
    await scan.fill("7790895000997");
    await scan.press("Enter");
    await scan.fill("7790895000997");
    await scan.press("Enter");
    await expect(page.getByLabel(`Cantidad de ${GAS}`)).toHaveText("2");
    await expect(page.getByTestId("pos-total")).toHaveText("$ 3.600");
    await expect(scan).toHaveValue("");
    // Un código desconocido avisa y no agrega nada.
    await scan.fill("0000000000000");
    await scan.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "No hay ningún producto con el código" }),
    ).toBeVisible();
    await expect(page.getByTestId("pos-total")).toHaveText("$ 3.600");

    await page.getByRole("radio", { name: "QR / billetera" }).click();
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expectToast(page, "Venta registrada: $ 3.600");
    const [sale] = await sql`select id, method from store_sales order by created_at desc limit 1`;
    expect(sale!.method).toBe("qr");
    const moves =
      await sql`select type, qty::float8 as qty, finished_lot_id from stock_movements where ref_id = ${sale!.id}`;
    expect(moves).toEqual([{ type: "store_sale", qty: -2, finished_lot_id: null }]);
    expect(await localQty(sql, "RV-GAS-500")).toBe(46);
  });

  test("búsqueda por nombre: un agua con transferencia", async ({ page, sql }) => {
    await page.goto("/local");
    await page.getByLabel("Buscar producto").fill("agua");
    await expect(page.getByRole("button", { name: `Agregar ${GAS}` })).toHaveCount(0);
    await page.getByRole("button", { name: `Agregar ${AGUA}` }).click();
    await page.getByRole("radio", { name: "QR / billetera" }).click();
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expectToast(page, "Venta registrada: $ 1.300");
    expect(await localQty(sql, "RV-AGU-500")).toBe(23);
  });

  test("vende un elaborado con pago dividido: la línea es el elaborado y el stock sale de la bolsa de tapitas", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    await page.getByLabel("Buscar producto").fill("horneado");
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: `Agregar ${HOR}` }).click();
    await expect(page.getByTestId("pos-total")).toHaveText("$ 9.600");

    await page.getByLabel("Dividir el pago").check();
    await page.getByLabel("Medio 1", { exact: true }).selectOption({ label: "Efectivo" });
    await page.getByLabel("Monto medio 1").fill("2000");
    await page.getByLabel("Medio 2", { exact: true }).selectOption({ label: "Transferencia" });
    await expect(page.getByTestId("pos-remainder")).toHaveText("$ 7.600");
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expectToast(page, "Venta registrada: $ 9.600");

    const [s] = await sql`select id from store_sales order by created_at desc limit 1`;
    const pays =
      await sql`select method, amount::float8 as amount from store_sale_payments where sale_id = ${s!.id} order by method`;
    expect(pays).toEqual([
      { method: "cash", amount: 2000 },
      { method: "transfer", amount: 7600 },
    ]);
    const items = await sql`select p.code, i.qty_units, i.unit_price::float8 as price from store_sale_items i
      join products p on p.id = i.product_id where i.sale_id = ${s!.id}`;
    expect(items).toEqual([{ code: "EL-HOR-250", qty_units: 3, price: 3200 }]);
    const moves = await sql`select p.code, m.type, m.qty::float8 as qty from stock_movements m
      join products p on p.id = m.product_id where m.ref_id = ${s!.id}`;
    expect(moves).toEqual([{ code: "CH-TAP-500", type: "store_sale", qty: -1.5 }]);
    expect(await localQty(sql, "CH-TAP-500")).toBe(0.5);
  });

  test("anula una venta cargada por error: pide motivo, devuelve el stock y deja de contar", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    await expect(page.getByTestId("stat-today")).toContainText("$ 38.500"); // 14.400 + 9.600 + 3.600 + 1.300 + 9.600
    await page.getByRole("tab", { name: "Ventas" }).click();
    const today = page.getByRole("table", { name: "Ventas de hoy" });
    const row = today.getByRole("row", { name: new RegExp(`2 × ${GAS}`) });
    await expect(row).toContainText("QR / billetera");
    await row.getByRole("button", { name: /^Anular/ }).click();
    const dialog = page.getByRole("dialog");
    // El motivo es obligatorio.
    await expect(dialog.getByRole("button", { name: "Anular la venta", exact: true })).toBeDisabled();
    await dialog.getByLabel("Motivo de la anulación").fill("Cargué mal el producto");
    await dialog.getByRole("button", { name: "Anular la venta", exact: true }).click();
    await expectToast(page, "Venta anulada: volvieron 2 unidades al stock");

    await expect(today.getByRole("row", { name: new RegExp(`2 × ${GAS}`) })).toContainText("Anulada");
    await expect(today.getByRole("row", { name: new RegExp(`2 × ${GAS}`) })).toContainText(
      "Cargué mal el producto",
    );
    await expect(page.getByTestId("stat-today")).toContainText("$ 34.900");
    expect(await localQty(sql, "RV-GAS-500")).toBe(48);
    const [v] =
      await sql`select voided_at is not null as voided, void_reason, voided_by_id is not null as by_user
      from store_sales where void_reason is not null`;
    expect(v).toEqual({ voided: true, void_reason: "Cargué mal el producto", by_user: true });
    const returns =
      await sql`select qty::float8 as qty from stock_movements where type = 'return' and note like 'Anulación de venta%'`;
    expect(returns).toEqual([{ qty: 2 }]);
  });

  test("si el stock cambió mientras tanto, el servidor rechaza la venta con un mensaje claro", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    await page.getByRole("button", { name: `Agregar ${GAS}` }).click();
    // Alguien más se llevó lo que quedaba del local.
    await sql`insert into stock_movements (type, item_kind, product_id, location_id, qty)
      select 'adjustment', 'product', product_id, location_id, -sum(qty)
      from v_product_stock where product_id = (select id from products where code = 'RV-GAS-500')
        and location_id = (select id from locations where code = 'LOCAL') group by product_id, location_id`;
    await page.getByRole("button", { name: /^Cobrar/ }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /No hay stock de Gaseosa 500 ml/ })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Vaciar la venta" }).click();
  });

  test("las alertas miden la demanda y el local pide reposición a la planta con las cantidades sugeridas", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    const panel = page.getByTestId("store-alerts");
    // Hoy se vendieron 3 tapitas + 3 elaborados (1,5 bolsas) y quedan 0,5 bolsas; lengüitas: 2 vendidas, quedan 2.
    const tapRow = panel.getByRole("listitem").filter({ hasText: TAP });
    await expect(tapRow).toContainText("Reponer");
    await expect(tapRow).toContainText("se vende 4,5 por día (incluye elaborados)");
    await expect(tapRow.getByLabel(`Cantidad a pedir de ${TAP}`)).toHaveValue("18"); // 4,5 × (1 + 3) − 0,5
    const lenRow = panel.getByRole("listitem").filter({ hasText: LEN });
    await expect(lenRow).toContainText("Reponer");
    await expect(lenRow.getByLabel(`Cantidad a pedir de ${LEN}`)).toHaveValue("6"); // 2 × 4 − 2
    // La reventa sin ventas y el agua con stock de sobra no alertan.
    await expect(panel).not.toContainText(AGUA);

    // La cantidad sugerida se puede editar y la fecha de necesidad elegir.
    await tapRow.getByLabel(`Cantidad a pedir de ${TAP}`).fill("20");
    await panel.getByLabel("Se necesita para el").fill(demoDay(2));
    await panel.getByRole("button", { name: "Pedir reposición" }).click();
    await expectToast(page, /Pedido de reposición #1 enviado a la planta/);

    const items = await sql`select p.code, i.qty_requested, i.qty_sent from store_replenishment_items i
      join products p on p.id = i.product_id order by p.code`;
    expect(items).toEqual([
      { code: "CH-LEN-500", qty_requested: 6, qty_sent: null },
      { code: "CH-TAP-500", qty_requested: 20, qty_sent: null },
    ]);
    const [rep] = await sql`select status, needed_by::text as needed_by from store_replenishments`;
    expect(rep).toEqual({ status: "requested", needed_by: demoDay(2) });

    // Lo ya pedido se descuenta de la sugerencia y queda visible en la pestaña de reposición.
    await expect(tapRow).toContainText("Ya pediste 20 a la planta");
    await page.getByRole("tab", { name: /^Reposición/ }).click();
    const card = page.getByRole("list", { name: "Pedidos de reposición" }).getByRole("listitem").first();
    await expect(card).toContainText("Pedido #1");
    await expect(card).toContainText("Pedida");
    await expect(card).toContainText(`20 × ${TAP}`);
    await expect(card).toContainText(`Se necesita para el ${ar(demoDay(2))}`);
  });

  test("ingreso de mercadería de reventa: suma stock al local con costo y proveedor", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    await page.getByRole("tab", { name: "Mercadería" }).click();
    await page.getByLabel("Producto 1").selectOption({ label: GAS });
    await page.getByLabel("Cantidad 1").fill("24");
    await page.getByLabel("Costo 1").fill("1150");
    await page.getByLabel("Proveedor (opcional)").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Ingresar al local" }).click();
    await expectToast(page, "Ingreso registrado: 1 producto sumado al local");
    // La gaseosa estaba en 0 (se la llevaron en el test anterior): ahora hay 24.
    expect(await localQty(sql, "RV-GAS-500")).toBe(24);
    const [cost] = await sql`select unit_cost_net::float8 as cost, supplier_id is not null as has_supplier
      from product_costs where product_id = (select id from products where code = 'RV-GAS-500') order by created_at desc limit 1`;
    expect(cost).toEqual({ cost: 1150, has_supplier: true });
  });
});

test.describe("La planta envía la reposición", () => {
  test.use({ storageState: asRole("production_manager") });

  test("la jefa de producción ve el pedido y lo envía: F3/F4 → local por FEFO", async ({ page, sql }) => {
    const [before] = await sql`select coalesce(sum(qty),0)::float8 as qty from v_product_stock
      where product_id = (select id from products where code = 'CH-TAP-500')
        and location_id in (select id from locations where code in ('F3','F4'))`;
    await page.goto("/stock/reposicion");
    await expect(page.getByRole("heading", { name: "Pedidos del local para enviar" })).toBeVisible();
    const card = page.getByRole("article", { name: "Pedido de reposición 1" });
    await expect(card).toContainText(`Pidió 20 · en F3 + F4 hay ${before!.qty}`);
    await expect(card).toContainText(`se necesita para el ${ar(demoDay(2))}`);
    await expect(card.getByLabel(`Unidades a enviar de ${TAP} (pedido 1)`)).toHaveValue("20");
    await card.getByRole("button", { name: "Enviar el pedido 1 al local" }).click();
    await expectToast(page, "Pedido #1 enviado: 26 unidades pasaron al local");
    await expect(page.getByText("No hay pedidos de reposición pendientes")).toBeVisible();

    // Stock: el local suma lo enviado y la planta lo resta; las transferencias quedan con el número del pedido.
    expect(await localQty(sql, "CH-TAP-500")).toBe(20.5);
    expect(await localQty(sql, "CH-LEN-500")).toBe(8);
    const [after] = await sql`select coalesce(sum(qty),0)::float8 as qty from v_product_stock
      where product_id = (select id from products where code = 'CH-TAP-500')
        and location_id in (select id from locations where code in ('F3','F4'))`;
    expect(after!.qty).toBe(before!.qty - 20);
    const moves =
      await sql`select count(*)::int as n from stock_movements where type = 'transfer' and note = 'Reposición del local #1'`;
    expect(moves[0]!.n).toBeGreaterThanOrEqual(4);
    const [rep] = await sql`select status, sent_by_id is not null as sent from store_replenishments`;
    expect(rep).toEqual({ status: "sent", sent: true });
    await expect(page.getByRole("list", { name: "Pedidos de reposición" })).toContainText("Enviada");
  });
});

test.describe("El local recibe y cierra la caja", () => {
  test.use({ storageState: asRole("store") });

  test("el local ve el pedido enviado y confirma la recepción; las alertas se actualizan", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    await expect(page.getByTestId("store-alerts")).toContainText("Todo en orden");
    await page.getByRole("tab", { name: /^Reposición/ }).click();
    const card = page.getByRole("list", { name: "Pedidos de reposición" }).getByRole("listitem").first();
    await expect(card).toContainText("Enviada");
    await card.getByRole("button", { name: "Confirmar recepción del pedido 1" }).click();
    await expectToast(page, "Pedido #1 recibido");
    await expect(card).toContainText("Recibida");
    const [rep] = await sql`select status, received_by_id is not null as received from store_replenishments`;
    expect(rep).toEqual({ status: "received", received: true });
    await page.getByRole("tab", { name: "Stock del local" }).click();
    const stock = page.getByRole("table", { name: "Stock del local por producto" });
    await expect(stock.getByRole("row", { name: /^Chipá tapitas 0,5 kg Chipá de la planta/ })).toContainText(
      "OK",
    );
    await expect(stock.getByRole("row", { name: HOR })).toContainText("Se arma al vender");
  });

  test("historial del día y del mes, y cierre de caja por medio de pago con diferencia", async ({
    page,
    sql,
  }) => {
    await page.goto("/local");
    // Sin la anulada: efectivo 14.400 + 2.000, transferencia 7.600, tarjeta 9.600, QR 1.300.
    await expect(page.getByTestId("stat-today")).toContainText("$ 34.900");
    await page.getByRole("tab", { name: "Ventas" }).click();
    const today = page.getByRole("table", { name: "Ventas de hoy" });
    await expect(today.getByRole("row", { name: /3 × Chipá tapitas 0,5 kg/ })).toContainText("Efectivo");
    await expect(today.getByRole("row", { name: /2 × Chipá lengüitas 0,5 kg/ })).toContainText("Tarjeta");
    const split = today.getByRole("row", { name: `3 × ${HOR}`, exact: false });
    await expect(split).toContainText("Efectivo");
    await expect(split).toContainText("Transferencia");
    const month = page.getByRole("table", { name: "Ventas por día del mes" });
    await expect(month.getByRole("row", { name: /02\/10\/2026/ })).toContainText("$ 34.900");
    await expect(month.getByRole("row", { name: /02\/10\/2026/ })).toContainText("Abierta");

    await page.getByRole("tab", { name: "Cierre de caja" }).click();
    await expect(page.getByTestId("expected-cash")).toHaveText("$ 16.400");
    await expect(page.getByTestId("expected-transfer")).toHaveText("$ 7.600");
    await expect(page.getByTestId("expected-card")).toHaveText("$ 9.600");
    await expect(page.getByTestId("expected-qr")).toHaveText("$ 1.300");
    await page.getByLabel("Efectivo contado").fill("16000");
    await expect(page.getByTestId("cash-difference")).toContainText("-$ 400");
    await expect(page.getByTestId("cash-difference")).toContainText("falta plata");
    await page.getByRole("button", { name: "Cerrar caja" }).click();
    await expectToast(page, "Caja cerrada: diferencia de -$ 400");
    await expect(page.getByRole("alert").filter({ hasText: "La caja de hoy está cerrada" })).toBeVisible();
    await expect(page.getByTestId("closing-difference")).toHaveText("-$ 400");

    const [closing] =
      await sql`select date::text as date, expected_cash::float8 as cash, counted_cash::float8 as counted,
      expected_transfer::float8 as transfer, expected_card::float8 as card, expected_qr::float8 as qr
      from cash_closings where created_at >= ${startedAt}`;
    expect(closing).toEqual({
      date: demoDay(0),
      cash: 16400,
      counted: 16000,
      transfer: 7600,
      card: 9600,
      qr: 1300,
    });

    // Uno por día: no hay formulario para volver a cerrar y el historial lo marca.
    await page.getByRole("tab", { name: "Ventas" }).click();
    await expect(page.getByRole("table", { name: "Ventas por día del mes" })).toContainText(
      "Cerrada con diferencia",
    );
  });

  test("con la caja cerrada la empleada ya no puede anular ventas", async ({ page }) => {
    await page.goto("/local");
    await page.getByRole("tab", { name: "Ventas" }).click();
    await expect(page.getByRole("button", { name: /^Anular/ })).toHaveCount(0);
    await expect(page.getByText("las ventas solo las puede anular Dirección")).toBeVisible();
  });

  test("las pantallas del local no tienen scroll horizontal en el celular", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/local");
    for (const tab of [
      "Vender",
      "Ventas",
      /^Reposición/,
      "Mercadería",
      "Cierre de caja",
      "Stock del local",
    ]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        String(tab),
      ).toBe(true);
    }
  });

  test("el local no ve clientes, pedidos ni el stock general", async ({ page }) => {
    await page.goto("/local");
    await expect(page.getByRole("link", { name: "Clientes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Pedidos" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Stock", exact: true })).toHaveCount(0);
    for (const url of ["/clientes", "/pedidos", "/stock", "/stock/producto-terminado", "/stock/reposicion"]) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/sin-permiso/);
    }
  });
});

test.describe("Permisos del local", () => {
  test.describe("Dirección", () => {
    test.use({ storageState: asRole("admin") });
    test("puede anular una venta aunque la caja esté cerrada y el cierre queda marcado", async ({
      page,
      sql,
    }) => {
      await page.goto("/local");
      await page.getByRole("tab", { name: "Ventas" }).click();
      const row = page
        .getByRole("table", { name: "Ventas de hoy" })
        .getByRole("row", { name: new RegExp(`1 × ${AGUA}`) });
      await row.getByRole("button", { name: /^Anular/ }).click();
      await page.getByLabel("Motivo de la anulación").fill("Cobro duplicado");
      await page.getByRole("dialog").getByRole("button", { name: "Anular la venta", exact: true }).click();
      await expectToast(page, "Venta anulada: volvió 1 unidad al stock");
      expect(await localQty(sql, "RV-AGU-500")).toBe(24);
      await page.getByRole("tab", { name: "Cierre de caja" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Hubo ventas o anulaciones después del cierre" }),
      ).toBeVisible();
    });
  });

  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("consulta el historial y las alertas pero no vende, repone ni cierra la caja", async ({ page }) => {
      await page.goto("/local");
      await expect(page.getByRole("tab", { name: "Vender" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Mercadería" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Ventas" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pedir reposición" })).toHaveCount(0);
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
