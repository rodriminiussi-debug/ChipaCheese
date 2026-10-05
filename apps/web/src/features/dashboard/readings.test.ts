import { describe, expect, it } from "vitest";
import {
  agingReading,
  coverageReading,
  dayLabel,
  marginReading,
  monthlyValueReading,
  moneyShort,
  otifReading,
  resultReading,
  salesReading,
  storeReading,
  temperatureReading,
  topCustomersReading,
  yieldReading,
  zoneReading,
} from "./readings";

describe("lecturas de los gráficos", () => {
  it("montos para frases", () => {
    expect(moneyShort(18_272_942)).toBe("$ 18,3 M");
    expect(moneyShort(-1_108_282)).toBe("-$ 1,1 M");
    expect(moneyShort(583_243)).toBe("$ 583 mil");
    expect(moneyShort(950)).toBe("$ 950");
  });
  it("día del eje", () => {
    expect(dayLabel("2026-10-02")).toBe("vie 2");
  });
  it("ventas: el mes contra el anterior", () => {
    expect(
      salesReading([
        { month: "2026-08", total: 18_000_000 },
        { month: "2026-09", total: 18_360_000 },
      ]),
    ).toBe("Septiembre: $ 18,4 M, +2,0 % vs agosto");
    expect(
      salesReading([
        { month: "2026-08", total: 0 },
        { month: "2026-09", total: 1_000_000 },
      ]),
    ).toBe("Septiembre: $ 1,0 M, sin dato de agosto para comparar");
    expect(salesReading([{ month: "2026-09", total: 0 }])).toBe("Septiembre: sin ventas facturadas.");
  });
  it("resultado: cubre o no los retiros", () => {
    expect(
      resultReading({
        month: "2026-09",
        result: 583_243,
        resultPct: 3.19,
        withdrawals: 9_000_000,
        hasData: true,
      }),
    ).toBe("Septiembre: +$ 583 mil (3,2 % de las ventas); no cubre los retiros de $ 9,0 M: faltan $ 8,4 M.");
    expect(
      resultReading({
        month: "2026-09",
        result: 10_000_000,
        resultPct: 20,
        withdrawals: 9_000_000,
        hasData: true,
      }),
    ).toContain("cubre los retiros");
    expect(
      resultReading({ month: "2026-09", result: 0, resultPct: null, withdrawals: 1, hasData: false }),
    ).toBe("Septiembre: sin datos cargados.");
  });
  it("margen: cuántos canales bajo el objetivo y el más lejos", () => {
    expect(
      marginReading([
        { listName: "Local", avgMarginPct: 47.4, targetMarginPct: 33 },
        { listName: "Revendedores", avgMarginPct: 21.9, targetMarginPct: 25 },
        { listName: "Supermercados", avgMarginPct: 15.9, targetMarginPct: 18 },
      ]),
    ).toBe("2 de 3 canales bajo el objetivo; el más lejos: Revendedores, 21,9 % contra 25 % (−3,1 pts).");
    expect(marginReading([{ listName: "Local", avgMarginPct: 40, targetMarginPct: 33 }])).toBe(
      "Todos los canales cumplen su margen objetivo.",
    );
    expect(marginReading([{ listName: "Local", avgMarginPct: null, targetMarginPct: 33 }])).toContain(
      "Sin precios",
    );
  });
  it("mejores clientes: quién lidera y cuánto concentran", () => {
    expect(
      topCustomersReading(
        "2026-09",
        [
          { name: "La Reina", net: 1_800_000 },
          { name: "Arcoiris", net: 1_200_000 },
        ],
        6_000_000,
      ),
    ).toBe("Septiembre: La Reina lidera con $ 1,8 M; los 2 primeros suman el 50 % de las ventas.");
    expect(topCustomersReading("2026-09", [], 0)).toBe("Septiembre: todavía no hay facturas.");
  });
  it("deuda por antigüedad", () => {
    expect(
      agingReading({
        current: 5_000_000,
        d1_30: 2_800_000,
        d31_60: 200_000,
        d61_90: 0,
        d90_plus: 0,
        total: 8_000_000,
      }),
    ).toBe("$ 8,0 M por cobrar, $ 3,0 M ya vencidos (38 %); nada pasa de 60 días.");
    expect(agingReading({ current: 100, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 100 })).toContain(
      "dentro del plazo",
    );
    expect(agingReading({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 })).toBe(
      "Hoy no hay deuda de clientes.",
    );
  });
  it("valor mensual (costo por bolsa)", () => {
    const fmt = (n: number) => `$ ${n}`;
    expect(
      monthlyValueReading(
        [
          { month: "2026-08", value: 3000 },
          { month: "2026-09", value: 3090 },
        ],
        fmt,
        "costo",
      ),
    ).toBe("Septiembre: $ 3090, +3,0 % vs agosto");
    expect(monthlyValueReading([{ month: "2026-09", value: null }], fmt, "costo")).toBe(
      "Todavía no hay datos de costo.",
    );
  });
  it("costo de reparto por zona", () => {
    const fmt = (n: number) => `$ ${n}`;
    expect(
      zoneReading(
        "2026-09",
        [
          { zone: "Rosario", costPerKg: 276 },
          { zone: "Pueblo Esther", costPerKg: 553 },
        ],
        fmt,
      ),
    ).toBe("Septiembre: Pueblo Esther es la más cara ($ 553/kg) y Rosario la más barata ($ 276/kg).");
  });
  it("rendimiento, cobertura y entregas", () => {
    expect(
      yieldReading([
        { yieldPct: 90.5, weighedKg: 149.3, ingredientsKg: 164.9 },
        { yieldPct: 87.4, weighedKg: 149.3, ingredientsKg: 170.9 },
      ]),
    ).toBe("Promedio de 2 producción(es): 88,9 %; la última rindió 87,4 %, −3,1 pts vs la anterior.");
    expect(
      coverageReading([
        { name: "Jamón", coverageDays: 0, reorderDays: null, status: "out_of_stock" },
        { name: "Queso", coverageDays: 3, reorderDays: 10, status: "reorder" },
        { name: "Sal", coverageDays: 100, reorderDays: 30, status: "ok" },
      ]),
    ).toBe("2 bajo el punto de pedido: Jamón, Queso.");
    expect(
      otifReading([
        { weekFrom: "2026-09-21", pct: 100, delivered: 2, ok: 2 },
        { weekFrom: "2026-09-28", pct: null, delivered: 0, ok: 0 },
      ]),
    ).toBe(
      "Última semana con entregas (del 21/09): 100 %; en 2 semanas, 2 de 2 pedidos a tiempo y completos.",
    );
  });
  it("local y temperaturas", () => {
    expect(
      storeReading(
        [
          { date: "2026-10-01", units: 6 },
          { date: "2026-10-02", units: 0 },
        ],
        "2026-10-02",
      ),
    ).toBe("Ayer: 6 unidad(es); promedio de 6 por día con ventas (1 de 2 días).");
    expect(storeReading([{ date: "2026-10-02", units: 0 }], "2026-10-02")).toBe(
      "Sin ventas del local en los últimos 1 días.",
    );
    expect(
      temperatureReading(
        [
          { date: "2026-10-01", readings: 5, outOfRange: 1 },
          { date: "2026-10-02", readings: 3, outOfRange: 0 },
        ],
        "2026-10-02",
      ),
    ).toBe("Hoy: 3 registro(s), 0 fuera de rango; en 2 días: 8 registros, 1 fuera de rango.");
  });
});
