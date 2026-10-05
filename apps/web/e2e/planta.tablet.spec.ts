import { test, expect, asRole, expectToast, demoDay } from "./fixtures";

const todayAR = () => demoDay();

test.describe("Modo planta en tablet (M4)", () => {
  test.use({ storageState: asRole("operator") });

  /** Producción de hoy en elaboración, creada por la jefa (fixture SQL: este spec prueba la carga del operario). */
  async function createRun(sql: import("postgres").Sql) {
    const date = todayAR();
    const [{ id: recipeId }] = await sql`select id from recipes where status = 'active'`;
    const [{ id: userId }] = await sql`select id from users where username = 'af'`;
    const [{ n }] =
      await sql`select coalesce(max(run_number), 0) + 1 as n from production_runs where date = ${date}`;
    const [run] =
      await sql`insert into production_runs (date, run_number, recipe_id, starch_kg, batches, status, responsible_id)
      values (${date}, ${n}, ${recipeId}, 75, 2, 'in_progress', ${userId}) returning id`;
    return { id: run!.id as string, number: Number(n) };
  }

  async function openRun(page: import("@playwright/test").Page, number: number) {
    // Con varias producciones abiertas hay que elegir; con una sola se abre directo.
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const [y, m, d] = todayAR().split("-");
    // Puede haber producciones de otros días con el mismo número (se envasa lo de ayer): número + fecha.
    const pick = page.getByRole("link", { name: new RegExp(`Producción N° ${number} · ${d}/${m}/${y}`) });
    if (await pick.isVisible()) await pick.click();
  }

  test("el operario carga consumo real y pesadas con botones grandes", async ({ page, sql }) => {
    const run = await createRun(sql);
    await page.goto("/planta");
    await page.getByTestId("tile-produccion").click();
    await expect(page.getByRole("heading", { name: "Producción y pesadas" })).toBeVisible();
    await openRun(page, run.number);
    await expect(page.getByRole("heading", { name: `Producción N° ${run.number}` })).toBeVisible();

    // Consumo real: viene precargado, un toque lo confirma. Los controles son grandes (≥ 64 px).
    const confirm = page.getByRole("button", { name: "Confirmar consumos" });
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    expect(
      (await page.getByLabel("Real de Leche", { exact: true }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(64);
    await confirm.click();
    await expectToast(page, "Consumos registrados");
    await expect(page.getByText(/Consumos cargados \(\d+ líneas\)/)).toBeVisible();

    // Pesadas por forma.
    const save = page.getByRole("button", { name: "Guardar pesadas" });
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await expect(page.getByLabel("Pesada de tapitas en kg")).toHaveAttribute("inputmode", "decimal");
    await page.getByLabel("Pesada de tapitas en kg").fill("40");
    await page.getByLabel("Pesada de aritos en kg").fill("5");
    await page.getByLabel("Pesada de lengüitas en kg").fill("30");
    await save.click();
    await expectToast(page, "Pesadas registradas");
    await expect(page.getByText(/Pesado: 75 kg/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Pesadas cargadas" })).toContainText("Tapitas · 40 kg");

    // Los consumos quedaron en el libro mayor (con los lotes repartidos por FEFO según el stock).
    const [moves] = await sql`select count(*)::int as n, sum(qty)::float as qty from stock_movements
      where ref_table = 'production_runs' and ref_id = ${run.id} and type = 'production_consumption'`;
    expect(moves!.n).toBeGreaterThanOrEqual(7);
    expect(moves!.qty).toBeLessThan(0);
  });

  test("el operario envasa con +/− y queda el lote con su stock y la etiqueta", async ({ page, sql }) => {
    const run = await createRun(sql);
    await page.goto("/planta");
    await page.getByTestId("tile-envasado").click();
    await openRun(page, run.number);
    await expect(
      page.getByRole("heading", { name: new RegExp(`Envasado · Producción N° ${run.number}`) }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Chipá tapitas 0,5 kg" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Sumar 10", exact: true }).click();
    await page.getByRole("button", { name: "Sumar 1", exact: true }).click();
    await page.getByRole("button", { name: "Restar 1", exact: true }).click();
    await expect(page.getByRole("status", { name: "Bolsas a registrar" })).toHaveText("30");
    await page.getByRole("button", { name: "F4" }).click();
    const confirm = page.getByRole("button", { name: "Confirmar envasado (30)" });
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await confirm.click();
    await expectToast(page, /Envasado registrado: 30 u\. en el lote \d{6}-\d+/);
    await expect(page.getByRole("link", { name: "Imprimir etiquetas" })).toBeVisible();
    const packed = page.getByRole("region", { name: "Envasado de este lote" });
    await expect(packed).toContainText("Chipá tapitas 0,5 kg");
    await expect(packed).toContainText("30 u.");

    const [lot] = await sql`select l.code, coalesce(sum(s.qty), 0)::float as qty, min(loc.code) as loc
      from finished_lots l left join v_product_stock s on s.finished_lot_id = l.id
      left join locations loc on loc.id = s.location_id
      where l.run_id = ${run.id} group by l.code`;
    expect(lot).toMatchObject({ qty: 30, loc: "F4" });
    await page.getByRole("link", { name: "Imprimir etiquetas" }).click();
    await expect(page.getByRole("img", { name: new RegExp(`lote ${lot!.code}`) }).first()).toBeVisible();
    await expect(page.getByTestId("product-label")).toHaveCount(30);
  });

  test("mis tareas de hoy muestra lo asignado en el pizarrón", async ({ page, sql }) => {
    await sql`insert into task_assignments (date, task_id, user_id)
      select ${todayAR()}, t.id, u.id from plant_tasks t, users u
      where t.name = 'Huevos' and u.username = 'jt' on conflict do nothing`;
    await page.goto("/planta");
    await page.getByTestId("tile-tareas").click();
    await expect(page.getByRole("heading", { name: "Mis tareas de hoy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preproducción" })).toBeVisible();
    await expect(page.getByText("Huevos")).toBeVisible();
  });

  test("el operario recibe una orden de compra: lote, vencimiento y temperatura con alerta sobre 5 °C", async ({
    page,
    sql,
  }) => {
    const [{ id: supplierId }] = await sql`select id from suppliers where legal_name = 'Leo Pelle'`;
    const [order] =
      await sql`insert into purchase_orders (number, supplier_id, ordered_at, expected_at, status)
      values ('OC-TAB-1', ${supplierId}, ${demoDay(-1)}, ${todayAR()}, 'sent') returning id`;
    await sql`insert into purchase_order_items (purchase_order_id, ingredient_id, qty, unit)
      select ${order!.id}, id, 50, 'kg' from ingredients where name = 'Fécula de mandioca'`;
    await sql`insert into purchase_order_items (purchase_order_id, ingredient_id, qty, unit)
      select ${order!.id}, id, 10, 'kg' from ingredients where name = 'Queso barra (Tybo/Maki)'`;
    const stock = async (name: string) => {
      const [r] = await sql`select coalesce(sum(sm.qty), 0)::float as qty from stock_movements sm
        join ingredients i on i.id = sm.ingredient_id where i.name = ${name}`;
      return r!.qty as number;
    };
    const [fecula0, queso0] = [await stock("Fécula de mandioca"), await stock("Queso barra (Tybo/Maki)")];

    await page.goto("/planta");
    await page.getByTestId("tile-recepcion").click();
    await expect(page.getByRole("heading", { name: "Recibir mercadería" })).toBeVisible();
    const card = page.getByTestId("reception-order").filter({ hasText: "OC-TAB-1" });
    await expect(card).toContainText("Se espera hoy");
    await card.click();
    await expect(page.getByRole("heading", { name: "Recibir OC-TAB-1" })).toBeVisible();

    // Controles grandes y precarga de lo pendiente.
    const register = page.getByRole("button", { name: /Registrar recepción/ });
    expect((await register.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    expect(
      (await page.getByLabel("Cantidad recibida (kg) — Fécula de mandioca").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(64);
    await expect(page.getByLabel("Cantidad recibida (kg) — Fécula de mandioca")).toHaveValue("50");

    // Faltan lote y temperatura: el servidor lo explica.
    await register.click();
    await expectToast(page, /falta el lote del proveedor|la temperatura es obligatoria/);

    await page.getByLabel("Lote del proveedor — Fécula de mandioca").fill("FEC-TAB");
    await page.getByLabel("Lote del proveedor — Queso barra (Tybo/Maki)").fill("TYBO-TAB");
    await page.getByLabel("Vencimiento — Queso barra (Tybo/Maki)").fill("2026-12-31");
    await page.getByLabel("Cantidad recibida (kg) — Queso barra (Tybo/Maki)").fill("8,5");
    await page.getByLabel("Temperatura °C — Queso barra (Tybo/Maki)").fill("7");
    await expect(page.getByRole("alert").filter({ hasText: "Temperatura fuera de rango" })).toBeVisible();
    await register.click();

    await expect(page.getByTestId("reception-done")).toContainText("2 lotes ingresados");
    await expect(page.getByTestId("reception-done").getByRole("alert")).toContainText(
      "Queso barra (Tybo/Maki) llegó a 7,0 °C",
    );
    expect(await stock("Fécula de mandioca")).toBe(fecula0 + 50);
    expect(await stock("Queso barra (Tybo/Maki)")).toBe(queso0 + 8.5);
    const [rec] = await sql`select u.username, r.purchase_order_id from receptions r
      join users u on u.id = r.received_by_id order by r.created_at desc limit 1`;
    expect(rec).toMatchObject({ username: "jt", purchase_order_id: order!.id });
    const [po] = await sql`select status from purchase_orders where id = ${order!.id}`;
    expect(po!.status).toBe("partially_received"); // del queso llegaron 8,5 de 10
  });

  test("entrega sin orden: el operario elige el proveedor y carga lo que trajo", async ({ page, sql }) => {
    await page.goto("/planta/recepcion");
    await page.getByRole("link", { name: "Leo Pelle", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recibir mercadería" })).toBeVisible();
    await page.getByLabel("Cantidad recibida (kg) — Fécula de mandioca").fill("25");
    await page.getByLabel("Lote del proveedor — Fécula de mandioca").fill("FEC-LIBRE");
    await page.getByRole("button", { name: "Registrar recepción (1)" }).click();
    await expect(page.getByTestId("reception-done")).toContainText("1 lote ingresado");
    const [lot] =
      await sql`select received_qty::float as qty from raw_lots where supplier_lot_code = 'FEC-LIBRE'`;
    expect(lot!.qty).toBe(25);
  });

  test("el operario avisa una falla de la Biscomatic y la jefa la ve en Mantenimiento", async ({
    page,
    sql,
    browser,
  }) => {
    await page.goto("/planta");
    await page.getByTestId("tile-falla").click();
    await expect(page.getByRole("heading", { name: "Avisar una falla" })).toBeVisible();
    const send = page.getByRole("button", { name: "Avisar la falla" });
    expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    expect(
      (await page.getByRole("button", { name: "Formadora Biscomatic" }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(64);
    await expect(send).toBeDisabled();
    await page.getByRole("button", { name: "Formadora Biscomatic" }).click();
    await page.getByRole("button", { name: "No arranca" }).click();
    await page.getByLabel("¿Qué pasa?").fill("No arranca. Salta el térmico al encender");
    await page.getByRole("button", { name: /Está parado/ }).click();
    await send.click();
    await expect(page.getByTestId("fault-done")).toContainText("Aviso enviado: Formadora Biscomatic");

    const [o] =
      await sql`select o.status, o.type, o.stopped, o.reported_at is not null as reported, u.username
      from maintenance_orders o join users u on u.id = o.reported_by_id
      join equipment e on e.id = o.equipment_id where e.code = 'BISCOMATIC' and o.reported_at is not null`;
    expect(o).toMatchObject({
      status: "open",
      type: "corrective",
      stopped: true,
      reported: true,
      username: "jt",
    });

    // La jefa lo ve como "Avisada por J.T." en Mantenimiento.
    const jefa = await browser.newContext({ storageState: asRole("production_manager") });
    const jefaPage = await jefa.newPage();
    await jefaPage.goto("/mantenimiento");
    const panel = jefaPage.getByTestId("fault-reports");
    await expect(panel).toContainText("Formadora Biscomatic");
    await expect(panel).toContainText("Equipo parado");
    await expect(panel).toContainText("Avisada por J.T.");
    await jefa.close();
  });

  test("el operario cuenta el inventario en la tablet y guarda el avance; solo la jefa lo confirma", async ({
    page,
    sql,
    browser,
  }) => {
    await page.goto("/planta");
    await page.getByTestId("tile-inventario").click();
    await expect(page.getByRole("heading", { name: "Contar inventario" })).toBeVisible();
    await expect(page.getByText("No hay conteos abiertos")).toBeVisible();
    const start = page.getByRole("button", { name: "Contar materia prima" });
    expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await start.click();
    await expect(page.getByRole("heading", { name: "Inventario de materia prima" })).toBeVisible();

    // Botones grandes; el operario no ve confirmar ni anular.
    const saveBtn = page.getByRole("button", { name: "Guardar avance" });
    expect((await saveBtn.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await expect(page.getByRole("button", { name: "Confirmar inventario" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0);
    const first = page.getByRole("spinbutton").first();
    expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await first.fill("12.5");
    await saveBtn.click();
    await expectToast(page, "Avance guardado");

    const [count] = await sql`select c.id, c.status, u.username, count(i.counted_qty)::int as counted
      from inventory_counts c join users u on u.id = c.counted_by_id
      join inventory_count_items i on i.count_id = c.id group by c.id, c.status, u.username`;
    expect(count).toMatchObject({ status: "draft", username: "jt", counted: 1 });
    // El stock no se movió: el ajuste lo hace la jefa al confirmar.
    const [adj] = await sql`select count(*)::int as n from stock_movements where type = 'adjustment'`;
    expect(adj!.n).toBe(0);

    // Volver al inicio de inventario: figura como conteo en curso, sin poder abrir otro de lo mismo.
    await page.getByRole("link", { name: "Inventarios" }).click();
    await expect(page.getByTestId("open-count")).toContainText("Contadas 1 de");
    await expect(page.getByRole("button", { name: "Contar materia prima" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Contar producto terminado" })).toBeVisible();

    // La jefa abre el mismo conteo en el escritorio y lo confirma: recién ahí se ajusta el stock.
    const jefa = await browser.newContext({ storageState: asRole("production_manager") });
    const jefaPage = await jefa.newPage();
    await jefaPage.goto(`/stock/inventario/${count!.id}`);
    await jefaPage.getByRole("button", { name: "Confirmar inventario" }).click();
    await jefaPage.getByRole("button", { name: "Sí, confirmar" }).click();
    await expect(
      jefaPage.locator("[data-sonner-toast]").filter({ hasText: /Inventario confirmado/ }),
    ).toBeVisible();
    const [after] = await sql`select count(*)::int as n from stock_movements where type = 'adjustment'`;
    expect(after!.n).toBe(1);
    await jefa.close();
  });
});
