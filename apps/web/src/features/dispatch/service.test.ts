import { describe, expect, it } from "vitest";
import { and, asc, eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import {
  createDispatch,
  createRoute,
  changeDispatchLot,
  costByMonth,
  costByZone,
  createRouteDispatches,
  deliverDispatch,
  finishRoute,
  getDeliveryCostSummary,
  getDispatch,
  getRoute,
  listDispatchRegistry,
  listRouteCosts,
  moveStop,
  rejectDispatch,
  removeStop,
  routeProposal,
  startRoute,
} from "./service";
import { createRouteInput, finishRouteInput } from "./schemas";
import { changeOrderStatus, createOrder } from "../purchases/service";
import { purchaseOrderInput } from "../purchases/schemas";

const DAY = "2026-10-02"; // viernes
const NOW = new Date("2026-10-02T09:00:00-03:00");
const LATER = new Date("2026-10-02T12:30:00-03:00");

type Status = (typeof schema.orderStatusEnum.enumValues)[number];

async function customerId(tx: Tx, legalName: string) {
  const c = await tx.query.customers.findFirst({ where: eq(schema.customers.legalName, legalName) });
  return c!.id;
}
async function productId(tx: Tx, name: string) {
  const p = await tx.query.products.findFirst({ where: eq(schema.products.name, name) });
  return p!.id;
}
/** Pedido de prueba: items = [nombre de producto, unidades]. */
async function makeOrder(
  tx: Tx,
  customer: string,
  status: Status,
  items: [string, number][],
  promisedDate = DAY,
) {
  const [o] = await tx
    .insert(schema.orders)
    .values({ customerId: await customerId(tx, customer), promisedDate, status, total: 0 })
    .returning();
  for (const [name, units] of items)
    await tx
      .insert(schema.orderItems)
      .values({ orderId: o!.id, productId: await productId(tx, name), qtyUnits: units, unitPrice: 1000 });
  return o!;
}
async function vehicleId(tx: Tx) {
  const v = await tx.query.vehicles.findFirst();
  return v!.id;
}
async function productStock(tx: Tx, lotCode: string, product: string) {
  const rows = await tx
    .select({ qty: schema.productStock.qty, loc: schema.productStock.locationId })
    .from(schema.productStock)
    .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.productStock.finishedLotId))
    .where(
      and(
        eq(schema.finishedLots.code, lotCode),
        eq(schema.productStock.productId, await productId(tx, product)),
      ),
    );
  return rows.reduce((a, r) => a + r.qty, 0);
}
const TAP = "Chipá tapitas 0,5 kg";
const LEN = "Chipá lengüitas 0,5 kg";

const routeInput = (orderIds: string[], supplierStops: { supplierId: string; notes?: string }[] = []) =>
  createRouteInput.parse({ date: DAY, orderIds, supplierStops });

