import { describe, expect, it } from "vitest";
import {
  allocateFefo,
  averageDailyConsumption,
  canProduce,
  coverageDays,
  needsReorder,
  reorderPoint,
  starchKgForProductKg,
  type LotBalance,
} from "./stock";
import { RECIPE } from "./test-fixtures";

describe("allocateFefo (Regla 5)", () => {
  const lots: LotBalance[] = [
    { lotId: "L-C", expiryDate: "2027-03-01", qty: 100, locationId: "F3" },
    { lotId: "L-A", expiryDate: "2027-01-15", qty: 40, locationId: "F4" },
    { lotId: "L-B", expiryDate: "2027-02-10", qty: 60 },
    { lotId: "L-Z", expiryDate: "2026-12-01", qty: 0 },
    { lotId: "L-N", expiryDate: "2026-11-01", qty: -5 },
  ];

  it("toma primero el lote que vence antes, con lotes desordenados", () => {
    const r = allocateFefo(lots, 70);
    expect(r.shortfall).toBe(0);
    expect(r.allocations).toEqual([
      { lotId: "L-A", qty: 40, expiryDate: "2027-01-15", locationId: "F4" },
      { lotId: "L-B", qty: 30, expiryDate: "2027-02-10" },
    ]);
  });

  it("ignora lotes con qty <= 0 aunque venzan antes", () => {
    const r = allocateFefo(lots, 10);
    expect(r.allocations.map((a) => a.lotId)).toEqual(["L-A"]);
  });

  it("informa el faltante cuando no alcanza", () => {
    const r = allocateFefo(lots, 425);
    expect(r.allocations.map((a) => a.qty)).toEqual([40, 60, 100]);
    expect(r.shortfall).toBe(225);
  });

  it("desempata por lotId cuando vencen el mismo día", () => {
    const r = allocateFefo(
      [
        { lotId: "B", expiryDate: "2027-01-01", qty: 10 },
        { lotId: "A", expiryDate: "2027-01-01", qty: 10 },
      ],
      15,
    );
    expect(r.allocations).toEqual([
      { lotId: "A", qty: 10, expiryDate: "2027-01-01" },
      { lotId: "B", qty: 5, expiryDate: "2027-01-01" },
    ]);
  });

  it("lotes con mismo id y vencimiento mantienen el orden de entrada", () => {
    const r = allocateFefo(
      [
        { lotId: "A", expiryDate: "2027-01-01", qty: 1, locationId: "x" },
        { lotId: "A", expiryDate: "2027-01-01", qty: 1, locationId: "y" },
      ],
      2,
    );
    expect(r.allocations.map((a) => a.locationId)).toEqual(["x", "y"]);
  });

  it("pedido 0 o negativo, o sin lotes", () => {
    expect(allocateFefo(lots, 0)).toEqual({ allocations: [], shortfall: 0 });
    expect(allocateFefo(lots, -3)).toEqual({ allocations: [], shortfall: 0 });
    expect(allocateFefo([], 5)).toEqual({ allocations: [], shortfall: 5 });
  });

  it("no muta el arreglo de entrada", () => {
    const copy = lots.map((l) => l.lotId);
    allocateFefo(lots, 50);
    expect(lots.map((l) => l.lotId)).toEqual(copy);
  });
});

describe("averageDailyConsumption (Regla 6)", () => {
  const today = "2026-09-30";
  it("suma la ventana (today-30, today] y divide por 30", () => {
    const c = [
      { date: "2026-08-31", qty: 100 }, // = today - 30 → excluido
      { date: "2026-09-01", qty: 60 }, // primer día incluido
      { date: "2026-09-15", qty: 30 },
      { date: "2026-09-30", qty: 30 }, // today incluido
      { date: "2026-10-01", qty: 999 }, // futuro excluido
    ];
    expect(averageDailyConsumption(c, today)).toBe(4);
  });
  it("ventana configurable y vacía", () => {
    expect(averageDailyConsumption([{ date: "2026-09-29", qty: 10 }], today, 7)).toBe(1.429);
    expect(averageDailyConsumption([], today)).toBe(0);
  });
  it("rechaza ventana inválida", () => {
    expect(() => averageDailyConsumption([], today, 0)).toThrow(RangeError);
  });
});

describe("coverageDays / reorderPoint / needsReorder (Reglas 6 y 7)", () => {
  it("cobertura = stock ÷ consumo diario, 1 decimal", () => {
    expect(coverageDays(300, 4)).toBe(75);
    expect(coverageDays(100, 30)).toBe(3.3);
    expect(coverageDays(-5, 4)).toBe(0);
  });
  it("consumo 0 → null (cobertura infinita)", () => {
    expect(coverageDays(100, 0)).toBeNull();
  });
  it("punto de pedido = consumo × plazo + seguridad", () => {
    // Queso barra: 22,5 kg por producción de 75 kg de fécula, ~1 producción/día
    expect(reorderPoint(22.5, 3, 45)).toBe(112.5);
    expect(reorderPoint(0.333, 2, 0.1)).toBe(0.766);
  });
  it("needsReorder incluye el punto de pedido", () => {
    expect(needsReorder(112.5, 112.5)).toBe(true);
    expect(needsReorder(112.4, 112.5)).toBe(true);
    expect(needsReorder(112.6, 112.5)).toBe(false);
  });
});

describe("canProduce (RF-17)", () => {
  const full = {
    queso_barra: 100,
    reggianito: 100,
    manteca: 100,
    fecula: 200,
    huevo: 100,
    leche: 100,
    sal: 10,
  };
  it("alcanza para una receta completa (75 kg de fécula)", () => {
    expect(canProduce({ starchKg: 75, lines: RECIPE, stockByIngredient: full })).toEqual({
      ok: true,
      missing: [],
    });
  });
  it("lista los faltantes con necesidad, disponible y diferencia", () => {
    const r = canProduce({
      starchKg: 150,
      lines: RECIPE,
      stockByIngredient: { ...full, manteca: 20, sal: undefined as unknown as number },
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([
      { ingredientId: "manteca", needed: 30, available: 20, shortfall: 10 },
      { ingredientId: "sal", needed: 4.5, available: 0, shortfall: 4.5 },
    ]);
  });
  it("insumo ausente en el stock cuenta como 0", () => {
    const r = canProduce({ starchKg: 75, lines: RECIPE.slice(0, 1), stockByIngredient: {} });
    expect(r.missing).toEqual([{ ingredientId: "queso_barra", needed: 22.5, available: 0, shortfall: 22.5 }]);
  });
});

describe("starchKgForProductKg", () => {
  it("150 kg de producto ÷ 2 = 75 kg de fécula", () => {
    expect(starchKgForProductKg(150, 2)).toBe(75);
    expect(starchKgForProductKg(425, 2)).toBe(212.5);
  });
  it("rechaza rendimiento <= 0", () => {
    expect(() => starchKgForProductKg(150, 0)).toThrow(RangeError);
  });
});
