import { test, expect, asRole } from "./fixtures";

/**
 * Aviso de falla (operario, chofer, local) y cómo lo ve Mantenimiento. El archivo arranca de la base demo
 * intacta; los tests comparten estado y corren en orden. El aviso del operario en la tablet se prueba en
 * `planta.tablet.spec.ts`.
 */
test.describe.configure({ mode: "serial" });

async function equipmentId(sql: import("postgres").Sql, code: string) {
  const [e] = await sql`select id from equipment where code = ${code}`;
  return e!.id as string;
}

test.describe("local avisa una falla", () => {
  test.use({ storageState: asRole("store") });

  test("desde el enlace del local: elige el freezer, cuenta qué pasa y avisa", async ({ page, sql }) => {
    await page.goto("/local");
    await page.getByRole("link", { name: /Avisar una falla/ }).click();
    await expect(page.getByRole("heading", { name: "Avisar una falla" })).toBeVisible();
    // Hasta no completar equipo, descripción y "¿está parado?" no se puede enviar.
    const send = page.getByRole("button", { name: "Avisar la falla" });
    await expect(send).toBeDisabled();
    await page.getByRole("button", { name: "Freezer horizontal F3" }).click();
    await page.getByRole("button", { name: "No enfría" }).click();
    await page.getByRole("button", { name: "Sigue funcionando" }).click();
    await send.click();
    await expect(page.getByTestId("fault-done")).toContainText("Aviso enviado: Freezer horizontal F3");
    const [o] = await sql`select o.type, o.status, o.activity, o.stopped, u.username
      from maintenance_orders o join users u on u.id = o.reported_by_id
      join equipment e on e.id = o.equipment_id where e.code = 'F3'`;
    expect(o).toMatchObject({
      type: "corrective",
      status: "open",
      activity: "No enfría",
      stopped: false,
      username: "local1",
    });
    await page.getByRole("link", { name: "Listo" }).click();
    await expect(page).toHaveURL(/\/local$/);
  });
});

test.describe("chofer avisa del equipo de frío", () => {
  test.use({ storageState: asRole("logistics") });

  test("el enlace deja elegido el equipo de frío del vehículo", async ({ page, sql }) => {
    const id = await equipmentId(sql, "VEH-FRIO");
    await page.goto(`/avisar-falla?equipo=${id}&volver=/despacho`);
    await expect(page.getByRole("button", { name: "Equipo de frío del vehículo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByLabel("¿Qué pasa?").fill("El equipo de frío no llega a -18");
    await page.getByRole("button", { name: /Está parado/ }).click();
    await page.getByRole("button", { name: "Avisar la falla" }).click();
    await expect(page.getByTestId("fault-done")).toContainText("Mantenimiento ya lo ve");
    await expect(page.getByTestId("fault-done")).toContainText("avisale también a la jefa");
    await page.getByRole("link", { name: "Listo" }).click();
    await expect(page).toHaveURL(/\/despacho$/);
  });
});

test.describe("la jefa y Dirección ven los avisos", () => {
  test.use({ storageState: asRole("production_manager") });

  test("la jefa los ve en Mantenimiento, con quién avisó y el equipo parado", async ({ page }) => {
    await page.goto("/mantenimiento");
    const panel = page.getByTestId("fault-reports");
    await expect(panel).toContainText("Fallas avisadas sin resolver (2)");
    await expect(panel).toContainText("Equipo de frío del vehículo");
    await expect(panel).toContainText("Equipo parado");
    await expect(panel).toContainText("Avisada por Logística (chofer)");
    await expect(panel).toContainText("Avisada por Local — Empleada 1");
    // En la lista de correctivos figura "Avisada por X".
    await page.getByRole("link", { name: "Correctivos" }).click();
    await page.getByRole("link", { name: "Abiertas" }).click();
    await expect(page.getByTestId("reported-by").filter({ hasText: "Local — Empleada 1" })).toBeVisible();
  });
});

test.describe("Dirección y permisos", () => {
  test.describe("Dirección", () => {
    test.use({ storageState: asRole("admin") });
    test("ve el aviso en Mantenimiento y también puede avisar", async ({ page }) => {
      await page.goto("/mantenimiento");
      await expect(page.getByTestId("fault-reports")).toContainText("Avisada por Local — Empleada 1");
      await page.goto("/avisar-falla");
      await page.getByRole("button", { name: "Heladera vertical" }).click();
      await page.getByLabel("¿Qué pasa?").fill("Gotea agua");
      await page.getByRole("button", { name: "Sigue funcionando" }).click();
      await page.getByRole("button", { name: "Avisar la falla" }).click();
      await expect(page.getByTestId("fault-done")).toBeVisible();
    });
  });
  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("no puede avisar fallas", async ({ page }) => {
      await page.goto("/avisar-falla");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
  test.describe("responsable técnico", () => {
    test.use({ storageState: asRole("technical_lead") });
    test("ve los avisos pero no puede avisar", async ({ page }) => {
      await page.goto("/mantenimiento");
      await expect(page.getByTestId("fault-reports")).toBeVisible();
      await page.goto("/avisar-falla");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
