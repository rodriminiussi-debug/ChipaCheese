import { describe, expect, it } from "vitest";
import {
  buildConsumptionRows,
  buildShapeDemands,
  canTransitionRun,
  capacityUsage,
  nextRunStatuses,
  splitKgByPlanShape,
  sumKgByPlanShape,
  summarizeRun,
  weekDays,
} from "./production-plan";

describe("conversión de demanda a kg por forma (RF-19)", () => {
  it("el surtido se reparte en partes iguales y sándwich/pizzeta quedan fuera", () => {
    expect(splitKgByPlanShape("mixed", 30)).toEqual({ tapita: 10, arito: 10, lenguita: 10 });
    expect(splitKgByPlanShape("tapita", 5)).toEqual({ tapita: 5 });
    expect(splitKgByPlanShape("sandwich", 9)).toEqual({});
    expect(splitKgByPlanShape("pizzeta", 9)).toEqual({});
  });

  it("suma por forma redondeando a 3 decimales", () => {
    const out = sumKgByPlanShape([
      { shape: "mixed", kg: 10 },
      { shape: "tapita", kg: 1 },
      { shape: "sandwich", kg: 50 },
    ]);
    expect(out).toEqual({ tapita: 4.333, arito: 3.333, lenguita: 3.333 });
  });

  it("arma pendiente, stock y mínimo en kg (unidades × peso neto)", () => {
    const demands = buildShapeDemands({
      pending: [
        { shape: "lenguita", units: 2, netWeightKg: 5 },
        { shape: "mixed", units: 60, netWeightKg: 0.5 },
      ],
      stock: [{ shape: "tapita", units: 160, netWeightKg: 0.5 }],
      minStock: [{ shape: "tapita", units: 60, netWeightKg: 0.5 }],
    });
    expect(demands).toEqual([
      { shape: "tapita", pendingKg: 10, stockKg: 80, minStockKg: 30 },
      { shape: "arito", pendingKg: 10, stockKg: 0, minStockKg: 0 },
      { shape: "lenguita", pendingKg: 20, stockKg: 0, minStockKg: 0 },
    ]);
  });
});

describe("uso de capacidad y semana", () => {
  it("clasifica el uso del abatidor", () => {
    expect(capacityUsage(0, 150)).toEqual({ pct: 0, tone: "neutral" });
    expect(capacityUsage(75, 150)).toEqual({ pct: 50, tone: "good" });
    expect(capacityUsage(140, 150)).toEqual({ pct: 93, tone: "warn" });
    expect(capacityUsage(160, 150)).toEqual({ pct: 107, tone: "bad" });
  });

  it("lista los días hábiles de la semana ISO", () => {
    // 2026-10-02 es viernes
    expect(weekDays("2026-10-02")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(weekDays("2026-10-04", [1, 7])).toEqual(["2026-09-28", "2026-10-04"]);
  });
});

describe("estados de la producción (RF-20)", () => {
  it("solo permite las transiciones del flujo", () => {
    expect(canTransitionRun("planned", "in_progress")).toBe(true);
    expect(canTransitionRun("in_progress", "freezing")).toBe(true);
    expect(canTransitionRun("freezing", "packed")).toBe(true);
    expect(canTransitionRun("packed", "closed")).toBe(true);
    expect(canTransitionRun("planned", "packed")).toBe(false);
    expect(canTransitionRun("closed", "planned")).toBe(false);
    expect(canTransitionRun("packed", "cancelled")).toBe(false);
    expect(nextRunStatuses("cancelled")).toEqual([]);
  });
});

describe("filas de consumo (Regla 2)", () => {
  const lines = [
    { ingredientId: "fecula", qtyPerKgStarch: 1 },
    { ingredientId: "leche", qtyPerKgStarch: 0.4, minPerKgStarch: 0.24, maxPerKgStarch: 0.4 },
    { ingredientId: "queso", qtyPerKgStarch: 0.3 },
  ];

  it("marca fuera de rango con rango de receta o con umbral", () => {
    const rows = buildConsumptionRows({
      lines,
      starchKg: 75,
      thresholdPct: 10,
      entries: [
        { ingredientId: "fecula", rawLotId: "L1", qty: 75 },
        { ingredientId: "leche", rawLotId: null, qty: 31 }, // rango 18–30
        { ingredientId: "queso", rawLotId: "L2", qty: 22 }, // teórico 22,5: -2,2 % → ok
      ],
    });
    expect(rows.find((r) => r.ingredientId === "leche")).toMatchObject({
      qtyTheoretical: 30,
      qtyActual: 31,
      outOfRange: true,
      reason: "above_range",
    });
    expect(rows.find((r) => r.ingredientId === "queso")).toMatchObject({ outOfRange: false });
    const bad = buildConsumptionRows({
      lines,
      starchKg: 75,
      thresholdPct: 10,
      entries: [{ ingredientId: "queso", rawLotId: null, qty: 30 }],
    });
    expect(bad[0]).toMatchObject({ outOfRange: true, reason: "over_threshold" });
  });

  it("reparte el teórico entre lotes del mismo insumo y evalúa el total", () => {
    const rows = buildConsumptionRows({
      lines,
      starchKg: 75,
      thresholdPct: 10,
      entries: [
        { ingredientId: "queso", rawLotId: "A", qty: 10 },
        { ingredientId: "queso", rawLotId: "B", qty: 12.5 },
        { ingredientId: "queso", rawLotId: "C", qty: 0 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((a, r) => a + r.qtyTheoretical, 0)).toBeCloseTo(22.5, 6);
    expect(rows.every((r) => !r.outOfRange)).toBe(true);
  });

  it("rechaza insumos que no están en la receta", () => {
    expect(() =>
      buildConsumptionRows({
        lines,
        starchKg: 75,
        thresholdPct: 10,
        entries: [{ ingredientId: "otro", rawLotId: null, qty: 1 }],
      }),
    ).toThrow(RangeError);
  });
});

describe("rendimiento y merma (Regla 3, RF-21)", () => {
  it("reproduce el registro del 01/09: 149,3 kg pesados sobre 163,5 kg de ingredientes", () => {
    const s = summarizeRun({
      starchKg: 75,
      expectedYieldPerKgStarch: 1.99,
      theoreticalIngredientsKg: 163.5,
      consumptions: [{ qtyActual: 100 }, { qtyActual: 63.5 }],
      weighings: [
        { shape: "tapita", kg: 70.6 },
        { shape: "arito", kg: 10.1 },
        { shape: "lenguita", kg: 68.6 },
      ],
    });
    expect(s.weighedKg).toBe(149.3);
    expect(s.ingredientsKg).toBe(163.5);
    expect(s.ingredientsSource).toBe("actual");
    expect(s.yieldRatio).toBe(0.9131);
    expect(s.lossKg).toBe(14.2);
    expect(s.bags).toBe(298.6);
    expect(s.kgPerKgStarch).toBe(1.991);
    expect(s.expectedWeighedKg).toBe(149.25);
    expect(s.deltaKg).toBe(0.05);
  });

  it("sin consumos usa los kg teóricos de la receta", () => {
    const s = summarizeRun({
      starchKg: 75,
      expectedYieldPerKgStarch: 2,
      theoreticalIngredientsKg: 163.5,
      consumptions: [],
      weighings: [],
    });
    expect(s.ingredientsSource).toBe("theoretical");
    expect(s.weighedKg).toBe(0);
    expect(s.kgPerKgStarch).toBeNull();
  });
});
