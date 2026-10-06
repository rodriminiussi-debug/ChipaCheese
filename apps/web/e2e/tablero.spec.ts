import ExcelJS from "exceljs";
import { test, expect, asRole, expectToast } from "./fixtures";

/**
 * M8 · Tablero, costeo, gastos fijos y resultado mensual (RF-39 a RF-42).
 * El archivo arranca de la base demo intacta (aislamiento por archivo, e2e/fixtures.ts). Hoy = 02/10/2026.
 * Septiembre: UNA factura (La Reina, $468.000 con IVA = $386.776,86 netos), 120 bolsas, una producción,
 * gastos fijos por $1.040.000 → resultado −$1.108.282 (ver service.test.ts de finance).
 */
test.describe.configure({ mode: "serial" });

test.describe("Tablero de Dirección (RF-41)", () => {
  test.use({ storageState: asRole("admin") });

  test("muestra los indicadores, el resultado y las alertas accionables con links que navegan", async ({
    page,
  }) => {
    await page.goto("/tablero?mes=2026-09");
    await expect(page.getByRole("heading", { name: "Tablero", level: 1 })).toBeVisible();

    // Indicadores operativos: semana 28/09–02/10, 149,3 kg sobre 5 × 150.
    await expect(page.getByTestId("kpi-capacity")).toContainText("19,9");
    await expect(page.getByTestId("kpi-capacity")).toContainText("149,3 kg");
    await expect(page.getByTestId("kpi-otif")).toContainText("100,0");
    await expect(page.getByTestId("kpi-otif")).toContainText("7 de 7");
    await expect(page.getByTestId("kpi-coverage")).toContainText("2 bajo punto de pedido");

    // Plata: costo por bolsa con el último precio y el rendimiento real, deuda y resultado.
    await expect(page.getByTestId("kpi-cost-bag")).toContainText("$ 3.194,03");
    await expect(page.getByTestId("kpi-receivables")).toContainText("$ 268.000");
    await expect(page.getByTestId("kpi-result")).toContainText("-$ 1.108.282");
    await expect(page.getByTestId("kpi-withdrawals")).toContainText("No cubre");
    await expect(page.getByTestId("chart-margin")).toContainText("Revendedores (mayorista)");
    await expect(page.getByTestId("chart-top-customers")).toContainText("Supermercado La Reina");

    // Alertas: cada una navega a donde se resuelve.
    const alerts = page.getByRole("list", { name: "Alertas" });
    await expect(alerts.getByRole("link", { name: /Insumos a reponer/ })).toContainText("Jamón feteado");
    await alerts.getByRole("link", { name: /Insumos a reponer/ }).click();
    await expect(page).toHaveURL(/\/stock$/);

    await page.goto("/tablero");
    await page
      .getByRole("list", { name: "Alertas" })
      .getByRole("link", { name: /Faltan precios de compra/ })
      .click();
    await expect(page).toHaveURL(/\/costos$/);
    await expect(page.getByRole("alert").filter({ hasText: "Faltan precios de compra" })).toContainText(
      "Jamón feteado",
    );

    await page.goto("/tablero");
    await page
      .getByRole("list", { name: "Alertas" })
      .getByRole("link", { name: /Temperaturas sin registrar hoy/ })
      .click();
    await expect(page).toHaveURL(/\/calidad\?vista=temperaturas/);
  });

  test("gráficos por tema: título que es la pregunta, lectura accesible y tabla alternativa", async ({
    page,
  }) => {
    await page.goto("/tablero?mes=2026-09");
    for (const group of ["Ventas y resultado", "Costos y reparto", "Cobranzas", "Producción", "Calidad"])
      await expect(page.getByRole("heading", { name: group, level: 2, exact: true })).toBeVisible();

    const questions = [
      "¿Cómo vienen las ventas?",
      "¿Estamos ganando?",
      "¿Qué canal deja más margen?",
      "¿Quiénes compran más?",
      "¿Cómo evoluciona el costo por bolsa?",
      "¿Cuánto cuesta repartir?",
      "¿Cuánto nos deben y hace cuánto?",
      "¿Cuánto producimos contra la capacidad?",
      "¿Cuánto rinde cada producción?",
      "¿Alcanza la materia prima?",
      "¿Entregamos a tiempo y completo?",
      "¿Cuánto vende el local por día?",
    ];
    for (const q of questions) {
      await expect(page.getByRole("heading", { name: q, level: 3 })).toBeVisible();
      // Cada gráfico lleva su lectura como descripción accesible.
      await expect(
        page.getByRole("img", { name: new RegExp(`^${q.replace("?", "\\?")} .+`) }),
      ).toBeAttached();
    }
    // Septiembre sin datos de ventas previos: la lectura compara contra agosto o lo dice.
    await expect(page.getByTestId("chart-sales")).toContainText(/Septiembre: \$ 387 mil/);
    await expect(page.getByTestId("chart-result")).toContainText("no cubre los retiros de $ 9,0 M");
    await expect(page.getByTestId("chart-aging")).toContainText(
      "$ 268 mil por cobrar, todo dentro del plazo",
    );

    // La tabla alternativa trae los mismos valores.
    const sales = page.getByTestId("chart-sales");
    await sales.getByText("Ver como tabla").click();
    await expect(sales.getByRole("table", { name: "Ventas netas por canal y mes" })).toContainText(
      "$ 386.777",
    );
    const production = page.getByTestId("chart-production");
    await production.getByText("Ver como tabla").click();
    await expect(production.getByRole("table", { name: "Producción diaria" })).toContainText("149,3 kg");
  });

  test("alertas nuevas: lotes por vencer, proveedores atrasados, aumentos de precio y pedidos sin preparar", async ({
    page,
    sql,
  }) => {
    test.slow();
    await page.goto("/tablero");
    const alerts = page.getByRole("list", { name: "Alertas" });
    // El pedido del Club Náutico es para el próximo día hábil (lunes) y todavía no está listo.
    await expect(alerts.getByRole("link", { name: /Pedidos del lunes sin preparar/ })).toContainText(
      "Club Náutico",
    );

    await sql`update finished_lots set expiry_date = '2026-10-20' where code = '260901-1'`;
    await sql`update raw_lots set expiry_date = '2026-10-05' where supplier_lot_code = 'LEC-0928'`;
    await sql`insert into purchase_orders (number, supplier_id, ordered_at, expected_at, status)
      select 'OC-E2E', id, '2026-09-20', '2026-09-30', 'sent' from suppliers limit 1`;
    await sql`insert into ingredient_prices (ingredient_id, supplier_id, date, unit_price_net)
      select i.id, p.supplier_id, '2026-10-01', 1500 from ingredients i
      join ingredient_prices p on p.ingredient_id = i.id where i.name = 'Leche' limit 1`;
    await page.reload();
    await expect(alerts.getByRole("link", { name: /Lotes de producto terminado por vencer/ })).toContainText(
      "260901-1",
    );
    await expect(alerts.getByRole("link", { name: /Lotes de materia prima por vencer/ })).toContainText(
      "Leche",
    );
    await expect(alerts.getByRole("link", { name: /Entregas de proveedores atrasadas/ })).toBeVisible();
    await expect(alerts.getByRole("link", { name: /Aumentos de precio de compra/ })).toContainText("Leche +");

    // Cada una lleva a donde se resuelve.
    await expect(alerts.getByRole("link", { name: /Entregas de proveedores atrasadas/ })).toHaveAttribute(
      "href",
      "/compras/ordenes",
    );
    await expect(alerts.getByRole("link", { name: /Lotes de materia prima por vencer/ })).toHaveAttribute(
      "href",
      "/stock",
    );
    await expect(alerts.getByRole("link", { name: /Aumentos de precio de compra/ })).toHaveAttribute(
      "href",
      /^\/compras\/precios\//,
    );
    await alerts.getByRole("link", { name: /Lotes de producto terminado por vencer/ }).click();
    await expect(page).toHaveURL(/\/stock\/producto-terminado/, { timeout: 30_000 });

    // Limpieza: los tests siguientes del archivo (costos) no deben ver el aumento de precio ni la OC.
    await sql`delete from ingredient_prices where date = '2026-10-01' and unit_price_net = 1500`;
    await sql`delete from purchase_orders where number = 'OC-E2E'`;
  });

  test("cambia el mes de los indicadores", async ({ page }) => {
    await page.goto("/tablero");
    // Octubre recién empieza: sin ventas facturadas todavía.
    await expect(page.getByTestId("kpi-sales")).toContainText("$ 0");
    await page.getByLabel("Mes de los indicadores").fill("2026-09");
    await page.getByRole("button", { name: "Ver" }).click();
    await expect(page).toHaveURL(/mes=2026-09/);
    await expect(page.getByTestId("kpi-sales")).toContainText("$ 386.777");
  });

  test("no tiene scroll horizontal en el celular", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [
      "/tablero?mes=2026-09",
      "/costos",
      "/costos/gastos?mes=2026-09",
      "/costos/resultado?mes=2026-09",
    ]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(
        true,
      );
    }
  });
});

