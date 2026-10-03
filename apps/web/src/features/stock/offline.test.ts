import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import { createInventoryCount, getInventoryCount, saveCountItems } from "./inventory";
import { ingredientTotals } from "./ledger";
import { saveCountPayload } from "./schemas";

/** Inventario físico sin señal (RF-15): el guardado de avance es idempotente y no pisa lo más nuevo. */
describe("guardar avance del inventario desde la cola offline (RF-15)", () => {
  const T = (iso: string) => new Date(iso);

  it("un reenvío viejo de la cola no pisa un avance más nuevo ni mueve stock", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id } = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      const items = (await getInventoryCount(tx, id))!.items;
      const sal = items.find((i) => i.itemName === "Sal")!;
      const totals = await ingredientTotals(tx);
      const A = crypto.randomUUID();

      const first = await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: 7.1 }], {
        clientId: A,
        recordedAt: T("2026-10-02T10:00:00-03:00"),
      });
      expect(first).toMatchObject({ saved: 1, duplicate: false, stale: false });

      // Se corrige en pantalla y llega de nuevo el envío viejo con el mismo clientId: no pisa nada.
      await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: 7.3 }], {
        clientId: crypto.randomUUID(),
        recordedAt: T("2026-10-02T10:05:00-03:00"),
      });
      const replay = await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: 7.1 }], {
        clientId: A,
        recordedAt: T("2026-10-02T10:00:00-03:00"),
      });
      expect(replay).toMatchObject({ saved: 0, stale: true });
      const detail = (await getInventoryCount(tx, id))!;
      expect(detail.items.find((i) => i.id === sal.id)!.countedQty).toBe(7.3);
      expect(await ingredientTotals(tx)).toEqual(totals); // guardar avance nunca mueve stock
    });
  });

  it("reenviar exactamente el último envío es duplicado; un envío más nuevo sí se aplica", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id } = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      const sal = (await getInventoryCount(tx, id))!.items.find((i) => i.itemName === "Sal")!;
      const B = crypto.randomUUID();
      const stamp = { clientId: B, recordedAt: T("2026-10-02T11:00:00-03:00") };
      await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: 5 }], stamp);
      const dup = await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: 5 }], stamp);
      expect(dup).toMatchObject({ saved: 0, duplicate: true });

      const next = await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: null }], {
        clientId: crypto.randomUUID(),
        recordedAt: T("2026-10-02T11:30:00-03:00"),
      });
      expect(next).toMatchObject({ saved: 1, duplicate: false, stale: false });
      expect((await getInventoryCount(tx, id))!.items.find((i) => i.id === sal.id)!.countedQty).toBeNull();
    });
  });

  it("el payload exige clientId y recordedAt", () => {
    const base = { countId: crypto.randomUUID(), items: [] };
    expect(saveCountPayload.safeParse(base).success).toBe(false);
    expect(
      saveCountPayload.safeParse({
        ...base,
        clientId: crypto.randomUUID(),
        recordedAt: "2026-10-02T11:00:00-03:00",
      }).success,
    ).toBe(true);
  });
});
