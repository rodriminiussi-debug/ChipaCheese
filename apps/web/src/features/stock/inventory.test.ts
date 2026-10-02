import { describe, expect, it } from "vitest";
import { eq, schema } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import {
  confirmInventoryCount,
  createInventoryCount,
  getInventoryCount,
  listInventoryCounts,
  saveCountItems,
  voidInventoryCount,
} from "./inventory";
import { finishedLotBalances, ingredientTotals, locationByCode, recordIngredientMovements } from "./ledger";
import { listMovements } from "./service";

describe("inventario físico guiado (RF-15)", () => {
  it("precarga una posición por insumo × lote × ubicación con el saldo del sistema", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id, items } = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      // 9 lotes de la recepción inicial; el lote de fécula queda en 150.
      expect(items).toBe(9);
      const detail = (await getInventoryCount(tx, id))!;
      expect(detail.count.status).toBe("draft");
      expect(detail.summary).toMatchObject({ total: 9, counted: 0, pending: 9, withDiff: 0 });
      const fecula = detail.items.find((i) => i.itemName === "Fécula de mandioca")!;
      expect(fecula).toMatchObject({
        lotCode: "FEC-2609",
        locationCode: "DEP-SECO",
        systemQty: 150,
        countedQty: null,
      });
      expect(fecula.unitPriceNet).toBe(1728);
      // Se agrupa por ubicación (DEP-SECO antes que HELADERA).
      expect(detail.items[0]!.locationCode).toBe("DEP-SECO");
    });
  });

  it("guardar parcial no ajusta nada; confirmar genera un 'adjustment' con lote por cada diferencia", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id } = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      const before = (await getInventoryCount(tx, id))!;
      const sal = before.items.find((i) => i.itemName === "Sal")!;
      const leche = before.items.find((i) => i.itemName === "Leche")!;
      const huevo = before.items.find((i) => i.itemName === "Huevo")!;
      const totalsBefore = await ingredientTotals(tx);

      // Avance parcial: solo se cargó la sal (falta 1 kg).
      await saveCountItems(tx, userId, id, [{ id: sal.id, countedQty: 7.1 }]);
      expect(await ingredientTotals(tx)).toEqual(totalsBefore);
      const partial = (await getInventoryCount(tx, id))!;
      expect(partial.summary).toMatchObject({ counted: 1, pending: 8, withDiff: 1 });

      // Se carga leche (sobran 4 L) y huevo sin diferencia, y se confirma.
      const res = await confirmInventoryCount(tx, userId, id, [
        { id: leche.id, countedQty: 40 },
        { id: huevo.id, countedQty: huevo.systemQty },
      ]);
      expect(res).toEqual({ adjusted: 2, counted: 3, pending: 6 });

      const totals = await ingredientTotals(tx);
      expect(totals[sal.itemId]).toBe(7.1);
      expect(totals[leche.itemId]).toBe(40);
      expect(totals[huevo.itemId]).toBe(huevo.systemQty);

      const { rows } = await listMovements(tx, { type: "adjustment" });
      expect(rows).toHaveLength(2);
      const salMove = rows.find((r) => r.itemName === "Sal")!;
      expect(salMove).toMatchObject({
        qty: -1,
        lotCode: "SAL-0901",
        locationCode: "DEP-SECO",
        refTable: "inventory_counts",
        refId: id,
        userName: "A.F. (Jefa de producción)",
      });
      expect(rows.find((r) => r.itemName === "Leche")!.qty).toBe(4);

      // El reporte: diferencia en cantidad y valorizada con el último precio sin IVA (sal $708/kg).
      const after = (await getInventoryCount(tx, id))!;
      expect(after.count.status).toBe("confirmed");
      const salRow = after.items.find((i) => i.itemName === "Sal")!;
      expect(salRow).toMatchObject({ diff: -1, diffValue: -708 });
      expect(after.items.find((i) => i.itemName === "Leche")).toMatchObject({ diff: 4, diffValue: 4264 });
      expect(after.summary).toMatchObject({ counted: 3, pending: 6, withDiff: 2, totalDiffValue: 3556 });
      expect((await listInventoryCounts(tx))[0]).toMatchObject({ id, items: 9, counted: 3, withDiff: 2 });
    });
  });

  it("al confirmar compara con el saldo ACTUAL (movimientos posteriores a la creación del conteo)", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id } = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      const detail = (await getInventoryCount(tx, id))!;
      const sal = detail.items.find((i) => i.itemName === "Sal")!;
      const dep = await locationByCode(tx, "DEP-SECO");
      const lot = (await tx.query.rawLots.findFirst({
        where: eq(schema.rawLots.supplierLotCode, "SAL-0901"),
      }))!;
      // Después de crear el conteo se consumen 2 kg; el operario cuenta lo que hay físicamente: 6,1.
      await recordIngredientMovements(tx, userId, [
        {
          type: "production_consumption",
          ingredientId: sal.itemId,
          rawLotId: lot.id,
          locationId: dep.id,
          qty: -2,
        },
      ]);
      const res = await confirmInventoryCount(tx, userId, id, [{ id: sal.id, countedQty: 6.1 }]);
      expect(res.adjusted).toBe(0);
      expect((await ingredientTotals(tx))[sal.itemId]).toBe(6.1);
      expect((await getInventoryCount(tx, id))!.items.find((i) => i.id === sal.id)!.systemQty).toBe(6.1);
    });
  });

  it("no se confirma dos veces, ni vacío, ni se edita un conteo cerrado; se puede anular", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id } = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      const items = (await getInventoryCount(tx, id))!.items;
      await expect(confirmInventoryCount(tx, userId, id, [])).rejects.toThrow(/al menos una cantidad/);

      await confirmInventoryCount(tx, userId, id, [{ id: items[0]!.id, countedQty: items[0]!.systemQty }]);
      await expect(confirmInventoryCount(tx, userId, id, [])).rejects.toThrow(/ya está cerrado/);
      await expect(saveCountItems(tx, userId, id, [{ id: items[0]!.id, countedQty: 1 }])).rejects.toThrow(
        /ya está cerrado/,
      );

      const other = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: "anular" });
      await voidInventoryCount(tx, other.id);
      expect((await getInventoryCount(tx, other.id))!.count.status).toBe("voided");
      await expect(voidInventoryCount(tx, other.id)).rejects.toThrow(/ya está cerrado/);
      // Una posición de otro conteo no se puede guardar en éste.
      const third = await createInventoryCount(tx, userId, { itemKind: "ingredient", notes: null });
      await expect(
        saveCountItems(tx, userId, third.id, [{ id: items[0]!.id, countedQty: 1 }]),
      ).rejects.toThrow(/no pertenece/);
    });
  });

  it("conteo de producto terminado: ajusta por lote y ubicación sin tocar otros lotes", async () => {
    await inRollback("af", async (tx, userId) => {
      const { id } = await createInventoryCount(tx, userId, { itemKind: "product", notes: null });
      const detail = (await getInventoryCount(tx, id))!;
      const tapitas = detail.items.filter((i) => i.itemName.startsWith("Chipá tapitas 0,5"));
      const sep = tapitas.find((i) => i.lotCode === "260901-1")!;
      expect(sep).toMatchObject({ systemQty: 60, locationCode: "F3", unit: "unit" });
      expect(sep.unitPriceNet).toBeNull(); // el producto no se valoriza con precio de insumo

      await confirmInventoryCount(tx, userId, id, [{ id: sep.id, countedQty: 57 }]);
      const p = (await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") }))!;
      const bal = await finishedLotBalances(tx, p.id);
      expect(bal.map((b) => [b.code, b.qty])).toEqual([
        ["260901-1", 57],
        ["261001-1", 100],
      ]);
      const mv = (await listMovements(tx, { type: "adjustment", productId: p.id })).rows;
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ qty: -3, lotCode: "260901-1", refTable: "inventory_counts", refId: id });
    });
  });
});
