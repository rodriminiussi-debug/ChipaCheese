import { describe, expect, it } from "vitest";
import {
  costPerBag,
  costPerKg,
  ingredientsCost,
  laborCostPerRun,
  marginPct,
  marginPerUnit,
  priceForMargin,
} from "./costing";
import { bagsEquivalent } from "./units";
import { COST_LINES, COST_LINES_LIST_PRICES } from "./test-fixtures";

const LABOR = laborCostPerRun({ workers: 4, hours: 6, hourlyCost: 5000 });

describe("ingredientsCost / laborCostPerRun", () => {
  it("costo de ingredientes por producción = $791.930", () => {
    expect(ingredientsCost(COST_LINES)).toBe(791930);
  });
  it("con los precios por kg redondeados del relevamiento difiere en menos de $5", () => {
    expect(Math.abs(ingredientsCost(COST_LINES_LIST_PRICES) - 791930)).toBeLessThan(5);
  });
  it("sin líneas → 0", () => {
    expect(ingredientsCost([])).toBe(0);
  });
  it("mano de obra: 4 × 6 × $5.000 = $120.000", () => {
    expect(LABOR).toBe(120000);
  });
});

describe("costPerKg (Regla 8)", () => {
  it("con 149,3 kg reales + mano de obra ≈ $6.108/kg", () => {
    const c = costPerKg({ lines: COST_LINES, producedKg: 149.3, laborCost: LABOR });
    expect(c).toBeCloseTo((791930 + 120000) / 149.3, 2);
    expect(Math.round(c)).toBe(6108);
  });
  it("error 1 del Excel: usar 163,5 kg (suma de ingredientes) subestima el costo", () => {
    const real = costPerKg({ lines: COST_LINES, producedKg: 149.3, laborCost: 0 });
    const excel = costPerKg({ lines: COST_LINES, producedKg: 163.5, laborCost: 0 });
    expect(Math.round(excel)).toBe(4844); // cifra del relevamiento
    expect(real).toBeGreaterThan(excel);
    expect((real - excel) / real).toBeCloseTo(0.087, 2); // ~9% abajo
  });
  it("producedKg <= 0 lanza error", () => {
    expect(() => costPerKg({ lines: COST_LINES, producedKg: 0, laborCost: 0 })).toThrow(RangeError);
    expect(() => costPerKg({ lines: COST_LINES, producedKg: -1, laborCost: 0 })).toThrow(RangeError);
  });
});

describe("costPerBag (Regla 8)", () => {
  it("con rendimiento real (149,3 kg) + envase $140", () => {
    const perKg = costPerKg({ lines: COST_LINES, producedKg: 149.3, laborCost: LABOR });
    const bag = costPerBag({ costPerKg: perKg, packagingCostPerBag: 140 });
    expect(bag).toBeCloseTo(perKg * 0.5 + 140, 2);
    expect(Math.round(bag)).toBe(3194);
  });
  it("con las 297 bolsas del Excel (148,5 kg) reproduce el costo directo ≈ $3.210", () => {
    const kg = 297 * 0.5;
    expect(kg).toBe(148.5);
    const perKg = costPerKg({ lines: COST_LINES, producedKg: kg, laborCost: LABOR });
    const bag = costPerBag({ costPerKg: perKg, packagingCostPerBag: 140 });
    expect(Math.round(bag)).toBe(3210);
    // desglose del relevamiento: $2.666 ingredientes + $404 mano de obra + $140 envase
    expect(Math.round(791930 / bagsEquivalent(kg))).toBe(2666);
    expect(Math.round(LABOR / bagsEquivalent(kg))).toBe(404);
  });
  it("bolsa de otro peso (granel 5 kg)", () => {
    expect(costPerBag({ costPerKg: 6000, bagKg: 5, packagingCostPerBag: 200 })).toBe(30200);
  });
});

describe("priceForMargin / marginPct / marginPerUnit (Regla 9)", () => {
  it("priceForMargin(3210, 24) ≈ 4.223,68", () => {
    expect(priceForMargin(3210, 24)).toBe(4223.68);
  });
  it("margen 0% → precio = costo", () => {
    expect(priceForMargin(3210, 0)).toBe(3210);
  });
  it("rechaza margen fuera de [0, 100)", () => {
    expect(() => priceForMargin(3210, 100)).toThrow(RangeError);
    expect(() => priceForMargin(3210, 150)).toThrow(RangeError);
    expect(() => priceForMargin(3210, -1)).toThrow(RangeError);
  });
  it("marginPct(4200, 3210) ≈ 23,57", () => {
    expect(marginPct(4200, 3210)).toBe(23.57);
    expect(marginPct(4500, 3210)).toBe(28.67);
    expect(marginPct(4800, 3210)).toBe(33.13);
  });
  it("precio bajo costo → margen negativo (distribuidor BA: $3.150 vs $3.210)", () => {
    expect(marginPct(3150, 3210)).toBe(-1.9);
  });
  it("marginPct rechaza precio <= 0", () => {
    expect(() => marginPct(0, 100)).toThrow(RangeError);
  });
  it("margen por bolsa: $990 / $1.290 / $1.590", () => {
    expect(marginPerUnit(4200, 3210)).toBe(990);
    expect(marginPerUnit(4500, 3210)).toBe(1290);
    expect(marginPerUnit(4800, 3210)).toBe(1590);
  });
});