describe("hoja de ruta (RF-24)", () => {
  it("propone los pedidos listos agrupados por zona y marca los no listos y las zonas sin reparto ese día", async () => {
    await inRollback("logistica", async (tx) => {
      const ready = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const notReady = await makeOrder(tx, "Club Náutico", "in_production", [[LEN, 4]]);
      const funes = await makeOrder(tx, "La Esperanza", "ready", [[TAP, 6]]);
      const future = await makeOrder(tx, "Vía Dolce", "ready", [[TAP, 6]], "2026-10-08");
      const delivered = await makeOrder(tx, "Vía Dolce", "delivered", [[TAP, 6]]);

      const p = await routeProposal(tx, DAY);
      const ids = p.zones.flatMap((z) => z.orders.map((o) => o.id));
      expect(ids).toEqual(expect.arrayContaining([ready.id, notReady.id, funes.id]));
      expect(ids).not.toContain(future.id); // fecha comprometida posterior a la ruta
      expect(ids).not.toContain(delivered.id); // ya entregado

      const rosario = p.zones.find((z) => z.name === "Rosario")!;
      expect(rosario.deliversOnDate).toBe(true); // lunes, miércoles y viernes
      expect(rosario.weekdays).toEqual([1, 3, 5]);
      expect(rosario.orders.map((o) => o.id)).toEqual(expect.arrayContaining([ready.id, notReady.id]));
      expect(rosario.orders.find((o) => o.id === ready.id)).toMatchObject({ ready: true, kg: 5, units: 10 });
      expect(rosario.orders.find((o) => o.id === notReady.id)?.ready).toBe(false);
      const funesZone = p.zones.find((z) => z.name === "Funes")!;
      expect(funesZone.deliversOnDate).toBe(false); // Funes reparte los martes
      // Las zonas que reparten ese día van primero.
      expect(p.zones.indexOf(rosario)).toBeLessThan(p.zones.indexOf(funesZone));
    });
  });

  it("crea la ruta con paradas por zona y retiros en proveedores; los pedidos ya rutados no se vuelven a proponer", async () => {
    await inRollback("logistica", async (tx) => {
      const a = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const b = await makeOrder(tx, "Club Náutico", "ready", [[LEN, 20]]);
      const f = await makeOrder(tx, "La Esperanza", "ready", [[TAP, 6]]);
      const supplier = (await tx.query.suppliers.findFirst({
        where: eq(schema.suppliers.legalName, "Leo Pelle"),
      }))!;
      const route = await createRoute(
        tx,
        routeInput([f.id, a.id, b.id], [{ supplierId: supplier.id, notes: "Retirar 25 kg de fécula" }]),
      );
      const r = (await getRoute(tx, route.id))!;
      expect(r.status).toBe("planned");
      // Rosario (Arcoiris #a, Náutico #b) antes que Funes; el retiro en el proveedor va al final.
      expect(r.stops.map((s) => s.title)).toEqual([
        "Supermercado Arcoiris",
        "Club Náutico",
        "La Esperanza",
        "Leo Pelle",
      ]);
      expect(r.stops.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
      expect(r.stops[3]).toMatchObject({ kind: "supplier_pickup", notes: "Retirar 25 kg de fécula" });
      expect(r.totals).toMatchObject({ kg: 18, units: 36, stops: 4, stopsDone: 0 });

      const p = await routeProposal(tx, DAY);
      const ids = p.zones.flatMap((z) => z.orders.map((o) => o.id));
      expect(ids).not.toContain(a.id);
      await expect(createRoute(tx, routeInput([a.id]))).rejects.toThrow(/ya no se puede poner en la ruta/);
    });
  });

  it("exige al menos una parada y permite subir y bajar paradas", async () => {
    expect(createRouteInput.safeParse({ date: DAY }).success).toBe(false);
    await inRollback("logistica", async (tx) => {
      const a = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const b = await makeOrder(tx, "Club Náutico", "ready", [[LEN, 20]]);
      const route = await createRoute(tx, routeInput([a.id, b.id]));
      const before = (await getRoute(tx, route.id))!;
      await moveStop(tx, { stopId: before.stops[1]!.id, direction: "up" });
      const after = (await getRoute(tx, route.id))!;
      expect(after.stops.map((s) => s.title)).toEqual(["Club Náutico", "Supermercado Arcoiris"]);
      // El primero no puede subir más: queda igual.
      await moveStop(tx, { stopId: after.stops[0]!.id, direction: "up" });
      expect((await getRoute(tx, route.id))!.stops.map((s) => s.seq)).toEqual([1, 2]);
      await removeStop(tx, { stopId: after.stops[0]!.id });
      const left = (await getRoute(tx, route.id))!;
      expect(left.stops.map((s) => [s.title, s.seq])).toEqual([["Supermercado Arcoiris", 1]]);
    });
  });
});

describe("retiros en proveedor sugeridos desde órdenes de compra (RF-10)", () => {
  async function purchase(
    tx: Tx,
    userId: string,
    o: { pickup: boolean; expectedAt: string; send?: boolean; supplier?: string },
  ) {
    const supplier = (await tx.query.suppliers.findFirst({
      where: eq(schema.suppliers.legalName, o.supplier ?? "Leo Pelle"),
    }))!;
    const ingredient = (await tx.query.ingredients.findFirst({
      where: eq(schema.ingredients.name, "Fécula de mandioca"),
    }))!;
    const order = await createOrder(
      tx,
      userId,
      purchaseOrderInput.parse({
        supplierId: supplier.id,
        orderedAt: "2026-09-30",
        expectedAt: o.expectedAt,
        pickup: o.pickup,
        items: [{ ingredientId: ingredient.id, qty: 25 }],
      }),
    );
    if (o.send !== false) await changeOrderStatus(tx, order.id, "sent");
    return { order, supplier };
  }

  it("sugiere las OC enviadas con retiro y fecha esperada hasta la de la ruta, con su detalle", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const due = await purchase(tx, userId, { pickup: true, expectedAt: "2026-10-01" });
      const today = await purchase(tx, userId, { pickup: true, expectedAt: DAY, supplier: "Cotar" });
      const future = await purchase(tx, userId, { pickup: true, expectedAt: "2026-10-05" });
      const delivery = await purchase(tx, userId, { pickup: false, expectedAt: "2026-10-01" });
      const draft = await purchase(tx, userId, { pickup: true, expectedAt: "2026-10-01", send: false });

      const { pickups } = await routeProposal(tx, DAY);
      expect(pickups.map((p) => p.orderId)).toEqual([due.order.id, today.order.id]);
      expect(pickups[0]).toMatchObject({
        number: due.order.number,
        supplierId: due.supplier.id,
        supplierName: "Leo Pelle",
        expectedAt: "2026-10-01",
        summary: "25 kg Fécula de mandioca",
      });
      const ids = pickups.map((p) => p.orderId);
      for (const o of [future, delivery, draft]) expect(ids).not.toContain(o.order.id);
      // Más adelante, la OC futura pasa a sugerirse.
      expect((await routeProposal(tx, "2026-10-05")).pickups.map((p) => p.orderId)).toContain(
        future.order.id,
      );
    });
  });

  it("la parada creada desde la sugerencia deja de sugerirse; si la ruta se cancela, vuelve a aparecer", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { order, supplier } = await purchase(tx, userId, { pickup: true, expectedAt: "2026-10-01" });
      const [suggestion] = (await routeProposal(tx, DAY)).pickups;
      expect(suggestion!.note).toContain(order.number);
      const route = await createRoute(
        tx,
        routeInput([], [{ supplierId: supplier.id, notes: suggestion!.note }]),
      );
      const stop = (await getRoute(tx, route.id))!.stops[0]!;
      expect(stop).toMatchObject({ kind: "supplier_pickup", title: "Leo Pelle" });
      expect(stop.notes).toBe(suggestion!.note);
      expect((await routeProposal(tx, DAY)).pickups.map((p) => p.orderId)).not.toContain(order.id);

      await tx.update(schema.routes).set({ status: "cancelled" }).where(eq(schema.routes.id, route.id));
      expect((await routeProposal(tx, DAY)).pickups.map((p) => p.orderId)).toContain(order.id);
    });
  });

  it("la OC recibida completa deja de sugerirse", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { order } = await purchase(tx, userId, { pickup: true, expectedAt: "2026-10-01" });
      await tx
        .update(schema.purchaseOrders)
        .set({ status: "received" })
        .where(eq(schema.purchaseOrders.id, order.id));
      expect((await routeProposal(tx, DAY)).pickups).toEqual([]);
    });
  });
});

