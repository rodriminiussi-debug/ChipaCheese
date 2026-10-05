import { test, expect, asRole, expectToast } from "./fixtures";

/** Mi cuenta: cambiar la propia contraseña y el PIN, y volver a ingresar con los nuevos. */
test.describe.configure({ mode: "serial" });

test.describe("Mi cuenta", () => {
  test.use({ storageState: asRole("store") });

  test("muestra mi rol y mis permisos en palabras; hay un enlace en el menú", async ({ page }) => {
    await page.goto("/local");
    await page.getByRole("link", { name: "Mi cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
    await expect(page.getByTestId("account-role")).toHaveText("Local");
    const list = page.getByRole("list", { name: "Mis permisos" });
    await expect(list).toContainText("Vender y cerrar la caja del local");
    await expect(list).toContainText("Avisar la falla de un equipo");
    await expect(list).not.toContainText("Administrar usuarios");
  });

  test("cambiar la contraseña: pide la actual, valida y cierra las otras sesiones", async ({ page, sql }) => {
    const [{ id }] = await sql`select id from users where username = 'local1'`;
    await sql`insert into sessions (id, user_id, expires_at) values ('otra-sesion-e2e', ${id}, now() + interval '1 day')`;
    await page.goto("/cuenta");

    await page.getByLabel("Contraseña actual", { exact: true }).fill("mal");
    await page.getByLabel("Contraseña nueva", { exact: true }).fill("corta");
    await page.getByLabel("Repetí la contraseña nueva").fill("corta");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByText("Mínimo 8 caracteres")).toBeVisible();

    await page.getByLabel("Contraseña nueva", { exact: true }).fill("ClaveNueva2026");
    await page.getByLabel("Repetí la contraseña nueva").fill("ClaveNueva2026");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expectToast(page, "La contraseña actual no es correcta");

    await page.getByLabel("Contraseña actual", { exact: true }).fill("chipa1234");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expectToast(page, "Contraseña cambiada");
    expect((await sql`select 1 from sessions where id = 'otra-sesion-e2e'`).length).toBe(0);
    // La sesión actual sigue abierta.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
  });

  test("cambiar el PIN con la contraseña nueva", async ({ page }) => {
    await page.goto("/cuenta");
    await page.getByLabel("Contraseña o PIN actual").fill("ClaveNueva2026");
    await page.getByLabel("PIN nuevo", { exact: true }).fill("864209");
    await page.getByLabel("Repetí el PIN nuevo").fill("864209");
    await page.getByRole("button", { name: "Cambiar PIN" }).click();
    await expectToast(page, "PIN cambiado");
  });

  test.describe("operario con PIN", () => {
    test.use({ storageState: asRole("operator") });
    test("cambia su PIN con el PIN actual desde la tablet (enlace en la cabecera de planta)", async ({
      page,
    }) => {
      await page.goto("/planta");
      await page.getByRole("link", { name: "Mi cuenta" }).click();
      await expect(page.getByTestId("account-role")).toHaveText("Operario");
      await page.getByLabel("Contraseña o PIN actual").fill("1234");
      await page.getByLabel("PIN nuevo", { exact: true }).fill("864209");
      await page.getByLabel("Repetí el PIN nuevo").fill("864209");
      await page.getByRole("button", { name: "Cambiar PIN" }).click();
      await expectToast(page, "PIN cambiado");
    });
  });
});

test.describe("Ingreso con los datos nuevos", () => {
  test("la contraseña vieja ya no sirve y la nueva sí", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Usuario o email").fill("local1");
    await page.getByLabel("Contraseña").fill("chipa1234");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Usuario o contraseña incorrectos.")).toBeVisible();
    await page.getByLabel("Contraseña").fill("ClaveNueva2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/local/);
  });

  test("el PIN nuevo entra en la tablet y el viejo no", async ({ page }) => {
    const enter = async (pin: string) => {
      await page.goto("/login/planta");
      await page.getByRole("button", { name: /J\.T\./ }).click();
      for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
      await page.getByRole("button", { name: "Entrar" }).click();
    };
    await enter("1234");
    await expect(page.getByText("PIN incorrecto.")).toBeVisible();
    await enter("864209");
    await expect(page).toHaveURL(/\/planta$/);
  });
});
