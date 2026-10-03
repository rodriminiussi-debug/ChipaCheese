import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { getProductCosts, realYield } from "./service";

const TODAY = "2026-10-02";
/** Sin producciones en los 60 días previos: el rendimiento sale de la receta. */
const FAR_FUTURE = "2027-06-01";

async function ingredientId(tx: Executor, name: string) {
  const row = await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.name, name) });
  return row!.id;
}

async function productByCode(tx: Executor, code: string) {
  return (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;
}

describe("costeo base (Regla 8)", () => {
  it("con rendimiento de receta de 148,5 kg la bolsa de 0,5 kg cuesta ~$3.210 (relevamiento)", async () => {
    await inRollback("nahuel", async (tx) => {
      // 148,5 kg ÷ 75 kg de fécula = 1,98 kg de producto por kg de fécula.
      await tx
        .update(schema.recipes)
        .set({ expectedYieldPerKgStarch: 1.98 })
        .where(eq(schema.recipes.status, "active"));
      const c = await getProductCosts(tx, FAR_FUTURE);
      expect(c.yield.source).toBe("recipe");
      expect(c.producedKgPerRun).toBeCloseTo(148.5, 3);

      // Ingredientes ≈ $791.930 por producción → ~$5.333/kg (el relevamiento dice ~$5.330).
      const run = c.ingredients.reduce((a, l) => a + (l.costPerRun ?? 0), 0);
      expect(run).toBeCloseTo(791_934, 0);
      expect(c.ingredientsCostPerKg).toBeCloseTo(5333, 0);
      // Mano de obra: 4 × 6 h × $5.000 = $120.000 → $808/kg → $404 por bolsa.
      expect(c.labor.costPerRun).toBe(120_000);
      expect(c.labor.perKg).toBeCloseTo(808.08, 2);

      const tap = c.byProductId[(await productByCode(tx, "CH-TAP-500")).id]!;
      expect(tap.componentsCost).toBe(140); // envase
      expect(tap.doughCost! * 1).toBeCloseTo(3070.55, 0);
      expect(tap.unitCost!).toBeGreaterThan(3208);
      expect(tap.unitCost!).toBeLessThan(3213);
      expect(tap.missingPrices).toEqual([]);
    });
  });

  it("desglose por insumo: queso barra 28,1 % y reggianito 25,4 % del costo de ingredientes", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await getProductCosts(tx, FAR_FUTURE);
      const by = Object.fromEntries(c.ingredients.map((l) => [l.name, l]));
      expect(by["Queso barra (Tybo/Maki)"]!.pctOfIngredients).toBeCloseTo(28.1, 1);
      expect(by["Queso reggianito"]!.pctOfIngredients).toBeCloseTo(25.4, 1);
      expect(by["Fécula de mandioca"]!.pctOfIngredients).toBeCloseTo(16.4, 1);
      expect(by["Sal"]!.pctOfIngredients).toBeCloseTo(0.2, 1);
      const total = c.ingredients.reduce((a, l) => a + (l.pctOfIngredients ?? 0), 0);
      expect(total).toBeGreaterThan(99.8);
      expect(total).toBeLessThan(100.2);
      // Con la mano de obra el % de cada insumo baja y la suma + mano de obra = 100 %.
      const withLabor = c.ingredients.reduce((a, l) => a + (l.pctOfCost ?? 0), 0);
      expect(withLabor + (c.labor.perKg / c.costPerKg!) * 100).toBeCloseTo(100, 0);
    });
  });

  it("usa el rendimiento real de las producciones de los últimos 60 días (kg pesados ÷ kg de fécula)", async () => {
    await inRollback("nahuel", async (tx) => {
      // Demo: 01/09 y 01/10, ambas con 75 kg de fécula y 149,3 kg pesados.
      const real = await realYield(tx, TODAY);
      expect(real).toEqual({ runs: 2, weighedKg: 298.6, starchKg: 150 });
      const c = await getProductCosts(tx, TODAY);
      expect(c.yield.source).toBe("real");
      expect(c.yield.perKgStarch).toBeCloseTo(1.9907, 4);
      expect(c.producedKgPerRun).toBeCloseTo(149.3, 3);
      // No usa la suma de ingredientes (163,5 kg): el costo/kg es ~$6.108, no ~$5.579.
      expect(c.costPerKg).toBeCloseTo((791_934 + 120_000) / 149.3, 0);
    });
  });

  it("ignora producciones fuera de la ventana de 60 días o sin pesadas", async () => {
    await inRollback("nahuel", async (tx) => {
      // Más de 60 días después de la última producción demo, la ventana queda vacía.
      expect((await realYield(tx, "2026-12-15")).runs).toBe(0);
      // Una producción sin pesadas no cuenta.
      await tx.insert(schema.productionRuns).values({
        date: TODAY,
        runNumber: 9,
        recipeId: (await tx.query.recipes.findFirst())!.id,
        starchKg: 75,
      });
      expect((await realYield(tx, TODAY)).runs).toBe(2);
    });
  });

  it("marca 'precio faltante' en vez de asumir $0 (error 8 del Excel)", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await getProductCosts(tx, TODAY);
      const sw = c.byProductId[(await productByCode(tx, "SW-JYQ")).id]!;
      expect(sw.unitCost).toBeNull();
      expect(sw.missingPrices.sort()).toEqual(["Jamón feteado", "Queso feteado"]);
      expect(sw.doughCost).toBeGreaterThan(0);
      // El granel de 5 kg no tiene precio de la bolsa.
      const granel = c.byProductId[(await productByCode(tx, "CH-TAP-5K")).id]!;
      expect(granel.unitCost).toBeNull();
      expect(granel.missingPrices).toEqual(["Bolsa granel 5 kg"]);

      // Con precios cargados el sándwich pasa a tener costo: masa 0,18 kg + 100 g de jamón y de queso.
      await tx.insert(schema.ingredientPrices).values([
        { ingredientId: await ingredientId(tx, "Jamón feteado"), date: TODAY, unitPriceNet: 9000 },
        { ingredientId: await ingredientId(tx, "Queso feteado"), date: TODAY, unitPriceNet: 10000 },
      ]);
      const c2 = await getProductCosts(tx, TODAY);
      const sw2 = c2.byProductId[sw.productId]!;
      expect(sw2.missingPrices).toEqual([]);
      expect(sw2.componentsCost).toBe(1900); // 0,1 × 9.000 + 0,1 × 10.000
      expect(sw2.unitCost).toBeCloseTo(sw2.doughCost! + 1900, 2);
    });
  });

  it("si falta el precio de un insumo de la receta, ningún producto tiene costo", async () => {
    await inRollback("nahuel", async (tx) => {
      const sal = await ingredientId(tx, "Sal");
      await tx.delete(schema.ingredientPrices).where(eq(schema.ingredientPrices.ingredientId, sal));
      const c = await getProductCosts(tx, TODAY);
      expect(c.costPerKg).toBeNull();
      expect(c.missingPrices).toEqual(["Sal"]);
      expect(c.products.every((p) => p.unitCost === null)).toBe(true);
      expect(c.byProductId[(await productByCode(tx, "CH-TAP-500")).id]!.missingPrices).toContain("Sal");
    });
  });

  it("toma el último precio de compra y los parámetros de mano de obra de la configuración", async () => {
    await inRollback("nahuel", async (tx) => {
      const before = await getProductCosts(tx, TODAY);
      await tx.insert(schema.ingredientPrices).values({
        ingredientId: await ingredientId(tx, "Manteca"),
        date: "2026-10-01",
        unitPriceNet: 12000,
      });
      await tx
        .update(schema.appSettings)
        .set({ value: 8000 })
        .where(eq(schema.appSettings.key, "labor.hourly_cost"));
      const after = await getProductCosts(tx, TODAY);
      const manteca = after.ingredients.find((l) => l.name === "Manteca")!;
      expect(manteca.unitPriceNet).toBe(12000);
      expect(after.labor.costPerRun).toBe(4 * 6 * 8000);
      expect(after.costPerKg!).toBeGreaterThan(before.costPerKg!);
    });
  });
});
