import { describe, expect, it } from "vitest";
import { schema, eq, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { createOrderInput } from "./schemas";
import {
  changeOrderStatus,
  countOverdueOrders,
  createOrder,
  currentPriceMap,
  estimateForOrder,
  estimateOrderDate,
  getOrder,
  getOverdueCustomers,
  listOrders,
  orderFormData,
  packingSheet,
  customerOrderStats,
  updateOrder,
} from "./service";

const TODAY = "2026-10-02"; // viernes: es la fecha de los datos demo

async function customer(tx: Tx, legalName: string) {
  const c = await tx.query.customers.findFirst({ where: (t, { eq }) => eq(t.legalName, legalName) });
  if (!c) throw new Error(`cliente ${legalName} no existe`);
  return c;
}
async function product(tx: Tx, code: string) {
  const p = await tx.query.products.findFirst({ where: (t, { eq }) => eq(t.code, code) });
  if (!p) throw new Error(`producto ${code} no existe`);
  return p;
}
const input = (customerId: string, items: { productId: string; qtyUnits: number }[], promisedDate = "2026-10-06") =>
  createOrderInput.parse({ customerId, promisedDate, items });

describe("alta de pedido (RF-02)", () => {
  it("congela los precios de la lista del cliente y calcula total y kg", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const via = await customer(tx, "Vía Dolce"); // mayorista
      const reina = await customer(tx, "Supermercado La Reina"); // supermercados
      const tap = await product(tx, "CH-TAP-500");
      const len5k = await product(tx, "CH-LEN-5K");

      const a = await createOrder(
        tx,
        userId,
        input(via.id, [
          { productId: tap.id, qtyUnits: 20 },
          { productId: len5k.id, qtyUnits: 2 },
        ]),
        { today: TODAY },
      );
      expect(a.total).toBe(20 * 4200 + 2 * 40000);
      expect(a.kg).toBe(20);

      const b = await createOrder(tx, userId, input(reina.id, [{ productId: tap.id, qtyUnits: 20 }]), {
        today: TODAY,
      });
      expect(b.total).toBe(20 * 3900);

      const detail = await getOrder(tx, a.id);
      expect(detail?.status).toBe("received");
      expect(detail?.source).toBe("whatsapp");
      expect(detail?.createdById).toBe(userId);
      expect(detail?.items.map((i) => i.unitPrice).sort((a, b) => a - b)).toEqual([4200, 40000]);
      expect(detail?.events).toHaveLength(1);
      expect(detail?.events[0]).toMatchObject({ status: "received", byId: userId });
    });
  });

  it("usa el último precio vigente (validFrom ≤ hoy) y no los futuros", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const via = await customer(tx, "Vía Dolce");
      const tap = await product(tx, "CH-TAP-500");
      await tx.insert(schema.priceListItems).values([
        { priceListId: via.priceListId!, productId: tap.id, unitPrice: 4500, validFrom: "2026-10-01" },
        { priceListId: via.priceListId!, productId: tap.id, unitPrice: 9999, validFrom: "2026-11-01" },
      ]);
      const map = await currentPriceMap(tx, TODAY, via.priceListId!);
      expect(map[via.priceListId!]![tap.id]).toBe(4500);
      const o = await createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 10 }]), {
        today: TODAY,
      });
      expect(o.total).toBe(45000);
    });
  });

  it("suma líneas repetidas y rechaza fecha pasada, cliente inactivo y producto sin precio", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const via = await customer(tx, "Vía Dolce");
      const tap = await product(tx, "CH-TAP-500");
      const o = await createOrder(
        tx,
        userId,
        input(via.id, [
          { productId: tap.id, qtyUnits: 5 },
          { productId: tap.id, qtyUnits: 7 },
        ]),
        { today: TODAY },
      );
      expect((await getOrder(tx, o.id))?.items).toHaveLength(1);
      expect((await getOrder(tx, o.id))?.items[0]?.qtyUnits).toBe(12);

      await expect(
        createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 1 }], "2026-10-01"), {
          today: TODAY,
        }),
      ).rejects.toThrow(/anterior a hoy/);

      // La pizzeta no está en ninguna lista de precios.
      const pz = await product(tx, "PZ-REC");
      await expect(
        createOrder(tx, userId, input(via.id, [{ productId: pz.id, qtyUnits: 1 }]), { today: TODAY }),
      ).rejects.toThrow(/no tiene precio vigente/);

      await tx.update(schema.customers).set({ active: false }).where(eq(schema.customers.id, via.id));
      await expect(
        createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 1 }]), { today: TODAY }),
      ).rejects.toThrow(/inactivo/);
    });
  });

  it("el formulario trae fecha por defecto = próximo día de entrega desde mañana", async () => {
    await inRollback("nahuel", async (tx) => {
      const data = await orderFormData(tx, TODAY);
      const by = (name: string) => data.customers.find((c) => c.name === name)!;
      // Rosario: lun-mié-vie → hoy es viernes → lunes 05/10
      expect(by("Supermercado La Reina").defaultPromisedDate).toBe("2026-10-05");
      // Funes: martes → 06/10
      expect(by("La Esperanza").defaultPromisedDate).toBe("2026-10-06");
      // Pueblo Esther: jueves → 08/10
      expect(by("Vía Dolce").defaultPromisedDate).toBe("2026-10-08");
      // "repetir último pedido"
      expect(by("Vía Dolce").lastItems.length).toBe(2);
      // la lista de cada cliente tiene precios
      const via = by("Vía Dolce");
      expect(Object.keys(data.prices[via.priceListId!]!).length).toBeGreaterThan(5);
    });
  });
});

