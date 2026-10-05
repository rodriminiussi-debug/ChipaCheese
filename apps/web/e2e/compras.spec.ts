import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { test, expect, asRole, expectToast } from "./fixtures";

const FACTURA = resolve(import.meta.dirname, "fixtures", "factura-prueba.png");

// Los tests comparten la base y dependen del orden: proveedores → factura → OC y recepción → pago → permisos.
test.describe.configure({ mode: "serial" });

test.describe("Compras y proveedores (M2)", () => {
  test.use({ storageState: asRole("admin") });

  test("RF-07: ficha de proveedor con CUIT validado, WhatsApp e insumos con precio", async ({ page }) => {
    await page.goto("/proveedores");
    await expect(page.getByRole("link", { name: "Leo Pelle" })).toBeVisible();
    await page.getByLabel("Buscar proveedores").fill("cotar");
    await page.getByLabel("Buscar proveedores").press("Enter");
    await expect(page.getByRole("link", { name: "Cotar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Leo Pelle" })).toHaveCount(0);

    // Alta con CUIT inválido y luego válido
    await page.goto("/proveedores/nuevo");
    await page.getByLabel("Razón social *").fill("Distribuidora E2E SRL");
    await page.getByLabel("CUIT").fill("30-70123456-0");
    await page.getByRole("button", { name: "Crear proveedor" }).click();
    await expect(page.getByText("CUIT inválido")).toBeVisible();
    await page.getByLabel("CUIT").fill("30-70123456-8");
    await page.getByLabel("Plazo de entrega (días)").fill("3");
    await page.getByLabel("Plazo de pago (días)").fill("15");
    await page.getByRole("button", { name: "Crear proveedor" }).click();
    await expectToast(page, "Proveedor creado");
    await expect(page.getByRole("heading", { name: "Distribuidora E2E SRL" })).toBeVisible();

    // Leo Pelle: cargar el WhatsApp (el pedido por OC sale por ahí) y ver sus insumos con el último precio
    await page.goto("/proveedores");
    await page.getByRole("link", { name: "Leo Pelle" }).click();
    await page.getByLabel("WhatsApp").fill("+54 9 341 555-1234");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expectToast(page, "Cambios guardados");
    await page.getByRole("tab", { name: "Insumos y precios" }).click();
    await expect(page.getByText("Fécula de mandioca")).toBeVisible();
    await expect(page.getByText("$ 1.728")).toBeVisible();
  });

  test("RF-08/09: factura por foto → revisión con diferencias → mapeo → confirmación → precio en el historial", async ({
    page,
  }) => {
    await page.goto("/compras/facturas/nueva");
    await page.getByLabel("Elegir foto o PDF de la factura").setInputFiles(FACTURA);
    await expect(page.getByAltText("Vista previa de la factura")).toBeVisible();
    await page.getByRole("button", { name: "Leer factura con IA" }).click();
    await expectToast(page, "Factura leída");
    await expect(page).toHaveURL(/\/compras\/facturas\/[0-9a-f-]{36}$/);

    // La foto queda al lado del formulario y la IA ya completó proveedor y líneas
    await expect(page.getByAltText("Foto de la factura")).toBeVisible();
    await expect(page.getByLabel("Proveedor *")).toContainText("Leo Pelle");
    await expect(page.getByLabel("Punto de venta")).toHaveValue("0003");
    await expect(page.getByLabel("Número", { exact: true })).toHaveValue("00004567");
    await expect(page.getByLabel("Descripción (línea 1)")).toHaveValue("QUESO TYBO BARRA X KG");
    await expect(page.getByLabel("Insumo o producto (línea 1)")).toContainText("Queso barra (Tybo/Maki)");
    await expect(page.getByLabel("Insumo o producto (línea 2)")).toContainText("Queso reggianito");
    await expect(page.getByLabel("Insumo o producto (línea 3)")).toContainText("Fécula de mandioca");
    await expect(page.getByText("Los totales coinciden con la factura.")).toBeVisible();

    // El IVA es el de la factura: si un renglón no cierra, la diferencia se ve y no deja confirmar
    await page.getByLabel("IVA de la factura (línea 3)").fill("28000");
    await expect(page.getByRole("alert").filter({ hasText: "Los totales no coinciden" })).toBeVisible();
    await expect(page.getByText(/Diferencia: .*192,50/).first()).toBeVisible();
    await page.getByRole("button", { name: "Confirmar factura" }).click();
    await expectToast(page, "Los totales no coinciden con la factura");
    await page.getByLabel("IVA de la factura (línea 3)").fill("28192,5");
    await expect(page.getByText("Los totales coinciden con la factura.")).toBeVisible();

    // Mapeo editable: sacar y volver a elegir el insumo de la línea 3
    await page.getByLabel("Insumo o producto (línea 3)").click();
    await page.getByRole("option", { name: "No es un insumo (flete, otros)" }).click();
    await expect(page.getByText("1 línea sin insumo")).toBeVisible();
    await page.getByLabel("Insumo o producto (línea 3)").click();
    await page.getByRole("option", { name: "Fécula de mandioca" }).click();

    await page.getByRole("button", { name: "Confirmar factura" }).click();
    await expectToast(page, "Factura confirmada: 3 precios actualizados");
    await expect(page.getByRole("heading", { name: "Factura A 0003-00004567" })).toBeVisible();
    await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();

    // Historial de precios: queda el último precio del queso barra con el gráfico y la tabla
    await page.goto("/compras/precios");
    await page.getByRole("link", { name: "Queso barra (Tybo/Maki)" }).click();
    await expect(page.getByRole("heading", { name: "Queso barra (Tybo/Maki)" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Gráfico del precio neto en el tiempo" })).toBeVisible();
    const compras = page.getByRole("row").filter({ hasText: "01/10/2026" }).filter({ hasText: "2,73" });
    await expect(compras).toContainText("Leo Pelle");
    await expect(compras).toContainText("$ 10.150");
  });

  test("RF-08: una factura duplicada da un error claro", async ({ page }) => {
    await page.goto("/compras/facturas/nueva");
    await page.getByLabel("Elegir foto o PDF de la factura").setInputFiles(FACTURA);
    await page.getByRole("button", { name: "Leer factura con IA" }).click();
    await expectToast(page, "Ya está cargada la factura A 0003-00004567 de Leo Pelle");
    await expect(page).toHaveURL(/\/compras\/facturas\/nueva$/);
  });

  test("RF-10/11: orden de compra → WhatsApp → recepción → sube el stock del insumo", async ({
    page,
    sql,
  }) => {
    const stock = async () => {
      const [r] = await sql`select coalesce(sum(sm.qty), 0)::float as qty from stock_movements sm
        join ingredients i on i.id = sm.ingredient_id where i.name = 'Fécula de mandioca'`;
      return r!.qty as number;
    };
    const before = await stock();

    await page.goto("/compras/ordenes/nueva");
    await page.getByLabel("Proveedor *").click();
    await page.getByRole("option", { name: "Leo Pelle" }).click();
    await page.getByLabel("Insumo (línea 1)").click();
    await page.getByRole("option", { name: "Fécula de mandioca" }).click();
    await page.getByLabel(/Cantidad.*línea 1/).fill("50");
    // precio estimado = último precio de compra (el de la factura confirmada)
    await expect(page.getByLabel("Precio estimado (línea 1)")).toHaveValue("1790");
    await page.getByRole("button", { name: "Crear orden" }).click();
    await expectToast(page, "Orden OC-0001 creada");
    await expect(page.getByRole("heading", { name: "OC-0001" })).toBeVisible();

    // Un solo canal: el link de WhatsApp lleva el detalle del pedido y la marca como enviada
    const wa = page.getByRole("link", { name: "Enviar por WhatsApp" });
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/5493415551234\?text=/);
    expect(decodeURIComponent((await wa.getAttribute("href"))!)).toContain("50 kg Fécula de mandioca");
    const [popup] = await Promise.all([page.waitForEvent("popup"), wa.click()]);
    await popup.close();
    await expectToast(page, "Orden marcada como enviada");
    await expect(page.getByText("Enviada", { exact: true })).toBeVisible();

    // Entregas esperadas
    await page.goto("/compras/ordenes");
    await expect(
      page.getByRole("heading", { name: /Próximas entregas|Entregas atrasadas/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "OC-0001" }).first()).toBeVisible();

    // Recepción de la OC: lote del proveedor y listo
    await page.getByRole("link", { name: "OC-0001" }).first().click();
    await page.getByRole("link", { name: "Recibir mercadería" }).click();
    await expect(page.getByLabel(/Cantidad.*línea 1/)).toHaveValue("50");
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    await expect(page.getByText("falta el lote del proveedor").first()).toBeVisible();
    await page.getByLabel(/Lote del proveedor.*línea 1/).fill("FEC-E2E-1");
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    await expectToast(page, "Recepción registrada: 1 lote");
    await expect(page.getByRole("heading", { name: "OC-0001" })).toBeVisible();
    await expect(page.getByText("Recibida", { exact: true })).toBeVisible();

    expect(await stock()).toBe(before + 50);
  });

  test("RF-10: orden de compra con retiro en proveedor y vista imprimible", async ({ page }) => {
    await page.goto("/compras/ordenes/nueva");
    await page.getByLabel("Proveedor *").click();
    await page.getByRole("option", { name: "Leo Pelle" }).click();
    await page.getByLabel("Insumo (línea 1)").click();
    await page.getByRole("option", { name: "Manteca" }).click();
    await page.getByLabel(/Cantidad.*línea 1/).fill("12");
    await page.getByLabel("Retiro en proveedor").check();
    await page.getByRole("button", { name: "Crear orden" }).click();
    await expectToast(page, /Orden OC-\d+ creada/);
    await expect(page.getByText("Retiro en proveedor", { exact: true })).toBeVisible();
    const orderUrl = page.url();

    await page.getByRole("link", { name: "Imprimir / PDF" }).click();
    await expect(page).toHaveURL(/\/compras\/ordenes\/[0-9a-f-]{36}\/imprimir$/);
    const sheet = page.getByTestId("orden-compra");
    await expect(sheet.getByRole("heading", { name: /Orden de compra OC-\d+/ })).toBeVisible();
    await expect(sheet).toContainText("Leo Pelle");
    await expect(sheet.getByTestId("orden-retiro")).toContainText("Retiro en proveedor");
    await expect(sheet.getByRole("row", { name: /Manteca/ })).toContainText("12 kg");
    await expect(page.getByRole("button", { name: "Imprimir / guardar PDF" })).toBeVisible();

    // Sin retiro, la hoja no lo marca.
    await page.goBack();
    await page.getByRole("link", { name: "Editar" }).click();
    await page.getByLabel("Retiro en proveedor").uncheck();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expectToast(page, "Orden guardada");
    await page.goto(`${orderUrl}/imprimir`);
    await expect(page.getByTestId("orden-compra")).toContainText("Entrega el proveedor");
    await expect(page.getByTestId("orden-retiro")).toHaveCount(0);
  });

  test("RF-11: recepción libre de un refrigerado exige temperatura y alerta por encima de 5 °C", async ({
    page,
  }) => {
    await page.goto("/compras/recepciones/nueva");
    await page.getByLabel("Proveedor *").click();
    await page.getByRole("option", { name: "Leo Pelle" }).click();
    await page.getByLabel("Insumo (línea 1)").click();
    await page.getByRole("option", { name: "Queso barra (Tybo/Maki)" }).click();
    await page.getByLabel(/Cantidad.*línea 1/).fill("10");
    await page.getByLabel(/Lote del proveedor.*línea 1/).fill("TYBO-E2E");
    await page.getByLabel(/Vencimiento.*línea 1/).fill("2026-12-31");
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    await expect(page.getByText("la temperatura es obligatoria para refrigerados").first()).toBeVisible();

    await page.getByLabel(/Temperatura.*línea 1/).fill("8");
    await expect(page.getByRole("alert").filter({ hasText: "Temperatura fuera de rango" })).toBeVisible();
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    await expectToast(page, "Recepción registrada");
    await expect(page).toHaveURL(/\/compras\/recepciones$/);
    const row = page.getByRole("row").filter({ hasText: "TYBO-E2E" });
    await expect(row).toContainText("Heladera");
    await expect(row).toContainText("8 °C > 5");
  });

  test("RF-12: un pago al proveedor baja el saldo de la cuenta corriente", async ({ page }) => {
    await page.goto("/proveedores");
    await page.getByRole("link", { name: "Leo Pelle" }).click();
    await page.getByRole("tab", { name: "Cuenta corriente" }).click();
    await expect(page.getByTestId("supplier-balance")).toContainText("$ 1.131.417,50");
    await expect(page.getByRole("cell", { name: "Factura A 0003-00004567" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Registrar pago" }).click();
    await page.getByLabel("Importe").fill("131.417,50");
    await page.getByLabel("Referencia").fill("Transf. E2E");
    await page.getByRole("button", { name: "Guardar pago" }).click();
    await expectToast(page, "Pago registrado");
    await expect(page.getByTestId("supplier-balance")).toContainText("$ 1.000.000");
    await expect(page.getByRole("cell", { name: /Pago \(Transferencia\) · Transf. E2E/ })).toBeVisible();

    await page.goto("/compras/cuentas");
    await expect(page.getByRole("row").filter({ hasText: "Leo Pelle" })).toContainText("$ 1.000.000");
  });

  test("RF-12: resumen del mes con neto, IVA y total", async ({ page }) => {
    await page.goto("/compras?mes=2026-10");
    await expect(page.getByTestId("spend-net")).toContainText("$ 950.500");
    await expect(page.getByTestId("spend-vat")).toContainText("$ 171.412,50");
    await expect(page.getByTestId("spend-total")).toContainText("$ 1.131.417,50");
    await expect(page.getByRole("row").filter({ hasText: "Leo Pelle" }).first()).toContainText("$ 950.500");
  });

  test("RF-09: exporta el historial de precios a Excel y queda registrado quién lo exportó", async ({
    page,
  }) => {
    await page.goto("/compras/precios");
    await page.getByRole("link", { name: "Leche" }).first().click();
    await expect(page).toHaveURL(/\/compras\/precios\/[0-9a-f-]{36}$/);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Exportar a Excel" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^precios-leche-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await download.path())!);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Historial", "Mensual"]);
    const ws = wb.getWorksheet("Historial")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Insumo",
      "Unidad",
      "Proveedor",
      "Fecha",
      "Precio neto",
      "Variación %",
      "Factura",
    ]);
    expect(ws.rowCount).toBeGreaterThan(1);
    expect(ws.getRow(2).getCell(1).value).toBe("Leche");

    // Todos los insumos desde el listado.
    await page.goto("/compras/precios");
    const [all] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Exportar a Excel" }).click(),
    ]);
    expect(all.suggestedFilename()).toMatch(/^precios-todos-/);

    await page.goto("/admin/auditoria?vista=exportaciones");
    const rows = page.getByRole("table", { name: "Exportaciones" }).getByRole("row");
    await expect(rows.nth(1)).toContainText("Historial de precios (Excel)");
    await expect(rows.nth(1)).toContainText("Nahuel");
    await expect(rows.nth(1)).toContainText("insumo: todos");
    await expect(rows.nth(2)).toContainText("insumo: Leche");
  });
});

