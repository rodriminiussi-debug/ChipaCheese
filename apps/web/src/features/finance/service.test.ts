import { describe, expect, it } from "vitest";
import { eq, schema } from "@chipa/db";
import { pctChange, simulateUnitCost } from "@chipa/domain";
import { inRollback } from "../../../tests/helpers";
import { locationByCode } from "@/features/stock/ledger";
import { can } from "@/lib/rbac";
import {
  copyFixedExpensesFromPreviousMonth,
  createFixedExpense,
  deleteFixedExpense,
  getCostOverview,
  getMonthlyResult,
  getPartnerWithdrawals,
  getResultHistory,
  listFixedExpenses,
  setPartnerWithdrawals,
  updateFixedExpense,
} from "./service";

const TODAY = "2026-10-02";

/**
 * Datos demo relevantes (packages/db/src/seed):
 *  - Precios: queso barra 9.880, reggianito 13.431, manteca 9.800, fécula 1.728, huevo 3.222, leche 1.066,
 *    sal 708, bolsa 0,5 kg 140. Receta por producción de 75 kg de fécula.
 *  - Producciones 01/09 y 01/10: 149,3 kg pesados cada una → rendimiento real 149,3 kg por producción.
 *  - Gastos fijos de agosto y septiembre: $1.040.000 (7 conceptos del Excel de abril).
 *  - Septiembre: UNA factura (A 0002-00001234 a La Reina, pedido de 60 tapitas + 60 lengüitas a $3.900 = $468.000 con IVA);
 *    los demás pedidos del mes (Vía Dolce ×4, La Esperanza ×2) se cargaron ya "cobrados" y sin factura.
 */
describe("gastos fijos (RF-42)", () => {
  it("lista el mes con total, por categoría y avisa las categorías que el Excel no tenía", async () => {
    await inRollback("nahuel", async (tx) => {
      const sep = await listFixedExpenses(tx, "2026-09");
      expect(sep.rows).toHaveLength(7);
      expect(sep.total).toBe(1_040_000);
      // 300.000 alquiler; servicios = luz 200.000 + agua 100.000 + desinfección 40.000.
      expect(sep.byCategory.find((c) => c.category === "services")?.amount).toBe(340_000);
      expect(sep.byCategory.find((c) => c.category === "rent")?.amount).toBe(300_000);
      // El seed no trae vehículo, combustible, sueldos ni amortizaciones (ASSAL cuenta como impuestos/tasas).
      expect(sep.missingCategories.map((m) => m.category)).toEqual([
        "vehicle",
        "fuel",
        "payroll",
        "depreciation",
      ]);
      const empty = await listFixedExpenses(tx, "2026-07");
      expect(empty.total).toBe(0);
      expect(empty.missingCategories).toHaveLength(5);
    });
  });

  it("alta, edición y baja; no permite repetir el concepto en el mes", async () => {
    await inRollback("nahuel", async (tx) => {
      const row = await createFixedExpense(tx, {
        month: "2026-09",
        concept: "Patente camioneta",
        category: "vehicle",
        amount: 85_000,
        notes: null,
      });
      expect(row.month).toBe("2026-09-01");
      let sep = await listFixedExpenses(tx, "2026-09");
      expect(sep.total).toBe(1_125_000);
      expect(sep.missingCategories.map((m) => m.category)).not.toContain("vehicle");

      await expect(
        createFixedExpense(tx, {
          month: "2026-09",
          concept: "patente CAMIONETA",
          category: "vehicle",
          amount: 1,
          notes: null,
        }),
      ).rejects.toThrow(/Ya hay un gasto/);

      await updateFixedExpense(tx, {
        id: row.id,
        concept: "Patente y seguro camioneta",
        category: "vehicle",
        amount: 120_000,
        notes: "Cuota anual / 12",
      });
      sep = await listFixedExpenses(tx, "2026-09");
      expect(sep.total).toBe(1_160_000);

      // Renombrar a un concepto que ya existe (Alquiler) también es un error.
      await expect(
        updateFixedExpense(tx, { id: row.id, concept: "Alquiler", category: "rent", amount: 1, notes: null }),
      ).rejects.toThrow(/Ya hay un gasto/);

      await deleteFixedExpense(tx, row.id);
      expect((await listFixedExpenses(tx, "2026-09")).total).toBe(1_040_000);
      await expect(deleteFixedExpense(tx, row.id)).rejects.toThrow(/no existe/);
    });
  });

  it("copiar del mes anterior trae lo que falta sin pisar lo cargado", async () => {
    await inRollback("nahuel", async (tx) => {
      // Octubre está vacío: copia los 7 conceptos de septiembre.
      const first = await copyFixedExpensesFromPreviousMonth(tx, "2026-10");
      expect(first).toEqual({ copied: 7, skipped: 0, from: "2026-09" });
      expect((await listFixedExpenses(tx, "2026-10")).total).toBe(1_040_000);

      // Se edita uno en octubre y se vuelve a copiar: no se duplica ni se pisa.
      const alquiler = (await listFixedExpenses(tx, "2026-10")).rows.find((r) => r.concept === "Alquiler")!;
      await updateFixedExpense(tx, {
        id: alquiler.id,
        concept: "Alquiler",
        category: "rent",
        amount: 350_000,
        notes: null,
      });
      const again = await copyFixedExpensesFromPreviousMonth(tx, "2026-10");
      expect(again).toEqual({ copied: 0, skipped: 7, from: "2026-09" });
      expect((await listFixedExpenses(tx, "2026-10")).total).toBe(1_090_000);

      // Si el mes anterior no tiene nada, avisa.
      await expect(copyFixedExpensesFromPreviousMonth(tx, "2026-08")).rejects.toThrow(
        /mes anterior no tiene/,
      );
    });
  });
});