test.describe("Tablero de la jefa de producción", () => {
  test.use({ storageState: asRole("production_manager") });

  test("ve sólo indicadores operativos: nada de montos, márgenes, deuda ni precios", async ({ page }) => {
    await page.goto("/tablero?mes=2026-09");
    await expect(page.getByRole("heading", { name: "Tablero", level: 1 })).toBeVisible();
    await expect(page.getByTestId("kpi-capacity")).toContainText("19,9");
    await expect(page.getByTestId("kpi-otif")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Alertas" }).getByRole("link", { name: /Insumos a reponer/ }),
    ).toBeVisible();
    await expect(page.getByTestId("chart-production")).toBeVisible();
    // Gráficos operativos sí; ninguno con montos.
    for (const q of [
      "¿Cuánto rinde cada producción?",
      "¿Alcanza la materia prima?",
      "¿Entregamos a tiempo y completo?",
    ])
      await expect(page.getByRole("heading", { name: q, level: 3 })).toBeVisible();
    for (const id of ["sales", "result", "margin", "top-customers", "cost-bag", "delivery-cost", "aging"])
      await expect(page.getByTestId(`chart-${id}`)).toHaveCount(0);
    for (const h of ["Ventas y resultado", "Costos y reparto", "Cobranzas"])
      await expect(page.getByRole("heading", { name: h, exact: true })).toHaveCount(0);
    // Los avisos de lotes y pedidos los ve también, sin plata.
    await expect(page.getByRole("list", { name: "Alertas" })).toContainText("Pedidos del lunes sin preparar");

    // Ni un solo monto en la pantalla.
    const text = await page.locator("main, body").first().innerText();
    expect(text).not.toContain("$");
    for (const hidden of [
      "Resultado de",
      "Deuda de clientes",
      "Margen por canal",
      "Costo por bolsa",
      "Cheques",
      "Precios bajo costo",
    ])
      await expect(page.getByText(hidden)).toHaveCount(0);

    // Tampoco entra a las pantallas de finanzas ni al Excel del resultado.
    await page.goto("/costos");
    await expect(page).toHaveURL(/sin-permiso/);
    await page.goto("/costos/resultado");
    await expect(page).toHaveURL(/sin-permiso/);
    const res = await page.request.get("/api/costos/resultado/export?mes=2026-09");
    expect(res.status()).toBe(403);
  });
});

