import { describe, expect, it } from "vitest";
import { capacityUsagePct, monthlyResult, onTimeInFullRate } from "./finance";

describe("monthlyResult (RF-40)", () => {
  it("estimación del relevamiento: ventas $18,9M → resultado ≈ $2,9M", () => {
    const r = monthlyResult({
      salesByChannel: { revendedores: 12_600_000, supermercados: 4_200_000, local: 2_100_000 },
      costOfSales: 12_350_000,
      labor: 2_640_000,
      fixed: 1_040_000,
      delivery: 0,
    });
    expect(r).toEqual({
      sales: 18_900_000,
      grossMargin: 6_550_000,
      result: 2_870_000,
      resultPct: 15.19,
    });
  });
  it("resta reparto y otros; puede dar pérdida", () => {
    const r = monthlyResult({
      salesByChannel: { a: 1000 },
      costOfSales: 600,
      labor: 300,
      fixed: 100,
      delivery: 50,
      other: 25,
    });
    expect(r.result).toBe(-75);
    expect(r.resultPct).toBe(-7.5);
  });
  it("sin ventas: resultPct null", () => {
    expect(monthlyResult({ salesByChannel: {}, costOfSales: 0, labor: 0, fixed: 1000, delivery: 0 })).toEqual(
      { sales: 0, grossMargin: 0, result: -1000, resultPct: null },
    );
  });
});

describe("capacityUsagePct", () => {
  it('~100 kg/día sobre 150 kg = 66,7% (el "~67%" del relevamiento)', () => {
    expect(capacityUsagePct(100 * 22, 22)).toBe(66.7);
    expect(capacityUsagePct(150, 1)).toBe(100);
  });
  it("capacidad personalizada y casos inválidos", () => {
    expect(capacityUsagePct(50, 1, 100)).toBe(50);
    expect(capacityUsagePct(100, 0)).toBeNull();
    expect(capacityUsagePct(100, 5, 0)).toBeNull();
  });
});

describe("onTimeInFullRate", () => {
  it("pedidos OK ÷ pedidos entregados", () => {
    expect(
      onTimeInFullRate([
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-10", complete: true }, // ok
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-09", complete: true }, // ok (antes)
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-11", complete: true }, // tarde
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-10", complete: false }, // incompleto
        { promisedDate: "2026-09-10", deliveredDate: null, complete: true }, // no cuenta
      ]),
    ).toBe(50);
  });
  it("sin entregas → null", () => {
    expect(onTimeInFullRate([])).toBeNull();
    expect(
      onTimeInFullRate([{ promisedDate: "2026-09-10", deliveredDate: null, complete: false }]),
    ).toBeNull();
  });
  it("1 decimal", () => {
    expect(
      onTimeInFullRate([
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-10", complete: true },
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-12", complete: true },
        { promisedDate: "2026-09-10", deliveredDate: "2026-09-12", complete: true },
      ]),
    ).toBe(33.3);
  });
});
