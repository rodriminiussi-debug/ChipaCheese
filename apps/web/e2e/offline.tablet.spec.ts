import { test, expect, asRole, demoDay } from "./fixtures";

/**
 * Tablet de planta sin señal (RF-20): pesadas, envasado y confirmación de consumos quedan en la cola del
 * equipo y, al volver la conexión, se envían UNA sola vez (idempotencia por clientId).
 */
test.use({ storageState: asRole("operator") });

type Sql = import("postgres").Sql;

/** Producción de hoy en elaboración (la crea la jefa; este spec prueba la carga del operario). */
async function createRun(sql: Sql) {
  const date = demoDay();
  const [{ id: recipeId }] = await sql`select id from recipes where status = 'active'`;
  const [{ id: userId }] = await sql`select id from users where username = 'af'`;
  const [{ n }] =
    await sql`select coalesce(max(run_number), 0) + 1 as n from production_runs where date = ${date}`;
  const [run] =
    await sql`insert into production_runs (date, run_number, recipe_id, starch_kg, batches, status, responsible_id)
      values (${date}, ${n}, ${recipeId}, 75, 2, 'in_progress', ${userId}) returning id`;
  return run!.id as string;
}

test.describe("Planta sin señal (RF-20)", () => {
  test("la pesada sin señal queda en cola y se sincroniza una sola vez al volver la conexión", async ({
    page,
    context,
    sql,
  }) => {
    const runId = await createRun(sql);
    await page.goto(`/planta/produccion?id=${runId}`);
    await expect(page.getByLabel("Pesada de tapitas en kg")).toBeVisible();

    await context.setOffline(true);
    await page.getByLabel("Pesada de tapitas en kg").fill("40");
    await page.getByLabel("Pesada de lengüitas en kg").fill("30");
    await page.getByRole("button", { name: "Guardar pesadas" }).click();

    // La tablet avisa que quedó guardado y lo muestra como pendiente de enviar; todavía no llegó al servidor.
    await expect(page.getByTestId("weighings-pending")).toContainText("Tapitas · 40 kg");
    await expect(page.getByTestId("weighings-pending")).toContainText("Pendiente de enviar");
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    expect(await sql`select 1 from production_weighings where run_id = ${runId}`).toHaveLength(0);

    await context.setOffline(false);
    await expect
      .poll(async () => (await sql`select 1 from production_weighings where run_id = ${runId}`).length, {
        timeout: 20_000,
      })
      .toBe(2);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    // La pantalla se refresca sola con lo que acaba de llegar.
    await expect(page.getByText(/Pesado: 70 kg/)).toBeVisible();
    await expect(page.getByTestId("weighings-pending")).toHaveCount(0);

    // Una sola vez: dos filas (tapita y lenguita), cada una con su client_id, y la hora real de la carga.
    const rows = await sql`select shape, kg::float8 as kg, client_id,
        (weighed_at at time zone 'America/Argentina/Buenos_Aires')::date::text as day
      from production_weighings where run_id = ${runId} order by shape`;
    expect(rows.map((r) => [r.shape, r.kg])).toEqual([
      ["tapita", 40],
      ["lenguita", 30],
    ]);
    expect(rows.every((r) => r.client_id)).toBe(true);
    expect(new Set(rows.map((r) => r.client_id)).size).toBe(2);
    // La hora es la de la carga en la tablet (reloj congelado en el día demo), no la de la sincronización.
    expect(rows.every((r) => r.day === demoDay())).toBe(true);
  });

  test("si el servidor guarda pero la respuesta se pierde, el reenvío de la cola no duplica la pesada", async ({
    page,
    context,
    sql,
  }) => {
    const runId = await createRun(sql);
    await page.goto(`/planta/produccion?id=${runId}`);
    await expect(page.getByLabel("Pesada de aritos en kg")).toBeVisible();

    // El servidor procesa la Server Action pero la tablet nunca recibe la respuesta.
    await page.route("**/planta/produccion**", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByLabel("Pesada de aritos en kg").fill("12");
    await page.getByRole("button", { name: "Guardar pesadas" }).click();
    await expect(page.getByTestId("weighings-pending")).toContainText("Aritos · 12 kg");
    expect(await sql`select 1 from production_weighings where run_id = ${runId}`).toHaveLength(1);

    // Vuelve la señal: la cola reenvía el mismo registro y el servidor lo reconoce por su clientId.
    await page.unroute("**/planta/produccion**");
    await context.setOffline(true);
    await context.setOffline(false);
    await expect(page.getByTestId("weighings-pending")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    await expect(page.getByText(/Pesado: 12 kg/)).toBeVisible();
    const rows =
      await sql`select kg::float8 as kg, client_id from production_weighings where run_id = ${runId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kg: 12 });
  });

  test("el envasado sin señal se registra una sola vez y suma el stock del lote una vez", async ({
    page,
    context,
    sql,
  }) => {
    const runId = await createRun(sql);
    await page.goto(`/planta/envasado?id=${runId}`);
    await expect(page.getByRole("button", { name: "Chipá tapitas 0,5 kg" })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole("button", { name: "Chipá tapitas 0,5 kg" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Sumar 10", exact: true }).click();
    await page.getByRole("button", { name: "F4" }).click();
    await page.getByRole("button", { name: "Confirmar envasado (30)" }).click();

    await expect(page.getByTestId("packing-pending")).toContainText("30 u.");
    await expect(page.getByRole("status").filter({ hasText: "Quedó en la cola" })).toContainText("30 bolsas");
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    expect(await sql`select 1 from finished_lots where run_id = ${runId}`).toHaveLength(0);

    await context.setOffline(false);
    await expect
      .poll(
        async () =>
          (
            await sql`select 1 from packings p join finished_lots l on l.id = p.finished_lot_id
              where l.run_id = ${runId}`
          ).length,
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Envasado de este lote" })).toContainText("30 u.");

    const packings = await sql`select p.units, p.client_id, l.code from packings p
      join finished_lots l on l.id = p.finished_lot_id where l.run_id = ${runId}`;
    expect(packings).toHaveLength(1);
    expect(packings[0]).toMatchObject({ units: 30 });
    expect(packings[0]!.client_id).toBeTruthy();
    const [stock] = await sql`select coalesce(sum(s.qty), 0)::float as qty, min(loc.code) as loc
      from finished_lots l join v_product_stock s on s.finished_lot_id = l.id
      join locations loc on loc.id = s.location_id where l.run_id = ${runId}`;
    expect(stock).toMatchObject({ qty: 30, loc: "F4" });
    const outputs = await sql`select 1 from stock_movements m join packings p on p.id = m.ref_id
      where m.ref_table = 'packings' and m.type = 'production_output' and p.finished_lot_id in
      (select id from finished_lots where run_id = ${runId})`;
    expect(outputs).toHaveLength(1);
  });

  test("la confirmación de consumos sin señal descuenta el stock una sola vez", async ({
    page,
    context,
    sql,
  }) => {
    const runId = await createRun(sql);
    await page.goto(`/planta/produccion?id=${runId}`);
    const confirm = page.getByRole("button", { name: "Confirmar consumos" });
    await expect(confirm).toBeEnabled();

    await context.setOffline(true);
    await confirm.click();
    await expect(page.getByTestId("consumptions-pending")).toContainText("pendientes de enviar");
    await expect(confirm).toBeDisabled(); // no se puede reconfirmar mientras haya una confirmación en la cola
    await expect(page.getByTestId("offline-indicator")).toContainText("1 pendiente");
    expect(
      await sql`select 1 from stock_movements where ref_table = 'production_runs' and ref_id = ${runId}`,
    ).toHaveLength(0);

    await context.setOffline(false);
    await expect
      .poll(
        async () =>
          (await sql`select 1 from production_consumption_confirmations where run_id = ${runId}`).length,
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    await expect(page.getByText(/Consumos cargados \(\d+ líneas\)/)).toBeVisible();

    const consumptions = await sql`select 1 from production_consumptions where run_id = ${runId}`;
    const moves = await sql`select qty::float8 as qty from stock_movements
      where ref_table = 'production_runs' and ref_id = ${runId} and type = 'production_consumption'`;
    expect(consumptions.length).toBeGreaterThanOrEqual(7);
    expect(moves).toHaveLength(consumptions.length); // un movimiento por consumo, sin reversiones
    expect(moves.every((m) => m.qty < 0)).toBe(true);
  });
});
