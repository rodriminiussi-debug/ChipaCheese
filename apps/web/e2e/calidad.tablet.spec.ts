import { test, expect, asRole } from "./fixtures";

/** Tablet de planta (operario): limpieza, temperatura fuera de rango y carga sin señal (RF-34, RF-38). */
test.use({ storageState: asRole("operator") });

test.describe("Limpieza en la tablet", () => {
  test("el operario marca un punto como correcto con un toque", async ({ page, sql }) => {
    await page.goto("/planta/limpieza");
    await expect(page.getByRole("heading", { name: "Limpieza de hoy" })).toBeVisible();
    const pisos = page.getByRole("group", { name: "Pisos" });
    const ok = pisos.getByRole("button", { name: "Correcto" });
    // Botones grandes: usable con guantes.
    expect((await ok.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await ok.click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Limpieza registrada" }).first(),
    ).toBeVisible();
    await expect(pisos.getByTestId("point-status")).toContainText("Correcto");

    const [rec] = await sql`select r.result, r.late_entry, r.client_id, u.username
      from cleaning_records r join sanitation_points p on p.id = r.point_id join users u on u.id = r.user_id
      where p.element = 'Pisos' and r.date = '2026-10-02'`;
    expect(rec).toMatchObject({ result: "ok", late_entry: false, username: "jt" });
    expect(rec!.client_id).toBeTruthy();
  });

  test("'A profundizar' guarda la nota", async ({ page, sql }) => {
    await page.goto("/planta/limpieza");
    const bandejas = page.getByRole("group", { name: "Bandejas" });
    await bandejas.getByRole("button", { name: "A profundizar" }).click();
    await bandejas.getByLabel("Nota").fill("Falta desengrasar");
    await bandejas.getByRole("button", { name: "Guardar" }).click();
    await expect(bandejas.getByTestId("point-status")).toContainText("A profundizar");
    const [rec] = await sql`select r.result, r.notes from cleaning_records r
      join sanitation_points p on p.id = r.point_id where p.element = 'Bandejas' and r.date = '2026-10-02'`;
    expect(rec).toMatchObject({ result: "deepen", notes: "Falta desengrasar" });
  });
});

test.describe("Temperaturas en la tablet", () => {
  async function typeValue(page: import("@playwright/test").Page, value: string) {
    for (const ch of value) {
      const name = ch === "-" ? "Signo menos" : ch === "," ? "Coma" : ch;
      await page.getByRole("button", { name, exact: true }).click();
    }
  }

  test("fuera de rango: alerta roja y acción correctiva obligatoria antes de guardar", async ({
    page,
    sql,
  }) => {
    await page.goto("/planta/temperaturas");
    await page.getByRole("button", { name: /^F3/ }).click();
    await expect(page.getByText("Rango: ≤ −18 °C")).toBeVisible();

    // Un toque en el signo y dos números: −12 °C.
    await typeValue(page, "-12");
    await expect(page.getByTestId("temp-display")).toContainText("−12");
    const alert = page.getByTestId("out-of-range-alert");
    await expect(alert).toContainText("FUERA DE RANGO");
    const save = page.getByRole("button", { name: "Guardar con alerta" });
    await expect(save).toBeDisabled(); // falta la acción correctiva

    await page.getByRole("button", { name: "Se llamó al técnico" }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId("saved-alert")).toContainText("F3 fuera de rango");

    const [log] = await sql`select l.value_c::float as v, l.out_of_range, l.corrective_action, l.late_entry
      from temperature_logs l join equipment e on e.id = l.equipment_id
      where e.code = 'F3' and l.date = '2026-10-02'`;
    expect(log).toMatchObject({
      v: -12,
      out_of_range: true,
      corrective_action: "Se llamó al técnico",
      late_entry: false,
    });
  });

  test("dentro de rango se guarda directo con el teclado numérico", async ({ page, sql }) => {
    await page.goto("/planta/temperaturas");
    await page.getByRole("button", { name: /^HELADERA/ }).click();
    await typeValue(page, "4,5");
    await expect(page.getByTestId("temp-display")).toContainText("4,5");
    await expect(page.getByTestId("out-of-range-alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByTestId("saved-ok")).toContainText("HELADERA");
    const [log] = await sql`select l.value_c::float as v, l.out_of_range from temperature_logs l
      join equipment e on e.id = l.equipment_id where e.code = 'HELADERA' and l.date = '2026-10-02'`;
    expect(log).toMatchObject({ v: 4.5, out_of_range: false });
  });

  test("sin señal la lectura queda en cola y se sincroniza al volver la conexión", async ({
    page,
    context,
    sql,
  }) => {
    await page.goto("/planta/temperaturas");
    await expect(page.getByRole("button", { name: /^F4/ })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole("button", { name: /^F4/ }).click();
    await typeValue(page, "-20");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByTestId("saved-ok")).toContainText("(en cola)");
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    const before = await sql`select 1 from temperature_logs l join equipment e on e.id = l.equipment_id
      where e.code = 'F4' and l.date = '2026-10-02'`;
    expect(before).toHaveLength(0);

    await context.setOffline(false);
    await expect
      .poll(
        async () =>
          (
            await sql`select l.value_c::float as v, l.client_id from temperature_logs l
              join equipment e on e.id = l.equipment_id where e.code = 'F4' and l.date = '2026-10-02'`
          ).length,
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    const rows = await sql`select l.value_c::float as v, l.client_id, l.late_entry from temperature_logs l
      join equipment e on e.id = l.equipment_id where e.code = 'F4' and l.date = '2026-10-02'`;
    expect(rows[0]).toMatchObject({ v: -20, late_entry: false });
    expect(rows[0]!.client_id).toBeTruthy();
  });
});
