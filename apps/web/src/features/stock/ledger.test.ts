import { describe, expect, it } from "vitest";
import { eq, schema } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import {
  allocateProductFefo,
  finishedLotBalances,
  ingredientTotals,
  locationByCode,
  recordProductMovements,
} from "./ledger";

describe("libro mayor de stock", () => {
  it("los totales de insumos reflejan el seed demo (fécula 225 − 75 consumidos)", async () => {
    await inRollback("af", async (tx) => {
      const fecula = await tx.query.ingredients.findFirst({
        where: eq(schema.ingredients.name, "Fécula de mandioca"),
      });
      const totals = await ingredientTotals(tx);
      expect(totals[fecula!.id]).toBe(150);
    });
  });

  it("asigna FEFO: primero el lote que vence antes (260901-1)", async () => {
    await inRollback("af", async (tx) => {
      const p = await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") });
      const { allocations } = await allocateProductFefo(tx, p!.id, 70);
      expect(allocations.map((a) => [a.code, a.qty])).toEqual([
        ["260901-1", 60],
        ["261001-1", 10],
      ]);
    });
  });

  it("falla si no alcanza el stock y excluye lotes retenidos", async () => {
    await inRollback("af", async (tx, userId) => {
      const p = await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-ARI-500") });
      await expect(allocateProductFefo(tx, p!.id, 1000)).rejects.toThrow(/No hay stock suficiente/);
      await tx
        .update(schema.finishedLots)
        .set({ onHold: true })
        .where(eq(schema.finishedLots.code, "260901-1"));
      const bal = await finishedLotBalances(tx, p!.id);
      expect(bal.map((b) => b.code)).toEqual(["261001-1"]);
      const f3 = await locationByCode(tx, "F3");
      await recordProductMovements(tx, userId, [
        { type: "waste", productId: p!.id, finishedLotId: bal[0]!.finishedLotId, locationId: f3.id, qty: -1 },
      ]);
      expect((await finishedLotBalances(tx, p!.id))[0]!.qty).toBe(18);
    });
  });
});