test.describe("Compras: permisos", () => {
  test.use({ storageState: asRole("accountant") });

  test("la contadora ve y exporta las compras pero no carga ni edita", async ({ page }) => {
    await page.goto("/compras?mes=2026-10");
    await expect(page.getByTestId("spend-total")).toContainText("$ 1.131.417,50");
    await expect(page.getByRole("link", { name: "Cargar factura" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Nueva orden" })).toHaveCount(0);

    // Exportación a Excel del mes
    await expect(page.getByRole("link", { name: "Exportar a Excel" })).toBeVisible();
    const res = await page.request.get("/compras/exportar?mes=2026-10");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    expect((await res.body()).subarray(0, 2).toString()).toBe("PK"); // un .xlsx es un zip

    // Puede ver la factura confirmada, sin acciones de edición
    await page.goto("/compras/facturas");
    await page.getByRole("link", { name: /Factura A 0003-00004567/ }).click();
    await expect(page.getByRole("heading", { name: "Factura A 0003-00004567" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar factura" })).toHaveCount(0);

    await page.goto("/compras/facturas/nueva");
    await expect(page).toHaveURL(/sin-permiso/);
    await page.goto("/compras/ordenes/nueva");
    await expect(page).toHaveURL(/sin-permiso/);

    // Proveedor: ficha de solo lectura y cuenta corriente sin botón de pago
    await page.goto("/proveedores");
    await page.getByRole("link", { name: "Leo Pelle" }).click();
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Cuenta corriente" }).click();
    await expect(page.getByTestId("supplier-balance")).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar pago" })).toHaveCount(0);
    await page.goto("/proveedores/nuevo");
    await expect(page).toHaveURL(/sin-permiso/);
  });
});

test.describe("Compras: celular", () => {
  test.use({ storageState: asRole("admin"), viewport: { width: 390, height: 844 }, hasTouch: true });

  test("cargar una factura desde el celular: cámara y carga manual a un toque", async ({ page }) => {
    await page.goto("/compras/facturas/nueva");
    const camera = page.getByLabel("Sacar foto de la factura");
    await expect(camera).toHaveAttribute("capture", "environment");
    await expect(page.getByRole("button", { name: "Cargar a mano (sin foto)" })).toBeVisible();
    // sin scroll horizontal
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("Compras de reventa", () => {
  test.use({ storageState: asRole("admin") });

  test("una línea de factura mapeada a una gaseosa registra su costo e ingresa stock al local", async ({
    page,
    sql,
  }) => {
    await page.goto("/compras/facturas/nueva");
    await page.getByRole("button", { name: /Cargar a mano|Carga manual/ }).click();
    await expect(page).toHaveURL(/\/compras\/facturas\/[0-9a-f-]{36}$/);
    await page.getByLabel("Proveedor *").click();
    await page.getByRole("option", { name: /Leo Pelle/ }).click();
    await page.getByLabel("Punto de venta").fill("9");
    await page.getByLabel("Número", { exact: true }).fill("777");
    await page.getByLabel("Fecha de emisión").fill("2026-10-01");
    await page.getByLabel("Descripción (línea 1)").fill("GASEOSA 500 ML");
    await page.getByLabel("Insumo o producto (línea 1)").click();
    await page.getByRole("option", { name: "Gaseosa 500 ml" }).click();
    await page.getByLabel("Cantidad (línea 1)").fill("24");
    await page.getByLabel("Precio neto unitario (línea 1)").fill("1200");
    await page.getByLabel("Ingresar al local").check();
    await page.getByRole("button", { name: "Confirmar factura" }).click();
    await expectToast(page, /1 producto ingresado al local/);
    const [cost] = await sql`
      select unit_cost_net::float8 as c from v_product_last_cost
      where product_id = (select id from products where code = 'RV-GAS-500')`;
    expect(cost!.c).toBe(1200);
    const [mov] = await sql`
      select count(*)::int as n from stock_movements where ref_table = 'purchase_invoices'
        and product_id = (select id from products where code = 'RV-GAS-500')`;
    expect(mov!.n).toBe(1);
  });
});
