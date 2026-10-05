import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { getExpiryAlerts, getLateSupplierOrders, getNextDayOrders, getPriceIncreases } from "./attention";
import { buildAlerts, getDashboard, getFinancialDashboard, getOperationalDashboard } from "./service";
import {
  coverageChart,
  getCostPerBagByMonth,
  getOtifByWeek,
  getStoreDailyUnits,
  getTemperaturesDaily,
  getYieldByRun,
} from "./series";

const TODAY = "2026-10-02";

/** Nueva compra del insumo al mismo proveedor que la anterior (la variación se mide contra el mismo proveedor). */
async function newPrice(tx: Executor, ingredientId: string, date: string, unitPriceNet: number) {
  const last = await tx.query.ingredientPrices.findFirst({
    where: eq(schema.ingredientPrices.ingredientId, ingredientId),
  });
  await tx
    .insert(schema.ingredientPrices)
    .values({ ingredientId, date, unitPriceNet, supplierId: last?.supplierId });
}

/**
 * Datos demo (packages/db/src/seed/demo.ts), hoy = viernes 02/10/2026:
 *  - Producciones: 01/09 (149,3 kg pesados, 164,9 kg de ingredientes) y 01/10 (149,3 kg; 170,9 kg).
 *  - 7 pedidos de septiembre entregados el día comprometido; el pedido 8 (Club Náutico, confirmado) es para el lunes 05/10.
 *  - Todos los precios de compra son del 29/09. Sin ventas del local ni órdenes de compra.
 */
