import { test, expect, asRole, expectToast } from "./fixtures";

/** M7: trazabilidad, reclamos con retención de lote, exportación de planillas, mantenimiento y permisos. */

test.describe("Trazabilidad (RF-35)", () => {
  test.use({ storageState: asRole("technical_lead") });

  test("el lote 260901-1 se traza por código en menos de un segundo", async ({ page }) => {
    // Calienta la ruta (en dev la primera visita compila) y mide la respuesta real.
    await page.request.get("/calidad/trazabilidad?lote=260901-1");
    const t0 = Date.now();
    const res = await page.request.get("/calidad/trazabilidad?lote=260901-1");
    expect(res.ok()).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);

    await page.goto("/calidad/trazabilidad?lote=260901-1");
    await expect(page.getByTestId("lot-code")).toHaveText("260901-1");
    const elapsed = await page.getByTestId("trace-elapsed").innerText();
    expect(elapsed).toMatch(/Resuelto en 0,\d\d s/);

    // Hacia atrás: producción, responsable, supervisor, operarios, receta.
    const production = page.getByTestId("trace-production");
    await expect(production).toContainText("01/09/2026");
    await expect(production).toContainText("Mañana");
    await expect(production).toContainText("A.F.");
    await expect(production).toContainText("N.R.");
    await expect(production).toContainText("J.T., S.G., S.R.");
    await expect(page.getByTestId("trace-consumptions")).toContainText("Fécula");
    // Hacia adelante: envasado por producto y ubicación, stock y reclamos.
    await expect(page.getByTestId("trace-packings")).toContainText("Total envasado");
    await expect(page.getByTestId("trace-packings")).toContainText("114");
    await expect(page.getByTestId("trace-stock")).toContainText("F3");
    await expect(page.getByTestId("trace-complaints")).toContainText("Bolsas mal selladas");
  });

  test("desde el lote de materia prima TYBO-0925 llega a los lotes terminados (retiro)", async ({ page }) => {
    await page.goto("/calidad/trazabilidad");
    await page.getByLabel("Código de lote").fill("TYBO-0925");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page).toHaveURL(/lote=TYBO-0925/);
    const report = page.getByTestId("raw-lot-report");
    await expect(report).toContainText("Queso barra");
    await expect(page.getByTestId("trace-raw-lots")).toContainText("261001-1");
    await expect(page.getByTestId("trace-raw-customers")).toBeVisible();
    // Solo lectura: el responsable técnico no puede retener lotes.
    await expect(page.getByRole("button", { name: /Retener/ })).toHaveCount(0);
  });

  test("informe en PDF y código inexistente", async ({ page }) => {
    const pdf = await page.request.get("/api/calidad/trazabilidad/pdf?lote=260901-1");
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    await page.goto("/calidad/trazabilidad?lote=999999-9");
    await expect(page.getByText('No encontramos el lote "999999-9"')).toBeVisible();
  });
});

