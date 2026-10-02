import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  assertIsoDate,
  diffDays,
  isoWeekday,
  isWorkday,
  monthKey,
  nextWorkdays,
} from "./dates";

describe("addDays", () => {
  it("suma y resta días cruzando mes y año", () => {
    expect(addDays("2026-09-28", 3)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("addMonths (fin de mes seguro)", () => {
  it("31/08 + 6 meses = 28/02 (año no bisiesto) o 29/02 (bisiesto)", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
  });
  it("mantiene el día cuando existe", () => {
    expect(addMonths("2026-09-01", 6)).toBe("2027-03-01");
    expect(addMonths("2026-08-26", 6)).toBe("2027-02-26");
  });
  it("cruza el año y admite meses negativos", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-31", -2)).toBe("2025-11-30");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-05-10", 0)).toBe("2026-05-10");
  });
});

describe("diffDays", () => {
  it("es a − b", () => {
    expect(diffDays("2026-09-10", "2026-09-01")).toBe(9);
    expect(diffDays("2026-09-01", "2026-09-10")).toBe(-9);
    expect(diffDays("2026-09-01", "2026-09-01")).toBe(0);
    expect(diffDays("2027-01-01", "2026-01-01")).toBe(365);
  });
});

describe("weekdays", () => {
  it("isoWeekday: 1 = lunes … 7 = domingo", () => {
    expect(isoWeekday("2026-09-28")).toBe(1); // lunes
    expect(isoWeekday("2026-09-01")).toBe(2);
    expect(isoWeekday("2026-10-02")).toBe(5);
    expect(isoWeekday("2026-10-03")).toBe(6);
    expect(isoWeekday("2026-10-04")).toBe(7); // domingo
  });
  it("isWorkday: lunes a viernes por defecto, configurable", () => {
    expect(isWorkday("2026-10-02")).toBe(true);
    expect(isWorkday("2026-10-03")).toBe(false);
    expect(isWorkday("2026-10-03", [1, 2, 3, 4, 5, 6])).toBe(true);
  });
  it("nextWorkdays salta fines de semana e incluye `from` si es hábil", () => {
    expect(nextWorkdays("2026-10-01", 3)).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
    expect(nextWorkdays("2026-10-03", 2)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(nextWorkdays("2026-10-03", 2, [6, 7])).toEqual(["2026-10-03", "2026-10-04"]);
  });
  it("nextWorkdays: count <= 0 → []; workdays vacío → error", () => {
    expect(nextWorkdays("2026-10-01", 0)).toEqual([]);
    expect(() => nextWorkdays("2026-10-01", 1, [])).toThrow(RangeError);
  });
});

describe("monthKey y validación", () => {
  it("monthKey devuelve YYYY-MM", () => {
    expect(monthKey("2026-09-30")).toBe("2026-09");
  });
  it("rechaza fechas inválidas", () => {
    expect(() => assertIsoDate("2026-02-30")).toThrow(RangeError);
    expect(() => assertIsoDate("2026-13-01")).toThrow(RangeError);
    expect(() => assertIsoDate("2026-00-10")).toThrow(RangeError);
    expect(() => assertIsoDate("2026-01-00")).toThrow(RangeError);
    expect(() => assertIsoDate("01/09/2026")).toThrow(RangeError);
    expect(() => monthKey("abc")).toThrow(RangeError);
    expect(() => addDays("2026-9-1", 1)).toThrow(RangeError);
    expect(() => assertIsoDate("2026-02-28")).not.toThrow();
  });
});