describe("series operativas del tablero", () => {
  it("rendimiento por producción: kg pesados ÷ kg de ingredientes de cada una", async () => {
    await inRollback("af", async (tx) => {
      const r = await getYieldByRun(tx, "2026-08-19", TODAY);
      expect(r.map((x) => [x.date, x.weighedKg, x.ingredientsKg, x.yieldPct])).toEqual([
        ["2026-09-01", 149.3, 164.9, 90.5],
        ["2026-10-01", 149.3, 170.9, 87.4],
      ]);
      // El rango recorta: sólo la de octubre.
      expect((await getYieldByRun(tx, "2026-09-15", TODAY)).map((x) => x.date)).toEqual(["2026-10-01"]);
      // El promedio de 30 días del indicador sale de las mismas producciones (sólo la de octubre).
      const op = await getOperationalDashboard(tx, { today: TODAY });
      expect(op.charts.yieldByRun).toHaveLength(2);
      expect(op.yield).toMatchObject({ runs: 1, ratio: 0.8736 });
    });
  });

  it("entregas a tiempo y completas por semana: 8 semanas, 7 entregas en septiembre, la última sin datos", async () => {
    await inRollback("af", async (tx) => {
      const w = await getOtifByWeek(tx, TODAY, 8);
      expect(w).toHaveLength(8);
      expect(w[0]!.weekFrom).toBe("2026-08-10");
      expect(w.at(-1)).toEqual({ weekFrom: "2026-09-28", pct: null, delivered: 0, ok: 0 });
      expect(w.reduce((a, x) => a + x.delivered, 0)).toBe(7);
      expect(w.reduce((a, x) => a + x.ok, 0)).toBe(7);
      expect(w.filter((x) => x.delivered > 0).every((x) => x.pct === 100)).toBe(true);
    });
  });

  it("una entrega tarde baja el porcentaje de su semana, no el de las demás", async () => {
    await inRollback("af", async (tx) => {
      const [late] = await tx.select().from(schema.orders).where(eq(schema.orders.status, "paid")).limit(1);
      const promised = late!.promisedDate;
      await tx
        .update(schema.orders)
        .set({
          deliveredAt: new Date(
            `${promised}T11:00:00-03:00`.replace(
              /(\d+)-(\d+)-(\d+)T/,
              (_, y, m, d) => `${y}-${m}-${String(Number(d) + 2).padStart(2, "0")}T`,
            ),
          ),
        })
        .where(eq(schema.orders.id, late!.id));
      const w = await getOtifByWeek(tx, TODAY, 8);
      expect(w.filter((x) => x.delivered > 0 && x.pct !== 100)).toHaveLength(1);
      expect(w.reduce((a, x) => a + x.ok, 0)).toBe(6);
    });
  });

  it("ventas diarias del local en unidades: suma por día argentino y no cuenta las anuladas", async () => {
    await inRollback("af", async (tx) => {
      expect((await getStoreDailyUnits(tx, TODAY, 14)).every((d) => d.units === 0)).toBe(true);
      const loc = (await tx.query.locations.findFirst({ where: eq(schema.locations.kind, "store") }))!;
      const prod = (await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") }))!;
      const sale = async (soldAt: string, units: number[], voided = false) => {
        const [s] = await tx
          .insert(schema.storeSales)
          .values({
            soldAt: new Date(soldAt),
            locationId: loc.id,
            method: "cash",
            total: 1000,
            voidedAt: voided ? new Date(soldAt) : null,
          })
          .returning();
        for (const u of units)
          await tx
            .insert(schema.storeSaleItems)
            .values({ saleId: s!.id, productId: prod.id, qtyUnits: u, unitPrice: 500 });
      };
      await sale("2026-10-01T15:00:00-03:00", [2, 3]);
      await sale("2026-10-01T23:30:00-03:00", [1]); // ya es 02/10 en UTC, pero 01/10 en Argentina
      await sale("2026-09-30T10:00:00-03:00", [4]);
      await sale("2026-09-30T11:00:00-03:00", [9], true); // anulada
      await sale("2026-09-01T10:00:00-03:00", [50]); // fuera de la ventana
      const days = await getStoreDailyUnits(tx, TODAY, 14);
      expect(days).toHaveLength(14);
      expect(days[0]!.date).toBe("2026-09-19");
      expect(days.at(-1)).toEqual({ date: TODAY, units: 0 });
      expect(Object.fromEntries(days.filter((d) => d.units > 0).map((d) => [d.date, d.units]))).toEqual({
        "2026-10-01": 6,
        "2026-09-30": 4,
      });
    });
  });

  it("temperaturas por día: registros y fuera de rango", async () => {
    await inRollback("af", async (tx) => {
      const base = await getTemperaturesDaily(tx, TODAY, 14);
      expect(base.find((d) => d.date === "2026-10-01")).toEqual({
        date: "2026-10-01",
        readings: 5,
        outOfRange: 0,
      });
      const f3 = (await tx.query.equipment.findFirst({ where: eq(schema.equipment.code, "F3") }))!;
      await tx.insert(schema.temperatureLogs).values({
        equipmentId: f3.id,
        date: "2026-10-01",
        measuredAt: new Date("2026-10-01T18:00:00-03:00"),
        valueC: -10,
        outOfRange: true,
      });
      const d = await getTemperaturesDaily(tx, TODAY, 14);
      expect(d.find((x) => x.date === "2026-10-01")).toEqual({
        date: "2026-10-01",
        readings: 6,
        outOfRange: 1,
      });
      expect(d).toHaveLength(14);
    });
  });

  it("cobertura: los sin stock primero (0 días), después de menor a mayor, con el punto de pedido en días", async () => {
    await inRollback("af", async (tx) => {
      const op = await getOperationalDashboard(tx, { today: TODAY });
      const c = op.charts.coverage;
      expect(c.slice(0, 2).map((x) => [x.name, x.coverageDays])).toEqual([
        ["Jamón feteado", 0],
        ["Queso feteado", 0],
      ]);
      const rest = c.slice(2).map((x) => x.coverageDays!);
      expect([...rest].sort((a, b) => a - b)).toEqual(rest);
      // Cada insumo con consumo trae su punto de pedido en días (consumo × plazo + seguridad ÷ consumo).
      expect(c.slice(2).every((x) => x.reorderDays != null && x.reorderDays > 0)).toBe(true);
      expect(coverageChart([], 5)).toEqual([]);
    });
  });
});

describe("costo por bolsa mes a mes", () => {
  it("reconstruye con el precio vigente a fin de cada mes: antes de la primera compra no hay costo", async () => {
    await inRollback("nahuel", async (tx) => {
      const s = await getCostPerBagByMonth(tx, ["2026-07", "2026-08", "2026-09", "2026-10"], TODAY);
      expect(s.map((x) => x.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
      // Todas las compras son del 29/09: julio y agosto no tienen precios.
      expect(s[0]).toEqual({ month: "2026-07", costPerBag: null, costPerKg: null });
      expect(s[1]!.costPerBag).toBeNull();
      expect(s[2]!.costPerBag).toBeGreaterThan(3000);
      // El mes en curso coincide con el indicador "costo por bolsa" (último precio, rendimiento a hoy).
      expect(s[3]).toEqual({ month: "2026-10", costPerBag: 3194.03, costPerKg: 6108.06 });
    });
  });

  it("un aumento posterior no cambia el costo de los meses anteriores", async () => {
    await inRollback("nahuel", async (tx) => {
      const queso = (await tx.query.ingredients.findFirst({
        where: eq(schema.ingredients.name, "Queso reggianito"),
      }))!;
      await tx
        .insert(schema.ingredientPrices)
        .values({ ingredientId: queso.id, date: "2026-10-01", unitPriceNet: 26862 }); // el doble
      const s = await getCostPerBagByMonth(tx, ["2026-09", "2026-10"], TODAY);
      const before = await getCostPerBagByMonth(tx, ["2026-09"], TODAY);
      expect(s[0]).toEqual(before[0]);
      expect(s[1]!.costPerBag!).toBeGreaterThan(s[0]!.costPerBag!);
    });
  });
});

describe("gráficos financieros del tablero", () => {
  it("6 meses terminando en el elegido, con los datos de septiembre", async () => {
    await inRollback("nahuel", async (tx) => {
      const f = await getFinancialDashboard(tx, { today: TODAY, month: "2026-09" });
      const c = f.charts;
      expect(c.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
      // Ventas: una factura a La Reina en septiembre; el resto de los meses sin ventas.
      expect(c.salesByMonth.at(-1)).toEqual({
        month: "2026-09",
        total: 386_776.86,
        byChannel: { supermarket: 386_776.86 },
      });
      expect(c.salesByMonth.slice(0, 5).every((m) => m.total === 0)).toBe(true);
      // Resultado: el mismo que /costos/resultado, y los retiros de referencia.
      expect(c.resultByMonth.at(-1)).toMatchObject({
        month: "2026-09",
        result: -1_108_282.34,
        hasData: true,
      });
      expect(c.resultByMonth[0]).toMatchObject({ hasData: false });
      expect(c.withdrawals).toBe(9_000_000);
      expect(c.costPerBagByMonth).toHaveLength(6);
      expect(c.deliveryByMonth).toHaveLength(6);
      // Deuda por antigüedad: $268.000 todavía sin vencer (el cheque se cobra el 10/10).
      expect(c.receivablesAging).toMatchObject({ current: 268_000, d1_30: 0, d90_plus: 0, total: 268_000 });
      expect(f.topCustomers.length).toBeLessThanOrEqual(10);
    });
  });

  it("la deuda se reparte por días de mora", async () => {
    await inRollback("nahuel", async (tx) => {
      // La factura de La Reina vencía el 17/10; hoy es 18/11: 32 días de mora.
      const f = await getFinancialDashboard(tx, { today: "2026-11-18", month: "2026-09" });
      expect(f.charts.receivablesAging.current).toBe(0);
      expect(f.charts.receivablesAging.d31_60).toBeGreaterThan(0);
      expect(f.charts.receivablesAging.total).toBe(f.receivables.total);
    });
  });

  it("sin finance:read no viaja ningún gráfico con montos", async () => {
    await inRollback("af", async (tx) => {
      const d = await getDashboard(tx, { today: TODAY, month: "2026-09", includeFinance: false });
      expect(d.financial).toBeNull();
      const json = JSON.stringify(d);
      for (const forbidden of [
        "salesByMonth",
        "resultByMonth",
        "withdrawals",
        "costPerBagByMonth",
        "deliveryByMonth",
        "deliveryByZone",
        "receivablesAging",
      ])
        expect(json).not.toContain(forbidden);
      // Los gráficos operativos sí.
      expect(d.operational.charts.yieldByRun.length).toBeGreaterThan(0);
    });
  });
});

describe("alertas: lotes por vencer", () => {
  it("producto terminado a ≤ 30 días y materia prima a ≤ 7 días, con link y cantidad", async () => {
    await inRollback("af", async (tx) => {
      const quiet = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(quiet.alerts.some((a) => a.id === "finished-expiry" || a.id === "raw-expiry")).toBe(false);

      // El lote de septiembre vence el 20/10 (18 días); el de octubre queda a 6 meses.
      await tx
        .update(schema.finishedLots)
        .set({ expiryDate: "2026-10-20" })
        .where(eq(schema.finishedLots.code, "260901-1"));
      // El lote de leche vence el 05/10 (3 días): dentro de los 7; el de huevo (20/10) todavía no.
      await tx
        .update(schema.rawLots)
        .set({ expiryDate: "2026-10-05" })
        .where(eq(schema.rawLots.supplierLotCode, "LEC-0928"));

      const d = await getDashboard(tx, { today: TODAY, includeFinance: false });
      const byId = Object.fromEntries(d.alerts.map((a) => [a.id, a]));
      expect(byId["finished-expiry"]).toMatchObject({
        severity: "warn",
        count: 1,
        href: "/stock/producto-terminado",
        financial: false,
      });
      expect(byId["finished-expiry"]!.detail).toContain("260901-1");
      expect(byId["finished-expiry"]!.detail).toContain("18 día(s)");
      expect(byId["raw-expiry"]).toMatchObject({ count: 1, href: "/stock", financial: false });
      expect(byId["raw-expiry"]!.detail).toContain("Leche");
      expect(byId["raw-expiry"]!.detail).toContain("LEC-0928");
    });
  });

  it("los umbrales salen de la configuración y un lote vencido con saldo es grave", async () => {
    await inRollback("af", async (tx) => {
      expect((await getExpiryAlerts(tx, TODAY, { finishedDays: 30, rawDays: 7 })).raw.count).toBe(0);
      // Con 14 días entra el de leche (12/10).
      expect((await getExpiryAlerts(tx, TODAY, { finishedDays: 30, rawDays: 14 })).raw).toMatchObject({
        count: 1,
        thresholdDays: 14,
      });
      await tx.insert(schema.appSettings).values({ key: "alerts.raw_expiry_days", value: 14 });
      const d = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(d.operational.expiry.raw.thresholdDays).toBe(14);
      expect(d.alerts.find((a) => a.id === "raw-expiry")).toMatchObject({ count: 1, severity: "warn" });

      await tx
        .update(schema.rawLots)
        .set({ expiryDate: "2026-10-01" })
        .where(eq(schema.rawLots.supplierLotCode, "LEC-0928"));
      const e = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(e.alerts.find((a) => a.id === "raw-expiry")).toMatchObject({ severity: "bad" });
      expect(e.alerts.find((a) => a.id === "raw-expiry")!.detail).toContain("vencido");
    });
  });
});

describe("alertas: proveedores, precios y pedidos de mañana", () => {
  it("entregas de proveedores atrasadas: órdenes enviadas o recibidas a medias con fecha esperada vencida", async () => {
    await inRollback("nahuel", async (tx) => {
      expect((await getLateSupplierOrders(tx, TODAY)).count).toBe(0);
      const sup = (await tx.query.suppliers.findFirst())!;
      const mk = (
        number: string,
        status: "sent" | "partially_received" | "received" | "draft",
        expectedAt: string,
      ) =>
        tx
          .insert(schema.purchaseOrders)
          .values({ number, supplierId: sup.id, orderedAt: "2026-09-20", expectedAt, status });
      await mk("OC-T1", "sent", "2026-09-30"); // 2 días de atraso
      await mk("OC-T2", "partially_received", "2026-09-25");
      await mk("OC-T3", "received", "2026-09-20"); // ya llegó
      await mk("OC-T4", "draft", "2026-09-20"); // todavía no se mandó
      await mk("OC-T5", "sent", "2026-10-02"); // hoy: no está atrasada
      await mk("OC-T6", "sent", "2026-10-09");
      const late = await getLateSupplierOrders(tx, TODAY);
      expect(late.count).toBe(2);
      expect(late.items.map((i) => [i.number, i.daysLate])).toEqual([
        ["OC-T2", 7],
        ["OC-T1", 2],
      ]);
      const d = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(d.alerts.find((a) => a.id === "late-suppliers")).toMatchObject({
        count: 2,
        href: "/compras/ordenes",
        financial: false,
      });
    });
  });

  it("aumentos de precio: más del umbral contra la compra anterior del mismo proveedor, en los últimos 30 días", async () => {
    await inRollback("nahuel", async (tx) => {
      expect(await getPriceIncreases(tx, TODAY, 5)).toEqual([]);
      const leche = (await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.name, "Leche") }))!;
      const manteca = (await tx.query.ingredients.findFirst({
        where: eq(schema.ingredients.name, "Manteca"),
      }))!;
      // Leche: 1.066 (29/09) → 1.173,6 (01/10) = +10,1 %. Manteca: 9.800 → 10.100 = +3,1 %: no llega al 5 %.
      await newPrice(tx, leche.id, "2026-10-01", 1173.6);
      await newPrice(tx, manteca.id, "2026-10-01", 10100);
      const r = await getPriceIncreases(tx, TODAY, 5);
      expect(r.map((x) => [x.name, x.pct])).toEqual([["Leche", 10.09]]);
      expect((await getPriceIncreases(tx, TODAY, 3)).map((x) => x.name)).toEqual(["Leche", "Manteca"]);

      const d = await getDashboard(tx, { today: TODAY, includeFinance: true });
      const alert = d.alerts.find((a) => a.id === "price-increases")!;
      expect(alert).toMatchObject({ count: 1, href: `/compras/precios/${leche.id}`, financial: false });
      expect(alert.detail).toBe("Leche +10,1 %");

      // Con el umbral de la configuración en 3 % son dos y el link va al listado.
      await tx.insert(schema.appSettings).values({ key: "alerts.price_increase_pct", value: 3 });
      const d3 = await getDashboard(tx, { today: TODAY, includeFinance: true });
      expect(d3.alerts.find((a) => a.id === "price-increases")).toMatchObject({
        count: 2,
        href: "/compras/precios",
      });
    });
  });

  it("aumentos de precio: sólo para quien ve finanzas o compras; no lleva montos", async () => {
    await inRollback("af", async (tx) => {
      const leche = (await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.name, "Leche") }))!;
      await newPrice(tx, leche.id, "2026-10-01", 1500);
      const without = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(without.priceIncreases).toBeNull();
      expect(without.alerts.some((a) => a.id === "price-increases")).toBe(false);
      // La jefa de producción tiene compras:read pero no finanzas: lo ve, sin un solo monto.
      const jefa = await getDashboard(tx, { today: TODAY, includeFinance: false, includePrices: true });
      const a = jefa.alerts.find((x) => x.id === "price-increases")!;
      expect(a.detail).not.toContain("$");
      expect(a.detail).toMatch(/Leche \+\d/);
      expect(jefa.financial).toBeNull();
    });
  });

  it("pedidos del próximo día hábil sin preparar: sin terminar, o listos sin ruta", async () => {
    await inRollback("af", async (tx) => {
      // Viernes 02/10: el próximo día hábil es el lunes 05/10 (Club Náutico, confirmado).
      const n = await getNextDayOrders(tx, TODAY, [1, 2, 3, 4, 5]);
      expect(n).toMatchObject({ date: "2026-10-05", isTomorrow: false, notReady: 1, readyWithoutRoute: 0 });
      expect(n.items[0]!.customer).toContain("Náutico");
      const d = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(d.alerts.find((a) => a.id === "tomorrow-orders")).toMatchObject({
        label: "Pedidos del lunes sin preparar",
        count: 1,
        href: "/pedidos",
        financial: false,
      });

      // Listo pero sin ruta armada: se resuelve en despacho.
      await tx.update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.number, 8));
      const ready = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(ready.alerts.find((a) => a.id === "tomorrow-orders")).toMatchObject({
        count: 1,
        href: "/despacho/nueva",
      });
      expect(ready.operational.nextDayOrders).toMatchObject({ notReady: 0, readyWithoutRoute: 1 });

      // Con ruta armada (no cancelada) ya no es una alerta.
      const order = (await tx.query.orders.findFirst({ where: eq(schema.orders.number, 8) }))!;
      const [route] = await tx.insert(schema.routes).values({ date: "2026-10-05" }).returning();
      await tx.insert(schema.routeStops).values({
        routeId: route!.id,
        seq: 1,
        kind: "delivery",
        orderId: order.id,
        customerId: order.customerId,
      });
      expect((await getNextDayOrders(tx, TODAY, [1, 2, 3, 4, 5])).readyWithoutRoute).toBe(0);
      const routed = await getDashboard(tx, { today: TODAY, includeFinance: false });
      expect(routed.alerts.some((a) => a.id === "tomorrow-orders")).toBe(false);

      // Si la ruta se cancela vuelve a aparecer.
      await tx.update(schema.routes).set({ status: "cancelled" }).where(eq(schema.routes.id, route!.id));
      expect((await getNextDayOrders(tx, TODAY, [1, 2, 3, 4, 5])).readyWithoutRoute).toBe(1);
    });
  });

  it("jueves: el próximo día hábil es mañana y la alerta lo dice", async () => {
    await inRollback("af", async (tx) => {
      await tx.update(schema.orders).set({ promisedDate: "2026-10-02" }).where(eq(schema.orders.number, 8));
      const d = await getDashboard(tx, { today: "2026-10-01", includeFinance: false });
      expect(d.alerts.find((a) => a.id === "tomorrow-orders")).toMatchObject({
        label: "Pedidos de mañana sin preparar",
        count: 1,
      });
    });
  });

  it("deja un lugar para las alertas del local: se suman a las del panel", async () => {
    await inRollback("af", async (tx) => {
      const op = await getOperationalDashboard(tx, { today: TODAY });
      const store = {
        id: "store-stock",
        severity: "warn" as const,
        label: "Local bajo el mínimo",
        count: 2,
        detail: "Chipá 0,5 kg",
        href: "/local",
        financial: false,
      };
      const ids = buildAlerts(op, null, { store: [store] }).map((a) => a.id);
      expect(ids).toContain("store-stock");
      expect(buildAlerts(op, null).map((a) => a.id)).not.toContain("store-stock");
    });
  });
});

export type { Executor };
