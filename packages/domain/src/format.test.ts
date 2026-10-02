import { describe, expect, it } from "vitest";
import { formatARS, formatDateAR, formatKg, formatNumber, parseDecimalAR } from "./format";

describe("formatARS", () => {
  it("enteros sin decimales, con separador de miles también en 4 dígitos", () => {
    expect(formatARS(4200)).toBe("$ 4.200");
    expect(formatARS(791930)).toBe("$ 791.930");
    expect(formatARS(0)).toBe("$ 0");
    expect(formatARS(18_900_000)).toBe("$ 18.900.000");
  });
  it("decimales cuando el monto los tiene o se piden", () => {
    expect(formatARS(4223.68)).toBe("$ 4.223,68");
    expect(formatARS(1353.2)).toBe("$ 1.353,20");
    expect(formatARS(791930, { decimals: 2 })).toBe("$ 791.930,00");
    expect(formatARS(4223.68, { decimals: 0 })).toBe("$ 4.224");
  });
  it("negativos", () => {
    expect(formatARS(-9_793_384)).toBe("-$ 9.793.384");
    expect(formatARS(-0.001)).toBe("$ 0");
  });
});

describe("formatKg / formatNumber", () => {
  it("kg con coma decimal", () => {
    expect(formatKg(149.3)).toBe("149,3 kg");
    expect(formatKg(425)).toBe("425 kg");
    expect(formatKg(2.25)).toBe("2,25 kg");
    expect(formatKg(1234.5)).toBe("1.234,5 kg");
  });
  it("número con decimales fijos", () => {
    expect(formatNumber(1234.5)).toBe("1.234,50");
    expect(formatNumber(0.9131, 4)).toBe("0,9131");
    expect(formatNumber(1234567.891, 0)).toBe("1.234.568");
  });
});

describe("formatDateAR", () => {
  it("DD/MM/AAAA", () => {
    expect(formatDateAR("2026-09-01")).toBe("01/09/2026");
    expect(formatDateAR("2027-02-28")).toBe("28/02/2027");
  });
  it("rechaza fechas inválidas", () => {
    expect(() => formatDateAR("01/09/2026")).toThrow(RangeError);
  });
});

describe("parseDecimalAR", () => {
  it("formato argentino", () => {
    expect(parseDecimalAR("1.234,5")).toBe(1234.5);
    expect(parseDecimalAR("149,3")).toBe(149.3);
    expect(parseDecimalAR("1.234.567,89")).toBe(1234567.89);
    expect(parseDecimalAR("0,5")).toBe(0.5);
  });
  it("punto decimal", () => {
    expect(parseDecimalAR("1234.5")).toBe(1234.5);
    expect(parseDecimalAR("0.5")).toBe(0.5);
    expect(parseDecimalAR("0.500")).toBe(0.5);
    expect(parseDecimalAR(".5")).toBe(0.5);
    expect(parseDecimalAR("12.5")).toBe(12.5);
  });
  it("punto como separador de miles", () => {
    expect(parseDecimalAR("1.234")).toBe(1234);
    expect(parseDecimalAR("4.200")).toBe(4200);
    expect(parseDecimalAR("1.234.567")).toBe(1234567);
  });
  it("enteros, signos, símbolo de moneda y espacios", () => {
    expect(parseDecimalAR("4200")).toBe(4200);
    expect(parseDecimalAR("-12,5")).toBe(-12.5);
    expect(parseDecimalAR("+3")).toBe(3);
    expect(parseDecimalAR(" $ 4.223,68 ")).toBe(4223.68);
  });
  it("vacío o inválido → null", () => {
    expect(parseDecimalAR("")).toBeNull();
    expect(parseDecimalAR("   ")).toBeNull();
    expect(parseDecimalAR("abc")).toBeNull();
    expect(parseDecimalAR("1,2,3")).toBeNull();
    expect(parseDecimalAR("1.2.3")).toBeNull();
    expect(parseDecimalAR("12a")).toBeNull();
  });
});