test.describe("Reclamos y retención de lotes (RF-34)", () => {
  test.use({ storageState: asRole("production_manager") });

  test("un reclamo con retención deja el lote retenido hasta liberarlo", async ({ page, sql }) => {
    await page.goto("/calidad/reclamos");
    await expect(page.getByText("Bolsa sin etiqueta")).toBeVisible(); // reclamo abierto del demo
    await page.getByRole("button", { name: "Nuevo reclamo" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Cliente", { exact: true }).click();
    await page.getByRole("option", { name: "Club Náutico" }).click();
    await dialog.getByLabel("Lote", { exact: true }).click();
    await page.getByRole("option", { name: "261001-1" }).click();
    await expect(dialog.getByText("Vence el 01/04/2027")).toBeVisible();
    await dialog.getByLabel("Cantidad (bolsas)").fill("3");
    await dialog.getByLabel("Motivo *").fill("Bolsa mal sellada E2E");
    await dialog.getByLabel("Acción sobre el cliente").fill("Reposición");
    await dialog.getByLabel("Retener el lote").click();
    await dialog.getByRole("button", { name: "Registrar reclamo" }).click();
    await expectToast(page, "Reclamo registrado");

    const row = page.getByRole("row").filter({ hasText: "Bolsa mal sellada E2E" });
    await expect(row).toContainText("Club Náutico");
    await expect(row).toContainText("01/04/2027");
    await expect(row.getByText("Retenido")).toBeVisible();
    const [lot] = await sql`select on_hold from finished_lots where code = '261001-1'`;
    expect(lot!.on_hold).toBe(true);

    // Un lote retenido no sale en despacho: la existencia disponible por FEFO lo excluye (ledger).
    await row.getByRole("button", { name: "Liberar lote" }).click();
    await expectToast(page, "Lote liberado");
    const [after] = await sql`select on_hold from finished_lots where code = '261001-1'`;
    expect(after!.on_hold).toBe(false);

    // Cierra el reclamo.
    await row.getByRole("button", { name: "Cerrar" }).click();
    await expectToast(page, "Reclamo cerrado");
    await expect(row.getByText("Cerrado")).toBeVisible();
  });
});

test.describe("Registros de limpieza (RF-34)", () => {
  test.use({ storageState: asRole("production_manager") });

  test("la planilla de agosto muestra los huecos y cargar un día pasado queda como carga tardía", async ({
    page,
    sql,
  }) => {
    await page.goto("/calidad?vista=limpieza&mes=2026-08");
    await expect(page.getByTestId("month-label")).toHaveText("agosto de 2026");
    const grid = page.getByTestId("cleaning-grid");
    await expect(grid.getByLabel("Pisos 03/08/2026: Correcto")).toBeVisible();
    await expect(grid.getByLabel("Pisos 04/08/2026: A profundizar")).toBeVisible();
    // Huecos: días hábiles sin registro.
    expect(await grid.locator("td[data-gap]").count()).toBeGreaterThan(100);
    await expect(grid.getByLabel("Pisos 05/08/2026: sin registro")).toBeVisible();

    await grid.getByLabel("Pisos 05/08/2026: sin registro").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("carga tardía");
    await dialog.getByRole("button", { name: "Correcto" }).click();
    await expectToast(page, "Limpieza cargada");
    await expect(grid.getByLabel("Pisos 05/08/2026: Correcto (carga tardía)")).toBeVisible();

    const [rec] = await sql`select r.late_entry, u.username from cleaning_records r
      join sanitation_points p on p.id = r.point_id join users u on u.id = r.user_id
      where p.element = 'Pisos' and r.date = '2026-08-05'`;
    expect(rec).toMatchObject({ late_entry: true, username: "af" });
  });

  test("las temperaturas del día muestran última lectura y faltantes", async ({ page }) => {
    await page.goto("/calidad?vista=temperaturas&mes=2026-10");
    const grid = page.getByTestId("temperature-grid");
    await expect(grid).toContainText("F3");
    await expect(grid.getByTestId("today-HELADERA")).toBeVisible();
    await expect(page.getByTestId("alert-missing-temperatures")).toContainText("F1");
    await expect(page.getByText("−21 °C").first()).toBeVisible(); // lectura de F3 del 01/10
  });
});

test.describe("Exportación para ASSAL (RF-36)", () => {
  test.use({ storageState: asRole("technical_lead") });

  test("el responsable técnico exporta las planillas en PDF y Excel", async ({ page }) => {
    await page.goto("/calidad/exportar?desde=2026-10-01&hasta=2026-10-02");
    await expect(page.getByTestId("export-temperaturas")).toBeVisible();
    const href = await page
      .getByTestId("export-temperaturas")
      .getByRole("link", { name: "Registro de temperaturas en PDF" })
      .getAttribute("href");
    expect(href).toContain("/api/calidad/export/temperaturas");

    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");

    for (const kind of ["limpieza", "reclamos", "mantenimiento", "elaboracion", "despacho"]) {
      const r = await page.request.get(
        `/api/calidad/export/${kind}?desde=2026-09-01&hasta=2026-10-31&mes=2026-08`,
      );
      expect(r.headers()["content-type"], kind).toBe("application/pdf");
    }
    const xlsx = await page.request.get(
      "/api/calidad/export/elaboracion?desde=2026-09-01&hasta=2026-10-31&formato=xlsx",
    );
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  });

  test("período inválido y registro desconocido", async ({ page }) => {
    expect(
      (await page.request.get("/api/calidad/export/temperaturas?desde=2026-10-05&hasta=2026-10-01")).status(),
    ).toBe(400);
    expect((await page.request.get("/api/calidad/export/inexistente")).status()).toBe(404);
  });

  test("quien no tiene permiso de exportar no descarga", async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: asRole("store"),
      baseURL: test.info().project.use.baseURL,
    });
    const res = await ctx.request.get("/api/calidad/export/temperaturas");
    expect(res.status()).toBe(403);
    await ctx.close();
  });
});

