import { describe, expect, it } from "vitest";
import {
  checkConsumption,
  consumptionDeviation,
  recipeIngredientsKg,
  theoreticalConsumption,
} from "./recipe";
import { STARCH_KG_PER_RECIPE } from "./constants";
import { RECIPE } from "./test-fixtures";

describe("theoreticalConsumption (Regla 2)", () => {
  it("receta de 75 kg de fécula: cantidades de la pestaña 29/09", () => {
    const t = theoreticalConsumption(RECIPE, STARCH_KG_PER_RECIPE);
    const byId = Object.fromEntries(t.map((x) => [x.ingredientId, x.qty]));
    expect(byId).toEqual({
      queso_barra: 22.5,
      reggianito: 15,
      manteca: 15,
      fecula: 75,
      huevo: 18,
      leche: 30,
      sal: 2.25,
    });
  });

  it("calcula el rango absoluto de la leche (18 a 28 L en la planta) y null sin rango", () => {
    const t = theoreticalConsumption(RECIPE, 75);
    const leche = t.find((x) => x.ingredientId === "leche");
    expect(leche).toEqual({ ingredientId: "leche", qty: 30, min: 18, max: 27.975 });
    const sal = t.find((x) => x.ingredientId === "sal");
    expect(sal).toMatchObject({ min: null, max: null });
  });

  it("escala con los kg de fécula", () => {
    const t = theoreticalConsumption(RECIPE, 37.5);
    expect(t.find((x) => x.ingredientId === "queso_barra")?.qty).toBe(11.25);
  });
});

describe("recipeIngredientsKg", () => {
  it("suma las 7 líneas de la receta de 75 kg de fécula", () => {
    // El relevamiento declara 163,5 kg pero sus 7 líneas suman 177,75 kg: se testea la suma real.
    expect(recipeIngredientsKg(RECIPE, 75)).toBe(177.75);
  });
  it("0 kg de fécula → 0", () => {
    expect(recipeIngredientsKg(RECIPE, 0)).toBe(0);
  });
});

describe("consumptionDeviation", () => {
  it("diff y % relativo al teórico", () => {
    expect(consumptionDeviation(30, 18)).toEqual({ diff: -12, pct: -40 });
    expect(consumptionDeviation(15, 10)).toEqual({ diff: -5, pct: -33.33 });
    expect(consumptionDeviation(22.5, 22)).toEqual({ diff: -0.5, pct: -2.22 });
    expect(consumptionDeviation(2.25, 1.9)).toEqual({ diff: -0.35, pct: -15.56 });
  });
  it("teórico 0", () => {
    expect(consumptionDeviation(0, 0)).toEqual({ diff: 0, pct: 0 });
    expect(consumptionDeviation(0, 5)).toEqual({ diff: 5, pct: Infinity });
  });
});

describe("checkConsumption", () => {
  it("con rango manda el rango (leche 28 L dentro, 30 L sobre el máximo)", () => {
    const base = { theoretical: 30, min: 18, max: 28, thresholdPct: 5 };
    expect(checkConsumption({ ...base, actual: 28 })).toEqual({
      ok: true,
      reason: "in_range",
      pct: -6.67,
    });
    expect(checkConsumption({ ...base, actual: 18 }).reason).toBe("in_range");
    expect(checkConsumption({ ...base, actual: 17.9 })).toMatchObject({
      ok: false,
      reason: "below_range",
    });
    expect(checkConsumption({ ...base, actual: 30 })).toMatchObject({
      ok: false,
      reason: "above_range",
    });
  });
  it("con un solo límite", () => {
    expect(checkConsumption({ theoretical: 30, actual: 100, min: 18, thresholdPct: 1 }).reason).toBe(
      "in_range",
    );
    expect(checkConsumption({ theoretical: 30, actual: 5, max: 40, thresholdPct: 1 }).reason).toBe(
      "in_range",
    );
  });
  it("sin rango compara |pct| contra el umbral", () => {
    expect(checkConsumption({ theoretical: 15, actual: 10, thresholdPct: 10 })).toEqual({
      ok: false,
      reason: "over_threshold",
      pct: -33.33,
    });
    expect(checkConsumption({ theoretical: 22.5, actual: 22, thresholdPct: 5 })).toEqual({
      ok: true,
      reason: "within_threshold",
      pct: -2.22,
    });
    expect(checkConsumption({ theoretical: 100, actual: 105, thresholdPct: 5 }).ok).toBe(true);
    expect(checkConsumption({ theoretical: 100, actual: 106, thresholdPct: 5 }).ok).toBe(false);
    expect(
      checkConsumption({ theoretical: 100, actual: 90, min: null, max: null, thresholdPct: 5 }).reason,
    ).toBe("over_threshold");
  });
});