describe("remito con lotes FEFO (RF-25)", () => {
  it("descuenta primero el lote 260901-1 y después el 261001-1, deja el pedido despachado y respeta F3/F4", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const before1 = await productStock(tx, "260901-1", TAP); // 60
      const before2 = await productStock(tx, "261001-1", TAP); // 100
      expect([before1, before2]).toEqual([60, 100]);
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 80]]);
      const route = await createRoute(tx, routeInput([o.id]));

      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      expect(d.orderNumber).toBe(o.number);

      const items = await tx
        .select({ lot: schema.finishedLots.code, qty: schema.dispatchItems.qtyUnits })
        .from(schema.dispatchItems)
        .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.dispatchItems.finishedLotId))
        .where(eq(schema.dispatchItems.dispatchId, d.id))
        .orderBy(asc(schema.finishedLots.expiryDate));
      expect(items).toEqual([
        { lot: "260901-1", qty: 60 },
        { lot: "261001-1", qty: 20 },
      ]);
      expect(await productStock(tx, "260901-1", TAP)).toBe(0);
      expect(await productStock(tx, "261001-1", TAP)).toBe(80);

      const moves = await tx
        .select()
        .from(schema.stockMovements)
        .where(and(eq(schema.stockMovements.refTable, "dispatches"), eq(schema.stockMovements.refId, d.id)));
      expect(moves).toHaveLength(2);
      expect(moves.every((m) => m.type === "dispatch" && m.qty < 0)).toBe(true);
      expect(moves.reduce((a, m) => a + m.qty, 0)).toBe(-80);

      const order = await tx.query.orders.findFirst({
        where: eq(schema.orders.id, o.id),
        with: { events: true },
      });
      expect(order?.status).toBe("dispatched");
      expect(order?.events.at(-1)).toMatchObject({ status: "dispatched" });
      const dispatch = await tx.query.dispatches.findFirst({ where: eq(schema.dispatches.id, d.id) });
      expect(dispatch).toMatchObject({ status: "prepared", routeId: route.id, responsibleId: userId });

      // No se puede generar dos veces el remito del mismo pedido.
      await expect(createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW)).rejects.toThrow(
        /ya tiene el remito/,
      );
    });
  });

  it("si no alcanza el stock explica qué falta y no escribe nada", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [
        [LEN, 10],
        [TAP, 500],
      ]);
      await expect(createDispatch(tx, userId, { orderId: o.id }, NOW)).rejects.toThrow(
        /No hay stock suficiente.*Chipá tapitas 0,5 kg \(faltan 340 u\.\)/,
      );
      expect(await tx.query.dispatches.findMany({ where: eq(schema.dispatches.orderId, o.id) })).toHaveLength(
        0,
      );
      expect((await tx.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))?.status).toBe("ready");
      expect(await productStock(tx, "260901-1", TAP)).toBe(60);
    });
  });

  it("solo genera remito de pedidos listos", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "confirmed", [[TAP, 5]]);
      await expect(createDispatch(tx, userId, { orderId: o.id }, NOW)).rejects.toThrow(
        /"Confirmado": solo se genera remito de pedidos listos/,
      );
    });
  });

  it("genera los remitos de toda la ruta e informa los que no se pudieron armar", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const ok = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const huge = await makeOrder(tx, "Club Náutico", "ready", [[LEN, 5000]]);
      const wip = await makeOrder(tx, "La Esperanza", "in_production", [[TAP, 5]]);
      const route = await createRoute(tx, routeInput([ok.id, huge.id, wip.id]));
      const res = await createRouteDispatches(tx, userId, route.id, NOW);
      expect(res.created.map((c) => c.orderNumber)).toEqual([ok.number]);
      expect(res.failed.map((f) => f.orderNumber).sort()).toEqual([huge.number, wip.number].sort());
      expect(res.failed.find((f) => f.orderNumber === huge.number)?.reason).toMatch(
        /No hay stock suficiente/,
      );
      // Repetir no duplica el remito ya generado.
      const again = await createRouteDispatches(tx, userId, route.id, NOW);
      expect(again.created).toHaveLength(0);
      expect(again.skipped).toBe(1);
    });
  });

  it("entrega: guarda quién recibió y la conformidad, marca la parada y deja el pedido entregado", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const route = await createRoute(tx, routeInput([o.id]));
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      await expect(
        deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: " " }, LATER),
      ).rejects.toThrow(/nombre de quien recibe/);
      await deliverDispatch(
        tx,
        userId,
        { dispatchId: d.id, receivedByName: "María Gómez", proofFileKey: "remitos/firma.png" },
        LATER,
      );
      const dispatch = await tx.query.dispatches.findFirst({ where: eq(schema.dispatches.id, d.id) });
      expect(dispatch).toMatchObject({
        status: "delivered",
        receivedByName: "María Gómez",
        proofFileKey: "remitos/firma.png",
      });
      expect(dispatch?.deliveredAt).toEqual(LATER);
      expect((await tx.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))?.status).toBe(
        "delivered",
      );
      const r = (await getRoute(tx, route.id))!;
      expect(r.stops[0]).toMatchObject({ done: true });
      expect(r.stops[0]!.dispatch).toMatchObject({ status: "delivered", receivedByName: "María Gómez" });
      await expect(
        deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: "Otra persona" }, LATER),
      ).rejects.toThrow(/está entregado/);
    });
  });

  it("rechazo total: devuelve el stock al mismo lote en F3 y deja el motivo en el historial del pedido", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 80]]);
      const route = await createRoute(tx, routeInput([o.id]));
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      expect(await productStock(tx, "260901-1", TAP)).toBe(0);

      await rejectDispatch(tx, userId, { dispatchId: d.id, reason: "Heladera rota, no recibe" }, LATER);
      expect(await productStock(tx, "260901-1", TAP)).toBe(60);
      expect(await productStock(tx, "261001-1", TAP)).toBe(100);
      const returns = await tx
        .select({ qty: schema.stockMovements.qty, loc: schema.locations.code, lot: schema.finishedLots.code })
        .from(schema.stockMovements)
        .innerJoin(schema.locations, eq(schema.locations.id, schema.stockMovements.locationId))
        .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.stockMovements.finishedLotId))
        .where(and(eq(schema.stockMovements.type, "return"), eq(schema.stockMovements.refId, d.id)));
      expect(returns.map((m) => [m.lot, m.loc, m.qty]).sort()).toEqual([
        ["260901-1", "F3", 60],
        ["261001-1", "F3", 20],
      ]);

      const dispatch = await tx.query.dispatches.findFirst({ where: eq(schema.dispatches.id, d.id) });
      expect(dispatch).toMatchObject({ status: "rejected", notes: "Heladera rota, no recibe" });
      // El dominio no deja retroceder un pedido despachado a "listo": sigue despachado con el motivo anotado.
      const order = await tx.query.orders.findFirst({
        where: eq(schema.orders.id, o.id),
        with: { events: true },
      });
      expect(order?.status).toBe("dispatched");
      expect(order?.events.at(-1)?.note).toMatch(/rechazada.*Heladera rota, no recibe.*Stock devuelto/);

      // Se puede reentregar: nuevo remito, otra vez FEFO.
      const again = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, LATER);
      expect(again.id).not.toBe(d.id);
      expect(await productStock(tx, "260901-1", TAP)).toBe(0);
      const r = (await getRoute(tx, route.id))!;
      expect(r.stops[0]!.dispatch).toMatchObject({ id: again.id, status: "prepared" });
      expect(r.stops[0]!.rejectedCount).toBe(1);
    });
  });
});

