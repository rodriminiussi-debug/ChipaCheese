import { describe, expect, it } from "vitest";
import { and, eq, schema, sql } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { receiveResaleProducts } from "./resale";

describe("ingreso de reventa", () => {
  it("suma stock en el local sin lote y registra el costo", async () => {
    await inRollback("local1", async (tx, userId) => {
      const gas = await tx.query.products.findFirst({ where: eq(schema.products.code, "RV-GAS-500") });
      const stockOf = async () => {
        const [r] = await tx.execute<{ qty: string | null }>(sql`
          select sum(v.qty) as qty from v_product_stock v join locations l on l.id = v.location_id
          where v.product_id = ${gas!.id} and l.code = 'LOCAL'`);
        return Number(r?.qty ?? 0);
      };
      const before = await stockOf();
      await receiveResaleProducts(tx, userId, {
        items: [{ productId: gas!.id, qty: 24, unitCostNet: 1150 }],
        date: "2026-10-02",
      });
      expect(await stockOf()).toBe(before + 24);
      const last = await tx
        .select()
        .from(schema.productLastCost)
        .where(and(eq(schema.productLastCost.productId, gas!.id)));
      expect(last[0]?.unitCostNet).toBe(1150);
    });
  });

  it("rechaza productos que no son de reventa", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") });
      await expect(
        receiveResaleProducts(tx, userId, { items: [{ productId: tap!.id, qty: 1 }], date: "2026-10-02" }),
      ).rejects.toThrow(/no es un producto de reventa/);
    });
  });
});
