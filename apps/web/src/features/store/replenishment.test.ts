import { describe, expect, it } from "vitest";
import { and, eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { locationByCode } from "@/features/stock/ledger";
import { getProductStockMatrix } from "@/features/stock/service";
import {
  cancelReplenishment,
  createReplenishment,
  getPendingReplenishments,
  listReplenishments,
  plantStockByProduct,
  receiveReplenishment,
  sendReplenishment,
} from "./replenishment";
import { replenishmentRequestInput } from "./schemas";

const TODAY = "2026-10-02";

const product = async (tx: Executor, code: string) =>
  (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;

const request = (
  items: { productId: string; qty: number }[],
  extra: { neededBy?: string; notes?: string } = {},
) => replenishmentRequestInput.parse({ items, ...extra });

async function stockAt(tx: Executor, productId: string, code: string) {
  const loc = await locationByCode(tx, code);
  const rows = await tx
    .select()
    .from(schema.productStock)
    .where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, loc.id)));
  return rows.reduce((a, r) => a + r.qty, 0);
}

describe("reposición del local a la planta", () => {
  it("el local pide, la planta envía por FEFO y el stock pasa de F3/F4 al LOCAL", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const len = await product(tx, "CH-LEN-500");
      const f3Before = await stockAt(tx, tap.id, "F3");
      const f4Before = await stockAt(tx, tap.id, "F4");
      const rep = await createReplenishment(
        tx,
        userId,
        request(
          [
            { productId: tap.id, qty: 30 },
            { productId: len.id, qty: 10 },
          ],
          { neededBy: "2026-10-05", notes: "Para el viernes" },
        ),
        TODAY,
      );
      expect(rep).toMatchObject({
        status: "requested",
        requestedById: userId,
        neededBy: "2026-10-05",
        notes: "Para el viernes",
      });
      const pending = await getPendingReplenishments(tx, TODAY);
      expect(pending).toMatchObject([
        {
          id: rep.id,
          totalUnits: 40,
          neededBy: "2026-10-05",
          overdue: false,
          requestedBy: expect.any(String),
        },
      ]);
      expect(pending[0]!.items.map((i) => [i.code, i.qtyRequested])).toEqual([
        ["CH-LEN-500", 10],
        ["CH-TAP-500", 30],
      ]);

      const sent = await sendReplenishment(tx, userId, { id: rep.id });
      expect(sent.sentUnits).toBe(40);
      expect(sent.replenishment).toMatchObject({ status: "sent", sentById: userId });
      expect(sent.replenishment.sentAt).toBeInstanceOf(Date);
      const items = await tx.query.storeReplenishmentItems.findMany({
        where: eq(schema.storeReplenishmentItems.replenishmentId, rep.id),
      });
      expect(items.map((i) => [i.qtyRequested, i.qtySent]).sort()).toEqual([
        [10, 10],
        [30, 30],
      ]);

      // Stock: el LOCAL suma exactamente lo enviado y F3 + F4 restan lo mismo.
      expect(await stockAt(tx, tap.id, "LOCAL")).toBe(30);
      expect((await stockAt(tx, tap.id, "F3")) + (await stockAt(tx, tap.id, "F4"))).toBe(
        f3Before + f4Before - 30,
      );
      const matrix = await getProductStockMatrix(tx);
      expect(
        matrix.rows.find((r) => r.code === "CH-LEN-500")!.byLocation[(await locationByCode(tx, "LOCAL")).id],
      ).toBe(10);
      // Transferencias con la referencia al pedido.
      const moves = await tx.query.stockMovements.findMany({
        where: eq(schema.stockMovements.type, "transfer"),
      });
      expect(
        moves.filter((m) => m.note === `Reposición del local #${rep.number}`).length,
      ).toBeGreaterThanOrEqual(4);

      // Ya no está pendiente; el local confirma la recepción.
      expect(await getPendingReplenishments(tx, TODAY)).toEqual([]);
      const received = await receiveReplenishment(tx, userId, rep.id);
      expect(received).toMatchObject({ status: "received", receivedById: userId });
      expect((await listReplenishments(tx)).map((r) => r.status)).toEqual(["received"]);
    });
  });

  it("se puede enviar menos de lo pedido y el envío usa el stock más viejo primero entre F3 y F4", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const rep = await createReplenishment(tx, userId, request([{ productId: tap.id, qty: 100 }]), TODAY);
      const itemId = (await tx.query.storeReplenishmentItems.findFirst({
        where: eq(schema.storeReplenishmentItems.replenishmentId, rep.id),
      }))!.id;
      await sendReplenishment(tx, userId, { id: rep.id, items: [{ itemId, qty: 65 }] });
      expect(await stockAt(tx, tap.id, "LOCAL")).toBe(65);
      const item = (await tx.query.storeReplenishmentItems.findFirst({
        where: eq(schema.storeReplenishmentItems.id, itemId),
      }))!;
      expect(item).toMatchObject({ qtyRequested: 100, qtySent: 65 });
      // FEFO: salió primero el lote que vence antes (260901-1, 60 u. en F3).
      const items = await tx.query.stockMovements.findMany({
        where: and(eq(schema.stockMovements.productId, tap.id), eq(schema.stockMovements.type, "transfer")),
        with: { finishedLot: true },
      });
      const toLocal = items.filter((m) => m.qty > 0);
      expect(toLocal.map((m) => [m.finishedLot!.code, m.qty]).sort()).toEqual([
        ["260901-1", 60],
        ["261001-1", 5],
      ]);
    });
  });

  it("si no alcanza el stock de planta no se envía nada", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const len = await product(tx, "CH-LEN-500");
      const have = (await plantStockByProduct(tx, [tap.id])).get(tap.id)!;
      expect(have).toBeGreaterThan(0);
      const rep = await createReplenishment(
        tx,
        userId,
        request([
          { productId: len.id, qty: 5 },
          { productId: tap.id, qty: have + 1 },
        ]),
        TODAY,
      );
      await expect(sendReplenishment(tx, userId, { id: rep.id })).rejects.toThrow(
        /No hay stock suficiente de Chipá tapitas/,
      );
      expect(await stockAt(tx, tap.id, "LOCAL")).toBe(0);
    });
  });

  it("estados: no se envía dos veces, no se cancela lo enviado ni se recibe lo no enviado", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const rep = await createReplenishment(tx, userId, request([{ productId: tap.id, qty: 5 }]), TODAY);
      await expect(receiveReplenishment(tx, userId, rep.id)).rejects.toThrow(/ya envió/);
      await sendReplenishment(tx, userId, { id: rep.id });
      await expect(sendReplenishment(tx, userId, { id: rep.id })).rejects.toThrow(/ya se envió/);
      await expect(cancelReplenishment(tx, rep.id)).rejects.toThrow(/enviado no se puede cancelar/);
      await receiveReplenishment(tx, userId, rep.id);
      await expect(receiveReplenishment(tx, userId, rep.id)).rejects.toThrow(/ya está recibido/);
      await expect(sendReplenishment(tx, userId, { id: crypto.randomUUID() })).rejects.toThrow(/no existe/);
    });
  });

  it("cancelar un pedido sin enviar lo saca de los pendientes", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const rep = await createReplenishment(tx, userId, request([{ productId: tap.id, qty: 5 }]), TODAY);
      expect((await cancelReplenishment(tx, rep.id)).status).toBe("cancelled");
      expect(await getPendingReplenishments(tx, TODAY)).toEqual([]);
      await expect(cancelReplenishment(tx, rep.id)).rejects.toThrow(/ya está cancelado/);
      await expect(sendReplenishment(tx, userId, { id: rep.id })).rejects.toThrow(/cancelado/);
    });
  });

  it("valida el pedido: fecha, productos de la planta y al menos un envío", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const gas = await product(tx, "RV-GAS-500");
      await expect(
        createReplenishment(
          tx,
          userId,
          request([{ productId: tap.id, qty: 5 }], { neededBy: "2026-10-01" }),
          TODAY,
        ),
      ).rejects.toThrow(/anterior a hoy/);
      await expect(
        createReplenishment(tx, userId, request([{ productId: gas.id, qty: 5 }]), TODAY),
      ).rejects.toThrow(/reventa se repone con el proveedor/);
      await expect(
        createReplenishment(tx, userId, request([{ productId: crypto.randomUUID(), qty: 5 }]), TODAY),
      ).rejects.toThrow(/no existe/);
      expect(replenishmentRequestInput.safeParse({ items: [] }).success).toBe(false);
      expect(replenishmentRequestInput.safeParse({ items: [{ productId: tap.id, qty: 0 }] }).success).toBe(
        false,
      );
      // Líneas repetidas se suman.
      const rep = await createReplenishment(
        tx,
        userId,
        request([
          { productId: tap.id, qty: 5 },
          { productId: tap.id, qty: 7 },
        ]),
        TODAY,
      );
      expect((await getPendingReplenishments(tx, TODAY))[0]!.items).toMatchObject([{ qtyRequested: 12 }]);
      const itemId = (await tx.query.storeReplenishmentItems.findFirst({
        where: eq(schema.storeReplenishmentItems.replenishmentId, rep.id),
      }))!.id;
      await expect(
        sendReplenishment(tx, userId, { id: rep.id, items: [{ itemId, qty: 0 }] }),
      ).rejects.toThrow(/al menos un producto/);
      await expect(
        sendReplenishment(tx, userId, { id: rep.id, items: [{ itemId: crypto.randomUUID(), qty: 1 }] }),
      ).rejects.toThrow(/no son de este pedido|no es de este pedido/);
    });
  });

  it("el tablero ve vencida la fecha en que se necesitaba y ordena por urgencia", async () => {
    await inRollback("local1", async (tx, userId) => {
      const tap = await product(tx, "CH-TAP-500");
      const late = await createReplenishment(
        tx,
        userId,
        request([{ productId: tap.id, qty: 5 }], { neededBy: "2026-10-02" }),
        "2026-10-02",
      );
      await createReplenishment(
        tx,
        userId,
        request([{ productId: tap.id, qty: 5 }], { neededBy: "2026-10-04" }),
        "2026-10-02",
      );
      await createReplenishment(tx, userId, request([{ productId: tap.id, qty: 5 }]), "2026-10-02");
      const pending = await getPendingReplenishments(tx, "2026-10-03");
      expect(pending.map((p) => [p.neededBy, p.overdue])).toEqual([
        ["2026-10-02", true],
        ["2026-10-04", false],
        [null, false],
      ]);
      expect(pending[0]!.id).toBe(late.id);
    });
  });
});
