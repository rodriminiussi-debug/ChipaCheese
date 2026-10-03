import { describe, expect, it } from "vitest";
import {
  cleaningExpectations,
  complianceRate,
  isCleaningDue,
  isLateEntry,
  monthBounds,
  startOfIsoWeek,
  maintenanceStatus,
  nextMaintenanceDue,
  temperatureStatus,
} from "./quality";

describe("isLateEntry (RF-34)", () => {
  it("es tardía si se carga un día posterior al registrado", () => {
    expect(isLateEntry("2026-08-03", "2026-08-10")).toBe(true);
    expect(isLateEntry("2026-08-10", "2026-08-10")).toBe(false);
    expect(isLateEntry("2026-08-11", "2026-08-10")).toBe(false);
  });
});

describe("temperatureStatus (RF-38)", () => {
  const freezer = { min: null, max: -18 };
  it("abatidor/freezer: máximo −18 °C", () => {
    expect(temperatureStatus(-20, freezer)).toBe("ok");
    expect(temperatureStatus(-18, freezer)).toBe("ok");
    expect(temperatureStatus(-15, freezer)).toBe("high");
  });
  it("heladera: 0 a 5 °C", () => {
    const fridge = { min: 0, max: 5 };
    expect(temperatureStatus(3, fridge)).toBe("ok");
    expect(temperatureStatus(-1, fridge)).toBe("low");
    expect(temperatureStatus(5.1, fridge)).toBe("high");
    expect(temperatureStatus(0, fridge)).toBe("ok");
  });
  it("sin límites siempre ok", () => {
    expect(temperatureStatus(100, { min: null, max: null })).toBe("ok");
  });
});

describe("mantenimiento preventivo (RF-37)", () => {
  it("próximo vencimiento = última ejecución + frecuencia", () => {
    expect(nextMaintenanceDue("2026-09-01", 30, "2026-01-01")).toBe("2026-10-01");
  });
  it("si nunca se hizo cuenta desde la fecha de alta del plan", () => {
    expect(nextMaintenanceDue(null, 90, "2026-09-01")).toBe("2026-11-30");
  });
  it("frecuencia inválida lanza error", () => {
    expect(() => nextMaintenanceDue(null, 0, "2026-09-01")).toThrow(RangeError);
  });
  it("estado: ok / due_soon / overdue", () => {
    const today = "2026-10-01";
    expect(maintenanceStatus("2026-09-30", today)).toBe("overdue");
    expect(maintenanceStatus("2026-10-01", today)).toBe("due_soon");
    expect(maintenanceStatus("2026-10-08", today)).toBe("due_soon");
    expect(maintenanceStatus("2026-10-09", today)).toBe("ok");
    expect(maintenanceStatus("2026-10-09", today, 10)).toBe("due_soon");
  });
});

describe("complianceRate", () => {
  it("hechos ÷ esperados en %, 1 decimal", () => {
    expect(complianceRate(2, 31)).toBe(6.5); // limpieza de agosto: solo días 3 y 4... 2 de 31
    expect(complianceRate(31, 31)).toBe(100);
    expect(complianceRate(0, 10)).toBe(0);
  });
  it("acota a 0..100", () => {
    expect(complianceRate(12, 10)).toBe(100);
    expect(complianceRate(-1, 10)).toBe(0);
  });
  it("sin esperados → null", () => {
    expect(complianceRate(0, 0)).toBeNull();
  });
});

describe("limpieza según frecuencia (RF-34)", () => {
  it("límites de mes y semana", () => {
    expect(monthBounds("2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(startOfIsoWeek("2026-10-02")).toBe("2026-09-28");
    expect(startOfIsoWeek("2026-10-04")).toBe("2026-09-28");
  });

  it("diaria: corresponde si no se hizo hoy", () => {
    expect(isCleaningDue("daily", "2026-10-02", ["2026-10-01"])).toBe(true);
    expect(isCleaningDue("daily", "2026-10-02", ["2026-10-02"])).toBe(false);
  });

  it("semanal: corresponde si no se registró en la semana (lunes a domingo)", () => {
    expect(isCleaningDue("weekly", "2026-10-02", ["2026-09-27"])).toBe(true);
    expect(isCleaningDue("weekly", "2026-10-02", ["2026-09-29"])).toBe(false);
    expect(isCleaningDue("weekly", "2026-10-05", ["2026-10-02"])).toBe(true);
  });

  it("mensual: corresponde si no se registró en el mes", () => {
    expect(isCleaningDue("monthly", "2026-10-20", ["2026-09-30"])).toBe(true);
    expect(isCleaningDue("monthly", "2026-10-20", ["2026-10-01"])).toBe(false);
  });

  it("esperados diarios: días hábiles anteriores a hoy (agosto con solo 3 y 4 marcados)", () => {
    const exp = cleaningExpectations("daily", ["2026-08-03", "2026-08-04"], "2026-08-01", "2026-08-31", "2026-10-02");
    expect(exp).toHaveLength(21); // agosto 2026 tiene 21 días hábiles
    expect(exp.filter((e) => e.done).map((e) => e.date)).toEqual(["2026-08-03", "2026-08-04"]);
  });

  it("el día en curso todavía no cuenta como faltante", () => {
    const exp = cleaningExpectations("daily", [], "2026-10-01", "2026-10-31", "2026-10-02");
    expect(exp.map((e) => e.date)).toEqual(["2026-10-01"]);
  });

  it("esperados semanales: el viernes de cada semana vencida", () => {
    const exp = cleaningExpectations("weekly", ["2026-09-29"], "2026-09-01", "2026-09-30", "2026-10-02");
    expect(exp.map((e) => e.date)).toEqual(["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
    expect(exp.every((e) => !e.done)).toBe(true);
    const done = cleaningExpectations("weekly", ["2026-09-08"], "2026-09-01", "2026-09-30", "2026-10-02");
    expect(done.find((e) => e.date === "2026-09-11")?.done).toBe(true);
  });

  it("esperado mensual: último día hábil del mes", () => {
    const exp = cleaningExpectations("monthly", ["2026-08-10"], "2026-08-01", "2026-08-31", "2026-10-02");
    expect(exp).toEqual([{ date: "2026-08-31", done: true }]);
    expect(cleaningExpectations("monthly", [], "2026-10-01", "2026-10-31", "2026-10-02")).toEqual([]);
  });
});