test.describe("Mantenimiento (RF-37)", () => {
  test.use({ storageState: asRole("production_manager") });

  test("registra un preventivo hecho y actualiza el cumplimiento y el vencimiento", async ({ page, sql }) => {
    await page.goto("/mantenimiento");
    const row = page.getByRole("row").filter({ hasText: "Revisión y cambio de alambre de corte" });
    await expect(row).toContainText("Formadora Biscomatic");
    await expect(row).toContainText("31/10/2026");
    await expect(row).toContainText("Al día");

    await row.getByRole("button", { name: /Registrar hecho/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Fecha en que se hizo")).toHaveValue("2026-10-02");
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expectToast(page, "Preventivo registrado");

    await expect(row).toContainText("02/10/2026");
    await expect(row).toContainText("01/11/2026");
    await expect(page.getByTestId("stat-compliance")).toContainText("50%");
    const [order] = await sql`select type, status, done_at::text from maintenance_orders o
      join equipment e on e.id = o.equipment_id where o.plan_id is not null and e.code = 'BISCOMATIC'`;
    expect(order).toMatchObject({ type: "preventive", status: "done", done_at: "2026-10-02" });
  });

  test("el historial de la Biscomatic muestra los correctivos repetidos", async ({ page }) => {
    await page.goto("/mantenimiento?vista=equipos");
    await page.getByRole("link", { name: "Formadora Biscomatic" }).click();
    await expect(page.getByRole("heading", { name: "Formadora Biscomatic" })).toBeVisible();
    await expect(page.getByTestId("repeated-failures")).toContainText("Alambre cortado");
    await expect(page.getByTestId("repeated-failures")).toContainText("3 veces");
    await expect(
      page.getByRole("row").filter({ hasText: "Cambio de alambre de corte" }).first(),
    ).toBeVisible();
  });

  test("abre y cierra una orden correctiva", async ({ page }) => {
    await page.goto("/mantenimiento?vista=correctivos");
    await page.getByRole("button", { name: "Nueva orden correctiva" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Equipo *").click();
    await page.getByRole("option", { name: /Rallador/ }).click();
    await dialog.getByLabel("Causa *").fill("Cuchilla desafilada E2E");
    await dialog.getByLabel("Actividad *").fill("Afilado de cuchilla");
    await dialog.getByLabel("Costo ($)").fill("3500");
    await dialog.getByLabel("Tiempo de parada (min)").fill("45");
    await dialog.getByRole("button", { name: "Registrar orden" }).click();
    await expectToast(page, "Orden correctiva registrada");

    const row = page.getByRole("row").filter({ hasText: "Cuchilla desafilada E2E" });
    await expect(row).toContainText("Abierta");
    await row.getByRole("button", { name: /Cerrar orden/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cerrar orden" }).click();
    await expectToast(page, "Orden cerrada");
    await expect(row).toContainText("Cerrada");
  });

  test("alta de un plan preventivo", async ({ page }) => {
    await page.goto("/mantenimiento");
    await page.getByRole("button", { name: "Nuevo plan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Equipo *").click();
    await page.getByRole("option", { name: /Rallador/ }).click();
    await dialog.getByLabel("Tarea *").fill("Afilado preventivo E2E");
    await dialog.getByLabel("Frecuencia (días) *").fill("45");
    await dialog.getByRole("button", { name: "Crear plan" }).click();
    await expectToast(page, "Plan creado");
    await expect(page.getByRole("row").filter({ hasText: "Afilado preventivo E2E" })).toContainText(
      "cada 45 días",
    );
  });

  test("valida los datos obligatorios del plan", async ({ page }) => {
    await page.goto("/mantenimiento");
    await page.getByRole("button", { name: "Nuevo plan" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Crear plan" }).click();
    await expect(page.getByText("Elegí el equipo")).toBeVisible();
    await expect(page.getByText("Indicá la tarea")).toBeVisible();
  });
});

test.describe("Permisos de M7", () => {
  test.describe("responsable técnico", () => {
    test.use({ storageState: asRole("technical_lead") });

    test("ve los registros y el mantenimiento pero no puede editar", async ({ page }) => {
      await page.goto("/calidad");
      await expect(page.getByRole("heading", { name: "Registros BPM" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Exportar", exact: true })).toBeVisible();
      // Sin celdas para cargar días pasados.
      await expect(page.getByTestId("cleaning-grid").locator("button")).toHaveCount(0);

      await page.goto("/calidad/reclamos");
      await expect(page.getByText("Bolsa sin etiqueta")).toBeVisible();
      await expect(page.getByRole("button", { name: "Nuevo reclamo" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Retener lote|Liberar lote/ })).toHaveCount(0);

      await page.goto("/mantenimiento");
      await expect(page.getByRole("row").filter({ hasText: "Revisión y cambio de alambre" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Nuevo plan" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Registrar hecho/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Nueva orden correctiva" })).toHaveCount(0);
    });

    test("no entra al modo planta", async ({ page }) => {
      await page.goto("/planta/limpieza");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });

  test.describe("operario", () => {
    test.use({ storageState: asRole("operator") });
    test("no ve las pantallas de gestión de calidad", async ({ page }) => {
      await page.goto("/calidad");
      await expect(page).toHaveURL(/sin-permiso/);
      await page.goto("/mantenimiento");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
