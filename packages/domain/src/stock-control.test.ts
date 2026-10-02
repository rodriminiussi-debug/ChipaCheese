import { describe, expect, it } from "vitest";
import {
  classifyCoverage,
  compareCoverageUrgency,
  countDifference,
  expiryAlert,
  maxStarchKg,
  simulateProduction,
  valueDifference,
} from "./stock-control";
import { RECIPE } from "./test-fixtures";

describe("classifyCoverage (RF-14)", () => {
  const base = { minStock: 10, avgDailyConsumption: 2, reorderPoint: 30 };
  it("sin stock cuando el saldo es 0 o negativo", () => {
    expect(classifyCoverage({ ...base, stock: 0 })).toBe("out_of_stock");
    expect(classifyCoverage({ ...base, stock: -3 })).toBe("out_of_stock");
  });
  it("reponer al llegar al punto de pedido (inclusive)", () => {
    expect(classifyCoverage({ ...base, stock: 30 })).toBe("reorder");
    expect(classifyCoverage({ ...base, stock: 12 })).toBe("reorder");
    expect(classifyCoverage({ ...base, stock: 31 })).toBe("ok");
  });
  it("reponer también si está por debajo del mínimo aunque el punto de pedido sea menor", () => {
    expect(classifyCoverage({ stock: 5, minStock: 10, avgDailyConsumption: 0, reorderPoint: 1 })).toBe(
      "reorder",
    );
  });
  it("sin consumo cuando no hay consumo y el stock está sano", () => {
    expect(classifyCoverage({ stock: 100, minStock: 10, avgDailyConsumption: 0, reorderPoint: 5 })).toBe(
      "no_consumption",
    );
  });
});

describe("compareCoverageUrgency", () => {
  it("ordena sin stock → reponer → ok → sin consumo y por cobertura ascendente", () => {
    const rows = [
      { id: "nc", status: "no_consumption" as const, coverageDays: null },
      { id: "ok20", status: "ok" as const, coverageDays: 20 },
      { id: "ok5", status: "ok" as const, coverageDays: 5 },
      { id: "r3", status: "reorder" as const, coverageDays: 3 },
      { id: "r1", status: "reorder" as const, coverageDays: 1 },
      { id: "out", status: "out_of_stock" as const, coverageDays: 0 },
      { id: "rnull", status: "reorder" as const, coverageDays: null },
      { id: "r3b", status: "reorder" as const, coverageDays: 3 },
    ];
    rows.sort(compareCoverageUrgency);
    expect(rows.map((r) => r.id)).toEqual(["out", "r1", "r3", "r3b", "rnull", "ok5", "ok20", "nc"]);
  });
});

describe("expiryAlert (RF-13)", () => {
  it("sin vencimiento no alerta", () => {
    expect(expiryAlert(null, "2026-10-02")).toEqual({ daysLeft: null, level: "none" });
  });
  it("alerta con 7 días o menos, vencido y ok", () => {
    expect(expiryAlert("2026-10-09", "2026-10-02")).toEqual({ daysLeft: 7, level: "soon" });
    expect(expiryAlert("2026-10-10", "2026-10-02")).toEqual({ daysLeft: 8, level: "ok" });
    expect(expiryAlert("2026-10-02", "2026-10-02")).toEqual({ daysLeft: 0, level: "soon" });
    expect(expiryAlert("2026-10-01", "2026-10-02")).toEqual({ daysLeft: -1, level: "expired" });
  });
  it("el umbral es configurable", () => {
    expect(expiryAlert("2026-10-20", "2026-10-02", 30).level).toBe("soon");
  });
});

describe("diferencias de inventario (RF-15)", () => {
  it("contado − sistema, sin ruido de punto flotante", () => {
    expect(countDifference(8.1, 7.1)).toBe(-1);
    expect(countDifference(0.1 + 0.2, 0.3)).toBe(0);
    expect(countDifference(10, 12.5)).toBe(2.5);
  });
  it("valoriza con el último precio sin IVA o devuelve null sin precio", () => {
    expect(valueDifference(-1, 708)).toBe(-708);
    expect(valueDifference(2.5, 9880.33)).toBe(24700.83);
    expect(valueDifference(3, null)).toBeNull();
    expect(valueDifference(3, undefined)).toBeNull();
  });
});

describe("simulador (RF-17)", () => {
  const stock = {
    queso_barra: 28,
    reggianito: 32,
    manteca: 15,
    fecula: 150,
    huevo: 22,
    leche: 36,
    sal: 8.1,
  };

  it("maxStarchKg: manda el insumo más escaso (manteca 15 ÷ 0,2 = 75 kg)", () => {
    expect(maxStarchKg(RECIPE, stock)).toBe(75);
  });
  it("maxStarchKg: 0 si falta un insumo, ignora líneas en 0 y receta vacía", () => {
    expect(maxStarchKg(RECIPE, { ...stock, huevo: 0 })).toBe(0);
    expect(maxStarchKg(RECIPE, { ...stock, huevo: -4 })).toBe(0);
    expect(maxStarchKg([], stock)).toBe(0);
    expect(maxStarchKg([{ ingredientId: "x", qtyPerKgStarch: 0 }], stock)).toBe(0);
    expect(maxStarchKg([{ ingredientId: "fecula", qtyPerKgStarch: 1 }], { fecula: 150 })).toBe(150);
    expect(maxStarchKg(RECIPE, {})).toBe(0);
  });

  it("alcanza: 75 kg de fécula con el stock de arriba", () => {
    const r = simulateProduction({
      starchKg: 75,
      lines: RECIPE,
      stockByIngredient: stock,
      expectedYieldPerKgStarch: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.lines.every((l) => l.ok && l.shortfall === 0)).toBe(true);
    expect(r.lines.find((l) => l.ingredientId === "queso_barra")).toEqual({
      ingredientId: "queso_barra",
      needed: 22.5,
      available: 28,
      shortfall: 0,
      ok: true,
    });
    expect(r.maxStarchKg).toBe(75);
    expect(r.maxProductKg).toBe(150);
    expect(r.completeRecipes).toBe(1);
  });

  it("falta: 150 kg de fécula exige más manteca de la que hay", () => {
    const r = simulateProduction({
      starchKg: 150,
      lines: RECIPE,
      stockByIngredient: stock,
      expectedYieldPerKgStarch: 1.99,
    });
    expect(r.ok).toBe(false);
    const manteca = r.lines.find((l) => l.ingredientId === "manteca")!;
    expect(manteca).toMatchObject({ needed: 30, available: 15, shortfall: 15, ok: false });
    expect(r.lines.filter((l) => !l.ok).map((l) => l.ingredientId)).toEqual([
      "queso_barra",
      "manteca",
      "huevo",
      "leche",
    ]);
    expect(r.maxProductKg).toBe(149.25);
  });

  it("varias recetas completas con stock abundante", () => {
    const r = simulateProduction({
      starchKg: 0,
      lines: RECIPE,
      stockByIngredient: {
        queso_barra: 100,
        reggianito: 100,
        manteca: 100,
        fecula: 400,
        huevo: 100,
        leche: 200,
        sal: 20,
      },
      expectedYieldPerKgStarch: 2,
      starchKgPerRecipe: 75,
    });
    expect(r.ok).toBe(true);
    expect(r.completeRecipes).toBe(4);
  });
});
