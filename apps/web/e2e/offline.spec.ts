import { test, expect, asRole, demoDay } from "./fixtures";

/**
 * Carga sin señal desde el celular (390×844): pedido (RF-02) y salida/cierre de ruta del chofer (RF-26).
 * Los registros quedan en la cola del equipo y al volver la conexión se crean UNA sola vez.
 */
const TAPITAS = "Chipá tapitas 0,5 kg";

test.describe("Pedido desde el celular sin señal (RF-02)", () => {
  test.use({ storageState: asRole("admin") });

  test("queda 'pendiente de enviar' y se crea una sola vez al volver la conexión", async ({
    page,
    context,
    sql,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pedidos/nuevo");
    await expect(page.getByRole("heading", { name: "Nuevo pedido" })).toBeVisible();
    const before = await sql`select 1 from orders`;

    await context.setOffline(true);
    await page.getByRole("combobox", { name: "Cliente" }).click();
    await page.getByPlaceholder("Escribí el nombre…").fill("vía");
    await page.getByRole("option", { name: "Vía Dolce" }).click();
    await page.getByLabel(`Cantidad de ${TAPITAS}`, { exact: true }).fill("20");
    await expect(page.getByTestId("order-total")).toHaveText("$ 84.000");
    await page.getByRole("button", { name: "Guardar pedido" }).click();

    // El pedido aparece como pendiente de enviar, el indicador del header avisa y el formulario queda listo
    // para cargar otro.
    const pending = page.getByTestId("pending-orders");
    await expect(pending).toContainText("Pendiente de enviar (1)");
    await expect(pending).toContainText("Vía Dolce");
    await expect(pending).toContainText("20 u.");
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    await expect(page).toHaveURL(/\/pedidos\/nuevo$/);
    expect(await sql`select 1 from orders`).toHaveLength(before.length);

    await context.setOffline(false);
    await expect
      .poll(async () => (await sql`select 1 from orders where client_id is not null`).length, {
        timeout: 20_000,
      })
      .toBe(1);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    await expect(page.getByTestId("pending-orders")).toHaveCount(0);

    // Una sola vez: el pedido, su única línea y su evento "recibido", a nombre de quien lo cargó.
    expect(await sql`select 1 from orders`).toHaveLength(before.length + 1);
    const [order] = await sql`select o.id, o.status, o.total::float8 as total, o.source, c.legal_name,
        (o.received_at at time zone 'America/Argentina/Buenos_Aires')::date::text as received_day,
        (select count(*)::int from order_items where order_id = o.id) as items,
        (select count(*)::int from order_events where order_id = o.id) as events,
        u.username
      from orders o join customers c on c.id = o.customer_id join users u on u.id = o.created_by_id
      where o.client_id is not null`;
    expect(order).toMatchObject({
      status: "received",
      total: 84000,
      source: "whatsapp",
      legal_name: "Vía Dolce",
      items: 1,
      events: 1,
      username: "nahuel",
      received_day: demoDay(),
    });
  });
});

test.describe("Salida de ruta sin señal (RF-26)", () => {
  test.use({ storageState: asRole("logistics") });

  test("el chofer inicia y cierra la ruta sin señal y se sincroniza una sola vez, en orden", async ({
    page,
    context,
    sql,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const [route] = await sql`
      insert into routes (date, vehicle_id, driver_id)
      values (${demoDay()}, (select id from vehicles where has_cold_unit limit 1),
              (select id from users where username = 'logistica'))
      returning id`;
    const routeId = route!.id as string;
    const coldLogs = async () =>
      (
        await sql`select 1 from temperature_logs t join equipment e on e.id = t.equipment_id
          where e.code = 'VEH-FRIO'`
      ).length;
    const logsBefore = await coldLogs();

    await page.goto(`/despacho/rutas/${routeId}`);
    await expect(page.getByLabel("Km inicial (tablero)")).toBeVisible();

    // Sin señal: sale con el camión...
    await context.setOffline(true);
    await page.getByLabel("Km inicial (tablero)").fill("12000");
    await page.getByRole("button", { name: "Iniciar ruta" }).click();
    await expect(page.getByText("salida pendiente de enviar")).toBeVisible();
    await expect(page.getByText(/En curso — salió \d\d:\d\d con 12000 km/)).toBeVisible();
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");

    // ...y al volver cierra la ruta, también sin señal.
    await page.getByLabel("Km final (tablero)").fill("12085");
    await page.getByLabel("Temperatura del equipo de frío (°C)").fill("-20");
    await page.getByLabel("Combustible (litros)").fill("9,5");
    await page.getByRole("button", { name: "Cerrar ruta" }).click();
    await expect(page.getByTestId("route-finish-pending")).toContainText("Km final 12085");
    await expect(page.getByTestId("offline-indicator")).toContainText("2 pendiente");
    const [still] = await sql`select status from routes where id = ${routeId}`;
    expect(still!.status).toBe("planned");

    await context.setOffline(false);
    await expect
      .poll(async () => (await sql`select status from routes where id = ${routeId}`)[0]!.status, {
        timeout: 20_000,
      })
      .toBe("done");
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    // La pantalla pasa sola al resumen de la salida cerrada.
    await expect(page.getByTestId("run-summary")).toContainText("12000 → 12085");

    const [closed] = await sql`select status, km_start::float8 as ks, km_end::float8 as ke,
        fuel_liters::float8 as liters, cold_unit_temp_c::float8 as temp, start_client_id, finish_client_id,
        (started_at < ended_at) as in_order
      from routes where id = ${routeId}`;
    expect(closed).toMatchObject({
      status: "done",
      ks: 12000,
      ke: 12085,
      liters: 9.5,
      temp: -20,
      in_order: true,
    });
    expect(closed!.start_client_id).toBeTruthy();
    expect(closed!.finish_client_id).toBeTruthy();
    // La temperatura del trayecto se registró una sola vez en el equipo de frío del vehículo.
    expect(await coldLogs()).toBe(logsBefore + 1);
  });
});

test.describe("Entrega con conformidad sin señal (RF-25)", () => {
  test.use({ storageState: asRole("logistics") });

  test("la entrega con foto queda en el celular y se registra una sola vez al volver la señal", async ({
    page,
    context,
    sql,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const [o] = await sql`insert into orders (customer_id, promised_date, status, total)
      values ((select id from customers where legal_name = 'Club Náutico'), ${demoDay()}, 'ready', 6000)
      returning id`;
    await sql`insert into order_items (order_id, product_id, qty_units, unit_price)
      values (${o!.id}, (select id from products where name = 'Chipá lengüitas 0,5 kg'), 6, 1000)`;
    const [route] = await sql`insert into routes (date, vehicle_id, driver_id, status, km_start)
      values (${demoDay()}, (select id from vehicles limit 1), (select id from users where username = 'logistica'), 'in_progress', 100)
      returning id`;
    await sql`insert into route_stops (route_id, seq, kind, order_id, customer_id)
      select ${route!.id}, 1, 'delivery', ${o!.id}, customer_id from orders where id = ${o!.id}`;
    await page.goto(`/despacho/rutas/${route!.id}`);
    await page.getByRole("button", { name: "Generar remito", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Entregar" })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole("button", { name: "Entregar" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Recibió (nombre y apellido)").fill("Pedro Díaz");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await dialog.getByLabel("Foto de la conformidad").setInputFiles({
      name: "remito.png",
      mimeType: "image/png",
      buffer: png,
    });
    await dialog.getByRole("button", { name: "Confirmar entrega" }).click();
    await expect(page.getByTestId("delivery-pending")).toContainText("pendiente de enviar");
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    const [still] = await sql`select status from dispatches where order_id = ${o!.id}`;
    expect(still!.status).toBe("prepared");

    await context.setOffline(false);
    await expect
      .poll(async () => (await sql`select status from dispatches where order_id = ${o!.id}`)[0]!.status, {
        timeout: 20_000,
      })
      .toBe("delivered");
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    const [d] =
      await sql`select received_by_name, proof_file_key, delivery_client_id from dispatches where order_id = ${o!.id}`;
    expect(d).toMatchObject({ received_by_name: "Pedro Díaz" });
    expect(d!.delivery_client_id).toBeTruthy();
    expect(d!.proof_file_key).toMatch(/\.jpg$/);
    await expect(async () => {
      const res = await request.get(`/api/files/${d!.proof_file_key}`);
      expect(res.status()).toBe(200);
    }).toPass({ timeout: 30_000 });
    expect((await sql`select status from orders where id = ${o!.id}`)[0]!.status).toBe("delivered");
  });
});

test.describe("Inventario físico sin señal (RF-15)", () => {
  test.use({ storageState: asRole("admin") });

  test("el avance del conteo se guarda sin señal, se retoma al recargar y se envía al volver la conexión", async ({
    page,
    context,
    sql,
  }) => {
    await page.goto("/stock/inventario");
    await page.getByRole("button", { name: "Nuevo conteo de materia prima" }).click();
    await expect(page).toHaveURL(/\/stock\/inventario\/[0-9a-f-]{36}$/);
    const countId = page.url().split("/").pop()!;
    const sal = page.getByLabel("Sal · lote SAL-0901 · DEP-SECO", { exact: true });
    await expect(sal).toBeVisible();

    // Sin señal el avance queda en la cola del equipo...
    await context.setOffline(true);
    await sal.fill("7");
    await page.getByRole("button", { name: "Guardar avance" }).click();
    await expect(page.getByTestId("count-pending")).toContainText("pendiente de enviar");
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    await expect(page.getByRole("button", { name: "Confirmar inventario" })).toBeDisabled();
    const counted = async () =>
      (
        await sql`select count(counted_qty)::int as n from inventory_count_items where count_id = ${countId}`
      )[0]!.n as number;
    expect(await counted()).toBe(0);

    // ...vuelve la señal pero el envío todavía falla (señal mala): se recarga la pantalla y se retoma lo cargado.
    await page.route("**/stock/inventario/**", (route) => {
      const req = route.request();
      return req.method() === "POST" && req.headers()["next-action"]
        ? route.abort("failed")
        : route.continue();
    });
    await context.setOffline(false);
    await page.reload();
    await expect(sal).toHaveValue("7");
    await expect(page.getByTestId("count-pending")).toBeVisible();
    expect(await counted()).toBe(0);

    // Con señal buena la cola se envía sola y queda guardado en el servidor, una sola vez.
    await page.unroute("**/stock/inventario/**");
    await context.setOffline(true);
    await context.setOffline(false);
    await expect.poll(counted, { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    await expect(page.getByTestId("count-pending")).toHaveCount(0);
    const [saved] = await sql`select c.last_save_client_id, i.counted_qty::float8 as qty
      from inventory_counts c join inventory_count_items i on i.count_id = c.id
      where c.id = ${countId} and i.counted_qty is not null`;
    expect(saved).toMatchObject({ qty: 7 });
    expect(saved!.last_save_client_id).toBeTruthy();
    await page.reload();
    await expect(sal).toHaveValue("7");
  });
});