describe("cambio manual de lote y entrega parcial del remito (RF-25)", () => {
  async function lotId(tx: Tx, code: string) {
    return (await tx.query.finishedLots.findFirst({ where: eq(schema.finishedLots.code, code) }))!.id;
  }
  async function remito(tx: Tx, userId: string, units: number) {
    const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, units]]);
    const d = await createDispatch(tx, userId, { orderId: o.id }, NOW);
    const items = await tx
      .select({
        id: schema.dispatchItems.id,
        lot: schema.finishedLots.code,
        qty: schema.dispatchItems.qtyUnits,
      })
      .from(schema.dispatchItems)
      .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.dispatchItems.finishedLotId))
      .where(eq(schema.dispatchItems.dispatchId, d.id))
      .orderBy(asc(schema.finishedLots.expiryDate));
    return { o, d, items };
  }
  const movesOf = (tx: Tx, dispatchId: string) =>
    tx
      .select()
      .from(schema.stockMovements)
      .where(
        and(eq(schema.stockMovements.refTable, "dispatches"), eq(schema.stockMovements.refId, dispatchId)),
      );

  it("cambia el lote asignado por FEFO con motivo: vuelve al lote anterior, descuenta del elegido y lo registra", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { d, items } = await remito(tx, userId, 10);
      expect(items).toEqual([expect.objectContaining({ lot: "260901-1", qty: 10 })]);
      expect(await productStock(tx, "260901-1", TAP)).toBe(50);
      expect(await productStock(tx, "261001-1", TAP)).toBe(100);

      await changeDispatchLot(
        tx,
        userId,
        {
          dispatchItemId: items[0]!.id,
          finishedLotId: await lotId(tx, "261001-1"),
          reason: "El cliente pidió el lote más nuevo",
        },
        NOW,
      );
      const item = (await tx.query.dispatchItems.findFirst({
        where: eq(schema.dispatchItems.id, items[0]!.id),
      }))!;
      expect(item).toMatchObject({
        finishedLotId: await lotId(tx, "261001-1"),
        lotChangeReason: "El cliente pidió el lote más nuevo",
        qtyUnits: 10,
      });
      expect(await productStock(tx, "260901-1", TAP)).toBe(60); // volvió
      expect(await productStock(tx, "261001-1", TAP)).toBe(90); // se descontó
      const moves = await movesOf(tx, d.id);
      expect(moves.filter((m) => m.type === "return").map((m) => m.qty)).toEqual([10]);
      expect(moves.reduce((a, m) => a + m.qty, 0)).toBe(-10); // neto: sigue saliendo 1 remito de 10 u.
      // Queda en la auditoría de la tabla.
      const audit = await tx.query.auditLog.findMany({ where: eq(schema.auditLog.recordId, item.id) });
      expect(audit.some((a) => a.action === "U" && a.changedBy === userId)).toBe(true);
    });
  });

  it("exige el motivo y valida el stock del lote elegido, que sea otro lote y que el remito siga preparado", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { items } = await remito(tx, userId, 80); // 60 de 260901-1 + 20 de 261001-1
      const [first, second] = items;
      const lot2 = await lotId(tx, "261001-1");
      const lot1 = await lotId(tx, "260901-1");
      await expect(
        changeDispatchLot(tx, userId, { dispatchItemId: first!.id, finishedLotId: lot2, reason: "  " }, NOW),
      ).rejects.toThrow(/por qué se cambia el lote/);
      await expect(
        changeDispatchLot(
          tx,
          userId,
          { dispatchItemId: first!.id, finishedLotId: lot1, reason: "mismo" },
          NOW,
        ),
      ).rejects.toThrow(/ya tiene ese lote/);
      // 260901-1 quedó sin stock: no se puede mover ahí la línea de 20 u. de 261001-1.
      await expect(
        changeDispatchLot(
          tx,
          userId,
          { dispatchItemId: second!.id, finishedLotId: lot1, reason: "prueba" },
          NOW,
        ),
      ).rejects.toThrow(/260901-1 tiene 0 u\..*no alcanza para las 20 u\./);
      // 261001-1 tiene 80 u. libres: alcanza para las 60 u. de la primera línea.
      await changeDispatchLot(
        tx,
        userId,
        { dispatchItemId: first!.id, finishedLotId: lot2, reason: "prueba" },
        NOW,
      );
      expect(await productStock(tx, "261001-1", TAP)).toBe(20);

      // Lote retenido por calidad.
      await tx.update(schema.finishedLots).set({ onHold: true }).where(eq(schema.finishedLots.id, lot1));
      await expect(
        changeDispatchLot(
          tx,
          userId,
          { dispatchItemId: second!.id, finishedLotId: lot1, reason: "prueba" },
          NOW,
        ),
      ).rejects.toThrow(/retenido por calidad/);
    });
  });

  it("no se cambia el lote de un remito ya entregado", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { d, items } = await remito(tx, userId, 10);
      await deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: "Recibe" }, NOW);
      await expect(
        changeDispatchLot(
          tx,
          userId,
          { dispatchItemId: items[0]!.id, finishedLotId: await lotId(tx, "261001-1"), reason: "tarde" },
          NOW,
        ),
      ).rejects.toThrow(/solo se cambia el lote de un remito preparado/);
    });
  });

  it("entrega parcial: guarda la cantidad real, devuelve el resto al stock con movimiento return y lo deja en el pedido", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { o, d, items } = await remito(tx, userId, 10);
      expect(await productStock(tx, "260901-1", TAP)).toBe(50);
      const res = await deliverDispatch(
        tx,
        userId,
        {
          dispatchId: d.id,
          receivedByName: "Recibe",
          quantities: [{ dispatchItemId: items[0]!.id, qty: 6 }],
        },
        NOW,
      );
      expect(res).toMatchObject({ partial: true, deliveredUnits: 6, returnedUnits: 4 });
      const item = (await tx.query.dispatchItems.findFirst({
        where: eq(schema.dispatchItems.id, items[0]!.id),
      }))!;
      expect(item).toMatchObject({ qtyUnits: 10, qtyDelivered: 6 });
      expect(await productStock(tx, "260901-1", TAP)).toBe(54);
      const ret = (await movesOf(tx, d.id)).filter((m) => m.type === "return");
      expect(ret.map((m) => m.qty)).toEqual([4]);
      expect(ret[0]!.note).toMatch(/Entrega parcial/);
      const order = await tx.query.orders.findFirst({
        where: eq(schema.orders.id, o.id),
        with: { events: true },
      });
      expect(order?.status).toBe("delivered");
      expect(order?.events.at(-1)?.note).toMatch(/Entrega parcial: 6 de 10 u\./);
      expect((await getDispatchForTest(tx, d.id)).deliveredUnits).toBe(6);
    });
  });

  it("valida las cantidades: nada entregado se rechaza, no puede superar el remito ni ser negativa, y la completa no deja huella", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { d, items } = await remito(tx, userId, 10);
      const id = items[0]!.id;
      const go = (qty: number) =>
        deliverDispatch(
          tx,
          userId,
          { dispatchId: d.id, receivedByName: "Recibe", quantities: [{ dispatchItemId: id, qty }] },
          NOW,
        );
      await expect(go(0)).rejects.toThrow(/rechazá el remito/);
      await expect(go(11)).rejects.toThrow(/entre 0 y 10/);
      await expect(go(-1)).rejects.toThrow(/entre 0 y 10/);
      await expect(go(2.5)).rejects.toThrow(/entre 0 y 10/);
      await expect(
        deliverDispatch(
          tx,
          userId,
          {
            dispatchId: d.id,
            receivedByName: "Recibe",
            quantities: [{ dispatchItemId: crypto.randomUUID(), qty: 1 }],
          },
          NOW,
        ),
      ).rejects.toThrow(/no pertenece a este remito/);
      expect(await productStock(tx, "260901-1", TAP)).toBe(50); // nada se movió
      const res = await go(10);
      expect(res).toMatchObject({ partial: false, returnedUnits: 0 });
      expect(
        (await tx.query.dispatchItems.findFirst({ where: eq(schema.dispatchItems.id, id) }))?.qtyDelivered,
      ).toBeNull();
    });
  });

  it("el costo por kg usa los kg realmente entregados", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 50]]);
      const route = await createRoute(tx, { ...routeInput([o.id]), vehicleId: await vehicleId(tx) });
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      const item = (await tx.query.dispatchItems.findFirst({
        where: eq(schema.dispatchItems.dispatchId, d.id),
      }))!;
      await deliverDispatch(
        tx,
        userId,
        { dispatchId: d.id, receivedByName: "Recibe", quantities: [{ dispatchItemId: item.id, qty: 30 }] },
        NOW,
      );
      await startRoute(tx, { id: route.id, kmStart: 12000 }, NOW);
      await finishRoute(
        tx,
        userId,
        finishRouteInput.parse({ id: route.id, kmEnd: "12085", coldUnitTempC: "-20" }),
        LATER,
      );
      const [row] = await listRouteCosts(tx, { from: DAY, to: DAY });
      expect(row!.kg).toBe(15); // 30 u. × 0,5 kg, no las 50 del remito
    });
  });
});

