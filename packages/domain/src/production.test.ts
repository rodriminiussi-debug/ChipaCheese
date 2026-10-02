import { describe, expect, it } from "vitest";
import { finishedLotCode, finishedLotExpiry, lossKg, productionYield, validateDailyLoad } from "./production";

/** Pesadas del registro de elaboración del 01/09: tapitas + aritos + lengüitas. */
const WEIGHED_KG = 70.6 + 10.1 + 68.6;

describe("productionYield / lossKg (Regla 3)", () => {
  it("pesadas del 01/09 suman 149,3 kg", () => {
    expect(WEIGHED_KG).toBeCloseTo(149.3, 10);
  });
  it("rendimiento = 149,3 ÷ 163,5 (ingredientes según relevamiento)", () => {
    expect(productionYield(149.3, 163.5)).toBe(0.9131);
  });
  it("rendimiento contra la suma real de las 7 líneas (177,75 kg)", () => {
    expect(productionYield(149.3, 177.75)).toBe(0.8399);
  });
  it("rendimiento 0 sin ingredientes", () => {
    expect(productionYield(10, 0)).toBe(0);
  });
  it("merma en kg", () => {
    expect(lossKg(149.3, 163.5)).toBe(14.2);
    expect(lossKg(150, 148)).toBe(-2);
  });
});

describe("finishedLotCode / finishedLotExpiry (Regla 4)", () => {
  it("formato AAMMDD-N", () => {
    expect(finishedLotCode("2026-09-01", 1)).toBe("260901-1");
    expect(finishedLotCode("2026-08-26", 2)).toBe("260826-2");
    expect(finishedLotCode("2027-12-31", 12)).toBe("271231-12");
  });
  it("rechaza número de producción inválido o fecha inválida", () => {
    expect(() => finishedLotCode("2026-09-01", 0)).toThrow(RangeError);
    expect(() => finishedLotCode("2026-09-01", 1.5)).toThrow(RangeError);
    expect(() => finishedLotCode("2026-02-31", 1)).toThrow(RangeError);
  });
  it("vencimiento = elaboración + 6 meses", () => {
    expect(finishedLotExpiry("2026-08-31")).toBe("2027-02-28");
    expect(finishedLotExpiry("2026-09-01")).toBe("2027-03-01");
    expect(finishedLotExpiry("2026-09-01", 12)).toBe("2027-09-01");
  });
});

describe("validateDailyLoad (Regla 1)", () => {
  it("0 kg es válido (no se produce)", () => {
    expect(validateDailyLoad(0)).toEqual({ ok: true });
  });
  it("mínimo 75 kg y máximo 150 kg inclusivos", () => {
    expect(validateDailyLoad(75)).toEqual({ ok: true });
    expect(validateDailyLoad(100)).toEqual({ ok: true });
    expect(validateDailyLoad(150)).toEqual({ ok: true });
  });
  it("por debajo del mínimo por tanda", () => {
    expect(validateDailyLoad(74.9)).toEqual({ ok: false, reason: "below_min_batch" });
  });
  it("sobre la capacidad del abatidor", () => {
    expect(validateDailyLoad(150.1)).toEqual({ ok: false, reason: "over_capacity" });
    expect(validateDailyLoad(425)).toEqual({ ok: false, reason: "over_capacity" });
  });
  it("parámetros personalizados", () => {
    expect(validateDailyLoad(40, 100, 50)).toEqual({ ok: false, reason: "below_min_batch" });
    expect(validateDailyLoad(120, 100, 50)).toEqual({ ok: false, reason: "over_capacity" });
  });
  it("rechaza negativos y NaN", () => {
    expect(() => validateDailyLoad(-1)).toThrow(RangeError);
    expect(() => validateDailyLoad(NaN)).toThrow(RangeError);
  });
});
