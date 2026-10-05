import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { getProductCosts } from "@/features/costing/service";
import { materialUnitCosts } from "@/features/finance/service";
import { createOrder, orderFormData } from "@/features/orders/service";
import { createOrderInput } from "@/features/orders/schemas";
import { getPriceMatrix } from "@/features/pricing/service";
import { packingOptions, suggestPlan } from "@/features/production/service";
import { getProductStockMatrix, transferProduct } from "@/features/stock/service";

/** Los tipos de producto (fabricado, reventa, elaborado) conviven en costeo, precios, pedidos, plan y stock. */

const TODAY = "2026-10-02";

const byCode = async (tx: Executor, code: string) =>
  (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;

describe("tipos de producto en costeo y precios", () => {
  it("la matriz de precios muestra reventa y elaborado con su margen (último costo / base × cantidad)", async () => {
    await inRollback("nahuel", async (tx) => {
      const { lists } = await getPriceMatrix(tx, TODAY);
      const local = lists.find((l) => l.name === "Local (minorista)")!;
      const gas = local.rows.find((r) => r.code === "RV-GAS-500")!;
      expect(gas.kind).toBe("resale");
      expect(gas.price).toBe(1800);
      expect(gas.cost).toBe(1100);
      expect(gas.marginPct).toBeCloseTo(((1800 - 1100) / 1800) * 100, 1);
      const hor = local.rows.find((r) => r.code === "EL-HOR-250")!;
      expect(hor.kind).toBe("prepared");
      expect(hor.cost).not.toBeNull();
      expect(hor.price).toBe(3200);
      expect(hor.status).not.toBe("no_cost");
    });
  });

  it("sin costo de compra el producto de reventa queda con 'precio faltante' (nunca $0)", async () => {
    await inRollback("nahuel", async (tx) => {
      const gas = await byCode(tx, "RV-GAS-500");
      await tx.delete(schema.productCosts).where(eq(schema.productCosts.productId, gas.id));
      const { lists } = await getPriceMatrix(tx, TODAY);
      const row = lists
        .find((l) => l.name === "Local (minorista)")!
        .rows.find((r) => r.code === "RV-GAS-500")!;
      expect(row.cost).toBeNull();
      expect(row.status).toBe("no_cost");
      expect(row.marginPct).toBeNull();
    });
  });

  it("el costo de materiales del resultado mensual contempla los tres tipos", async () => {
    await inRollback("nahuel", async (tx) => {
      const costs = await getProductCosts(tx, TODAY);
      const m = materialUnitCosts(costs);
      const tap = await byCode(tx, "CH-TAP-500");
      const gas = await byCode(tx, "RV-GAS-500");
      const hor = await byCode(tx, "EL-HOR-250");
      expect(m.get(gas.id)).toMatchObject({ cost: 1100, complete: true });
      // El elaborado consume media bolsa de tapitas: la mitad de los materiales de la bolsa.
      expect(m.get(hor.id)!.cost).toBeCloseTo(m.get(tap.id)!.cost * 0.5, 2);
      expect(m.get(hor.id)!.complete).toBe(true);
    });
  });
});

describe("tipos de producto en pedidos, plan y stock", () => {
  it("el formulario de pedido solo ofrece fabricados activos marcados 'disponible en pedidos'", async () => {
    await inRollback("nahuel", async (tx) => {
      const tap = await byCode(tx, "CH-TAP-500");
      const arito = await byCode(tx, "CH-ARI-500");
      const before = await orderFormData(tx, TODAY);
      const ids = before.products.map((p) => p.id);
      expect(ids).toContain(tap.id);
      expect(ids).not.toContain((await byCode(tx, "RV-GAS-500")).id);
      expect(ids).not.toContain((await byCode(tx, "EL-HOR-250")).id);

      await tx
        .update(schema.products)
        .set({ availableForOrders: false })
        .where(eq(schema.products.id, arito.id));
      expect((await orderFormData(tx, TODAY)).products.map((p) => p.id)).not.toContain(arito.id);
    });
  });

  it("un pedido no puede llevar un producto de reventa ni uno no disponible para pedidos", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const customer = (await tx.query.customers.findFirst({
        where: (t, { eq }) => eq(t.legalName, "Vía Dolce"),
      }))!;
      const gas = await byCode(tx, "RV-GAS-500");
      await expect(
        createOrder(
          tx,
          userId,
          createOrderInput.parse({
            customerId: customer.id,
            promisedDate: "2026-10-06",
            items: [{ productId: gas.id, qtyUnits: 2 }],
          }),
          { today: TODAY },
        ),
      ).rejects.toThrow(/no está disponible para pedidos/);
    });
  });

  it("el plan de producción y el envasado solo trabajan con fabricados", async () => {
    await inRollback("nahuel", async (tx) => {
      const gas = await byCode(tx, "RV-GAS-500");
      // Aunque la gaseosa tenga stock mínimo y movimientos, no genera demanda de masa.
      const before = await suggestPlan(tx, { date: TODAY, windowDays: 7, capacityKg: 150, minBatchKg: 75 });
      await tx.update(schema.products).set({ minStockUnits: 500 }).where(eq(schema.products.id, gas.id));
      const after = await suggestPlan(tx, { date: TODAY, windowDays: 7, capacityKg: 150, minBatchKg: 75 });
      expect(after.demands).toEqual(before.demands);
      expect(after.suggestion).toEqual(before.suggestion);

      const options = await packingOptions(tx);
      const codes = options.products.map((p) => p.code);
      expect(codes).toContain("CH-TAP-500");
      expect(codes).not.toContain("RV-GAS-500");
      expect(codes).not.toContain("EL-HOR-250");
    });
  });

  it("el stock de producto terminado muestra reventa (sin lote) pero no los elaborados, y no se transfiere", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const matrix = await getProductStockMatrix(tx);
      const kinds = Object.fromEntries(matrix.rows.map((r) => [r.code, r.kind]));
      expect(kinds["RV-GAS-500"]).toBe("resale");
      expect(kinds["EL-HOR-250"]).toBeUndefined();
      const gasRow = matrix.rows.find((r) => r.code === "RV-GAS-500")!;
      expect(gasRow.totalUnits).toBeGreaterThan(0);

      const local = (await tx.query.locations.findFirst({ where: eq(schema.locations.code, "LOCAL") }))!;
      const f3 = (await tx.query.locations.findFirst({ where: eq(schema.locations.code, "F3") }))!;
      await expect(
        transferProduct(tx, userId, {
          productId: gasRow.productId,
          fromLocationId: local.id,
          toLocationId: f3.id,
          units: 1,
          finishedLotId: null,
          note: null,
        }),
      ).rejects.toThrow(/no se transfiere/);
    });
  });
});
