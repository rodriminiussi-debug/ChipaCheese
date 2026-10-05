import { test, expect, asRole, expectToast } from "./fixtures";

/** Catálogo editable: Nahuel carga productos de reventa y elaborados, insumos, vehículos y freezers. */
test.describe.configure({ mode: "serial" });

test.describe("Catálogo (Dirección)", () => {
  test.use({ storageState: asRole("admin") });

  test("crea una gaseosa de reventa con costo y precio en la lista del local, y ve el margen", async ({
    page,
  }) => {
    await page.goto("/catalogo");
    await expect(page).toHaveURL(/\/catalogo\/productos/);
    await page.getByRole("link", { name: "Nuevo producto" }).click();
    await page.getByRole("radio", { name: /Reventa/ }).check();
    await page.getByLabel("Código *").fill("RV-COLA-1L");
    await page.getByLabel("Nombre *").fill("Gaseosa cola 1 L");
    await page.getByLabel("Se cuenta en (bolsa, botella, lata…) *").fill("botella");
    await page.getByLabel("Código de barras").fill("7791234000011");
    await page.getByLabel("Costo de compra inicial (sin IVA, por unidad)").fill("1500");
    await page.getByLabel("Precio en Local (minorista)").fill("2400");
    await expect(page.getByTestId("cost-preview")).toContainText("$ 1.500");
    await expect(page.getByText(/Margen 37,5\s?%/)).toBeVisible();
    await page.getByRole("button", { name: "Crear producto" }).click();
    await expectToast(page, "Producto creado");
    await expect(page.getByRole("heading", { name: "Gaseosa cola 1 L" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Costo y precios actuales" })).toContainText(
      "Local (minorista)",
    );

    // Está en la matriz de precios con su margen
    await page.goto("/precios");
    await page.getByRole("tab", { name: "Local (minorista)" }).click();
    const row = page.getByRole("row").filter({ hasText: "Gaseosa cola 1 L" });
    await expect(row).toContainText("$ 2.400");
    await expect(row).toContainText("$ 1.500");
  });

  test("rechaza un código repetido", async ({ page }) => {
    await page.goto("/catalogo/productos/nuevo");
    await page.getByRole("radio", { name: /Reventa/ }).check();
    await page.getByLabel("Código *").fill("RV-GAS-500");
    await page.getByLabel("Nombre *").fill("Otra gaseosa");
    await page.getByRole("button", { name: "Crear producto" }).click();
    await expectToast(page, "Ya existe un producto con el código RV-GAS-500");
  });

  test("crea un elaborado con base 'Chipá tapitas 0,5 kg' y ve su costo", async ({ page }) => {
    await page.goto("/catalogo/productos/nuevo");
    await page.getByRole("radio", { name: /Elaborado en el local/ }).check();
    await page.getByLabel("Código *").fill("EL-HOR-500");
    await page.getByLabel("Nombre *").fill("Chipá horneado 500 g");
    await page
      .getByLabel("Producto base (chipá terminado) *")
      .selectOption({ label: "Chipá tapitas 0,5 kg" });
    await page.getByLabel("Unidades del producto base que consume *").fill("0,5");
    await expect(page.getByTestId("cost-preview")).toContainText("Costo directo estimado");
    await page.getByRole("button", { name: "Crear producto" }).click();
    await expectToast(page, "Producto creado");
    await expect(page.getByRole("heading", { name: "Chipá horneado 500 g" })).toBeVisible();

    await page.goto("/catalogo/productos?tipo=prepared");
    await expect(page.getByRole("row").filter({ hasText: "Chipá horneado 500 g" })).toContainText(
      "0,50 × Chipá tapitas 0,5 kg",
    );
  });

  test("filtra por tipo y busca", async ({ page }) => {
    await page.goto("/catalogo/productos?tipo=resale");
    await expect(page.getByRole("link", { name: "Gaseosa 500 ml" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chipá tapitas 0,5 kg" })).toHaveCount(0);
    await page.goto("/catalogo/productos?q=horneado");
    await expect(page.getByRole("link", { name: /Chipá horneado/ }).first()).toBeVisible();
  });

  test("crea un insumo con precio inicial", async ({ page }) => {
    await page.goto("/catalogo/insumos");
    await page.getByRole("button", { name: "Nuevo insumo" }).click();
    await page.getByLabel("Nombre *").fill("Orégano");
    await page.getByLabel("Categoría").selectOption("seasoning");
    await page.getByLabel("Precio inicial (sin IVA, por unidad)").fill("8500");
    await page.getByRole("button", { name: "Crear insumo" }).click();
    await expectToast(page, "Insumo creado");
    const row = page.getByRole("row").filter({ hasText: "Orégano" });
    await expect(row).toContainText("$ 8.500");
  });

  test("crea un vehículo y un freezer nuevo que aparece en temperaturas", async ({ page }) => {
    await page.goto("/catalogo/vehiculos");
    await page.getByRole("button", { name: "Nuevo vehículo" }).click();
    await page.getByLabel("Nombre *").fill("Furgón nuevo");
    await page.getByLabel("Patente *").fill("ab123cd");
    await page.getByLabel("Costo por km").fill("320");
    await page.getByRole("button", { name: "Crear vehículo" }).click();
    await expectToast(page, "Vehículo creado");
    await expect(page.getByRole("row").filter({ hasText: "AB123CD" })).toContainText("VEH-AB123CD");

    await page.goto("/catalogo/equipos");
    await page.getByRole("button", { name: "Nuevo equipo" }).click();
    await page.getByLabel("Código *").fill("F5");
    await page.getByLabel("Nombre *").fill("Freezer F5");
    await page.getByRole("button", { name: "Crear equipo" }).click();
    await expectToast(page, "Equipo creado");

    await page.goto("/planta/temperaturas");
    await expect(page.getByText("Freezer F5").first()).toBeVisible();
  });

  test("zona y lista de precios nueva copiando con ajuste", async ({ page }) => {
    await page.goto("/catalogo/zonas");
    await page.getByRole("button", { name: "Nueva zona" }).click();
    await page.getByLabel("Nombre *").fill("Baigorria");
    await page.getByRole("button", { name: "Martes" }).click();
    await page.getByRole("button", { name: "Crear zona" }).click();
    await expectToast(page, "Zona creada");
    await expect(page.getByRole("row").filter({ hasText: "Baigorria" })).toContainText("Mar");

    await page.goto("/catalogo/listas");
    await page.getByRole("button", { name: "Nueva lista de precios" }).click();
    await page.getByLabel("Nombre *").fill("Distribuidores");
    await page.getByLabel("Copiar precios de otra lista").selectOption({ label: "Revendedores (mayorista)" });
    await page.getByLabel("Ajuste sobre los precios copiados (%)").fill("15");
    await page.getByRole("button", { name: "Crear lista" }).click();
    await expectToast(page, /Lista creada con \d+ precios copiados/);
  });
});

test.describe("Catálogo (Contadora)", () => {
  test.use({ storageState: asRole("accountant") });

  test("no accede al catálogo", async ({ page }) => {
    await page.goto("/catalogo/productos");
    await expect(page).toHaveURL(/sin-permiso/);
    await page.goto("/catalogo/insumos");
    await expect(page).toHaveURL(/sin-permiso/);
  });
});
