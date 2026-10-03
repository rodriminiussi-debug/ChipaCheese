import { describe, expect, it } from "vitest";
import { marginPct, priceForMargin } from "@chipa/domain";
import { and, eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { currentPriceMap } from "@/features/orders/service";
import {
  applySuggestedPrices,
  getBelowCostPrices,
  getPriceMatrix,
  setPrice,
  updateTargetMargin,
} from "./service";

const TODAY = "2026-10-02";

async function listByName(tx: Executor, name: string) {
  return (await tx.query.priceLists.findFirst({ where: eq(schema.priceLists.name, name) }))!;
}
async function productByCode(tx: Executor, code: string) {
  return (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;
}
async function rowOf(tx: Executor, listName: string, code: string) {
  const { lists } = await getPriceMatrix(tx, TODAY);
  return lists.find((l) => l.name === listName)!.rows.find((r) => r.code === code)!;
}

describe("listas de precios por canal con margen (RF-29)", () => {
  it("calcula costo, margen % y $, y el precio sugerido por margen objetivo", async () => {
    await inRollback("nahuel", async (tx) => {
      const row = await rowOf(tx, "Revendedores (mayorista)", "CH-TAP-500");
      expect(row.price).toBe(4200);
      // Costo directo de la bolsa con el rendimiento real de las producciones demo (~$3.194).
      expect(row.cost!).toBeGreaterThan(3150);
      expect(row.cost!).toBeLessThan(3250);
      expect(row.marginPct).toBe(marginPct(4200, row.cost!));
      expect(row.marginPerUnit).toBeCloseTo(4200 - row.cost!, 2);
      expect(row.suggestedPrice).toBe(priceForMargin(row.cost!, 25));
      // Margen del mayorista ≈ 24 % < 25 % objetivo → bajo el objetivo, pero sobre el costo.
      expect(row.status).toBe("below_target");
    });
  });

  it("detecta precios bajo el objetivo, bajo el costo y productos sin precio o sin costo", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const tap = await productByCode(tx, "CH-TAP-500");
      await setPrice(
        tx,
        { priceListId: mayorista.id, productId: tap.id, unitPrice: 3000, validFrom: null },
        TODAY,
      );
      expect((await rowOf(tx, mayorista.name, "CH-TAP-500")).status).toBe("below_cost");
      expect((await rowOf(tx, mayorista.name, "CH-TAP-500")).marginPct!).toBeLessThan(0);
      const below = await getBelowCostPrices(tx, TODAY);
      expect(below.map((b) => `${b.listName}|${b.name}`)).toContain(`${mayorista.name}|${tap.name}`);

      // Pizzeta no está en la lista mayorista; el sándwich tiene precio pero falta el jamón y el queso.
      expect((await rowOf(tx, mayorista.name, "PZ-REC")).status).toBe("no_price");
      const sw = await rowOf(tx, mayorista.name, "SW-JYQ");
      expect(sw.status).toBe("no_cost");
      expect(sw.cost).toBeNull();
      expect(sw.marginPct).toBeNull();
      expect(sw.missingPrices).toContain("Jamón feteado");
    });
  });

  it("editar un precio agrega una fila con vigencia y conserva el historial", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const tap = await productByCode(tx, "CH-TAP-500");
      await setPrice(
        tx,
        { priceListId: mayorista.id, productId: tap.id, unitPrice: 4500, validFrom: null },
        TODAY,
      );
      // Con vigencia futura: hoy rige el anterior.
      await setPrice(
        tx,
        { priceListId: mayorista.id, productId: tap.id, unitPrice: 4800, validFrom: "2026-11-01" },
        TODAY,
      );

      const row = await rowOf(tx, mayorista.name, "CH-TAP-500");
      expect(row.price).toBe(4500);
      expect(row.validFrom).toBe(TODAY);
      expect(row.upcoming).toEqual({ validFrom: "2026-11-01", unitPrice: 4800 });
      expect(row.history.map((h) => h.unitPrice)).toEqual([4800, 4500, 4200]);

      // Las nuevas cargas de pedido toman el precio vigente.
      const map = await currentPriceMap(tx, TODAY, mayorista.id);
      expect(map[mayorista.id]![tap.id]).toBe(4500);
      expect((await currentPriceMap(tx, "2026-11-02", mayorista.id))[mayorista.id]![tap.id]).toBe(4800);

      // Corregir el mismo día no duplica la fila.
      await setPrice(
        tx,
        { priceListId: mayorista.id, productId: tap.id, unitPrice: 4550, validFrom: null },
        TODAY,
      );
      const rows = await tx
        .select()
        .from(schema.priceListItems)
        .where(
          and(
            eq(schema.priceListItems.priceListId, mayorista.id),
            eq(schema.priceListItems.productId, tap.id),
          ),
        );
      expect(rows).toHaveLength(3);
      expect((await rowOf(tx, mayorista.name, "CH-TAP-500")).price).toBe(4550);
    });
  });

  it("rechaza vigencias pasadas, listas inexistentes y márgenes inválidos", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const tap = await productByCode(tx, "CH-TAP-500");
      await expect(
        setPrice(
          tx,
          { priceListId: mayorista.id, productId: tap.id, unitPrice: 4500, validFrom: "2026-09-01" },
          TODAY,
        ),
      ).rejects.toThrow(/anterior a hoy/);
      await expect(
        setPrice(
          tx,
          {
            priceListId: "00000000-0000-4000-8000-000000000000",
            productId: tap.id,
            unitPrice: 1,
            validFrom: null,
          },
          TODAY,
        ),
      ).rejects.toThrow(/no existe/);
    });
  });

  it("editar el margen objetivo de la lista cambia el estado y el precio sugerido", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      await updateTargetMargin(tx, { priceListId: mayorista.id, targetMarginPct: 10 });
      const row = await rowOf(tx, mayorista.name, "CH-TAP-500");
      expect(row.status).toBe("ok");
      expect(row.suggestedPrice).toBe(priceForMargin(row.cost!, 10));
      await updateTargetMargin(tx, { priceListId: mayorista.id, targetMarginPct: 40 });
      expect((await rowOf(tx, mayorista.name, "CH-TAP-500")).status).toBe("below_target");
    });
  });

  it("aplica el precio sugerido de forma masiva solo a lo que está bajo el objetivo y nunca baja precios", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const before = await getPriceMatrix(tx, TODAY);
      const lista = before.lists.find((l) => l.id === mayorista.id)!;
      const expected = lista.rows.filter((r) => r.status === "below_target" || r.status === "below_cost");
      expect(expected.length).toBeGreaterThan(0);

      const { changes } = await applySuggestedPrices(
        tx,
        { priceListId: mayorista.id, productIds: null, validFrom: null },
        TODAY,
      );
      expect(changes.map((c) => c.productId).sort()).toEqual(expected.map((r) => r.productId).sort());
      const after = (await getPriceMatrix(tx, TODAY)).lists.find((l) => l.id === mayorista.id)!;
      for (const c of changes) {
        const r = after.rows.find((x) => x.productId === c.productId)!;
        expect(r.price).toBe(c.to);
        expect(r.price!).toBeGreaterThan(c.from);
        expect(r.status).toBe("ok");
      }
      // Los que ya cumplían (o no tienen costo) quedan igual.
      const untouched = after.rows.find((r) => r.code === "SW-JYQ")!;
      expect(untouched.price).toBe(2600);
      // Segunda vez: no hay nada para actualizar.
      await expect(
        applySuggestedPrices(tx, { priceListId: mayorista.id, productIds: null, validFrom: null }, TODAY),
      ).rejects.toThrow(/No hay precios bajo el margen/);
    });
  });

  it("puede aplicar el sugerido solo a los productos elegidos", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const tap = await productByCode(tx, "CH-TAP-500");
      const { changes } = await applySuggestedPrices(
        tx,
        { priceListId: mayorista.id, productIds: [tap.id], validFrom: null },
        TODAY,
      );
      expect(changes).toHaveLength(1);
      expect((await rowOf(tx, mayorista.name, "CH-LEN-500")).status).toBe("below_target");
    });
  });
});
