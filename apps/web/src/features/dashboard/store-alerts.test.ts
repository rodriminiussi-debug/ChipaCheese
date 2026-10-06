import { describe, expect, it } from "vitest";
import { eq, schema } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { createReplenishment } from "@/features/store/replenishment";
import { getDashboard } from "./service";

const TODAY = "2026-10-02";

describe("alertas del local en el tablero", () => {
  it("muestra stock por agotarse y reposiciones pendientes de enviar", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const before = await getDashboard(tx, { today: TODAY, month: "2026-09", includeFinance: false });
      expect(before.alerts.find((a) => a.id === "store-replenishment")).toBeUndefined();

      const tap = await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") });
      await createReplenishment(tx, userId, {
        neededBy: TODAY,
        items: [{ productId: tap!.id, qty: 40 }],
      });
      const after = await getDashboard(tx, { today: TODAY, month: "2026-09", includeFinance: false });
      const rep = after.alerts.find((a) => a.id === "store-replenishment");
      expect(rep?.count).toBe(1);
      expect(rep?.href).toBe("/stock/reposicion");
      expect(rep?.financial).toBe(false);
    });
  });
});
