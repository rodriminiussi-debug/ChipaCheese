import { describe, expect, it } from "vitest";
import {
  averageDailyDemand,
  classifyStoreStock,
  compareStoreAlertUrgency,
  demandInBaseUnits,
  demandObservedDays,
  demandWindowStart,
  preparedAvailable,
  splitPreparedUnitsByLot,
} from "./store-demand";

describe("ventana de demanda", () => {
  it("son 30 días contando hoy", () => {
    expect(demandWindowStart("2026-10-30")).toBe("2026-10-01");
    expect(demandWindowStart("2026-10-02", 7)).toBe("2026-09-26");
    expect(() => demandWindowStart("2026-10-02", 0)).toThrow(RangeError);
  });

  it("con historia completa promedia sobre 30 días", () => {
    expect(demandObservedDays("2026-10-30", "2026-08-01")).toBe(30);
    expect(demandObservedDays("2026-10-30", "2026-10-01")).toBe(30);
  });

  it("con poca historia promedia sobre los días con datos (hoy cuenta)", () => {
    expect(demandObservedDays("2026-10-02", "2026-10-02")).toBe(1);
    expect(demandObservedDays("2026-10-10", "2026-10-04")).toBe(7);
  });

  it("sin ventas del local no hay días observados", () => {
    expect(demandObservedDays("2026-10-02", null)).toBe(0);
    expect(demandObservedDays("2026-10-02", "2026-10-05")).toBe(0);
  });
});

describe("venta diaria promedio", () => {
  it("unidades ÷ días con datos", () => {
    expect(averageDailyDemand(60, 30)).toBe(2);
    expect(averageDailyDemand(10, 3)).toBe(3.333);
  });
  it("0 si no hay ventas o días", () => {
    expect(averageDailyDemand(0, 30)).toBe(0);
    expect(averageDailyDemand(5, 0)).toBe(0);
  });
});

describe("elaborados que consumen producto base", () => {
  it("la demanda del elaborado se expresa en unidades del base", () => {
    expect(demandInBaseUnits(6, 0.5)).toBe(3);
    expect(demandInBaseUnits(3, 0.25)).toBe(0.75);
  });

  it("cuántos elaborados alcanzan con el stock del base", () => {
    expect(preparedAvailable(5, 0.5)).toBe(10);
    expect(preparedAvailable(2.75, 0.5)).toBe(5);
    expect(preparedAvailable(0.4, 0.5)).toBe(0);
    expect(preparedAvailable(0, 0.5)).toBe(0);
    expect(preparedAvailable(5, 0)).toBe(0);
    // sin error de coma flotante
    expect(preparedAvailable(0.3, 0.1)).toBe(3);
  });

  it("reparte las unidades vendidas entre lotes FEFO, cada unidad en el lote donde empieza", () => {
    // 5 elaborados × 0,5 = 2,5 de base: 1 del lote A y 1,5 del lote B.
    expect(
      splitPreparedUnitsByLot(5, 0.5, [
        { lotId: "A", qty: 1 },
        { lotId: "B", qty: 1.5 },
      ]),
    ).toEqual([
      { lotId: "A", units: 2 },
      { lotId: "B", units: 3 },
    ]);
    // una unidad que cruza el límite de lotes queda en el primero.
    expect(
      splitPreparedUnitsByLot(2, 0.75, [
        { lotId: "A", qty: 1 },
        { lotId: "B", qty: 0.5 },
      ]),
    ).toEqual([{ lotId: "A", units: 2 }]);
    expect(splitPreparedUnitsByLot(3, 1, [{ lotId: "A", qty: 3 }])).toEqual([{ lotId: "A", units: 3 }]);
  });

  it("sin asignaciones no se puede repartir", () => {
    expect(() => splitPreparedUnitsByLot(1, 0.5, [])).toThrow(RangeError);
  });
});