describe("estados del pedido (RF-03)", () => {
  async function newOrder(tx: Tx, userId: string) {
    const via = await customer(tx, "Vía Dolce");
    const tap = await product(tx, "CH-TAP-500");
    return createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 10 }]), { today: TODAY });
  }

  it("avanza hasta cobrado registrando un evento por paso y deliveredAt al entregar", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const o = await newOrder(tx, userId);
      for (const to of ["confirmed", "in_production", "ready", "dispatched"] as const) {
        await changeOrderStatus(tx, userId, { id: o.id, to });
      }
      expect((await getOrder(tx, o.id))?.deliveredAt).toBeNull();
      const at = new Date();
      await changeOrderStatus(tx, userId, { id: o.id, to: "delivered" }, at);
      await changeOrderStatus(tx, userId, { id: o.id, to: "invoiced" });
      await changeOrderStatus(tx, userId, { id: o.id, to: "paid" });
      const d = await getOrder(tx, o.id);
      expect(d?.status).toBe("paid");
      expect(d?.deliveredAt?.toISOString()).toBe(at.toISOString());
      expect(d?.events.map((e) => e.status)).toEqual([
        "received",
        "confirmed",
        "in_production",
        "ready",
        "dispatched",
        "delivered",
        "invoiced",
        "paid",
      ]);
      expect(d?.events.every((e) => e.byId === userId)).toBe(true);
    });
  });

  it("rechaza transiciones inválidas (retroceder, repetir, cancelar lo entregado)", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const o = await newOrder(tx, userId);
      await changeOrderStatus(tx, userId, { id: o.id, to: "ready" });
      await expect(changeOrderStatus(tx, userId, { id: o.id, to: "confirmed" })).rejects.toThrow(
        /No se puede pasar/,
      );
      await expect(changeOrderStatus(tx, userId, { id: o.id, to: "ready" })).rejects.toThrow(/No se puede pasar/);
      await changeOrderStatus(tx, userId, { id: o.id, to: "delivered" });
      await expect(changeOrderStatus(tx, userId, { id: o.id, to: "cancelled" })).rejects.toThrow(
        /No se puede pasar/,
      );
      expect((await getOrder(tx, o.id))?.events).toHaveLength(3);
    });
  });

  it("cancela con nota y deja el pedido sin transiciones", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const o = await newOrder(tx, userId);
      await changeOrderStatus(tx, userId, { id: o.id, to: "cancelled", note: "El cliente lo anuló" });
      const d = await getOrder(tx, o.id);
      expect(d?.status).toBe("cancelled");
      expect(d?.events.at(-1)?.note).toBe("El cliente lo anuló");
      await expect(changeOrderStatus(tx, userId, { id: o.id, to: "confirmed" })).rejects.toThrow();
    });
  });

  it("edita ítems solo en recibido/confirmado, conservando el precio congelado", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const via = await customer(tx, "Vía Dolce");
      const tap = await product(tx, "CH-TAP-500");
      const len = await product(tx, "CH-LEN-500");
      const o = await createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 10 }]), {
        today: TODAY,
      });
      // sube el precio de lista después de la carga: la línea existente conserva 4200
      await tx
        .insert(schema.priceListItems)
        .values({ priceListId: via.priceListId!, productId: tap.id, unitPrice: 5000, validFrom: "2026-10-02" });
      await updateOrder(
        tx,
        userId,
        {
          id: o.id,
          promisedDate: "2026-10-07",
          notes: null,
          items: [
            { productId: tap.id, qtyUnits: 12 },
            { productId: len.id, qtyUnits: 3 },
          ],
        },
        { today: TODAY },
      );
      const d = await getOrder(tx, o.id);
      expect(d?.total).toBe(12 * 4200 + 3 * 4200);
      expect(d?.promisedDate).toBe("2026-10-07");
      expect(d?.events.at(-1)?.note).toMatch(/modificado/);

      await changeOrderStatus(tx, userId, { id: o.id, to: "in_production" });
      await expect(
        updateOrder(
          tx,
          userId,
          { id: o.id, promisedDate: "2026-10-07", notes: null, items: [{ productId: tap.id, qtyUnits: 1 }] },
          { today: TODAY },
        ),
      ).rejects.toThrow(/solo se editan/);
    });
  });
});