async function getDispatchForTest(tx: Tx, id: string) {
  return (await getDispatch(tx, id))!;
}

describe("salida de la ruta (RF-26)", () => {
  async function routeWith(tx: Tx, userId: string, units = 20) {
    const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, units]]);
    const route = await createRoute(tx, { ...routeInput([o.id]), vehicleId: await vehicleId(tx) });
    return { o, route };
  }
  const finish = (id: string, extra: Record<string, unknown> = {}) =>
    finishRouteInput.parse({ id, kmEnd: "12085", coldUnitTempC: "-20", ...extra });

  it("planificada → en curso → cerrada, con km, horas y temperatura registrada en VEH-FRIO", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { o, route } = await routeWith(tx, userId);
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      await deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: "Recibe" }, NOW);

      await startRoute(tx, { id: route.id, kmStart: 12000 }, NOW);
      await expect(startRoute(tx, { id: route.id, kmStart: 12000 }, NOW)).rejects.toThrow(/solo se inicia/);
      await expect(finishRoute(tx, userId, finish(route.id, { kmEnd: "11990" }), LATER)).rejects.toThrow(
        /km final no puede ser menor/,
      );
      await expect(finishRoute(tx, userId, finish(route.id, { coldUnitTempC: "" }), LATER)).rejects.toThrow(
        /temperatura del equipo de frío/,
      );
      await finishRoute(
        tx,
        userId,
        finish(route.id, { coldUnitTempC: "-10", fuelLiters: "9,5", fuelCost: "18000" }),
        LATER,
      );

      const r = (await getRoute(tx, route.id))!;
      expect(r).toMatchObject({
        status: "done",
        kmStart: 12000,
        kmEnd: 12085,
        fuelLiters: 9.5,
        fuelCost: 18000,
        coldUnitTempC: -10,
      });
      expect(r.startedAt).toEqual(NOW);
      expect(r.endedAt).toEqual(LATER);
      const logs = await tx
        .select({
          value: schema.temperatureLogs.valueC,
          out: schema.temperatureLogs.outOfRange,
          code: schema.equipment.code,
        })
        .from(schema.temperatureLogs)
        .innerJoin(schema.equipment, eq(schema.equipment.id, schema.temperatureLogs.equipmentId))
        .where(eq(schema.equipment.code, "VEH-FRIO"));
      expect(logs).toEqual([{ value: -10, out: true, code: "VEH-FRIO" }]); // -10 °C: fuera de rango (máx. -18)
      await expect(finishRoute(tx, userId, finish(route.id), LATER)).rejects.toThrow(
        /solo se cierra una ruta en curso/,
      );
    });
  });

  it("una temperatura dentro de rango no se marca como desvío", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const { route } = await routeWith(tx, userId);
      await startRoute(tx, { id: route.id, kmStart: 100 }, NOW);
      await finishRoute(tx, userId, finish(route.id, { kmEnd: "180" }), LATER);
      const [log] = await tx
        .select({ out: schema.temperatureLogs.outOfRange, user: schema.temperatureLogs.userId })
        .from(schema.temperatureLogs)
        .innerJoin(schema.equipment, eq(schema.equipment.id, schema.temperatureLogs.equipmentId))
        .where(eq(schema.equipment.code, "VEH-FRIO"));
      expect(log).toEqual({ out: false, user: userId });
    });
  });

  it("exige vehículo para iniciar y no deja cerrar con remitos sin resolver", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const sinVehiculo = await createRoute(tx, routeInput([o.id]));
      await expect(startRoute(tx, { id: sinVehiculo.id, kmStart: 1 }, NOW)).rejects.toThrow(/vehículo/);

      const { o: o2, route } = await routeWith(tx, userId, 10);
      await createDispatch(tx, userId, { orderId: o2.id, routeId: route.id }, NOW);
      await startRoute(tx, { id: route.id, kmStart: 1 }, NOW);
      await expect(finishRoute(tx, userId, finish(route.id, { kmEnd: "50" }), LATER)).rejects.toThrow(
        /Quedan 1 remito sin entregar/,
      );
    });
  });
});

