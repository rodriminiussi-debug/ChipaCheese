import { describe, expect, it } from "vitest";
import * as domain from "./index";

describe("public API (index)", () => {
  it("re-exporta las constantes y funciones de cada área", () => {
    expect(domain.BAG_KG).toBe(0.5);
    expect(domain.SHELF_LIFE_MONTHS).toBe(6);
    expect(domain.DAILY_CAPACITY_KG).toBe(150);
    expect(domain.MIN_BATCH_KG).toBe(75);
    expect(domain.STARCH_KG_PER_RECIPE).toBe(75);
    expect(domain.VAT_RATES).toEqual([0, 10.5, 21, 27]);
    for (const name of [
      "roundMoney",
      "roundQty",
      "bagsEquivalent",
      "kgFromBags",
      "addDays",
      "addMonths",
      "diffDays",
      "isoWeekday",
      "isWorkday",
      "nextWorkdays",
      "monthKey",
      "theoreticalConsumption",
      "consumptionDeviation",
      "checkConsumption",
      "recipeIngredientsKg",
      "productionYield",
      "lossKg",
      "finishedLotCode",
      "finishedLotExpiry",
      "validateDailyLoad",
      "allocateFefo",
      "averageDailyConsumption",
      "coverageDays",
      "reorderPoint",
      "needsReorder",
      "canProduce",
      "starchKgForProductKg",
      "ingredientsCost",
      "costPerKg",
      "costPerBag",
      "laborCostPerRun",
      "priceForMargin",
      "marginPct",
      "marginPerUnit",
      "canTransition",
      "nextStatuses",
      "orderKg",
      "averageOrderIntervalDays",
      "daysSinceLastOrder",
      "isCustomerOverdue",
      "estimateBigOrderDate",
      "suggestDailyPlan",
      "accountBalance",
      "applyFifo",
      "agingBuckets",
      "statementWithRunningBalance",
      "lineNet",
      "lineVat",
      "invoiceTotals",
      "validateInvoiceTotals",
      "isValidCuit",
      "formatCuit",
      "priceVariationPct",
      "routeCost",
      "costPerKgDelivered",
      "isLateEntry",
      "temperatureStatus",
      "nextMaintenanceDue",
      "maintenanceStatus",
      "complianceRate",
      "monthlyResult",
      "capacityUsagePct",
      "onTimeInFullRate",
      "formatARS",
      "formatKg",
      "formatNumber",
      "formatDateAR",
      "parseDecimalAR",
    ] as const) {
      expect(typeof (domain as Record<string, unknown>)[name], name).toBe("function");
    }
    expect(domain.ORDER_STATUSES).toHaveLength(9);
  });
});