describe("listado y hoja de envasado (RF-03)", () => {
  it("filtra por estado, cliente, rango de fecha y atrasados", async () => {
    await inRollback("nahuel", async (tx) => {
      const nautico = await customer(tx, "Club Náutico");
      expect((await listOrders(tx, { status: "confirmed" }, TODAY)).map((o) => o.customerName)).toEqual([
        "Club Náutico",
      ]);
      expect((await listOrders(tx, { customerId: nautico.id }, TODAY)).length).toBe(1);
      const range = await listOrders(tx, { from: "2026-10-01", to: "2026-10-05" }, TODAY);
      expect(range.map((o) => o.customerName)).toEqual(["Club Náutico"]);
      // El pedido de Náutico (05/10) está atrasado a partir del 06/10.
      expect(await listOrders(tx, { overdue: true }, TODAY)).toHaveLength(0);
      const later = await listOrders(tx, { overdue: true }, "2026-10-06");
      expect(later.map((o) => o.customerName)).toEqual(["Club Náutico"]);
      expect(later[0]?.overdue).toBe(true);
      expect(await countOverdueOrders(tx, "2026-10-06")).toBe(1);
      // kg del pedido grande de La Reina
      const big = (await listOrders(tx, { status: "received" }, TODAY))[0]!;
      expect(big.kg).toBe(425);
    });
  });

  it("hoja de envasado: totales por producto y por cliente", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const via = await customer(tx, "Vía Dolce");
      const tap = await product(tx, "CH-TAP-500");
      const len5k = await product(tx, "CH-LEN-5K");
      await createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 20 }], "2026-10-05"), {
        today: TODAY,
      });
      const sheet = await packingSheet(tx, "2026-10-05");
      expect(sheet.orderCount).toBe(2); // Náutico (demo) + Vía Dolce
      const t = sheet.byProduct.find((p) => p.productId === tap.id)!;
      expect(t).toMatchObject({ units: 20, kg: 10 });
      expect(sheet.byProduct.find((p) => p.productId === len5k.id)).toMatchObject({ units: 2, kg: 10 });
      expect(sheet.totalKg).toBe(10 + 10 + 5); // 20 bolsas + 2 len granel + 1 tap granel
      expect(sheet.byCustomer.map((c) => c.name)).toEqual(["Club Náutico", "Vía Dolce"]);
      expect(sheet.byCustomer[0]?.kg).toBe(15);

      // los cancelados no se preparan
      expect((await packingSheet(tx, "2026-10-09")).totalKg).toBe(425);
      const [big] = await listOrders(tx, { status: "received" }, TODAY);
      await changeOrderStatus(tx, userId, { id: big!.id, to: "cancelled" });
      expect((await packingSheet(tx, "2026-10-09")).orderCount).toBe(0);
    });
  });
});

