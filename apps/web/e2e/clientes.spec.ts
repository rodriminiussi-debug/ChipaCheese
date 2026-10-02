import { test, expect, asRole, expectToast } from "./fixtures";

test.describe("Clientes (RF-01)", () => {
  test.use({ storageState: asRole("admin") });

  test("lista los clientes del relevamiento y busca", async ({ page }) => {
    await page.goto("/clientes");
    await expect(page.getByRole("link", { name: "Supermercado La Reina" })).toBeVisible();
    await page.getByLabel("Buscar clientes").fill("náutico");
    await page.getByLabel("Buscar clientes").press("Enter");
    await expect(page.getByRole("link", { name: "Club Náutico" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Supermercado La Reina" })).toHaveCount(0);
  });

  test("alta de cliente con validación de CUIT", async ({ page, sql }) => {
    await page.goto("/clientes/nuevo");
    await page.getByLabel("Razón social *").fill("Dietética E2E");
    await page.getByLabel("CUIT").fill("20-12345678-0");
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await expect(page.getByText("CUIT inválido")).toBeVisible();

    await page.getByLabel("CUIT").fill("20-12345678-6");
    await page.getByLabel("Plazo de pago (días)").fill("15");
    await page.getByRole("button", { name: "Mié" }).click();
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await expectToast(page, "Cliente creado");
    await expect(page.getByRole("heading", { name: "Dietética E2E" })).toBeVisible();

    // Auditoría: el alta quedó registrada con el usuario.
    const [row] = await sql`select a.action, u.username from audit_log a join users u on u.id = a.changed_by
      where a.table_name = 'customers' and a.new_data->>'legal_name' = 'Dietética E2E'`;
    expect(row).toMatchObject({ action: "I", username: "nahuel" });
  });

  test.describe("local", () => {
    test.use({ storageState: asRole("store") });
    test("puede ver pero no crear clientes", async ({ page }) => {
      await page.goto("/clientes");
      await expect(page.getByRole("link", { name: "Nuevo cliente" })).toHaveCount(0);
      await page.goto("/clientes/nuevo");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
