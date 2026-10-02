import { test, expect, asRole } from "./fixtures";

test.describe("Autenticación y permisos", () => {
  test("redirige a login sin sesión", async ({ page }) => {
    await page.goto("/tablero");
    await expect(page).toHaveURL(/\/login\?next=%2Ftablero/);
  });

  test("login con usuario y contraseña lleva al inicio del rol", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Usuario o email").fill("nahuel");
    await page.getByLabel("Contraseña").fill("chipa1234");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/tablero/);
    await expect(page.getByTestId("current-user")).toHaveText("Nahuel");
  });

  test("contraseña incorrecta muestra error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Usuario o email").fill("nahuel");
    await page.getByLabel("Contraseña").fill("mal");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Usuario o contraseña incorrectos.")).toBeVisible();
  });

  test("operario entra con PIN al modo planta", async ({ page }) => {
    await page.goto("/login/planta");
    await page.getByRole("button", { name: /J\.T\./ }).click();
    for (const d of "1234") await page.getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/planta$/);
    await expect(page.getByTestId("tile-produccion")).toBeVisible();
  });

  test.describe("operario", () => {
    test.use({ storageState: asRole("operator") });
    test("no accede a compras", async ({ page }) => {
      await page.goto("/compras");
      await expect(page).toHaveURL(/\/sin-permiso/);
    });
  });

  test.describe("jefa de producción", () => {
    test.use({ storageState: asRole("production_manager") });
    test("no ve finanzas en el menú", async ({ page }) => {
      await page.goto("/produccion");
      await expect(page.getByRole("link", { name: "Producción", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Cobranzas" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Gastos y costeo" })).toHaveCount(0);
    });
  });
});
