import { describe, expect, it } from "vitest";
import { bagsEquivalent, kgFromBags, roundMoney, roundQty, roundTo } from "./units";

describe("rounding", () => {
  it("roundMoney redondea a 2 decimales corrigiendo el error binario", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(4223.6842)).toBe(4223.68);
    expect(roundMoney(791930)).toBe(791930);
  });

  it("redondea half-away-from-zero en negativos y normaliza -0", () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-0.001)).toBe(0);
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true);
  });

  it("roundQty redondea a 3 decimales", () => {
    expect(roundQty(149.30004)).toBe(149.3);
    expect(roundQty(0.0005)).toBe(0.001);
  });

  it("roundTo deja pasar valores no finitos", () => {
    expect(roundTo(Infinity, 2)).toBe(Infinity);
    expect(roundTo(NaN, 2)).toBeNaN();
  });
});

describe("bags (Regla 3)", () => {
  it("bagsEquivalent: kg ÷ 0,5", () => {
    expect(bagsEquivalent(425)).toBe(850);
    expect(bagsEquivalent(148.5)).toBe(297);
    expect(bagsEquivalent(5, 5)).toBe(1);
  });

  it("bagsEquivalent rechaza peso de bolsa inválido", () => {
    expect(() => bagsEquivalent(10, 0)).toThrow(RangeError);
  });

  it("kgFromBags es el inverso", () => {
    expect(kgFromBags(850)).toBe(425);
    expect(kgFromBags(297)).toBe(148.5);
    expect(kgFromBags(10, 5)).toBe(50);
  });
});
