import { test, expect, asRole, expectToast } from "./fixtures";

test.describe("Configuración (Dirección)", () => {
  test.use({ storageState: asRole("admin") });

  test("alta de operario con PIN y luego ingresa por la tablet", async ({ page, browser }) => {
    await page.goto("/admin/usuarios/nuevo");
    await page.getByLabel("Nombre *").fill("Operario E2E");
    await page.getByLabel("Iniciales (planillas BPM) *").fill("O.E.");
    await page.getByLabel("Usuario *").fill("operarioe2e");
    await page.getByLabel("PIN de tablet").fill("8642");
    await page.getByRole("button", { name: "Crear usuario" }).click();
    await expectToast(page, "Usuario creado");
    await expect(page.getByRole("link", { name: "Operario E2E" })).toBeVisible();

    const ctx = await browser.newContext();
    const tablet = await ctx.newPage();
    await tablet.goto("/login/planta");
    await tablet.getByRole("button", { name: /O\.E\./ }).click();
    for (const d of "8642") await tablet.getByRole("button", { name: d, exact: true }).click();
    await tablet.getByRole("button", { name: "Entrar" }).click();
    await expect(tablet).toHaveURL(/\/planta$/);
    await ctx.close();
  });

  test("edita un parámetro y queda en la auditoría", async ({ page }) => {
    await page.goto("/admin");
    const input = page.getByLabel("labor.hourly_cost");
    await input.fill("6500");
    await input.locator("xpath=ancestor::tr").getByRole("button", { name: "Guardar" }).click();
    await expectToast(page, "Parámetro actualizado");
    await page.goto("/admin/auditoria?tabla=app_settings");
    await expect(page.getByText("5000 → 6500")).toBeVisible();
  });

  test.describe("jefa de producción", () => {
    test.use({ storageState: asRole("production_manager") });
    test("no accede a configuración", async ({ page }) => {
      await page.goto("/admin");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