test.describe("Costo por producto y simulador (RF-39)", () => {
  test.use({ storageState: asRole("admin") });

  test("costo por kg y por bolsa con rendimiento real, desglose, nota del Excel y precios faltantes", async ({
    page,
  }) => {
    await page.goto("/costos");
    await expect(page.getByRole("heading", { name: "Costo por kg y por bolsa" })).toBeVisible();
    await expect(page.getByTestId("stat-cost-kg")).toContainText("$ 6.108,06");
    await expect(page.getByTestId("stat-cost-bag")).toContainText("$ 3.194,03");
    await expect(page.getByText("149,3 kg").first()).toBeVisible();

    const breakdown = page.getByRole("table", { name: "Desglose del costo por insumo" });
    await expect(breakdown.getByRole("row", { name: /Queso barra/ })).toContainText("28,");
    await expect(page.getByText(/Lácteos \(quesos, manteca y leche\): 76,1/)).toBeVisible();

    // El sándwich y los granel no tienen todos los precios: se marca, no se asume $0.
    const products = page.getByRole("table", { name: "Costo por producto" });
    await expect(products.getByRole("row", { name: /Chisanwich/ })).toContainText("Precio faltante");
    await expect(page.getByRole("alert").filter({ hasText: "Faltan precios de compra" })).toContainText(
      "Queso feteado",
    );

    // Lo que el Excel calculaba mal.
    await expect(page.getByText("Qué calculaba mal el Excel")).toBeVisible();
    await expect(page.getByText(/163,5 kg/).first()).toBeVisible();
    await expect(page.getByText("$ 4.843,63")).toBeVisible();
  });

  test("sensibilidad: quesos −5 % baja ≈ 2,7 % el costo de ingredientes y mueve los márgenes", async ({
    page,
  }) => {
    await page.goto("/costos");
    await expect(page.getByTestId("sim-ingredients")).toContainText("sin cambios");
    await page.getByRole("button", { name: "Quesos −5 %" }).click();
    await expect(page.getByLabel("Cambio en Queso reggianito (%)")).toHaveValue("-5");
    await expect(page.getByTestId("sim-ingredients-delta")).toHaveText(/−2,6[78] %/);
    await expect(page.getByTestId("sim-cost-kg")).toContainText("antes $ 6.108,06");

    // Costo por bolsa simulado en la tabla y margen del mayorista: 23,9 % → 25,0 %+.
    const table = page.getByRole("table", { name: "Resultado de la simulación por producto" });
    const row = table.getByRole("row", { name: /Chipá tapitas 0,5 kg/ });
    await expect(row).toContainText("$ 3.194,03");
    await expect(row).toContainText(/−\d,\d+ %/);

    // Un aumento de la leche de 10 %: el costo sube y el botón Limpiar vuelve a lo actual.
    await page.getByRole("button", { name: "Limpiar" }).click();
    await page.getByLabel("Cambio en Leche (%)").fill("10");
    await expect(page.getByTestId("sim-ingredients-delta")).toHaveText(/\+0,4\d %/);
    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(page.getByTestId("sim-ingredients")).toContainText("sin cambios");
  });
});

