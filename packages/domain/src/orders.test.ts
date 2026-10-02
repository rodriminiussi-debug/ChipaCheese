import { describe, expect, it } from "vitest";
import {
  allocateBacklogKg,
  averageOrderIntervalDays,
  canTransition,
  currentUnitPrice,
  daysSinceLastOrder,
  estimateBigOrderDate,
  isCustomerOverdue,
  isOrderEditable,
  isOrderOverdue,
  nextDeliveryDate,
  nextStatuses,
  ORDER_STATUSES,
  orderKg,
  orderTotal,
  type OrderStatus,
} from "./orders";
import { bagsEquivalent } from "./units";

describe("order status machine (RF-03)", () => {
  it("avanza secuencialmente y permite saltar hacia adelante", () => {
    expect(canTransition("received", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "in_production")).toBe(true);
    expect(canTransition("ready", "dispatched")).toBe(true);
    expect(canTransition("ready", "delivered")).toBe(true);
    expect(canTransition("received", "paid")).toBe(true);
    expect(canTransition("delivered", "invoiced")).toBe(true);
    expect(canTransition("invoiced", "paid")).toBe(true);
  });
  it("nunca retrocede ni repite estado", () => {
    expect(canTransition("ready", "confirmed")).toBe(false);
    expect(canTransition("paid", "invoiced")).toBe(false);
    expect(canTransition("ready", "ready")).toBe(false);
  });
  it("se puede cancelar hasta antes de entregar", () => {
    for (const s of ["received", "confirmed", "in_production", "ready", "dispatched"] as const) {
      expect(canTransition(s, "cancelled")).toBe(true);
    }
  });
  it("no se cancela lo entregado, facturado o cobrado; cancelled y paid son finales", () => {
    for (const s of ["delivered", "invoiced", "paid", "cancelled"] as const) {
      expect(canTransition(s, "cancelled")).toBe(false);
    }
    for (const to of ORDER_STATUSES) {
      expect(canTransition("paid", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });
  it("nextStatuses lista las transiciones posibles", () => {
    expect(nextStatuses("invoiced")).toEqual(["paid"]);
    expect(nextStatuses("paid")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
    const fromReady: OrderStatus[] = ["dispatched", "delivered", "invoiced", "paid", "cancelled"];
    expect(nextStatuses("ready")).toEqual(fromReady);
  });
});

describe("orderKg", () => {
  it("850 bolsas de 0,5 kg = 425 kg", () => {
    expect(orderKg([{ qtyUnits: 850, netWeightKg: 0.5 }])).toBe(425);
    expect(bagsEquivalent(425)).toBe(850);
  });
  it("mezcla de bolsas de 0,5 kg y de 5 kg granel", () => {
    expect(
      orderKg([
        { qtyUnits: 100, netWeightKg: 0.5 },
        { qtyUnits: 3, netWeightKg: 5 },
      ]),
    ).toBe(65);
    expect(orderKg([])).toBe(0);
  });
});

describe("frecuencia de cliente (RF-04)", () => {
  const dates = ["2026-09-15", "2026-09-01", "2026-09-08"]; // desordenadas
  it("promedio de días entre pedidos consecutivos", () => {
    expect(averageOrderIntervalDays(dates)).toBe(7);
    expect(averageOrderIntervalDays(["2026-09-01", "2026-09-04", "2026-09-14"])).toBe(6.5);
  });
  it("menos de 2 pedidos → null", () => {
    expect(averageOrderIntervalDays([])).toBeNull();
    expect(averageOrderIntervalDays(["2026-09-01"])).toBeNull();
  });
  it("días desde el último pedido", () => {
    expect(daysSinceLastOrder(dates, "2026-09-30")).toBe(15);
    expect(daysSinceLastOrder([], "2026-09-30")).toBeNull();
  });
  it("cliente demorado: más de promedio × 1,5", () => {
    // promedio 7 → umbral 10,5 días
    expect(isCustomerOverdue({ orderDates: dates, today: "2026-09-25" })).toBe(false); // 10 días
    expect(isCustomerOverdue({ orderDates: dates, today: "2026-09-26" })).toBe(true); // 11 días
    expect(isCustomerOverdue({ orderDates: dates, today: "2026-09-22", toleranceFactor: 1 })).toBe(false); // 7 días, no supera 7
    expect(isCustomerOverdue({ orderDates: dates, today: "2026-09-23", toleranceFactor: 1 })).toBe(true);
  });
  it("sin historial suficiente nunca está demorado", () => {
    expect(isCustomerOverdue({ orderDates: ["2026-01-01"], today: "2026-09-30" })).toBe(false);
    expect(isCustomerOverdue({ orderDates: [], today: "2026-09-30" })).toBe(false);
  });
});

describe("estimateBigOrderDate (Regla 10 / RF-05)", () => {
  const monday = "2026-09-28";

  it("425 kg, stock 0, capacidad 150, desde un lunes → 150+150+125 y entrega el jueves", () => {
    const r = estimateBigOrderDate({ orderKg: 425, finishedStockKg: 0, today: monday });
    expect(r.schedule).toEqual([
      { date: "2026-09-28", kg: 150 },
      { date: "2026-09-29", kg: 150 },
      { date: "2026-09-30", kg: 125 },
    ]);
    expect(r.date).toBe("2026-10-01"); // jueves
  });

  it("con stock 100 kg el faltante (325 kg) sigue necesitando 3 días de producción", () => {
    const r = estimateBigOrderDate({ orderKg: 425, finishedStockKg: 100, today: monday });
    expect(r.schedule.map((s) => s.kg)).toEqual([150, 150, 25]);
    expect(r.date).toBe("2026-10-01");
  });

  it("con más stock se necesitan menos días", () => {
    const two = estimateBigOrderDate({ orderKg: 425, finishedStockKg: 130, today: monday });
    expect(two.schedule.map((s) => s.kg)).toEqual([150, 145]);
    expect(two.date).toBe("2026-09-30"); // miércoles
    const one = estimateBigOrderDate({ orderKg: 425, finishedStockKg: 275, today: monday });
    expect(one.schedule).toEqual([{ date: "2026-09-28", kg: 150 }]);
    expect(one.date).toBe("2026-09-29");
  });

  it("si el stock alcanza, la fecha es hoy y no hay producción", () => {
    expect(estimateBigOrderDate({ orderKg: 425, finishedStockKg: 425, today: monday })).toEqual({
      date: monday,
      schedule: [],
    });
    expect(estimateBigOrderDate({ orderKg: 0, finishedStockKg: 0, today: monday }).date).toBe(monday);
  });

  it("respeta los fines de semana", () => {
    // jueves 01/10: produce jueves, viernes y lunes 05/10 → disponible el martes 06/10
    const r = estimateBigOrderDate({ orderKg: 425, finishedStockKg: 0, today: "2026-10-01" });
    expect(r.schedule.map((s) => s.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
    expect(r.date).toBe("2026-10-06");
  });

  it("si hoy es sábado arranca el lunes", () => {
    const r = estimateBigOrderDate({ orderKg: 100, finishedStockKg: 0, today: "2026-10-03" });
    expect(r.schedule).toEqual([{ date: "2026-10-05", kg: 100 }]);
    expect(r.date).toBe("2026-10-06");
  });

  it("con sábados hábiles", () => {
    const r = estimateBigOrderDate({
      orderKg: 300,
      finishedStockKg: 0,
      today: "2026-10-02", // viernes
      workdays: [1, 2, 3, 4, 5, 6],
    });
    expect(r.schedule.map((s) => s.date)).toEqual(["2026-10-02", "2026-10-03"]);
    expect(r.date).toBe("2026-10-04");
  });

  it("descuenta los kg ya comprometidos y saltea días llenos", () => {
    const r = estimateBigOrderDate({
      orderKg: 425,
      finishedStockKg: 0,
      today: monday,
      committedKgByDate: { "2026-09-28": 100, "2026-09-29": 150, "2026-09-30": 0 },
    });
    expect(r.schedule).toEqual([
      { date: "2026-09-28", kg: 50 },
      { date: "2026-09-30", kg: 150 },
      { date: "2026-10-01", kg: 150 },
      { date: "2026-10-02", kg: 75 },
    ]);
    expect(r.date).toBe("2026-10-03");
  });

  it("freezeDays y capacidad configurables", () => {
    const r = estimateBigOrderDate({
      orderKg: 200,
      finishedStockKg: 0,
      today: monday,
      capacityKg: 100,
      freezeDays: 2,
    });
    expect(r.schedule).toEqual([
      { date: "2026-09-28", kg: 100 },
      { date: "2026-09-29", kg: 100 },
    ]);
    expect(r.date).toBe("2026-10-01");
    expect(
      estimateBigOrderDate({ orderKg: 100, finishedStockKg: 0, today: monday, freezeDays: 0 }).date,
    ).toBe(monday);
  });

  it("null si no alcanza dentro de maxDays", () => {
    const r = estimateBigOrderDate({
      orderKg: 1000,
      finishedStockKg: 0,
      today: monday,
      maxDays: 7,
    });
    expect(r.date).toBeNull();
    expect(r.schedule).toHaveLength(5); // 5 días hábiles de 7 corridos
    expect(r.schedule.reduce((a, s) => a + s.kg, 0)).toBe(750);
  });

  it("con 60 días por defecto un pedido enorme da null", () => {
    expect(estimateBigOrderDate({ orderKg: 100000, finishedStockKg: 0, today: monday }).date).toBeNull();
  });
});

describe("edición y atraso del pedido (RF-03)", () => {
  it("solo se editan ítems en recibido o confirmado", () => {
    expect(isOrderEditable("received")).toBe(true);
    expect(isOrderEditable("confirmed")).toBe(true);
    for (const s of ["in_production", "ready", "dispatched", "delivered", "invoiced", "paid", "cancelled"] as const) {
      expect(isOrderEditable(s)).toBe(false);
    }
  });
  it("atrasado = fecha comprometida < hoy y no entregado", () => {
    const base = { promisedDate: "2026-10-01", today: "2026-10-02" };
    expect(isOrderOverdue({ ...base, status: "confirmed" })).toBe(true);
    expect(isOrderOverdue({ ...base, status: "dispatched" })).toBe(true);
    expect(isOrderOverdue({ ...base, status: "delivered" })).toBe(false);
    expect(isOrderOverdue({ ...base, status: "paid" })).toBe(false);
    expect(isOrderOverdue({ ...base, status: "cancelled" })).toBe(false);
    // la fecha de hoy todavía no está atrasada
    expect(isOrderOverdue({ promisedDate: "2026-10-02", today: "2026-10-02", status: "received" })).toBe(false);
  });
});

describe("fecha de entrega por defecto (RF-02)", () => {
  // 2026-10-02 es viernes
  it("sin días definidos → mañana", () => {
    expect(nextDeliveryDate({ today: "2026-10-02", weekdays: [] })).toBe("2026-10-03");
  });
  it("primer día de entrega desde mañana (nunca hoy)", () => {
    // lun-mié-vie: pedido el viernes → lunes 05/10
    expect(nextDeliveryDate({ today: "2026-10-02", weekdays: [1, 3, 5] })).toBe("2026-10-05");
    // solo viernes: hoy es viernes → el viernes siguiente
    expect(nextDeliveryDate({ today: "2026-10-02", weekdays: [5] })).toBe("2026-10-09");
    // solo martes
    expect(nextDeliveryDate({ today: "2026-10-02", weekdays: [2] })).toBe("2026-10-06");
    // sábado y domingo
    expect(nextDeliveryDate({ today: "2026-10-02", weekdays: [7] })).toBe("2026-10-04");
  });
  it("ignora días inválidos", () => {
    expect(nextDeliveryDate({ today: "2026-10-02", weekdays: [0, 9] })).toBe("2026-10-03");
  });
});

describe("precio vigente y total (RF-02)", () => {
  const prices = [
    { validFrom: "2026-09-01", unitPrice: 4200 },
    { validFrom: "2026-10-01", unitPrice: 4500 },
    { validFrom: "2026-11-01", unitPrice: 5000 },
  ];
  it("toma el último validFrom que no sea futuro", () => {
    expect(currentUnitPrice(prices, "2026-09-15")).toBe(4200);
    expect(currentUnitPrice(prices, "2026-10-01")).toBe(4500);
    expect(currentUnitPrice(prices, "2026-10-02")).toBe(4500);
    expect(currentUnitPrice(prices, "2026-12-01")).toBe(5000);
  });
  it("sin precio vigente → null", () => {
    expect(currentUnitPrice(prices, "2026-08-31")).toBeNull();
    expect(currentUnitPrice([], "2026-10-01")).toBeNull();
  });
  it("total del pedido", () => {
    expect(
      orderTotal([
        { qtyUnits: 20, unitPrice: 4200 },
        { qtyUnits: 10, unitPrice: 4200.5 },
      ]),
    ).toBe(126005);
    expect(orderTotal([])).toBe(0);
  });
});

describe("allocateBacklogKg (RF-05)", () => {
  it("reparte la deuda de producción en los primeros días hábiles con capacidad", () => {
    // jueves 01/10: 100 kg el jueves, 150 el viernes, 50 el lunes
    const r = allocateBacklogKg({
      backlogKg: 300,
      today: "2026-10-01",
      committedKgByDate: { "2026-10-01": 50 },
    });
    expect(r).toEqual({ "2026-10-01": 150, "2026-10-02": 150, "2026-10-05": 50 });
  });
  it("sin deuda devuelve lo comprometido tal cual", () => {
    expect(allocateBacklogKg({ backlogKg: 0, today: "2026-10-01" })).toEqual({});
  });
  it("respeta capacidad y días hábiles configurados, y descarta lo que no entra", () => {
    const r = allocateBacklogKg({
      backlogKg: 1000,
      today: "2026-10-02",
      capacityKg: 100,
      workdays: [5],
      maxDays: 10,
    });
    expect(r).toEqual({ "2026-10-02": 100, "2026-10-09": 100 });
  });
});
