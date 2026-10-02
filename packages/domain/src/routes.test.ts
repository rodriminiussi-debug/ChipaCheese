import { describe, expect, it } from "vitest";
import { costPerKgDelivered, routeCost } from "./routes";

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
