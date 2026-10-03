import { describe, expect, it } from "vitest";
import {
  costPerKgDelivered,
  isSmallRoute,
  routeCost,
  routeHours,
  SMALL_ROUTE_KG,
  zoneDeliversOn,
} from "./routes";

describe("rutas chicas, horas y días de reparto (RF-24/26/27)", () => {
  it("marca como chica la ruta de menos de 50 kg (la del 30/09 con 25 kg)", () => {
    expect(isSmallRoute(25)).toBe(true);
    expect(isSmallRoute(49.9)).toBe(true);
    expect(isSmallRoute(50)).toBe(false);
    expect(isSmallRoute(120)).toBe(false);
    expect(isSmallRoute(80, 100)).toBe(true);
    expect(SMALL_ROUTE_KG).toBe(50);
  });
  it("calcula las horas de la salida con 2 decimales", () => {
    const start = new Date("2026-10-02T09:00:00-03:00");
    expect(routeHours(start, new Date("2026-10-02T12:30:00-03:00"))).toBe(3.5);
    expect(routeHours(start, new Date("2026-10-02T09:20:00-03:00"))).toBe(0.33);
    expect(routeHours(start, new Date("2026-10-02T08:00:00-03:00"))).toBe(0);
  });
  it("una zona reparte si el día de la semana está en sus días (1 = lunes)", () => {
    // 02/10/2026 es viernes (5)
    expect(zoneDeliversOn([1, 3, 5], "2026-10-02")).toBe(true);
    expect(zoneDeliversOn([2], "2026-10-02")).toBe(false);
    expect(zoneDeliversOn([4], "2026-10-01")).toBe(true);
  });
  it("sin días definidos no restringe", () => {
    expect(zoneDeliversOn([], "2026-10-03")).toBe(true);
  });
});

describe("routeCost (RF-26/27)", () => {
  const base = { kmStart: 12000, kmEnd: 12085, costPerKm: 300, hours: 3, driverHourlyCost: 4000 };

  it("estima el combustible como km × costo por km", () => {
    // 85 km × 300 + 3 h × 4.000
    expect(routeCost(base)).toEqual({ km: 85, total: 37500 });
  });
  it("si viene fuelCost se usa en lugar de km × costPerKm (no se suman)", () => {
    expect(routeCost({ ...base, fuelCost: 18000 })).toEqual({ km: 85, total: 30000 });
    expect(routeCost({ ...base, fuelCost: 0 }).total).toBe(12000);
  });
  it("suma otros costos (peajes, etc.)", () => {
    expect(routeCost({ ...base, otherCosts: 2500.5 }).total).toBe(40000.5);
  });
  it("km negativos lanzan error", () => {
    expect(() => routeCost({ ...base, kmEnd: 11999 })).toThrow(RangeError);
  });
});

describe("costPerKgDelivered", () => {
  it("ruta del 30/09 con 25 kg: costo por kg entregado", () => {
    expect(costPerKgDelivered(37500, 25)).toBe(1500);
    expect(costPerKgDelivered(37500, 150)).toBe(250);
  });
  it("sin kg entregados → null", () => {
    expect(costPerKgDelivered(37500, 0)).toBeNull();
  });
});