describe("retiros de los socios", () => {
  it("por defecto $9.000.000 y se edita por upsert en app_settings", async () => {
    await inRollback("nahuel", async (tx) => {
      expect(await getPartnerWithdrawals(tx)).toEqual({ amount: 9_000_000, isDefault: true });
      await setPartnerWithdrawals(tx, 3_000_000);
      await setPartnerWithdrawals(tx, 4_500_000);
      expect(await getPartnerWithdrawals(tx)).toEqual({ amount: 4_500_000, isDefault: false });
      const rows = await tx
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "finance.partner_withdrawals_monthly"));
      expect(rows).toHaveLength(1);
    });
  });
});

describe("resultado mensual (RF-40) — septiembre 2026 con los datos demo", () => {
  /**
   * Cuentas a mano (todo a precios actuales, sin IVA):
   *  - Ingredientes de una producción (75 kg de fécula):
   *      22,5 × 9.880 + 15 × 13.431 + 15 × 9.800 + 75 × 1.728 + 18 × 3.222 + 30 × 1.066 + 2,25 × 708
   *      = 222.300 + 201.465 + 147.000 + 129.600 + 57.996 + 31.980 + 1.593 = 791.934.
   *  - Rinde 149,3 kg (rendimiento REAL de las producciones, no 163,5): 791.934 ÷ 149,3 = $5.304,31 por kg.
   *  - Materiales de una bolsa de 0,5 kg = 5.304,31 × 0,5 + 140 (bolsa) = $2.792,16 (la mano de obra se resta aparte).
   *  - Ventas de septiembre: la factura a La Reina, $468.000 con IVA → neto 468.000 ÷ 1,21 = $386.776,86 (supermercados).
   *  - Costo de ventas: 120 bolsas (60 tapitas + 60 lengüitas del pedido facturado) × 2.792,16 = $335.059,20.
   *  - Mano de obra: 1 producción en septiembre (01/09) × (4 personas × 6 h × $5.000) = $120.000.
   *  - Gastos fijos: $1.040.000. Reparto: no hay rutas cargadas en septiembre → $0.
   *  - Margen bruto = 386.776,86 − 335.059,20 = 51.717,66.
   *  - Resultado = 51.717,66 − 120.000 − 1.040.000 − 0 = −1.108.282,34 (−286,54 % de las ventas).
   *  - Contra $9.000.000 de retiros: faltan 10.108.282,34.
   */
  it("calcula ventas, costo de ventas, mano de obra, fijos y resultado", async () => {
    await inRollback("nahuel", async (tx) => {
      const r = await getMonthlyResult(tx, "2026-09", { today: TODAY });
      expect(r.salesByChannel).toEqual([
        { channel: "supermarket", net: 386_776.86, total: 468_000, documents: 1 },
      ]);
      expect(r.sales).toBe(386_776.86);
      expect(r.costOfSales.unitsFromInvoicedOrders).toBe(120);
      expect(r.costOfSales.unitsFromStore).toBe(0);
      expect(r.costOfSales.lines.map((l) => [l.name, l.units, l.unitMaterialCost, l.cost]).sort()).toEqual([
        ["Chipá lengüitas 0,5 kg", 60, 2792.16, 167_529.6],
        ["Chipá tapitas 0,5 kg", 60, 2792.16, 167_529.6],
      ]);
      expect(r.costOfSales.total).toBe(335_059.2);
      expect(r.labor).toEqual({ runs: 1, perRun: 120_000, total: 120_000 });
      expect(r.fixed.total).toBe(1_040_000);
      expect(r.delivery.cost).toBe(0);
      expect(r.grossMargin).toBe(51_717.66);
      expect(r.result).toBe(-1_108_282.34);
      expect(r.resultPct).toBe(-286.54);
      expect(r.withdrawals).toMatchObject({
        amount: 9_000_000,
        isDefault: true,
        covers: false,
        difference: -10_108_282.34,
      });
      expect(r.hasData).toBe(true);
    });
  });

  it("avisa lo que no entra en la cuenta: pedidos entregados sin factura", async () => {
    await inRollback("nahuel", async (tx) => {
      const r = await getMonthlyResult(tx, "2026-09", { today: TODAY });
      // Vía Dolce: 4 pedidos de 20 + 10 bolsas a $4.200 = $126.000 c/u; La Esperanza: 2 de 15 a $4.200 = $63.000 c/u.
      expect(r.notices.deliveredWithoutInvoice).toEqual({ orders: 6, amount: 630_000 });
      expect(r.notices.invoicesWithoutOrder).toEqual({ count: 0, net: 0 });
    });
  });

  it("las ventas del local suman al canal y su costo entra en el costo de ventas", async () => {
    await inRollback("nahuel", async (tx) => {
      const [local, tap] = await Promise.all([
        locationByCode(tx, "LOCAL"),
        tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") }),
      ]);
      const [sale] = await tx
        .insert(schema.storeSales)
        .values({
          soldAt: new Date("2026-09-15T15:00:00-03:00"),
          locationId: local.id,
          method: "cash",
          total: 48_000,
        })
        .returning();
      await tx.insert(schema.storeSaleItems).values({
        saleId: sale!.id,
        productId: tap!.id,
        qtyUnits: 10,
        unitPrice: 4_800,
      });
      const r = await getMonthlyResult(tx, "2026-09", { today: TODAY });
      // Local: 48.000 con IVA 21 % incluido → neto 39.669,42.
      expect(r.salesByChannel.find((c) => c.channel === "store")).toMatchObject({
        net: 39_669.42,
        total: 48_000,
      });
      expect(r.sales).toBe(426_446.28);
      expect(r.costOfSales.unitsFromStore).toBe(10);
      expect(r.costOfSales.total).toBe(362_980.8); // 335.059,20 + 10 × 2.792,16
      expect(r.result).toBe(426_446.28 - 362_980.8 - 120_000 - 1_040_000);
    });
  });

  it("productos con precio faltante se marcan como costo subestimado, no como $0 silencioso", async () => {
    await inRollback("nahuel", async (tx) => {
      const sandwich = await tx.query.products.findFirst({
        where: eq(schema.products.code, "SW-JYQ"),
      });
      const local = await locationByCode(tx, "LOCAL");
      if (!sandwich) throw new Error("el seed debería tener el sándwich");
      const [sale] = await tx
        .insert(schema.storeSales)
        .values({
          soldAt: new Date("2026-09-16T12:00:00-03:00"),
          locationId: local.id,
          method: "cash",
          total: 5_000,
        })
        .returning();
      await tx
        .insert(schema.storeSaleItems)
        .values({ saleId: sale!.id, productId: sandwich.id, qtyUnits: 1, unitPrice: 5_000 });
      const r = await getMonthlyResult(tx, "2026-09", { today: TODAY });
      expect(r.costOfSales.underpriced).toContain(sandwich.name);
    });
  });

  it("octubre: producción del 01/10 pero sin facturas ni gastos → resultado = −mano de obra", async () => {
    await inRollback("nahuel", async (tx) => {
      const r = await getMonthlyResult(tx, "2026-10", { today: TODAY });
      expect(r.sales).toBe(0);
      expect(r.labor.runs).toBe(1);
      expect(r.result).toBe(-120_000);
      expect(r.resultPct).toBeNull();
      expect(r.fixed.missingCategories).toHaveLength(5);
    });
  });

  it("un mes vacío no tiene datos", async () => {
    await inRollback("nahuel", async (tx) => {
      const r = await getMonthlyResult(tx, "2026-03", { today: TODAY });
      expect(r.hasData).toBe(false);
      expect(r.result).toBe(0);
      await expect(getMonthlyResult(tx, "2026-13", { today: TODAY })).rejects.toThrow(/Mes inválido/);
    });
  });

  it("evolución de 6 meses: abril a septiembre, septiembre coincide con el detalle", async () => {
    await inRollback("nahuel", async (tx) => {
      const h = await getResultHistory(tx, "2026-09", 6, { today: TODAY });
      expect(h.map((p) => p.month)).toEqual([
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
      ]);
      expect(h.slice(0, 4).every((p) => !p.hasData)).toBe(true);
      // Agosto: sólo gastos fijos cargados (sin ventas ni producciones) → −$1.040.000.
      expect(h[4]).toMatchObject({ month: "2026-08", sales: 0, result: -1_040_000, hasData: true });
      expect(h[5]!.result).toBe(-1_108_282.34);
    });
  });
});