describe("costo por ruta y por kg (RF-27)", () => {
  async function closedRoute(
    tx: Tx,
    userId: string,
    units: number,
    opts: { fuelCost?: string; otherCosts?: string; deliver?: boolean; product?: string } = {},
  ) {
    const { product = TAP, ...costs } = opts;
    const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[product, units]]);
    const route = await createRoute(tx, { ...routeInput([o.id]), vehicleId: await vehicleId(tx) });
    const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
    if (costs.deliver !== false)
      await deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: "Recibe" }, NOW);
    else await rejectDispatch(tx, userId, { dispatchId: d.id, reason: "No quiso recibir" }, NOW);
    await startRoute(tx, { id: route.id, kmStart: 12000 }, NOW);
    await finishRoute(
      tx,
      userId,
      finishRouteInput.parse({
        id: route.id,
        kmEnd: "12085",
        coldUnitTempC: "-20",
        fuelCost: costs.fuelCost,
        otherCosts: costs.otherCosts,
      }),
      LATER,
    );
    return route;
  }

  it("estima el combustible por km, suma el chofer por hora y divide por los kg entregados", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const route = await closedRoute(tx, userId, 50); // 25 kg
      const [row] = await listRouteCosts(tx, { from: DAY, to: DAY });
      // 85 km × $250 + 3,5 h × $5.000 = 21.250 + 17.500
      expect(row).toMatchObject({
        id: route.id,
        km: 85,
        hours: 3.5,
        kg: 25,
        fuel: 21250,
        labor: 17500,
        other: 0,
        cost: 38750,
        costPerKg: 1550,
        small: true,
      });
    });
  });

  it("usa el combustible real si se cargó y suma otros costos; una ruta de 65 kg no es chica", async () => {
    await inRollback("logistica", async (tx, userId) => {
      await closedRoute(tx, userId, 130, { fuelCost: "18000", otherCosts: "2000" }); // 65 kg
      const [row] = await listRouteCosts(tx, { from: DAY, to: DAY });
      expect(row).toMatchObject({
        kg: 65,
        fuel: 18000,
        other: 2000,
        cost: 37500,
        costPerKg: 576.92,
        small: false,
      });
    });
  });

  it("los kg salen solo de remitos entregados (un rechazo no cuenta)", async () => {
    await inRollback("logistica", async (tx, userId) => {
      await closedRoute(tx, userId, 50, { deliver: false });
      const [row] = await listRouteCosts(tx, { from: DAY, to: DAY });
      expect(row).toMatchObject({ kg: 0, costPerKg: null, small: true });
    });
  });

  it("resumen mensual para el tablero: rutas, km, horas, kg, costo y costo/kg", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const empty = await getDeliveryCostSummary(tx, "2026-10");
      expect(empty).toEqual({ routes: 0, km: 0, hours: 0, kg: 0, cost: 0, costPerKg: null });
      await closedRoute(tx, userId, 50); // 25 kg, $38.750
      await closedRoute(tx, userId, 130, { fuelCost: "18000", otherCosts: "2000", product: LEN }); // 65 kg, $37.500
      const s = await getDeliveryCostSummary(tx, "2026-10");
      expect(s).toEqual({ routes: 2, km: 170, hours: 7, kg: 90, cost: 76250, costPerKg: 847.22 });
      expect(await getDeliveryCostSummary(tx, "2026-09")).toMatchObject({ routes: 0, costPerKg: null });
      await expect(getDeliveryCostSummary(tx, "2026-13")).rejects.toThrow(/Mes inválido/);
    });
  });
});

