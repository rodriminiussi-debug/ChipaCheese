import { describe, expect, it } from "vitest";
import {
  expiringLots,
  priceIncreases,
  lastWeekStarts,
  monthSeriesEnd,
  pricesAsOf,
  reorderPointDays,
  sharePct,
  weekStart,
} from "./dashboard";

describe("semanas", () => {
  it("el lunes de cada fecha", () => {
    expect(weekStart("2026-10-02")).toBe("2026-09-28"); // viernes
    expect(weekStart("2026-09-28")).toBe("2026-09-28"); // lunes
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // domingo
  });
  it("últimas semanas, de la más vieja a la actual", () => {
    expect(lastWeekStarts("2026-10-02", 3)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(lastWeekStarts("2026-10-02", 0)).toEqual([]);
  });
});

describe("monthSeriesEnd", () => {
  it("fin de mes, o hoy si el mes no terminó", () => {
    expect(monthSeriesEnd("2026-08", "2026-10-02")).toBe("2026-08-31");
    expect(monthSeriesEnd("2026-02", "2026-10-02")).toBe("2026-02-28");
    expect(monthSeriesEnd("2026-10", "2026-10-02")).toBe("2026-10-02");
  });
});

describe("pricesAsOf", () => {
  const history = [
    { ingredientId: "queso", date: "2026-07-10", unitPriceNet: 100 },
    { ingredientId: "leche", date: "2026-07-15", unitPriceNet: 10 },
    { ingredientId: "queso", date: "2026-08-20", unitPriceNet: 120 },
    { ingredientId: "queso", date: "2026-08-20", unitPriceNet: 125 }, // misma fecha: gana la última cargada
    { ingredientId: "queso", date: "2026-09-05", unitPriceNet: 150 },
  ];
  it("toma la última compra hasta la fecha, inclusive", () => {
    expect(Object.fromEntries(pricesAsOf(history, "2026-07-31"))).toEqual({ queso: 100, leche: 10 });
    expect(Object.fromEntries(pricesAsOf(history, "2026-08-20"))).toEqual({ queso: 125, leche: 10 });
    expect(Object.fromEntries(pricesAsOf(history, "2026-09-30"))).toEqual({ queso: 150, leche: 10 });
  });
  it("sin compras todavía, el insumo no tiene precio", () => {
    expect(pricesAsOf(history, "2026-07-01").size).toBe(0);
  });
});

describe("expiringLots", () => {
  const lots = [
    { lot: "A", name: "Chipá", expiryDate: "2026-10-20", qty: 10 },
    { lot: "B", name: "Chipá", expiryDate: "2026-12-30", qty: 10 },
    { lot: "C", name: "Chipá", expiryDate: "2026-10-01", qty: 4 }, // ya vencido con saldo
    { lot: "D", name: "Envases", expiryDate: null, qty: 100 },
    { lot: "E", name: "Chipá", expiryDate: "2026-10-05", qty: 0 }, // sin saldo
    { lot: "F", name: "Chipá", expiryDate: "2026-11-01", qty: 1 }, // justo a 30 días
  ];
  it("lotes con saldo que vencen en ≤ N días o ya vencidos, el más próximo primero", () => {
    const r = expiringLots(lots, "2026-10-02", 30);
    expect(r.map((l) => [l.lot, l.daysLeft])).toEqual([
      ["C", -1],
      ["A", 18],
      ["F", 30],
    ]);
  });
  it("el umbral manda", () => {
    expect(expiringLots(lots, "2026-10-02", 7).map((l) => l.lot)).toEqual(["C"]);
  });
});

describe("cobertura y participación", () => {
  it("días del punto de pedido", () => {
    expect(reorderPointDays(30, 4)).toBe(7.5);
    expect(reorderPointDays(30, 0)).toBeNull();
  });
  it("sharePct", () => {
    expect(sharePct(1, 3)).toBe(33.3);
    expect(sharePct(1, 0)).toBeNull();
  });
});

describe("priceIncreases", () => {
  const steps = [
    { ingredientId: "q", name: "Queso", date: "2026-09-25", price: 108, previousPrice: 100 }, // +8 %
    { ingredientId: "l", name: "Leche", date: "2026-09-28", price: 104, previousPrice: 100 }, // +4 %: no llega
    { ingredientId: "m", name: "Manteca", date: "2026-08-01", price: 200, previousPrice: 100 }, // vieja
    { ingredientId: "f", name: "Fécula", date: "2026-10-01", price: 112, previousPrice: 100 }, // +12 %
    { ingredientId: "s", name: "Sal", date: "2026-10-01", price: 90, previousPrice: 100 }, // baja
  ];
  it("sólo los que subieron más del umbral en el período, el mayor aumento primero", () => {
    const r = priceIncreases(steps, "2026-10-02", { thresholdPct: 5, days: 30 });
    expect(r.map((x) => [x.name, x.pct])).toEqual([
      ["Fécula", 12],
      ["Queso", 8],
    ]);
  });
  it("un umbral más bajo suma los chicos", () => {
    expect(priceIncreases(steps, "2026-10-02", { thresholdPct: 3, days: 30 }).map((x) => x.name)).toEqual([
      "Fécula",
      "Queso",
      "Leche",
    ]);
  });
});
