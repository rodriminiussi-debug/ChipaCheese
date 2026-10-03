import { describe, expect, it } from "vitest";
import {
  capacityUsagePct,
  deliveryIsComplete,
  monthlyResult,
  onTimeInFullRate,
  pctChange,
  simulateUnitCost,
  withdrawalsCoverage,
  workdaysBetween,
} from "./finance";

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

describe("withdrawalsCoverage (¿el resultado cubre los retiros?)", () => {
  it("el relevamiento: ~$2,9M de resultado contra ~$9M de retiros no alcanza", () => {
    expect(withdrawalsCoverage(2_870_000, 9_000_000)).toEqual({
      covers: false,
      difference: -6_130_000,
      coveragePct: 31.9,
    });
  });
  it("cubre cuando el resultado iguala o supera los retiros", () => {
    expect(withdrawalsCoverage(9_000_000, 9_000_000)).toMatchObject({ covers: true, difference: 0 });
    expect(withdrawalsCoverage(10_500_000, 9_000_000)).toMatchObject({ covers: true, difference: 1_500_000 });
  });
  it("resultado negativo: cobertura negativa; sin retiros: cubre y no hay porcentaje", () => {
    expect(withdrawalsCoverage(-1_000_000, 9_000_000).coveragePct).toBe(-11.1);
    expect(withdrawalsCoverage(100, 0)).toEqual({ covers: true, difference: 100, coveragePct: null });
  });
});

describe("workdaysBetween", () => {
  it("semana en curso lunes a viernes: 28/09 (lun) a 02/10 (vie) = 5", () => {
    expect(workdaysBetween("2026-09-28", "2026-10-02")).toBe(5);
  });
  it("de lunes a miércoles = 3; fin de semana no cuenta; rango invertido = 0", () => {
    expect(workdaysBetween("2026-09-28", "2026-09-30")).toBe(3);
    expect(workdaysBetween("2026-10-03", "2026-10-04")).toBe(0);
    expect(workdaysBetween("2026-10-02", "2026-09-28")).toBe(0);
  });
  it("respeta los días configurados (con sábado)", () => {
    expect(workdaysBetween("2026-09-28", "2026-10-03", [1, 2, 3, 4, 5, 6])).toBe(6);
  });
});

describe("deliveryIsComplete", () => {
  it("completo si se despachó al menos lo pedido de cada producto", () => {
    expect(deliveryIsComplete([{ ordered: 10, dispatched: 10 }])).toBe(true);
    expect(deliveryIsComplete([{ ordered: 10, dispatched: 12 }])).toBe(true);
    expect(deliveryIsComplete([{ ordered: 10, dispatched: 9 }])).toBe(false);
    expect(
      deliveryIsComplete([
        { ordered: 10, dispatched: 10 },
        { ordered: 5, dispatched: 0 },
      ]),
    ).toBe(false);
    expect(deliveryIsComplete([])).toBe(true);
  });
});

describe("pctChange", () => {
  it("variación porcentual con 2 decimales", () => {
    expect(pctChange(200, 190)).toBe(-5);
    expect(pctChange(3, 4)).toBe(33.33);
    expect(pctChange(100, 100)).toBe(0);
  });
  it("base 0 → null", () => {
    expect(pctChange(0, 10)).toBeNull();
  });
});

describe("simulateUnitCost (sensibilidad, RF-39)", () => {
  // Receta del relevamiento (29/09): costo por producción ≈ $791.930; se asumen 150 kg producidos.
  const recipeLines = [
    { ingredientId: "barra", qty: 22.5, unitPriceNet: 9880 }, // 222.300
    { ingredientId: "reggianito", qty: 15, unitPriceNet: 13431 }, // 201.465
    { ingredientId: "manteca", qty: 15, unitPriceNet: 9800 }, // 147.000
    { ingredientId: "fecula", qty: 75, unitPriceNet: 1728 }, // 129.600
    { ingredientId: "huevo", qty: 18, unitPriceNet: 3222 }, // 57.996
    { ingredientId: "leche", qty: 30, unitPriceNet: 1066 }, // 31.980
    { ingredientId: "sal", qty: 2.25, unitPriceNet: 708 }, // 1.593
  ];
  const base = {
    recipeLines,
    laborPerRun: 120_000,
    producedKgPerRun: 150,
    components: [{ ingredientId: "bolsa", qty: 1, unitPriceNet: 140 }],
    netWeightKg: 0.5,
  };

  it("sin cambios reproduce la Regla 8", () => {
    const s = simulateUnitCost({ ...base, changesPct: {} });
    // ingredientes = 791.934 → 5.279,56 por kg; + MO 120.000 → 911.934 / 150 = 6.079,56 por kg.
    expect(s.ingredientsCostPerKg).toBe(5279.56);
    expect(s.costPerKg).toBe(6079.56);
    expect(s.componentsCost).toBe(140);
    expect(s.unitCost).toBe(3179.78); // 6.079,56 × 0,5 + 140
  });

  it("quesos −5 %: el costo de ingredientes baja ≈ 2,7 % (oportunidad del relevamiento)", () => {
    const before = simulateUnitCost({ ...base, changesPct: {} });
    const after = simulateUnitCost({ ...base, changesPct: { barra: -5, reggianito: -5 } });
    // Los dos quesos son 423.765 de 791.934 (53,5 %): 5 % de eso = 21.188 → −2,68 %.
    expect(pctChange(before.ingredientsCostPerKg, after.ingredientsCostPerKg)).toBeCloseTo(-2.68, 1);
    expect(after.unitCost).toBeLessThan(before.unitCost);
  });

  it("un componente (envase) también se puede mover; la mano de obra no cambia", () => {
    const after = simulateUnitCost({ ...base, changesPct: { bolsa: 10 } });
    expect(after.componentsCost).toBe(154);
    expect(after.costPerKg).toBe(6079.56);
    expect(after.unitCost).toBe(3193.78);
  });

  it("producción sin kg es un error", () => {
    expect(() => simulateUnitCost({ ...base, producedKgPerRun: 0, changesPct: {} })).toThrow(RangeError);
  });
});