describe("costo de reparto por zona y por mes, y costo parcial (RF-27)", () => {
  /** Ruta cerrada del DAY con entregas en Rosario (Arcoiris) y Funes (La Esperanza). */
  async function twoZoneRoute(tx: Tx, userId: string, rosarioUnits: number, funesUnits: number) {
    const a = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, rosarioUnits]]);
    const f = await makeOrder(tx, "La Esperanza", "ready", [[TAP, funesUnits]]);
    const route = await createRoute(tx, { ...routeInput([a.id, f.id]), vehicleId: await vehicleId(tx) });
    for (const o of [a, f]) {
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      await deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: "Recibe" }, NOW);
    }
    await startRoute(tx, { id: route.id, kmStart: 12000 }, NOW);
    await finishRoute(
      tx,
      userId,
      finishRouteInput.parse({ id: route.id, kmEnd: "12085", coldUnitTempC: "-20" }),
      LATER,
    );
    return route;
  }

  it("reparte el costo de la ruta entre las zonas según los kg entregados en cada una", async () => {
    await inRollback("logistica", async (tx, userId) => {
      await twoZoneRoute(tx, userId, 60, 20); // 30 kg Rosario + 10 kg Funes = 40 kg, $38.750
      const { zones, unallocatedRoutes } = await costByZone(tx, "2026-10");
      expect(unallocatedRoutes).toBe(0);
      expect(zones.map((z) => z.zone)).toEqual(["Funes", "Rosario"]);
      const [funes, rosario] = zones;
      expect(rosario).toMatchObject({ routes: 1, deliveries: 1, kg: 30, cost: 29062.5, costPerKg: 968.75 });
      expect(funes).toMatchObject({ routes: 1, deliveries: 1, kg: 10, cost: 9687.5, costPerKg: 968.75 });
      expect(rosario!.cost + funes!.cost).toBe(38750);
      expect(zones.every((z) => !z.partial)).toBe(true);
      expect((await costByZone(tx, "2026-09")).zones).toEqual([]);
    });
  });

  it("una ruta sin entregas no se reparte entre zonas y queda informada aparte", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 10]]);
      const route = await createRoute(tx, { ...routeInput([o.id]), vehicleId: await vehicleId(tx) });
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      await rejectDispatch(tx, userId, { dispatchId: d.id, reason: "No quiso recibir" }, NOW);
      await startRoute(tx, { id: route.id, kmStart: 12000 }, NOW);
      await finishRoute(
        tx,
        userId,
        finishRouteInput.parse({ id: route.id, kmEnd: "12085", coldUnitTempC: "-20" }),
        LATER,
      );
      const res = await costByZone(tx, "2026-10");
      expect(res.zones).toEqual([]);
      expect(res).toMatchObject({ unallocatedRoutes: 1, unallocatedCost: 38750 });
    });
  });

  it("marca costo parcial cuando el vehículo no tiene costo por km (y no se cargó el combustible real)", async () => {
    await inRollback("logistica", async (tx, userId) => {
      await tx.update(schema.vehicles).set({ costPerKm: 0 });
      const route = await twoZoneRoute(tx, userId, 20, 20);
      const [row] = await listRouteCosts(tx, { from: DAY, to: DAY });
      expect(row).toMatchObject({ id: route.id, partial: true, missing: ["vehicle_cost_per_km"], fuel: 0 });
      // La mano de obra sí se estima: 3,5 h × $5.000.
      expect(row!.cost).toBe(17500);
      expect((await costByZone(tx, "2026-10")).zones.every((z) => z.partial)).toBe(true);
      expect((await costByMonth(tx, "2026-10", 1))[0]).toMatchObject({ month: "2026-10", partialRoutes: 1 });
    });
  });

  it("con el gasto real de combustible cargado el costo por km no hace falta", async () => {
    await inRollback("logistica", async (tx, userId) => {
      await tx.update(schema.vehicles).set({ costPerKm: 0 });
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [[TAP, 20]]);
      const route = await createRoute(tx, { ...routeInput([o.id]), vehicleId: await vehicleId(tx) });
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);
      await deliverDispatch(tx, userId, { dispatchId: d.id, receivedByName: "Recibe" }, NOW);
      await startRoute(tx, { id: route.id, kmStart: 12000 }, NOW);
      await finishRoute(
        tx,
        userId,
        finishRouteInput.parse({ id: route.id, kmEnd: "12085", coldUnitTempC: "-20", fuelCost: "18000" }),
        LATER,
      );
      const [row] = await listRouteCosts(tx, { from: DAY, to: DAY });
      expect(row).toMatchObject({ partial: false, missing: [], fuel: 18000 });
    });
  });

  it("serie mensual: los últimos meses del más viejo al más nuevo, con ceros donde no hubo rutas", async () => {
    await inRollback("logistica", async (tx, userId) => {
      await twoZoneRoute(tx, userId, 60, 20);
      const months = await costByMonth(tx, "2026-10", 3);
      expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
      expect(months[0]).toMatchObject({ routes: 0, cost: 0, costPerKg: null, partialRoutes: 0 });
      expect(months[2]).toMatchObject({ routes: 1, km: 85, kg: 40, cost: 38750, costPerKg: 968.75 });
    });
  });
});

