import { describe, expect, it } from "vitest";
import { and, eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { changeOrderStatus, createOrder, createReception } from "../purchases/service";
import { purchaseOrderInput, receptionInput } from "../purchases/schemas";
import { ingredientTotals, locationByCode, recordIngredientMovements } from "./ledger";
import { ingredientAdjustmentInput, ingredientLevelsInput, productTransferInput } from "./schemas";
import {
  adjustIngredientStock,
  getFinishedLotPositions,
  getIngredientCoverage,
  getIngredientStockDetail,
  getProductStockMatrix,
  getRawLotLabel,
  getReorderAlerts,
  listMovements,
  nextExpiryByIngredient,
  simulateProductionFromStock,
  transferProduct,
  updateIngredientLevels,
} from "./service";

const TODAY = "2026-10-02";
const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T15:00:00Z`) - n * 86_400_000);

async function ingredientByName(tx: Tx, name: string) {
  return (await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.name, name) }))!;
}

/**
 * Insumo sintético: proveedor con 2 días de entrega, stock de seguridad 10 y consumos conocidos.
 * `stock` es el saldo final (después de los consumos).
 */
async function syntheticIngredient(
  tx: Tx,
  userId: string,
  o: { name: string; stock: number; consumptions: { daysAgo: number; qty: number }[]; minStock?: number },
) {
  const supplier = (await tx.query.suppliers.findFirst({
    where: eq(schema.suppliers.legalName, "Leo Pelle"),
  }))!;
  const loc = await locationByCode(tx, "DEP-SECO");
  const [ing] = await tx
    .insert(schema.ingredients)
    .values({
      name: o.name,
      category: "other",
      unit: "kg",
      minStock: o.minStock ?? 0,
      safetyStock: 10,
      defaultSupplierId: supplier.id,
    })
    .returning();
  const consumed = o.consumptions.reduce((a, c) => a + c.qty, 0);
  await recordIngredientMovements(tx, userId, [
    { type: "receipt", ingredientId: ing!.id, locationId: loc.id, qty: o.stock + consumed },
    ...o.consumptions.map((c) => ({
      type: "production_consumption" as const,
      ingredientId: ing!.id,
      locationId: loc.id,
      qty: -c.qty,
      occurredAt: daysAgo(c.daysAgo),
    })),
  ]);
  return ing!;
}

describe("cobertura y punto de pedido (RF-14)", () => {
  it("calcula consumo diario de 30 días, cobertura, punto de pedido y estado con consumos sintéticos", async () => {
    await inRollback("af", async (tx, userId) => {
      // 300 kg consumidos dentro de la ventana → 10 kg/día. Los 1000 kg de hace 45 días no cuentan.
      const sano = await syntheticIngredient(tx, userId, {
        name: "Insumo test sano",
        stock: 100,
        consumptions: [
          { daysAgo: 5, qty: 100 },
          { daysAgo: 10, qty: 200 },
          { daysAgo: 45, qty: 1000 },
        ],
      });
      const critico = await syntheticIngredient(tx, userId, {
        name: "Insumo test crítico",
        stock: 20,
        consumptions: [{ daysAgo: 3, qty: 300 }],
      });
      const sinConsumo = await syntheticIngredient(tx, userId, {
        name: "Insumo test sin consumo",
        stock: 500,
        consumptions: [],
      });
      const agotado = await syntheticIngredient(tx, userId, {
        name: "Insumo test agotado",
        stock: 0,
        consumptions: [{ daysAgo: 1, qty: 30 }],
      });
      // Un "consumo" positivo y una merma NO entran en el consumo diario (sí mueven el saldo).
      const dep = await locationByCode(tx, "DEP-SECO");
      await recordIngredientMovements(tx, userId, [
        {
          type: "production_consumption",
          ingredientId: sano.id,
          locationId: dep.id,
          qty: 50,
          occurredAt: daysAgo(2),
        },
        { type: "waste", ingredientId: sano.id, locationId: dep.id, qty: -20, occurredAt: daysAgo(2) },
      ]);

      const rows = await getIngredientCoverage(tx, { today: TODAY });
      const by = (id: string) => rows.find((r) => r.ingredientId === id)!;

      expect(by(sano.id)).toMatchObject({
        stock: 130,
        avgDailyConsumption: 10,
        coverageDays: 13,
        leadTimeDays: 2,
        reorderPoint: 30, // 10 × 2 + seguridad 10
        status: "ok",
        shortfallToReorderPoint: 0,
      });
      expect(by(critico.id)).toMatchObject({
        stock: 20,
        avgDailyConsumption: 10,
        coverageDays: 2,
        reorderPoint: 30,
        status: "reorder",
        shortfallToReorderPoint: 10,
        supplierName: "Leo Pelle",
      });
      expect(by(sinConsumo.id)).toMatchObject({
        avgDailyConsumption: 0,
        coverageDays: null,
        reorderPoint: 10,
        status: "no_consumption",
      });
      expect(by(agotado.id)).toMatchObject({ stock: 0, status: "out_of_stock", coverageDays: 0 });

      // Orden por urgencia: sin stock → reponer → ok → sin consumo.
      const order = rows
        .filter((r) => [sano.id, critico.id, sinConsumo.id, agotado.id].includes(r.ingredientId))
        .map((r) => r.ingredientId);
      expect(order).toEqual([agotado.id, critico.id, sano.id, sinConsumo.id]);
      const firstOk = rows.findIndex((r) => r.status === "ok");
      const lastReorder = rows.map((r) => r.status).lastIndexOf("reorder");
      expect(lastReorder).toBeLessThan(firstOk);

      // Alertas: solo sin stock y reponer, en ese orden.
      const alerts = await getReorderAlerts(tx, { today: TODAY });
      expect(alerts.every((a) => a.status === "reorder" || a.status === "out_of_stock")).toBe(true);
      expect(alerts.map((a) => a.ingredientId)).toEqual(expect.arrayContaining([agotado.id, critico.id]));
      expect(alerts.find((a) => a.ingredientId === sano.id)).toBeUndefined();
    });
  });

  it("usa el seed demo: fécula con 150 kg y 75 kg consumidos el 01/10 → 2,5 kg/día y 60 días", async () => {
    await inRollback("af", async (tx) => {
      const rows = await getIngredientCoverage(tx, { today: TODAY });
      const fecula = rows.find((r) => r.name === "Fécula de mandioca")!;
      expect(fecula).toMatchObject({
        stock: 150,
        avgDailyConsumption: 2.5,
        coverageDays: 60,
        leadTimeDays: 2,
        reorderPoint: 43, // 2,5 × 2 + seguridad 38
        status: "ok",
      });
      // Insumos sin stock (jamón, queso feteado) van primero.
      expect(rows[0]!.status).toBe("out_of_stock");
    });
  });

  it("un insumo bajo su stock mínimo pasa a 'reponer' y la edición de niveles lo refleja", async () => {
    await inRollback("af", async (tx, userId) => {
      const sal = await ingredientByName(tx, "Sal");
      const before = (await getIngredientCoverage(tx, { today: TODAY })).find(
        (r) => r.ingredientId === sal.id,
      )!;
      expect(before.status).toBe("ok");
      await updateIngredientLevels(tx, { ingredientId: sal.id, minStock: 20, safetyStock: 5 });
      const after = (await getIngredientCoverage(tx, { today: TODAY })).find(
        (r) => r.ingredientId === sal.id,
      )!;
      expect(after).toMatchObject({ minStock: 20, safetyStock: 5, status: "reorder" });
      await expect(
        updateIngredientLevels(tx, {
          ingredientId: "00000000-0000-4000-8000-000000000000",
          minStock: 1,
          safetyStock: 1,
        }),
      ).rejects.toThrow(/no existe/);
      void userId;
    });
  });

  it("valida los niveles: no acepta negativos", () => {
    const base = { ingredientId: "00000000-0000-4000-8000-000000000000" };
    expect(ingredientLevelsInput.safeParse({ ...base, minStock: -1, safetyStock: 0 }).success).toBe(false);
    expect(ingredientLevelsInput.safeParse({ ...base, minStock: "12.5", safetyStock: "3" }).success).toBe(
      true,
    );
  });
});

describe("stock de materia prima y ajustes manuales (RF-13)", () => {
  it("detalle por lote con proveedor, vencimiento y días a vencer (alerta ≤ 7 días)", async () => {
    await inRollback("af", async (tx) => {
      const leche = await ingredientByName(tx, "Leche");
      const detail = (await getIngredientStockDetail(tx, leche.id, "2026-10-08"))!;
      expect(detail.total).toBe(36);
      expect(detail.positions).toHaveLength(1);
      expect(detail.positions[0]).toMatchObject({
        supplierLotCode: "LEC-0928",
        supplierName: "Cotar",
        locationCode: "HELADERA",
        expiryDate: "2026-10-12",
        daysLeft: 4,
        expiryLevel: "soon",
        qty: 36,
      });
      const far = (await getIngredientStockDetail(tx, leche.id, "2026-10-02"))!;
      expect(far.positions[0]).toMatchObject({ daysLeft: 10, expiryLevel: "ok" });
      const expired = await nextExpiryByIngredient(tx, "2026-10-20");
      expect(expired[leche.id]).toMatchObject({ level: "expired" });
      expect(await getIngredientStockDetail(tx, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });

  it("merma genera un movimiento 'waste' negativo con lote, motivo y usuario", async () => {
    await inRollback("af", async (tx, userId) => {
      const leche = await ingredientByName(tx, "Leche");
      const pos = (await getIngredientStockDetail(tx, leche.id, TODAY))!.positions[0]!;
      await adjustIngredientStock(tx, userId, {
        ingredientId: leche.id,
        rawLotId: pos.rawLotId,
        locationId: pos.locationId,
        kind: "shrinkage",
        qty: 5,
        reason: "Se cortó la cadena de frío",
      });
      expect((await ingredientTotals(tx))[leche.id]).toBe(31);
      const { rows } = await listMovements(tx, { ingredientId: leche.id, type: "waste" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        qty: -5,
        lotCode: "LEC-0928",
        userName: "A.F. (Jefa de producción)",
        refTable: "stock_adjustment",
      });
      expect(rows[0]!.note).toContain("Merma: Se cortó la cadena de frío");
    });
  });

  it("corrección en más → 'adjustment' positivo; en menos y descarte restan; no se puede superar el saldo", async () => {
    await inRollback("af", async (tx, userId) => {
      const sal = await ingredientByName(tx, "Sal");
      const pos = (await getIngredientStockDetail(tx, sal.id, TODAY))!.positions[0]!;
      const base = { ingredientId: sal.id, rawLotId: pos.rawLotId, locationId: pos.locationId };
      await adjustIngredientStock(tx, userId, {
        ...base,
        kind: "correction_in",
        qty: 2,
        reason: "Conteo de balanza",
      });
      await adjustIngredientStock(tx, userId, {
        ...base,
        kind: "correction_out",
        qty: 0.5,
        reason: "Derrame chico",
      });
      await adjustIngredientStock(tx, userId, { ...base, kind: "discard", qty: 1, reason: "Bolsa húmeda" });
      expect((await ingredientTotals(tx))[sal.id]).toBe(8.6); // 8,1 + 2 − 0,5 − 1
      const types = (await listMovements(tx, { ingredientId: sal.id })).rows.map((r) => r.type);
      expect(types.filter((t) => t === "adjustment")).toHaveLength(2);
      expect(types.filter((t) => t === "waste")).toHaveLength(1);

      await expect(
        adjustIngredientStock(tx, userId, { ...base, kind: "discard", qty: 100, reason: "Demasiado" }),
      ).rejects.toThrow(/saldo/);
    });
  });

  it("rechaza lote de otro insumo y exige motivo en el esquema", async () => {
    await inRollback("af", async (tx, userId) => {
      const sal = await ingredientByName(tx, "Sal");
      const leche = await ingredientByName(tx, "Leche");
      const lechePos = (await getIngredientStockDetail(tx, leche.id, TODAY))!.positions[0]!;
      await expect(
        adjustIngredientStock(tx, userId, {
          ingredientId: sal.id,
          rawLotId: lechePos.rawLotId,
          locationId: lechePos.locationId,
          kind: "discard",
          qty: 1,
          reason: "Lote equivocado",
        }),
      ).rejects.toThrow(/no corresponde/);
    });
    const base = {
      ingredientId: "00000000-0000-4000-8000-000000000000",
      locationId: "00000000-0000-4000-8000-000000000001",
      kind: "discard",
      qty: 1,
    };
    expect(ingredientAdjustmentInput.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(ingredientAdjustmentInput.safeParse({ ...base, reason: "  " }).success).toBe(false);
    expect(ingredientAdjustmentInput.safeParse({ ...base, reason: "Motivo válido" }).success).toBe(true);
    expect(ingredientAdjustmentInput.safeParse({ ...base, qty: 0, reason: "Motivo válido" }).success).toBe(
      false,
    );
  });
});

describe("producto terminado y transferencias (RF-16)", () => {
  it("la matriz producto × ubicación suma unidades y kg (seed: tapitas 500 g con 160 en F3)", async () => {
    await inRollback("af", async (tx) => {
      const m = await getProductStockMatrix(tx);
      expect(m.locations.map((l) => l.code)).toEqual(["F3", "F4", "LOCAL", "VEHICULO"]);
      const f3 = m.locations.find((l) => l.code === "F3")!;
      const tap = m.rows.find((r) => r.code === "CH-TAP-500")!;
      expect(tap.byLocation[f3.id]).toBe(160);
      expect(tap.totalUnits).toBe(160);
      expect(tap.totalKg).toBe(80);
      expect(m.totalKg).toBeGreaterThan(0);
      expect(typeof tap.belowMin).toBe("boolean");
    });
  });

  it("transfiere F3 → LOCAL con FEFO: dos pares de movimientos con el mismo lote", async () => {
    await inRollback("af", async (tx, userId) => {
      const p = (await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") }))!;
      const f3 = await locationByCode(tx, "F3");
      const local = await locationByCode(tx, "LOCAL");
      const res = await transferProduct(tx, userId, {
        productId: p.id,
        fromLocationId: f3.id,
        toLocationId: local.id,
        units: 70,
        finishedLotId: null,
        note: null,
      });
      expect(res.moved.map((m) => [m.code, m.qty])).toEqual([
        ["260901-1", 60],
        ["261001-1", 10],
      ]);

      const m = await getProductStockMatrix(tx);
      const row = m.rows.find((r) => r.productId === p.id)!;
      expect(row.byLocation[f3.id]).toBe(90);
      expect(row.byLocation[local.id]).toBe(70);
      expect(row.totalUnits).toBe(160); // el total no cambia

      const { rows } = await listMovements(tx, { productId: p.id, type: "transfer" });
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((r) => r.refId)).size).toBe(1);
      expect(rows.reduce((a, r) => a + r.qty, 0)).toBe(0);

      // Cada lote conserva su vencimiento al llegar al local.
      const lots = await getFinishedLotPositions(tx, TODAY);
      const inLocal = lots.filter((l) => l.productId === p.id && l.locationCode === "LOCAL");
      expect(inLocal.map((l) => [l.lotCode, l.qty])).toEqual([
        ["260901-1", 60],
        ["261001-1", 10],
      ]);
    });
  });

  it("permite elegir el lote puntual y valida saldo, ubicaciones y lotes retenidos", async () => {
    await inRollback("af", async (tx, userId) => {
      const p = (await tx.query.products.findFirst({ where: eq(schema.products.code, "CH-TAP-500") }))!;
      const f3 = await locationByCode(tx, "F3");
      const f4 = await locationByCode(tx, "F4");
      const dep = await locationByCode(tx, "DEP-SECO");
      const oct = (await tx.query.finishedLots.findFirst({
        where: eq(schema.finishedLots.code, "261001-1"),
      }))!;
      const base = { productId: p.id, fromLocationId: f3.id, toLocationId: f4.id, note: null };

      const res = await transferProduct(tx, userId, { ...base, units: 5, finishedLotId: oct.id });
      expect(res.moved).toEqual([{ finishedLotId: oct.id, qty: 5, code: "261001-1" }]);

      await expect(
        transferProduct(tx, userId, { ...base, units: 101, finishedLotId: oct.id }),
      ).rejects.toThrow(/hay 95 unidades/);
      await expect(
        transferProduct(tx, userId, { ...base, units: 9999, finishedLotId: null }),
      ).rejects.toThrow(/No hay stock suficiente/);
      await expect(
        transferProduct(tx, userId, { ...base, toLocationId: dep.id, units: 1, finishedLotId: null }),
      ).rejects.toThrow(/solo se mueve entre/);

      // Los lotes retenidos por calidad no salen por FEFO.
      await tx
        .update(schema.finishedLots)
        .set({ onHold: true })
        .where(eq(schema.finishedLots.code, "260901-1"));
      const r2 = await transferProduct(tx, userId, { ...base, units: 20, finishedLotId: null });
      expect(r2.moved.map((m) => m.code)).toEqual(["261001-1"]);
    });
  });

  it("el esquema rechaza origen = destino y unidades no enteras", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const ok = {
      productId: id,
      fromLocationId: id,
      toLocationId: "00000000-0000-4000-8000-000000000001",
      units: 3,
    };
    expect(productTransferInput.safeParse(ok).success).toBe(true);
    expect(productTransferInput.safeParse({ ...ok, toLocationId: id }).success).toBe(false);
    expect(productTransferInput.safeParse({ ...ok, units: 2.5 }).success).toBe(false);
    expect(productTransferInput.safeParse({ ...ok, units: 0 }).success).toBe(false);
  });
});

describe("libro mayor de movimientos", () => {
  it("filtra por tipo, insumo, lote y fechas, y pagina", async () => {
    await inRollback("af", async (tx) => {
      const fecula = await ingredientByName(tx, "Fécula de mandioca");
      const all = await listMovements(tx, {}, 1, 5);
      expect(all.rows).toHaveLength(5);
      expect(all.total).toBeGreaterThan(5);
      expect(all.pageCount).toBe(Math.ceil(all.total / 5));
      const page2 = await listMovements(tx, {}, 2, 5);
      expect(page2.rows[0]!.id).not.toBe(all.rows[0]!.id);

      const consumos = await listMovements(tx, { type: "production_consumption" });
      expect(consumos.total).toBe(7);
      expect(consumos.rows.every((r) => r.qty < 0)).toBe(true);
      expect(consumos.rows[0]!.userName).toBe("A.F. (Jefa de producción)");
      expect(consumos.rows[0]!.refTable).toBe("production_runs");

      const f = await listMovements(tx, { ingredientId: fecula.id });
      expect(f.rows.map((r) => r.type).sort()).toEqual(["production_consumption", "receipt"]);

      const byLot = await listMovements(tx, { lot: "260901" });
      expect(byLot.rows.length).toBeGreaterThan(0);
      expect(byLot.rows.every((r) => r.lotCode === "260901-1")).toBe(true);

      const day = await listMovements(tx, { from: "2026-09-28", to: "2026-09-28" });
      expect(day.rows.every((r) => r.type === "receipt")).toBe(true);
      expect(day.total).toBe(9);
      expect((await listMovements(tx, { from: "2026-12-01" })).total).toBe(0);
      expect(
        (await listMovements(tx, { itemKind: "product" })).rows.every((r) => r.itemKind === "product"),
      ).toBe(true);
    });
  });
});

describe("simulador (RF-17)", () => {
  it("falta fécula: 200 kg de fécula contra 150 kg de stock", async () => {
    await inRollback("af", async (tx) => {
      const sim = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 200 }))!;
      expect(sim.ok).toBe(false);
      const fecula = sim.rows.find((r) => r.name === "Fécula de mandioca")!;
      expect(fecula).toMatchObject({ needed: 200, available: 150, shortfall: 50, ok: false });
      expect(sim.rows.find((r) => r.name === "Sal")!.ok).toBe(true);
      expect(sim.rows).toHaveLength(7);
      // Manda la manteca (15 kg ÷ 0,2): 75 kg de fécula = 1 receta completa.
      expect(sim.maxStarchKg).toBe(75);
      expect(sim.completeRecipes).toBe(1);
      expect(sim.maxProductKg).toBe(149.25);
    });
  });

  it("en modo kg de producto convierte con el rendimiento esperado de la receta activa", async () => {
    await inRollback("af", async (tx) => {
      const sim = (await simulateProductionFromStock(tx, { mode: "product_kg", kg: 100 }))!;
      expect(sim.recipe.expectedYieldPerKgStarch).toBe(1.99);
      expect(sim.starchKg).toBe(50.251); // 100 ÷ 1,99
      expect(sim.ok).toBe(true);
      expect(sim.rows.every((r) => r.shortfall === 0)).toBe(true);
    });
  });

  it("sin receta activa devuelve null y refleja el stock real tras un ajuste", async () => {
    await inRollback("af", async (tx, userId) => {
      const manteca = await ingredientByName(tx, "Manteca");
      const pos = (await getIngredientStockDetail(tx, manteca.id, TODAY))!.positions[0]!;
      await adjustIngredientStock(tx, userId, {
        ingredientId: manteca.id,
        rawLotId: pos.rawLotId,
        locationId: pos.locationId,
        kind: "correction_in",
        qty: 15,
        reason: "Compra no registrada",
      });
      const sim = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 100 }))!;
      expect(sim.rows.find((r) => r.name === "Manteca")).toMatchObject({
        available: 30,
        needed: 20,
        ok: true,
      });

      await tx
        .update(schema.recipes)
        .set({ status: "archived" })
        .where(and(eq(schema.recipes.status, "active")));
      expect(await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 100 })).toBeNull();
    });
  });
});

describe("etiqueta del lote de materia prima (RF-11)", () => {
  it("devuelve insumo, lote y vencimiento del proveedor, cantidad y recepción para imprimir el QR con el id", async () => {
    await inRollback("af", async (tx) => {
      const leche = await ingredientByName(tx, "Leche");
      const lot = (await tx.query.rawLots.findFirst({ where: eq(schema.rawLots.ingredientId, leche.id) }))!;
      const label = (await getRawLotLabel(tx, lot.id))!;
      expect(label).toMatchObject({
        id: lot.id,
        ingredient: "Leche",
        supplierLotCode: lot.supplierLotCode,
        receivedQty: lot.receivedQty,
      });
      expect(label.supplier).toBeTruthy();
      expect(label.expiryDate).toBe(lot.expiryDate);
    });
  });

  it("devuelve null si el lote no existe", async () => {
    await inRollback("af", async (tx) => {
      expect(await getRawLotLabel(tx, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});

describe("simulador con compras en camino (RF-17)", () => {
  async function manteca(tx: Tx) {
    const ing = await ingredientByName(tx, "Manteca");
    const supplier = (await tx.query.suppliers.findFirst({
      where: eq(schema.suppliers.legalName, "Leo Pelle"),
    }))!;
    return { ing, supplier };
  }
  const mk = async (
    tx: Tx,
    userId: string,
    supplierId: string,
    ingredientId: string,
    qty: number,
    expectedAt: string,
    status?: "sent" | "cancelled",
  ) => {
    const o = await createOrder(
      tx,
      userId,
      purchaseOrderInput.parse({
        supplierId,
        orderedAt: "2026-10-01",
        expectedAt,
        items: [{ ingredientId, qty }],
      }),
    );
    if (status) await changeOrderStatus(tx, o.id, status);
    return o;
  };

  it("muestra lo que falta recibir de las OC enviadas, con su fecha, separado del stock actual", async () => {
    await inRollback("af", async (tx, userId) => {
      const { ing, supplier } = await manteca(tx);
      const stock = (await ingredientTotals(tx))[ing.id]!;
      const base = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 100 }))!;
      const row0 = base.rows.find((r) => r.name === "Manteca")!;
      expect(row0).toMatchObject({ incoming: 0, incomingDate: null, available: stock });

      // Borrador y cancelada no cuentan; las enviadas sí, ordenadas por fecha esperada.
      await mk(tx, userId, supplier.id, ing.id, 50, "2026-10-04");
      const far = await mk(tx, userId, supplier.id, ing.id, 8, "2026-10-09", "sent");
      const near = await mk(tx, userId, supplier.id, ing.id, 12, "2026-10-05", "sent");
      const cancelled = await mk(tx, userId, supplier.id, ing.id, 99, "2026-10-03", "sent");
      await changeOrderStatus(tx, cancelled.id, "cancelled");

      const sim = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 100 }))!;
      const row = sim.rows.find((r) => r.name === "Manteca")!;
      expect(row.available).toBe(stock); // el stock actual no cambia
      expect(row.incoming).toBe(20);
      expect(row.incomingDate).toBe("2026-10-05");
      expect(row.incomingOrders.map((o) => [o.orderId, o.qty, o.expectedAt])).toEqual([
        [near.id, 12, "2026-10-05"],
        [far.id, 8, "2026-10-09"],
      ]);
      // Faltante hoy intacto; con lo que llega se cubre (20 kg necesarios contra 15 de stock + 20 en camino).
      expect(row.shortfall).toBe(row0.shortfall);
      expect(row.shortfallAfterIncoming).toBe(0);
    });
  });

  it("una OC parcialmente recibida solo cuenta lo pendiente", async () => {
    await inRollback("af", async (tx, userId) => {
      const { ing, supplier } = await manteca(tx);
      const o = await mk(tx, userId, supplier.id, ing.id, 30, "2026-10-06", "sent");
      const loc = await locationByCode(tx, "HELADERA");
      await createReception(
        tx,
        userId,
        receptionInput.parse({
          supplierId: supplier.id,
          purchaseOrderId: o.id,
          lines: [
            {
              ingredientId: ing.id,
              qty: 10,
              supplierLotCode: "MAN-X",
              expiryDate: "2027-01-01",
              temperatureC: "3",
              locationId: loc.id,
            },
          ],
        }),
      );
      const sim = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 100 }))!;
      const row = sim.rows.find((r) => r.name === "Manteca")!;
      expect(row.incoming).toBe(20);
      expect(row.incomingOrders).toHaveLength(1);
      expect(row.incomingOrders[0]).toMatchObject({ orderId: o.id, number: o.number, qty: 20 });
    });
  });

  it("okWithIncoming indica si alcanzaría cuando llegue todo lo que está en camino", async () => {
    await inRollback("af", async (tx, userId) => {
      const { supplier } = await manteca(tx);
      const before = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 300 }))!;
      const short = before.rows.filter((r) => !r.ok);
      expect(short.length).toBeGreaterThan(0);
      expect(before.okWithIncoming).toBe(false);
      // Se pide a un proveedor lo que falta de cada insumo (más uno): hoy sigue sin alcanzar.
      for (const r of short)
        await mk(tx, userId, supplier.id, r.ingredientId, r.shortfall + 1, "2026-10-07", "sent");
      const after = (await simulateProductionFromStock(tx, { mode: "starch_kg", kg: 300 }))!;
      expect(after.ok).toBe(false);
      expect(after.okWithIncoming).toBe(true);
      expect(after.rows.filter((r) => !r.ok).every((r) => r.shortfallAfterIncoming === 0)).toBe(true);
    });
  });
});