describe("costos y simulador (RF-39)", () => {
  it("lácteos ≈ 76 % y quesos ≈ 53,5 % del costo de ingredientes", async () => {
    await inRollback("nahuel", async (tx) => {
      const o = await getCostOverview(tx, TODAY);
      expect(o.ingredientsCostPerRun).toBe(791_934);
      // quesos 222.300 + 201.465 = 423.765 → 53,5 %; + manteca 147.000 + leche 31.980 = 602.745 → 76,1 %.
      expect(o.cheesePctOfIngredients).toBe(53.5);
      expect(o.dairyPctOfIngredients).toBe(76.1);
      expect(o.costs.producedKgPerRun).toBe(149.3);
      expect(o.costs.yield.source).toBe("real");
    });
  });

  it("el Excel dividía por 163,5 kg: subestimaba el costo por kg de ingredientes ≈ 8,7 %", async () => {
    await inRollback("nahuel", async (tx) => {
      const { excel } = await getCostOverview(tx, TODAY);
      expect(excel.ingredientsPerKgExcel).toBe(4843.63); // 791.934 ÷ 163,5
      expect(excel.ingredientsPerKgReal).toBe(5304.31); // 791.934 ÷ 149,3
      expect(excel.underestimatedPct).toBe(8.7);
    });
  });

  it("sensibilidad: quesos −5 % baja ≈ 2,7 % el costo de ingredientes y reproduce el costo actual sin cambios", async () => {
    await inRollback("nahuel", async (tx) => {
      const o = await getCostOverview(tx, TODAY);
      const { costs } = o;
      const tap = costs.products.find((p) => p.code === "CH-TAP-500")!;
      const recipeLines = costs.ingredients.map((l) => ({
        ingredientId: l.ingredientId,
        qty: l.qtyPerKgStarch * costs.starchKgPerRun,
        unitPriceNet: l.unitPriceNet!,
      }));
      const input = {
        recipeLines,
        laborPerRun: costs.labor.costPerRun,
        producedKgPerRun: costs.producedKgPerRun,
        components: tap.components.map((c) => ({
          ingredientId: c.ingredientId,
          qty: c.qtyPerUnit,
          unitPriceNet: c.unitPriceNet!,
        })),
        netWeightKg: tap.netWeightKg,
      };
      const before = simulateUnitCost({ ...input, changesPct: {} });
      expect(before.unitCost).toBe(tap.unitCost); // misma cuenta que getProductCosts
      expect(before.ingredientsCostPerKg).toBe(costs.ingredientsCostPerKg);

      const cheeseIds = costs.ingredients
        .filter((l) => /queso|reggianito/i.test(l.name))
        .map((l) => l.ingredientId);
      expect(cheeseIds).toHaveLength(2);
      const after = simulateUnitCost({
        ...input,
        changesPct: Object.fromEntries(cheeseIds.map((id) => [id, -5])),
      });
      expect(pctChange(before.ingredientsCostPerKg, after.ingredientsCostPerKg)).toBeCloseTo(-2.68, 1);
      expect(after.unitCost).toBeLessThan(before.unitCost);
    });
  });

  it("el sándwich y los granel de 5 kg muestran precio faltante, no $0", async () => {
    await inRollback("nahuel", async (tx) => {
      const { costs } = await getCostOverview(tx, TODAY);
      const missing = costs.products.filter((p) => p.missingPrices.length > 0);
      expect(missing.length).toBeGreaterThan(0);
      expect(missing.every((p) => p.unitCost === null)).toBe(true);
    });
  });
});

describe("permisos de lo financiero", () => {
  it("sólo Dirección lee y escribe finanzas; la jefa de producción tiene tablero pero no finanzas", () => {
    expect(can("admin", "finance:read")).toBe(true);
    expect(can("admin", "finance:write")).toBe(true);
    for (const role of [
      "production_manager",
      "logistics",
      "operator",
      "store",
      "technical_lead",
      "accountant",
    ] as const) {
      expect(can(role, "finance:read")).toBe(false);
      expect(can(role, "finance:write")).toBe(false);
    }
    expect(can("production_manager", "dashboard:read")).toBe(true);
  });
});