describe("registro de despacho BPM (RF-28)", () => {
  it("se genera solo desde los remitos: producto, lote, fecha, cantidad, destino, transporte y responsable", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const o = await makeOrder(tx, "Supermercado Arcoiris", "ready", [
        [TAP, 80],
        [LEN, 10],
      ]);
      const route = await createRoute(tx, { ...routeInput([o.id]), vehicleId: await vehicleId(tx) });
      const d = await createDispatch(tx, userId, { orderId: o.id, routeId: route.id }, NOW);

      const rows = await listDispatchRegistry(tx, { from: DAY, to: DAY });
      const mine = rows.filter((r) => r.dispatchId === d.id);
      expect(mine.map((r) => [r.productName, r.lotCode, r.qtyUnits])).toEqual(
        expect.arrayContaining([
          [TAP, "260901-1", 60],
          [TAP, "261001-1", 20],
          [LEN, "260901-1", 10],
        ]),
      );
      expect(mine).toHaveLength(3);
      expect(mine[0]).toMatchObject({
        date: DAY,
        destination: "Supermercado Arcoiris",
        transport: "Utilitario con equipo de frío (AA000AA)",
        plate: "AA000AA",
        responsible: "Logística (chofer)",
        status: "prepared",
      });
      expect(mine.find((r) => r.lotCode === "261001-1")).toMatchObject({ expiryDate: "2027-04-01", kg: 10 });

      // Filtros por período y por producto.
      expect(await listDispatchRegistry(tx, { from: "2026-10-03", to: "2026-10-31" })).toEqual([]);
      const onlyLen = await listDispatchRegistry(tx, {
        from: DAY,
        to: DAY,
        productId: await productId(tx, LEN),
      });
      expect(onlyLen.map((r) => r.productName)).toEqual([LEN]);
    });
  });
});