describe("classifyStoreStock", () => {
  const base = { avgDaily: 10, targetDays: 3, leadDays: 1 };

  it("sin ventas no hay demanda para medir", () => {
    const r = classifyStoreStock({ ...base, avgDaily: 0, stock: 50 });
    expect(r).toMatchObject({ status: "no_sales", daysLeft: null, suggestedQty: 0 });
    expect(classifyStoreStock({ ...base, avgDaily: 0, stock: 0 }).status).toBe("no_sales");
  });

  it("agotado: sin stock y con ventas, sugiere plazo + días objetivo", () => {
    const r = classifyStoreStock({ ...base, stock: 0 });
    expect(r).toMatchObject({ status: "out", daysLeft: 0, runsOutBeforeArrival: true, suggestedQty: 40 });
    expect(classifyStoreStock({ ...base, stock: -2 }).status).toBe("out");
  });

  it("reponer: no alcanza para plazo + objetivo (4 días × 10 = 40)", () => {
    const r = classifyStoreStock({ ...base, stock: 25 });
    expect(r).toMatchObject({
      status: "reorder",
      daysLeft: 2.5,
      suggestedQty: 15,
      runsOutBeforeArrival: false,
    });
    expect(classifyStoreStock({ ...base, stock: 39 }).status).toBe("reorder");
  });

  it("se agota antes de que llegue la reposición cuando los días de stock son menos que el plazo", () => {
    expect(classifyStoreStock({ ...base, stock: 8 }).runsOutBeforeArrival).toBe(true);
    expect(classifyStoreStock({ ...base, stock: 10 }).runsOutBeforeArrival).toBe(false);
  });

  it("ok: con stock para plazo + objetivo no sugiere nada", () => {
    const r = classifyStoreStock({ ...base, stock: 40 });
    expect(r).toMatchObject({ status: "ok", daysLeft: 4, suggestedQty: 0 });
    expect(classifyStoreStock({ ...base, stock: 100 }).daysLeft).toBe(10);
  });

  it("redondea la sugerencia hacia arriba a unidades enteras", () => {
    // 3,333 por día × 4 = 13,332 → con 5 en stock faltan 8,332 → 9
    const r = classifyStoreStock({ avgDaily: 3.333, targetDays: 3, leadDays: 1, stock: 5 });
    expect(r.suggestedQty).toBe(9);
  });

  it("descuenta lo ya pedido a la planta de la sugerencia, no del estado", () => {
    const r = classifyStoreStock({ ...base, stock: 5, incoming: 30 });
    expect(r.status).toBe("reorder");
    expect(r.suggestedQty).toBe(5);
    expect(classifyStoreStock({ ...base, stock: 5, incoming: 100 }).suggestedQty).toBe(0);
    expect(classifyStoreStock({ ...base, stock: 5, incoming: -3 }).suggestedQty).toBe(35);
  });

  it("el plazo de reposición mayor aumenta lo que se sugiere", () => {
    expect(classifyStoreStock({ ...base, leadDays: 3, stock: 0 }).suggestedQty).toBe(60);
  });
});

describe("compareStoreAlertUrgency", () => {
  it("ordena agotado → reponer → ok → sin ventas y por días de stock", () => {
    const rows = [
      { id: "ns", status: "no_sales" as const, daysLeft: null },
      { id: "ok2", status: "ok" as const, daysLeft: 9 },
      { id: "re5", status: "reorder" as const, daysLeft: 3.2 },
      { id: "out", status: "out" as const, daysLeft: 0 },
      { id: "ok1", status: "ok" as const, daysLeft: 5 },
      { id: "re1", status: "reorder" as const, daysLeft: 1.1 },
      { id: "ok1b", status: "ok" as const, daysLeft: 5 },
    ];
    const sorted = [...rows].sort(compareStoreAlertUrgency).map((r) => r.id);
    expect(sorted).toEqual(["out", "re1", "re5", "ok1", "ok1b", "ok2", "ns"]);
  });
  it("sin días (sin ventas) va al final de su grupo", () => {
    expect(
      compareStoreAlertUrgency({ status: "ok", daysLeft: null }, { status: "ok", daysLeft: 3 }),
    ).toBeGreaterThan(0);
    expect(compareStoreAlertUrgency({ status: "ok", daysLeft: null }, { status: "ok", daysLeft: null })).toBe(
      0,
    );
  });
});
