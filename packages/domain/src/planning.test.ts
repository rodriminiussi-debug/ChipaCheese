import { describe, expect, it } from "vitest";
import { suggestDailyPlan } from "./planning";

const sum = (xs: { kg: number }[]): number => Math.round(xs.reduce((a, x) => a + x.kg, 0) * 10) / 10;

describe("suggestDailyPlan (RF-19)", () => {
  it("necesidad = pendiente + mínimo − stock, por forma", () => {
    const r = suggestDailyPlan({
      demands: [
        { shape: "tapitas", pendingKg: 60, stockKg: 10, minStockKg: 20 }, // 70
        { shape: "aritos", pendingKg: 20, stockKg: 5, minStockKg: 10 }, // 25
        { shape: "lenguitas", pendingKg: 0, stockKg: 100, minStockKg: 10 }, // 0
      ],
    });
    expect(r).toEqual({
      totalKg: 95,
      byShape: [
        { shape: "tapitas", kg: 70 },
        { shape: "aritos", kg: 25 },
        { shape: "lenguitas", kg: 0 },
      ],
      unmetKg: 0,
    });
  });

  it("sube al mínimo por tanda (75 kg) repartiendo proporcional", () => {
    const r = suggestDailyPlan({
      demands: [
        { shape: "tapitas", pendingKg: 30, stockKg: 0, minStockKg: 0 },
        { shape: "aritos", pendingKg: 10, stockKg: 0, minStockKg: 0 },
      ],
    });
    expect(r.totalKg).toBe(75);
    expect(r.unmetKg).toBe(0);
    expect(sum(r.byShape)).toBe(75);
    expect(r.byShape).toEqual([
      { shape: "tapitas", kg: 56.3 }, // 56,25 → el resto desempata hacia la primera
      { shape: "aritos", kg: 18.7 },
    ]);
  });

  it("si la necesidad total es 0 no se produce", () => {
    const r = suggestDailyPlan({
      demands: [{ shape: "tapitas", pendingKg: 0, stockKg: 50, minStockKg: 10 }],
    });
    expect(r).toEqual({ totalKg: 0, byShape: [{ shape: "tapitas", kg: 0 }], unmetKg: 0 });
    expect(suggestDailyPlan({ demands: [] })).toEqual({ totalKg: 0, byShape: [], unmetKg: 0 });
  });

  it("recorta a la capacidad (150 kg) y reporta lo no cubierto", () => {
    const r = suggestDailyPlan({
      demands: [
        { shape: "tapitas", pendingKg: 200, stockKg: 0, minStockKg: 0 },
        { shape: "aritos", pendingKg: 100, stockKg: 0, minStockKg: 0 },
      ],
    });
    expect(r).toEqual({
      totalKg: 150,
      byShape: [
        { shape: "tapitas", kg: 100 },
        { shape: "aritos", kg: 50 },
      ],
      unmetKg: 150,
    });
  });

  it("pedido de 425 kg: cubre 150 kg hoy y quedan 275 kg sin cubrir", () => {
    const r = suggestDailyPlan({
      demands: [{ shape: "tapitas", pendingKg: 425, stockKg: 0, minStockKg: 0 }],
    });
    expect(r.totalKg).toBe(150);
    expect(r.unmetKg).toBe(275);
  });

  it("la suma siempre cuadre con totalKg (mayor resto)", () => {
    const r = suggestDailyPlan({
      demands: [
        { shape: "a", pendingKg: 100, stockKg: 0, minStockKg: 0 },
        { shape: "b", pendingKg: 100, stockKg: 0, minStockKg: 0 },
        { shape: "c", pendingKg: 100, stockKg: 0, minStockKg: 0 },
      ],
      capacityKg: 100,
    });
    expect(r.totalKg).toBe(100);
    expect(sum(r.byShape)).toBe(100);
    expect(r.byShape.map((s) => s.kg)).toEqual([33.4, 33.3, 33.3]);
    expect(r.unmetKg).toBe(200);
  });

  it("necesidades decimales: redondea a 0,1 kg", () => {
    const r = suggestDailyPlan({
      demands: [
        { shape: "a", pendingKg: 80.04, stockKg: 0, minStockKg: 0 },
        { shape: "b", pendingKg: 20.01, stockKg: 0, minStockKg: 0 },
      ],
    });
    expect(r.totalKg).toBe(100.1);
    expect(sum(r.byShape)).toBe(100.1);
  });

  it("parámetros personalizados; el mínimo no puede superar la capacidad", () => {
    const r = suggestDailyPlan({
      demands: [{ shape: "a", pendingKg: 10, stockKg: 0, minStockKg: 0 }],
      capacityKg: 50,
      minBatchKg: 80,
    });
    expect(r.totalKg).toBe(50);
    expect(r.unmetKg).toBe(0);
  });
});
