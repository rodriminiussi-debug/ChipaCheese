import { describe, expect, it } from "vitest";
import { and, eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { buildAlerts, getDashboard, getOperationalDashboard, getOtif } from "./service";

const TODAY = "2026-10-02";

/**
 * Datos demo relevantes (packages/db/src/seed/demo.ts), hoy = viernes 02/10/2026:
 *  - Una producción por mes: 01/09 (149,3 kg) y 01/10 (149,3 kg; consumos 170,9 kg con 24 L de leche).
 *  - Pedidos de septiembre entregados el día comprometido a las 11:00: Vía Dolce ×4, La Esperanza ×2, La Reina ×1.
 *  - Factura a La Reina por $468.000 con IVA ($200.000 pagados con un cheque que se cobra el 10/10).
 *  - Jamón y queso feteado sin stock ni precio de compra; bolsa granel de 5 kg sin precio.
 */
describe("tablero operativo (RF-41)", () => {
  it("uso de capacidad de la semana: kg ÷ (150 × días hábiles de lunes a hoy)", async () => {
    await inRollback("af", async (tx) => {
      const op = await getOperationalDashboard(tx, { today: TODAY, month: "2026-09" });
      // Semana del lunes 28/09 al viernes 02/10 = 5 días hábiles; se produjo el 01/10: 149,3 kg.
      expect(op.capacity).toMatchObject({ weekFrom: "2026-09-28", workdays: 5, producedKg: 149.3, capacityKg: 150 });
      expect(op.capacity.usagePct).toBe(19.9); // 149,3 ÷ 750
      // Gráfico: 14 días terminando hoy, con el 01/10 como único día con producción.
      expect(op.dailyProduction).toHaveLength(14);
      expect(op.dailyProduction[0]!.date).toBe("2026-09-19");
      expect(op.dailyProduction.at(-1)!.date).toBe(TODAY);
      expect(op.dailyProduction.filter((d) => d.kg > 0)).toEqual([{ date: "2026-10-01", kg: 149.3, workday: true }]);
      expect(op.dailyProduction.find((d) => d.date === "2026-09-26")!.workday).toBe(false); // sábado
    });
  });

  it("rendimiento = kg pesados ÷ kg de ingredientes reales de los últimos 30 días", async () => {
    await inRollback("af", async (tx) => {
      const op = await getOperationalDashboard(tx, { today: TODAY });
      // Sólo entra la producción del 01/10 (la del 01/09 quedó a 31 días): 149,3 ÷ (75+22+15+15+18+24+1,9) = 149,3 ÷ 170,9.
      expect(op.yield).toMatchObject({ runs: 1, weighedKg: 149.3, ratio: 0.8736 });
    });
  });

  it("entregas a tiempo y completas: septiembre 7 de 7; una tarde o incompleta la baja", async () => {
    await inRollback("af", async (tx) => {
      expect(await getOtif(tx, "2026-09")).toEqual({ pct: 100, delivered: 7, ok: 7, month: "2026-09" });
      expect(await getOtif(tx, "2026-10")).toMatchObject({ pct: null, delivered: 0 });

      // Una entrega 2 días después de lo comprometido: 6 de 7 = 85,7 %.
      const [late] = await tx.select().from(schema.orders).where(eq(schema.orders.status, "paid")).limit(1);
      await tx
        .update(schema.orders)
        .set({ deliveredAt: new Date(`2026-09-${String(Number(late!.promisedDate.slice(8)) + 2).padStart(2, "0")}T11:00:00-03:00`) })
        .where(eq(schema.orders.id, late!.id));
      expect((await getOtif(tx, "2026-09")).pct).toBe(85.7);
    });
  });

  it("un pedido con remito por menos de lo pedido no cuenta como completo", async () => {
    await inRollback("af", async (tx) => {
      const reina = (await tx.query.orders.findFirst({
        where: eq(schema.orders.status, "invoiced"),
        with: { items: true },
      }))!;
      const lot = (await tx.query.finishedLots.findFirst())!;
      const [dispatch] = await tx
        .insert(schema.dispatches)
        .values({ orderId: reina.id, customerId: reina.customerId, status: "delivered" })
        .returning();
      // Pidió 60 tapitas + 60 lengüitas y se despachó sólo una de las dos.
      await tx
        .insert(schema.dispatchItems)
        .values({ dispatchId: dispatch!.id, productId: reina.items[0]!.productId, finishedLotId: lot.id, qtyUnits: reina.items[0]!.qtyUnits });
      expect(await getOtif(tx, "2026-09")).toMatchObject({ pct: 85.7, ok: 6, delivered: 7 });
    });
  });

  it("cobertura: jamón y queso feteado están sin stock; el resto sobre el punto de pedido", async () => {
    await inRollback("af", async (tx) => {
      const op = await getOperationalDashboard(tx, { today: TODAY });
      expect(op.coverage.belowReorderPoint).toBe(2);
      expect(op.coverage.items.map((i) => i.name).sort()).toEqual(["Jamón feteado", "Queso feteado"]);
    });
  });
});

describe("tablero financiero y permisos por rol", () => {
  it("Dirección: costo por bolsa, margen por canal, ventas, top clientes, deuda y resultado de septiembre", async () => {
    await inRollback("nahuel", async (tx) => {
      const t0 = Date.now();
      const d = await getDashboard(tx, { today: TODAY, month: "2026-09", includeFinance: true });
      expect(Date.now() - t0).toBeLessThan(1000); // el tablero carga en menos de 1 s con los datos demo
      const f = d.financial!;
      // Costo por bolsa: (791.934 ingredientes + 120.000 de mano de obra) ÷ 149,3 kg = 6.108,06 por kg → × 0,5 + $140 de bolsa.
      expect(f.costPerKg).toBe(6108.06);
      expect(f.costPerBag?.cost).toBe(3194.03);
      // Márgenes: 4.200 contra 3.194,03 = 23,95 % (mayorista, objetivo 25 %); supermercado 3.900 → 18,1 %.
      const byChannel = Object.fromEntries(f.marginByChannel.map((m) => [m.channel, m]));
      expect(byChannel.reseller).toMatchObject({ avgMarginPct: 24, worstMarginPct: 23.95, targetMarginPct: 25 });
      expect(byChannel.supermarket!.avgMarginPct).toBe(18.1);
      expect(byChannel.store!.avgMarginPct).toBeGreaterThan(33);
      expect(f.salesByChannel).toEqual([{ channel: "supermarket", net: 386_776.86, documents: 1 }]);
      expect(f.topCustomers.map((c) => [c.name, c.net])).toEqual([["Supermercado La Reina", 386_776.86]]);
      expect(f.receivables).toEqual({ total: 268_000, overdue: 0 }); // 468.000 facturados − 200.000 del cheque
      // Es el mismo resultado que muestra /costos/resultado.
      expect(f.result.result).toBe(-1_108_282.34);
      expect(f.result.withdrawals.covers).toBe(false);
      expect(f.missingPrices).toEqual(["Bolsa granel 5 kg", "Jamón feteado", "Queso feteado"]);
    });
  });

  it("sin finance:read no se calcula ni se devuelve nada financiero", async () => {
    await inRollback("af", async (tx) => {
      const d = await getDashboard(tx, { today: TODAY, month: "2026-09", includeFinance: false });
      expect(d.financial).toBeNull();
      expect(d.alerts.some((a) => a.financial)).toBe(false);
      // Ni siquiera en el JSON serializado hay claves de plata.
      const json = JSON.stringify(d);
      for (const forbidden of ["receivables", "marginByChannel", "withdrawals", "costPerBag", "topCustomers", "missingPrices"])
        expect(json).not.toContain(forbidden);
    });
  });

  it("alertas con link: insumos a reponer, precios faltantes y los que se disparan al cambiar los datos", async () => {
    await inRollback("nahuel", async (tx) => {
      const base = await getDashboard(tx, { today: TODAY, includeFinance: true });
      const ids = (d: typeof base) => d.alerts.map((a) => a.id);
      expect(ids(base)).toEqual(expect.arrayContaining(["reorder", "missing-prices", "temperature-missing", "corrective"]));
      expect(base.alerts.find((a) => a.id === "reorder")).toMatchObject({ count: 2, href: "/stock" });
      expect(base.alerts.find((a) => a.id === "missing-prices")!.href).toBe("/costos");

      await trigger(tx);
      const d = await getDashboard(tx, { today: TODAY, includeFinance: true });
      const byId = Object.fromEntries(d.alerts.map((a) => [a.id, a]));
      expect(byId["overdue-orders"]).toMatchObject({ count: 1, severity: "bad", href: "/pedidos?atrasados=1" });
      expect(byId["checks"]).toMatchObject({ count: 1, href: "/cobranzas/cheques", financial: true });
      expect(byId["below-cost"]).toMatchObject({ count: 1, href: "/precios", financial: true });
      expect(byId["temperature"]).toMatchObject({ count: 1, href: "/calidad?vista=temperaturas" });
      expect(byId["held-lots"]).toMatchObject({ count: 1, href: "/calidad" });
      // Los "bad" van primero.
      const firstWarn = d.alerts.findIndex((a) => a.severity === "warn");
      expect(d.alerts.slice(0, firstWarn).every((a) => a.severity === "bad")).toBe(true);

      // La jefa de producción ve las operativas, no las de plata.
      const op = await getOperationalDashboard(tx, { today: TODAY });
      const ops = buildAlerts(op, null).map((a) => a.id);
      expect(ops).toEqual(expect.arrayContaining(["overdue-orders", "temperature", "held-lots"]));
      expect(ops).not.toContain("checks");
      expect(ops).not.toContain("below-cost");
    });
  });
});

/** Dispara alertas: pedido atrasado, cheque a cobrar, precio bajo costo, temperatura fuera de rango y lote retenido. */
async function trigger(tx: Executor) {
  // Pedido del Náutico (confirmado, 05/10) pasa a estar atrasado.
  await tx
    .update(schema.orders)
    .set({ promisedDate: "2026-09-30" })
    .where(eq(schema.orders.status, "confirmed"));
  // El cheque de La Reina se puede cobrar el 05/10 (dentro de 7 días).
  await tx.update(schema.checks).set({ cashDate: "2026-10-05" });
  // Tapitas mayorista a $3.000, bajo el costo directo de $3.194,03.
  const tap = (await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") }))!;
  const mayorista = (await tx.query.priceLists.findFirst({ where: eq(schema.priceLists.channel, "reseller") }))!;
  await tx
    .update(schema.priceListItems)
    .set({ unitPrice: 3000 })
    .where(and(eq(schema.priceListItems.productId, tap.id), eq(schema.priceListItems.priceListId, mayorista.id)));
  // Una cámara con -10 °C fuera de rango hoy.
  const eq1 = (await tx.query.equipment.findFirst({ where: eq(schema.equipment.code, "F3") }))!;
  await tx.insert(schema.temperatureLogs).values({
    equipmentId: eq1.id,
    date: TODAY,
    measuredAt: new Date(`${TODAY}T08:00:00-03:00`),
    valueC: -10,
    outOfRange: true,
  });
  await tx.update(schema.finishedLots).set({ onHold: true }).where(eq(schema.finishedLots.code, "260901-1"));
}