test.describe("Gastos fijos y resultado mensual (RF-40, RF-42)", () => {
  test.use({ storageState: asRole("admin") });

  test("copiar el mes anterior y editar un gasto cambia el resultado", async ({ page }) => {
    // Octubre: una producción (mano de obra $120.000) y ningún gasto fijo cargado.
    await page.goto("/costos/resultado?mes=2026-10");
    await expect(page.getByTestId("stat-result")).toContainText("-$ 120.000");
    await expect(page.getByTestId("pnl-fixed")).toContainText("$ 0");

    await page.goto("/costos/gastos?mes=2026-10");
    await expect(page.getByText("Todavía no hay gastos cargados en octubre de 2026")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Faltan categorías" })).toContainText("Vehículo");
    await page.getByRole("button", { name: "Copiar del mes anterior" }).click();
    await expectToast(page, "Se copiaron 7 gasto(s) de septiembre de 2026");
    await expect(page.getByTestId("expenses-total")).toContainText("$ 1.040.000");

    // Editar el alquiler: 300.000 → 350.000.
    await page.getByRole("button", { name: "Editar Alquiler" }).click();
    await page.getByLabel("Importe del mes").fill("350000");
    await page.getByRole("button", { name: "Guardar gasto" }).click();
    await expectToast(page, "Gasto actualizado");
    await expect(page.getByTestId("expenses-total")).toContainText("$ 1.090.000");

    // Agregar uno de una categoría que el Excel no tenía: el aviso de esa categoría desaparece.
    await page.getByRole("button", { name: "Agregar gasto" }).click();
    await page.getByLabel("Concepto").fill("Patente camioneta");
    await page.getByLabel("Categoría").selectOption("vehicle");
    await page.getByLabel("Importe del mes").fill("40000");
    await page.getByRole("button", { name: "Guardar gasto" }).click();
    await expectToast(page, "Gasto agregado");
    await expect(page.getByTestId("expenses-total")).toContainText("$ 1.130.000");
    await expect(page.getByRole("alert").filter({ hasText: "Faltan categorías" })).not.toContainText(
      "Vehículo",
    );

    // Un concepto repetido en el mes se rechaza con un mensaje claro.
    await page.getByRole("button", { name: "Agregar gasto" }).click();
    await page.getByLabel("Concepto").fill("alquiler");
    await page.getByLabel("Importe del mes").fill("1");
    await page.getByRole("button", { name: "Guardar gasto" }).click();
    await expect(page.getByText("Ya existe en el mes")).toBeVisible();
    await page.keyboard.press("Escape");

    // El resultado de octubre refleja los gastos: −120.000 de mano de obra −1.130.000 de fijos.
    await page.goto("/costos/resultado?mes=2026-10");
    await expect(page.getByTestId("pnl-fixed")).toContainText("$ 1.130.000");
    await expect(page.getByTestId("stat-result")).toContainText("-$ 1.250.000");

    // Eliminar un gasto pide confirmación.
    await page.goto("/costos/gastos?mes=2026-10");
    await page.getByRole("button", { name: "Eliminar Patente camioneta" }).click();
    await page.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectToast(page, "Gasto eliminado");
    await expect(page.getByTestId("expenses-total")).toContainText("$ 1.090.000");
  });

  test("resultado de septiembre: ventas, costo de ventas, mano de obra, fijos y avisos", async ({ page }) => {
    await page.goto("/costos/resultado?mes=2026-09");
    await expect(page.getByRole("heading", { name: /Resultado · septiembre de 2026/ })).toBeVisible();
    await expect(page.getByTestId("pnl-sales")).toContainText("$ 386.776,86");
    await expect(page.getByTestId("pnl-cost-of-sales")).toContainText("$ 335.059,2");
    await expect(page.getByTestId("pnl-gross")).toContainText("$ 51.717,66");
    await expect(page.getByTestId("pnl-labor")).toContainText("$ 120.000");
    await expect(page.getByTestId("pnl-fixed")).toContainText("$ 1.040.000");
    await expect(page.getByTestId("pnl-result")).toContainText("-$ 1.108.282,34");
    await expect(page.getByText("Hay pedidos entregados sin factura")).toBeVisible();
    await expect(page.getByText(/Cómo se calcula \(y qué es aproximado\)/)).toBeVisible();
    await expect(page.getByRole("img", { name: /Resultado de los últimos seis meses/ })).toBeVisible();
  });

  test("exporta el resultado a Excel", async ({ page }) => {
    await page.goto("/costos/resultado?mes=2026-09");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Exportar a Excel" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("resultado-2026-09.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Resultado",
      "Ventas por canal",
      "Costo de ventas",
      "Gastos fijos",
      "Avisos",
    ]);
    const pnl = wb.getWorksheet("Resultado")!;
    const labels = pnl.getColumn(1).values as (string | undefined)[];
    const resultRow = labels.indexOf("Resultado");
    expect(pnl.getRow(resultRow).getCell(2).value).toBe(-1108282.34);
  });

  test("¿el resultado cubre los retiros?: se editan los retiros y se ve la diferencia", async ({
    page,
    sql,
  }) => {
    await page.goto("/costos/resultado?mes=2026-09");
    const card = page.getByTestId("withdrawals-card");
    await expect(card.getByTestId("covers-verdict")).toHaveText("No cubre los retiros");
    await expect(card.getByTestId("covers-detail")).toContainText("$ 9.000.000");
    await expect(card.getByTestId("covers-detail")).toContainText("Faltan $ 10.108.282");

    // Editar los retiros a $1.000.000: sigue sin cubrir, falta menos.
    await card.getByLabel("Retiros mensuales de los socios ($)").fill("1.000.000");
    await card.getByRole("button", { name: "Guardar retiros" }).click();
    await expectToast(page, "Retiros actualizados");
    await expect(card.getByTestId("covers-detail")).toContainText("Retiros: $ 1.000.000");
    await expect(card.getByTestId("covers-detail")).toContainText("Faltan $ 2.108.282");
    const saved = await sql`select value from app_settings where key = 'finance.partner_withdrawals_monthly'`;
    expect(saved[0]!.value).toBe(1000000);

    // Con una venta grande el mes sí cubre; subiendo los retiros deja de cubrir.
    await sql`insert into sales_invoices (customer_id, invoice_type, point_of_sale, number, issue_date, due_date, net_total, vat_total, total)
      select id, 'A', '0009', '00000001', '2026-09-20', '2026-10-20', 20000000, 4200000, 24200000
      from customers where legal_name = 'Supermercado La Reina'`;
    await page.reload();
    await expect(card.getByTestId("covers-verdict")).toHaveText("Cubre los retiros");
    await expect(card.getByTestId("covers-detail")).toContainText("Sobran");
    await card.getByLabel("Retiros mensuales de los socios ($)").fill("30000000");
    await card.getByRole("button", { name: "Guardar retiros" }).click();
    await expectToast(page, "Retiros actualizados");
    await expect(card.getByTestId("covers-verdict")).toHaveText("No cubre los retiros");
  });
});

test.describe("Permisos de finanzas", () => {
  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("no entra a costos ni al tablero", async ({ page }) => {
      await page.goto("/costos/gastos");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/tablero");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
