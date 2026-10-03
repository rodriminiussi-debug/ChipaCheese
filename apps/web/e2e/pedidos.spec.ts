import { test, expect, asRole, expectToast } from "./fixtures";

const TAPITAS = "Chipá tapitas 0,5 kg";
const LENGUITAS = "Chipá lengüitas 0,5 kg";

test.describe("Pedidos (RF-02 a RF-05)", () => {
  test.use({ storageState: asRole("admin") });

  test("carga un pedido completo desde el celular, lo edita y lo avanza hasta entregado", async ({
    page,
    sql,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const started = Date.now();
    let interactions = 0;

    await page.goto("/pedidos/nuevo");
    await expect(page.getByRole("heading", { name: "Nuevo pedido" })).toBeVisible();
    // Sin horizontal scroll en el celular.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // 1) cliente: abrir, escribir, elegir
    await page.getByRole("combobox", { name: "Cliente" }).click();
    interactions++;
    await page.getByPlaceholder("Escribí el nombre…").fill("vía");
    interactions++;
    await page.getByRole("option", { name: "Vía Dolce" }).click();
    interactions++;

    // La fecha viene precargada con el próximo día de entrega de Pueblo Esther (jueves).
    const promised = await page.getByLabel("Fecha comprometida").inputValue();
    expect(promised).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${promised}T12:00:00Z`).getUTCDay()).toBe(4);
    // El origen por defecto es WhatsApp.
    await expect(page.getByLabel("Origen")).toContainText("WhatsApp");

    // 2) cantidades (precio de la lista mayorista: $ 4.200 por bolsa)
    await expect(page.getByText("$ 4.200 c/u").first()).toBeVisible();
    await page.getByLabel(`Cantidad de ${TAPITAS}`, { exact: true }).fill("20");
    interactions++;
    await page.getByLabel(`Cantidad de ${LENGUITAS}`, { exact: true }).fill("10");
    interactions++;
    await expect(page.getByTestId("order-total")).toHaveText("$ 126.000");
    await expect(page.getByTestId("order-kg")).toContainText("15 kg");

    // 3) guardar
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    interactions++;
    await expectToast(page, /Pedido #\d+ cargado/);
    await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/);

    // Pocas interacciones y menos de un minuto (RF-02).
    expect(interactions).toBeLessThanOrEqual(8);
    expect(Date.now() - started).toBeLessThan(60_000);
    console.log(`RF-02: pedido cargado con ${interactions} interacciones en ${Date.now() - started} ms`);

    const orderId = page.url().split("/").pop()!;
    const [order] = await sql`select status, total::float8 as total, source, promised_date::text as promised
      from orders where id = ${orderId}`;
    expect(order).toMatchObject({ status: "received", total: 126000, source: "whatsapp", promised });
    const items =
      await sql`select unit_price::float8 as price, qty_units from order_items where order_id = ${orderId}`;
    expect(items.map((i) => i.price)).toEqual([4200, 4200]);

    // Detalle: ítems, total e historial con quién y cuándo.
    await expect(page.getByRole("heading", { name: /Pedido #\d+/ })).toBeVisible();
    await expect(page.getByTestId("order-detail-total")).toHaveText("$ 126.000");
    await expect(page.getByTestId("order-events").getByText("Recibido")).toBeVisible();
    await expect(page.getByTestId("order-events")).toContainText("Nahuel");

    // Avanzar: confirmar → editar ítems (solo recibido/confirmado) → producción → listo → despachado → entregado.
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await expectToast(page, "Pedido confirmado");
    await page.getByRole("link", { name: "Editar ítems" }).click();
    await expect(page.getByRole("heading", { name: /Editar pedido/ })).toBeVisible();
    await page.getByRole("button", { name: `Sumar ${TAPITAS}`, exact: true }).click();
    await expect(page.getByTestId("order-total")).toHaveText("$ 130.200");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expectToast(page, "Pedido actualizado");
    await expect(page.getByTestId("order-detail-total")).toHaveText("$ 130.200");

    await page.getByRole("button", { name: "Pasar a producción" }).click();
    await expectToast(page, "Pedido en producción");
    await expect(page.getByRole("link", { name: "Editar ítems" })).toHaveCount(0);
    await page.getByRole("button", { name: "Marcar listo" }).click();
    await expectToast(page, "Pedido listo");
    await page.getByRole("button", { name: "Despachar" }).click();
    await expectToast(page, "Pedido despachado");
    await page.getByRole("button", { name: "Marcar entregado" }).click();
    await expectToast(page, "Pedido entregado");

    await expect(page.getByTestId("order-events").getByText("Entregado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);
    const [done] =
      await sql`select status, delivered_at is not null as delivered from orders where id = ${orderId}`;
    expect(done).toMatchObject({ status: "delivered", delivered: true });
    const events = await sql`select status from order_events where order_id = ${orderId} order by at, id`;
    expect(events.map((e) => e.status)).toEqual([
      "received",
      "confirmed",
      "confirmed", // modificación de ítems
      "in_production",
      "ready",
      "dispatched",
      "delivered",
    ]);
  });

  test("las pantallas de pedidos no tienen scroll horizontal en el celular", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/pedidos", "/pedidos/envasado?fecha=2026-10-05", "/pedidos/fecha-posible?kg=425"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(
        true,
      );
    }
  });

  test("valida cliente y productos al guardar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pedidos/nuevo");
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    await expect(page.getByText("Elegí un cliente").first()).toBeVisible();
    await expect(page.getByText("Agregá al menos un producto")).toBeVisible();
  });

  test("RF-03: cancelar un pedido exige el motivo y queda en el historial", async ({ page, sql }) => {
    const [c] = await sql`select id from customers where legal_name = 'Vía Dolce'`;
    const [o] = await sql`insert into orders (customer_id, promised_date, status)
      values (${c!.id}, '2026-10-20', 'confirmed') returning id`;
    await page.goto(`/pedidos/${o!.id}`);
    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    const confirm = page.getByRole("button", { name: "Sí, cancelar" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Motivo de la cancelación").fill("   ");
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Motivo de la cancelación").fill("El cliente se quedó sin lugar en el freezer");
    await confirm.click();
    await expectToast(page, "Pedido cancelado");
    await expect(page.getByTestId("order-events")).toContainText(
      "El cliente se quedó sin lugar en el freezer",
    );
    const events = await sql`select status, note from order_events where order_id = ${o!.id} order by at`;
    expect(events.at(-1)).toMatchObject({
      status: "cancelled",
      note: "El cliente se quedó sin lugar en el freezer",
    });
  });

  test("repetir el último pedido carga las cantidades del cliente", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pedidos/nuevo");
    await page.getByRole("combobox", { name: "Cliente" }).click();
    await page.getByRole("option", { name: "La Esperanza" }).click();
    await page.getByRole("button", { name: "Repetir el último pedido" }).click();
    await expect(page.getByLabel("Cantidad de Chipá surtido 0,5 kg", { exact: true })).toHaveValue("15");
    await expect(page.getByTestId("order-total")).toHaveText("$ 63.000");
  });

  test("listado con filtros y badge de atrasados", async ({ page, sql }) => {
    // Un pedido con fecha comprometida vencida y sin entregar.
    const [c] = await sql`select id from customers where legal_name = 'Club Náutico'`;
    await sql`insert into orders (customer_id, promised_date, status, received_at)
      values (${c!.id}, '2026-01-10', 'confirmed', '2026-01-08T12:00:00Z')`;

    await page.goto("/pedidos");
    await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
    await expect(page.getByText("Atrasado").first()).toBeVisible();

    await page.getByLabel("Estado").selectOption("confirmed");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page).toHaveURL(/estado=confirmed/);
    await expect(page.getByRole("cell", { name: /Club Náutico/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /La Reina/ })).toHaveCount(0);

    await page.goto("/pedidos?atrasados=1");
    await expect(page.getByText("Atrasado").first()).toBeVisible();
    await page.goto("/pedidos?desde=2026-10-05&hasta=2026-10-05");
    await expect(page.getByRole("cell", { name: /Club Náutico/ })).toBeVisible();
  });

  test("hoja de envasado del día: totales por producto y por cliente", async ({ page }) => {
    await page.goto("/pedidos/envasado?fecha=2026-10-05");
    await expect(page.getByTestId("sheet-date")).toContainText("05/10/2026");
    await expect(page.getByText("Total a preparar por producto")).toBeVisible();
    // Pedido demo de Club Náutico: 2 bolsas de lengüitas 5 kg + 1 de tapitas 5 kg = 15 kg.
    const byProduct = page.getByRole("table");
    await expect(byProduct.getByRole("row", { name: /lengüitas granel 5 kg.* 2 10 kg/ })).toBeVisible();
    await expect(byProduct.getByRole("row", { name: /tapitas granel 5 kg.* 1 5 kg/ })).toBeVisible();
    await expect(page.getByText("Club Náutico")).toBeVisible();
    await expect(page.getByText("15 kg").first()).toBeVisible();

    // Navegar al día siguiente no rompe y muestra el estado vacío.
    await page.getByRole("link", { name: "Día siguiente" }).click();
    await expect(page.getByTestId("sheet-date")).toContainText("06/10/2026");
    await expect(page.getByText("No hay pedidos para preparar")).toBeVisible();

    await page.goto("/pedidos/envasado");
    await expect(page.getByRole("heading", { name: "Hoja de envasado" })).toBeVisible();
  });

  test("fecha posible del pedido grande de La Reina (850 bolsas)", async ({ page }) => {
    await page.goto("/pedidos?estado=received");
    const row = page.getByRole("row", { name: /La Reina/ });
    await expect(row).toContainText("425 kg");
    await row.getByRole("link").click();

    const card = page.getByTestId("estimate-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("estimate-date")).toBeVisible();
    // Stock demo: 147 kg de tapitas y lengüitas → faltan producir 278 kg (150 + 128).
    await expect(card).toContainText("faltan producir 278 kg");
    await expect(card).toContainText("Cronograma de producción sugerido");
    await expect(card).toContainText("150 kg");
    await expect(card).toContainText("128 kg");
  });

  test("calculadora: ¿para cuándo puedo entregar X kg?", async ({ page }) => {
    await page.goto("/pedidos/fecha-posible");
    await page.getByLabel("Kilos a entregar").fill("425");
    await page.getByLabel("Fecha pedida (opcional)").fill("2000-01-01");
    await page.getByRole("button", { name: "Calcular" }).click();
    await expect(page.getByText("equivalen a 850 bolsas")).toBeVisible();
    await expect(page.getByTestId("estimate-date")).toBeVisible();
    await expect(page.getByText("La fecha comprometida es anterior a la posible")).toBeVisible();

    // Un pedido chico alcanza con el stock.
    await page.getByLabel("Kilos a entregar").fill("5");
    await page.getByLabel("Fecha pedida (opcional)").fill("");
    await page.getByRole("button", { name: "Calcular" }).click();
    await expect(page.getByText("Alcanza con el stock terminado")).toBeVisible();
  });

  test("clientes para llamar y frecuencia en la ficha del cliente", async ({ page, sql }) => {
    // Cliente que pedía cada 7 días y dejó de pedir hace mucho.
    const [c] =
      await sql`insert into customers (legal_name, channel) values ('Kiosco Frecuente E2E', 'reseller') returning id`;
    for (const d of ["2026-07-01", "2026-07-08", "2026-07-15"]) {
      await sql`insert into orders (customer_id, promised_date, status, received_at)
        values (${c!.id}, ${d}, 'paid', ${`${d}T12:00:00Z`})`;
    }

    await page.goto("/pedidos");
    const panel = page.getByTestId("overdue-customers");
    await expect(panel.getByText("Clientes para llamar").first()).toBeVisible();
    await expect(panel.getByRole("link", { name: "Kiosco Frecuente E2E" })).toBeVisible();
    await expect(panel).toContainText("pide cada 7 días");
    // Los que están al día no aparecen.
    await expect(panel.getByRole("link", { name: "Vía Dolce" })).toHaveCount(0);

    await panel.getByRole("link", { name: "Kiosco Frecuente E2E" }).click();
    await expect(page.getByRole("heading", { name: "Kiosco Frecuente E2E" })).toBeVisible();
    await expect(page.getByText("Frecuencia de compra")).toBeVisible();
    await expect(page.getByText("7 días").first()).toBeVisible();
    await expect(page.getByText("Para llamar: superó su frecuencia habitual")).toBeVisible();

    // Vía Dolce: historial con sus 4 pedidos demo y 7 días de frecuencia.
    await page.goto("/clientes");
    await page.getByRole("link", { name: "Vía Dolce" }).click();
    await expect(page.getByRole("region", { name: "Historial de compras" })).toContainText(
      "Comprado (90 días)",
    );
    await expect(page.getByRole("link", { name: /^#\d+$/ }).nth(3)).toBeVisible(); // 4 demo + los de otros tests
  });
});

test.describe("Pedidos: permisos", () => {
  test.describe("logística", () => {
    test.use({ storageState: asRole("logistics") });
    test("ve los pedidos pero no los crea ni edita; solo despacha y entrega", async ({ page }) => {
      await page.goto("/pedidos");
      await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Nuevo pedido" })).toHaveCount(0);
      await expect(page.getByTestId("overdue-customers")).toHaveCount(0);
      await page.goto("/pedidos/nuevo");
      await expect(page).toHaveURL(/sin-permiso/);

      await page.goto("/pedidos?estado=confirmed");
      await page
        .getByRole("row", { name: /Club Náutico/ })
        .getByRole("link")
        .first()
        .click();
      await expect(page.getByRole("button", { name: "Despachar" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pasar a producción" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Editar ítems" })).toHaveCount(0);
    });
  });

  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("no ve pedidos", async ({ page }) => {
      await page.goto("/pedidos");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