describe("historial y frecuencia (RF-04)", () => {
  it("estadísticas de Vía Dolce con los pedidos demo", async () => {
    await inRollback("nahuel", async (tx) => {
      const via = await customer(tx, "Vía Dolce");
      const s = await customerOrderStats(tx, via.id, TODAY);
      expect(s).toMatchObject({
        orderCount: 4,
        averageIntervalDays: 7,
        daysSinceLastOrder: 7,
        lastOrderDate: "2026-09-25",
        expectedNextDate: "2026-10-02",
        overdue: false,
        overdueFactor: 1.5,
      });
      // 4 pedidos de 20 × 4200 + 10 × 4200 dentro de los últimos 90 días
      expect(s.last90Total).toBe(4 * 126000);
      expect(s.last90Orders).toBe(4);
      expect(s.last90Kg).toBe(4 * 15);
      expect((await customerOrderStats(tx, via.id, "2026-10-08")).overdue).toBe(true);
    });
  });

  it("clientes para llamar: los que superan su frecuencia × 1,5", async () => {
    await inRollback("nahuel", async (tx) => {
      expect(await getOverdueCustomers(tx, TODAY)).toEqual([]);
      // 10/10: Vía Dolce (7 días de promedio) lleva 15 > 10,5; La Esperanza (14) lleva 24 > 21
      const list = await getOverdueCustomers(tx, "2026-10-10");
      expect(list.map((c) => c.name)).toEqual(["Vía Dolce", "La Esperanza"]);
      expect(list[0]).toMatchObject({
        lastOrderDate: "2026-09-25",
        daysSinceLastOrder: 15,
        averageIntervalDays: 7,
        expectedDate: "2026-10-02",
        daysLate: 8,
      });
      // La Reina pidió el 02/10 con promedio de 24 días: no está demorada
      expect(list.some((c) => c.name === "Supermercado La Reina")).toBe(false);
    });
  });

  it("un pedido cancelado no cuenta como compra", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const via = await customer(tx, "Vía Dolce");
      const tap = await product(tx, "CH-TAP-500");
      const o = await createOrder(tx, userId, input(via.id, [{ productId: tap.id, qtyUnits: 1 }]), {
        today: TODAY,
      });
      expect((await customerOrderStats(tx, via.id, TODAY)).orderCount).toBe(5);
      await changeOrderStatus(tx, userId, { id: o.id, to: "cancelled" });
      expect((await customerOrderStats(tx, via.id, TODAY)).orderCount).toBe(4);
    });
  });
});

