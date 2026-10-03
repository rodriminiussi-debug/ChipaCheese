import { test, expect, asRole, expectToast } from "./fixtures";

const AR = "America/Argentina/Buenos_Aires";
/** Fecha de hoy en Argentina (YYYY-MM-DD), igual que `todayAR()` del servidor. */
const dayAR = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date(Date.now() + offset * 86_400_000));

test.describe("Producción y lotes (M4)", () => {
  test.use({ storageState: asRole("admin") });

  test("plan del día: guardar, confirmar y ver la semana; el plan que no cumple la regla no se confirma", async ({
    page,
  }) => {
    await page.goto("/produccion");
    await expect(page.getByRole("heading", { name: "Producción", level: 1 })).toBeVisible();

    // Un plan sobre la capacidad del abatidor avisa y no deja confirmar (Regla 1).
    await page.getByLabel("Kg planificados de tapitas").fill("100");
    await page.getByLabel("Kg planificados de aritos").fill("50");
    await page.getByLabel("Kg planificados de lengüitas").fill("50");
    await expect(page.getByText("El plan supera la capacidad del abatidor")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar plan" })).toBeDisabled();

    await page.getByLabel("Kg planificados de tapitas").fill("60");
    await page.getByLabel("Kg planificados de aritos").fill("10");
    await page.getByLabel("Kg planificados de lengüitas").fill("70");
    await expect(page.getByTestId("plan-total")).toHaveText("140 kg");
    await page.getByRole("button", { name: "Guardar plan" }).click();
    await expectToast(page, "Plan guardado");
    await expect(page.getByText("Plan borrador")).toBeVisible();

    await page.getByRole("button", { name: "Confirmar plan" }).click();
    await expectToast(page, "Plan confirmado");
    await expect(page.getByText("Plan confirmado").first()).toBeVisible();

    // Vista semanal: el día queda con 140 de 150 kg.
    await expect(page.getByTestId(`week-${dayAR()}`)).toContainText("140 de 150 kg");

    // El pedido de Club Náutico (confirmado, entrega en 3 días) entra en la demanda pendiente.
    await page.getByText(/Pedidos considerados/).click();
    await expect(page.getByRole("cell", { name: /Club Náutico/ }).first()).toBeVisible();
  });

  test("flujo completo: producción → consumos → pesadas → congelado → envasado → lote con stock y etiqueta con QR", async ({
    page,
    sql,
  }) => {
    // 1) Crear la producción del día.
    await page.goto("/produccion");
    await page.getByRole("link", { name: "Nueva producción" }).click();
    await expect(page).toHaveURL(/\/produccion\/nueva/);
    await expect(page.getByLabel("Kg de fécula *")).toHaveValue("75");
    await page.getByRole("button", { name: "Operario J.T." }).click();
    await page.getByRole("button", { name: "Crear producción" }).click();
    await expectToast(page, /Producción N° \d+ creada/);
    await expect(page).toHaveURL(/\/produccion\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /Producción N° \d+/ })).toBeVisible();
    await expect(page.getByText("Planificada")).toBeVisible();

    // 2) Consumos: el teórico viene precargado; leche fuera del rango de la receta (18–30 L) se marca.
    await expect(page.getByLabel("Real de Leche", { exact: true })).toHaveValue("30");
    await expect(page.getByLabel("Real de Fécula de mandioca", { exact: true })).toHaveValue("75");
    await page.getByLabel("Real de Leche", { exact: true }).fill("31");
    await expect(page.getByText(/Fuera de rango: 31 L/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar consumos" }).click();
    await expectToast(page, "Consumos registrados: 1 fuera de rango");
    await expect(page.getByText("En elaboración")).toBeVisible();
    const lecheRow = page.getByRole("row", { name: /Leche/ });
    await expect(lecheRow).toContainText("Fuera de rango");
    await expect(lecheRow).toContainText("LEC-0928");

    // 3) Pesadas y rendimiento (registro del 01/09: 149,3 kg).
    await page.getByLabel("Pesada de tapitas en kg").fill("70,6");
    await page.getByLabel("Pesada de aritos en kg").fill("10,1");
    await page.getByLabel("Pesada de lengüitas en kg").fill("68,6");
    await page.getByRole("button", { name: "Guardar pesadas" }).click();
    await expectToast(page, "Pesadas registradas");
    await expect(page.getByTestId("stat-weighed")).toContainText("149,3 kg");
    // 149,3 kg pesados ÷ 178,75 kg de ingredientes reales (con 31 L de leche) = 83,5 %.
    await expect(page.getByTestId("stat-yield")).toContainText("83,5 %");
    await expect(page.getByTestId("stat-bags")).toContainText("299");
    await expect(page.getByTestId("stat-per-starch")).toContainText("Esperado de la receta: 1,99");

    // 4) Congelado en F1 + F2.
    await page.getByRole("button", { name: "Pasar a congelado" }).click();
    await page.getByRole("button", { name: "Confirmar congelado" }).click();
    await expectToast(page, "Estado actualizado");
    await expect(page.getByText("F1 + F2")).toBeVisible();

    // 5) Envasado: crea el lote AAMMDD-N.
    await page.getByLabel("Producto").selectOption({ label: "Chipá tapitas 0,5 kg" });
    await page.getByLabel("Unidades").fill("60");
    await page.getByRole("button", { name: "Registrar envasado" }).click();
    await expectToast(page, /Envasado registrado en el lote \d{6}-\d+/);
    const lotLink = page.getByRole("link", { name: /^Lote \d{6}-\d+$/ });
    await expect(lotLink).toBeVisible();
    const code = (await lotLink.textContent())!.replace("Lote ", "");
    const yymmdd = dayAR().slice(2).replaceAll("-", "");
    expect(code).toMatch(new RegExp(`^${yymmdd}-\\d+$`));

    await page.getByRole("button", { name: "Marcar envasada" }).click();
    await expectToast(page, "Estado actualizado");
    await expect(page.getByText("Envasada", { exact: true })).toBeVisible();

    // Libro mayor: producto +60 con el lote y envases −60 del depósito seco, sin lote.
    const [stock] = await sql`select coalesce(sum(s.qty), 0)::float as qty from v_product_stock s
      join finished_lots l on l.id = s.finished_lot_id where l.code = ${code}`;
    expect(stock!.qty).toBe(60);
    const [bags] = await sql`select sum(m.qty)::float as qty, bool_and(m.raw_lot_id is null) as no_lot,
        min(l.code) as loc from stock_movements m
      join ingredients i on i.id = m.ingredient_id join locations l on l.id = m.location_id
      join packings p on p.id = m.ref_id
      join finished_lots fl on fl.id = p.finished_lot_id
      where m.ref_table = 'packings' and i.name like 'Bolsa 0,5%' and fl.code = ${code}`;
    expect(bags).toMatchObject({ qty: -60, no_lot: true, loc: "DEP-SECO" });

    // 6) El lote aparece con su stock.
    await lotLink.click();
    await expect(page.getByRole("heading", { name: `Lote ${code}` })).toBeVisible();
    const stockRow = page.getByRole("row", { name: /Chipá tapitas 0,5 kg/ }).first();
    await expect(stockRow).toContainText("F3");
    await expect(stockRow).toContainText("60");
    await expect(page.getByText("Total en stock: 60 unidades")).toBeVisible();
    await page.goto("/produccion");
    await expect(page.getByRole("link", { name: code }).first()).toBeVisible();

    // 7) Etiqueta con QR a la trazabilidad del lote.
    await page.goto(`/produccion/lotes/${code}`);
    await page.getByRole("link", { name: /Etiqueta de Chipá tapitas 0,5 kg/ }).click();
    const qr = page.getByRole("img", { name: `Código QR de trazabilidad del lote ${code}` });
    await expect(qr).toBeVisible();
    await expect
      .poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByTestId("product-label").first()).toContainText("Mantener congelado a −18 °C");
    await expect(page.getByTestId("product-label").first()).toContainText("Pacon SRL");
    await expect(page.getByTestId("product-label").first()).toContainText(code);
    await expect(page.getByText(`/calidad/trazabilidad?lote=${code}`)).toBeVisible();
    await page.getByLabel("Copias").fill("3");
    await page.getByRole("button", { name: "Actualizar vista" }).click();
    await expect(page.getByTestId("product-label")).toHaveCount(3);
  });

  test("carga tardía: una producción con fecha anterior queda marcada", async ({ page, sql }) => {
    await page.goto("/produccion/nueva");
    // Reintenta mientras la página termina de hidratar (el formulario pisa el valor al montar).
    await expect(async () => {
      await page.getByLabel("Fecha de elaboración *").fill(dayAR(-10));
      await expect(page.getByText("La fecha es anterior a hoy")).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await page.getByRole("button", { name: "Crear producción" }).click();
    await expectToast(page, /Producción N° \d+ creada/);
    await expect(page.getByText("Carga tardía").first()).toBeVisible();
    const [run] =
      await sql`select late_entry from production_runs where date = ${dayAR(-10)} order by created_at desc`;
    expect(run).toMatchObject({ late_entry: true });
  });

  test("receta: ficha escalada, nueva versión (copia de la activa) y activación", async ({ page }) => {
    await page.goto("/produccion/receta");
    await expect(page.getByText("Masa de chipá — versión 1")).toBeVisible();
    await expect(page.getByText("Activa", { exact: true }).first()).toBeVisible();

    // Ficha imprimible: 37,5 kg de fécula = una tanda → 11,25 kg de queso barra.
    await page.getByRole("link", { name: "Ficha imprimible" }).click();
    await page.getByRole("link", { name: /37,5 kg \(una tanda\)/ }).click();
    const sheet = page.getByRole("article", { name: "Ficha de receta" });
    await expect(sheet).toContainText("37,5 kg de fécula");
    await expect(sheet.getByRole("row", { name: /Queso barra/ })).toContainText("11,25 kg");
    await expect(page.getByRole("button", { name: "Imprimir ficha" })).toBeVisible();

    // Nueva versión: menos leche, con notas.
    await page.goto("/produccion/receta/nueva");
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await expect(page.getByText("Contá qué cambió en esta versión")).toBeVisible();
    await page.getByLabel("Cantidad de Leche por kg de fécula").fill("0,35");
    await page.getByLabel("Notas de la versión *").fill("Bajamos la leche a 0,35 L por kg de fécula");
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await expectToast(page, "Versión 2 guardada");
    await expect(page.getByText("Masa de chipá — versión 2")).toBeVisible();
    await expect(page.getByText("Borrador", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Activar versión 2" }).click();
    await expectToast(page, "Versión 2 activada");
    const history = page.getByRole("region", { name: "Historial de versiones" });
    await expect(history.getByRole("row", { name: /Versión 1/ })).toContainText("Archivada");
    await expect(history.getByRole("row", { name: /Versión 2/ })).toContainText("Activa");
  });

  test("pizarrón: asignar tareas, copiar el día anterior y capacitar a un reemplazo", async ({ page }) => {
    await page.goto("/personas");
    const alert = page.getByTestId("critical-alerts");
    await expect(alert).toContainText("Dependencia crítica: 7 tareas sin reemplazo");
    await expect(alert).toContainText("Batidora: solo A.F.");

    // Asignación de ayer, copiada a hoy.
    await page.goto(`/personas?fecha=${dayAR(-1)}`);
    await page.getByLabel("Asignar S.G. a Batidora").check();
    await expect(page.getByLabel("Asignar S.G. a Batidora")).toBeChecked();
    await page.reload();
    await expect(page.getByLabel("Asignar S.G. a Batidora")).toBeChecked();

    await page.goto("/personas");
    await page.getByLabel("Asignar J.T. a Huevos").check();
    await page.getByRole("button", { name: "Copiar asignación del día anterior" }).click();
    await expectToast(page, /Se copiaron 1 asignaciones del/);
    await expect(page.getByLabel("Asignar S.G. a Batidora")).toBeChecked();
    await page.reload();
    await expect(page.getByLabel("Asignar J.T. a Huevos")).toBeChecked();
    await expect(page.getByLabel("Asignar S.G. a Batidora")).toBeChecked();

    // Matriz: E.A. pasa a "Puede" en Batidora y esa tarea sale de la alerta.
    await page.getByRole("link", { name: "Matriz de polivalencia" }).click();
    await page.getByLabel("Nivel de E.A. en Batidora").selectOption("able");
    await expect(page.getByTestId("critical-alerts")).toContainText("6 tareas sin reemplazo");
    await expect(page.getByTestId("critical-alerts")).not.toContainText("Batidora: solo");
  });
});

test.describe("permisos de producción", () => {
  test.describe("local", () => {
    test.use({ storageState: asRole("store") });
    test("no accede a producción, receta ni personas", async ({ page }) => {
      for (const path of ["/produccion", "/produccion/receta", "/personas", "/produccion/nueva"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/sin-permiso/);
      }
    });
  });

  test.describe("operario", () => {
    test.use({ storageState: asRole("operator") });
    test("ve la producción pero no crea recetas ni producciones", async ({ page }) => {
      await page.goto("/produccion");
      await expect(page.getByRole("heading", { name: "Producción", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Nueva producción" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Guardar plan" })).toHaveCount(0);
      await page.goto("/produccion/receta/nueva");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/produccion/nueva");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/personas");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