describe("fecha posible de un pedido grande (RF-05)", () => {
  it("pedido de 850 bolsas de La Reina: stock terminado + 2 días de producción", async () => {
    await inRollback("nahuel", async (tx) => {
      const [big] = await listOrders(tx, { status: "received" }, TODAY);
      const est = await estimateForOrder(tx, big!.id, TODAY);
      expect(est).toMatchObject({
        orderKg: 425,
        capacityKg: 150,
        needsProduction: true,
        plannedKg: 0,
        backlogKg: 0,
      });
      // stock demo: tapitas 160 bolsas (80 kg) + lengüitas 134 bolsas (67 kg)
      expect(est!.finishedStockKg).toBe(147);
      expect(est!.shortfallKg).toBe(278);
      // viernes 02/10 (150) + lunes 05/10 (128) → disponible el martes 06/10
      expect(est!.schedule).toEqual([
        { date: "2026-10-02", kg: 150 },
        { date: "2026-10-05", kg: 128 },
      ]);
      expect(est!.date).toBe("2026-10-06");
      // la fecha comprometida (09/10) alcanza
      expect(est!.date! <= big!.promisedDate).toBe(true);
    });
  });

  it("descuenta los planes de producción ya guardados", async () => {
    await inRollback("nahuel", async (tx) => {
      const [big] = await listOrders(tx, { status: "received" }, TODAY);
      await tx.insert(schema.productionPlans).values([
        { date: "2026-10-02", totalKg: 100 },
        { date: "2026-10-05", totalKg: 150 },
      ]);
      const est = await estimateForOrder(tx, big!.id, TODAY);
      expect(est!.plannedKg).toBe(250);
      expect(est!.schedule).toEqual([
        { date: "2026-10-02", kg: 50 },
        { date: "2026-10-06", kg: 150 },
        { date: "2026-10-07", kg: 78 },
      ]);
      expect(est!.date).toBe("2026-10-08");
    });
  });

  it("suma a la capacidad ocupada lo que otros pedidos abiertos aún tienen que producir", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const [big] = await listOrders(tx, { status: "received" }, TODAY);
      const via = await customer(tx, "Vía Dolce");
      const ari = await product(tx, "CH-ARI-500");
      // 31 bolsas de aritos en stock; otro pedido pide 400 → faltan 369 bolsas = 184,5 kg
      await createOrder(tx, userId, input(via.id, [{ productId: ari.id, qtyUnits: 400 }], "2026-10-08"), {
        today: TODAY,
      });
      const est = await estimateForOrder(tx, big!.id, TODAY);
      expect(est!.backlogKg).toBe(184.5);
      // hoy (150) y el lunes (34,5) ya están ocupados por ese faltante
      expect(est!.schedule).toEqual([
        { date: "2026-10-05", kg: 115.5 },
        { date: "2026-10-06", kg: 150 },
        { date: "2026-10-07", kg: 12.5 },
      ]);
      expect(est!.date).toBe("2026-10-08");
    });
  });

  it("si el stock alcanza no hay que producir; la calculadora usa el stock libre total", async () => {
    await inRollback("nahuel", async (tx) => {
      const small = await estimateOrderDate(tx, { kg: 10, today: TODAY });
      expect(small).toMatchObject({ needsProduction: false, shortfallKg: 0, date: TODAY, schedule: [] });
      const bigKg = await estimateOrderDate(tx, { kg: 500, today: TODAY });
      expect(bigKg.needsProduction).toBe(true);
      expect(bigKg.date).not.toBeNull();
    });
  });

  it("respeta la capacidad y los días hábiles configurados", async () => {
    await inRollback("nahuel", async (tx) => {
      const est = await estimateOrderDate(tx, { kg: 1000, today: "2026-10-03" }); // sábado
      expect(est.workdays).toEqual([1, 2, 3, 4, 5]);
      // el pedido grande de La Reina (abierto) ya reserva 278 kg de producción: lunes 150 + martes 128
      expect(est.backlogKg).toBe(278);
      expect(est.schedule[0]).toEqual({ date: "2026-10-06", kg: 22 });
      expect(est.schedule.every((s) => ![6, 7].includes(new Date(`${s.date}T12:00:00Z`).getUTCDay() || 7))).toBe(true);
    });
  });
});
