import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { autoLinkInvoices, linkInvoiceToOrder } from "./service";

/** Pedido entregado de un cliente del seed, sin factura. */
async function deliveredOrder(
  tx: Tx,
  customer: string,
  total: number,
  deliveredAt = "2026-09-18T12:00:00-03:00",
) {
  const c = await tx.query.customers.findFirst({ where: eq(schema.customers.legalName, customer) });
  const [o] = await tx
    .insert(schema.orders)
    .values({
      customerId: c!.id,
      promisedDate: "2026-09-18",
      status: "delivered",
      deliveredAt: new Date(deliveredAt),
      total,
    })
    .returning();
  return { order: o!, customerId: c!.id };
}
async function invoice(tx: Tx, customerId: string, total: number, number: string, issueDate = "2026-09-20") {
  const [i] = await tx
    .insert(schema.salesInvoices)
    .values({
      customerId,
      invoiceType: "A",
      pointOfSale: "0009",
      number,
      issueDate,
      dueDate: "2026-10-20",
      total,
      source: "arca_import",
    })
    .returning();
  return i!;
}

describe("vincular facturas con pedidos entregados", () => {
  it("vincula sola la coincidencia única y el pedido pasa a facturado", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const { order, customerId } = await deliveredOrder(tx, "Vía Dolce", 126000);
      const inv = await invoice(tx, customerId, 126000, "00009001");
      const res = await autoLinkInvoices(tx, userId, [inv.id], "2026-10-02");
      expect(res).toEqual({ linked: 1, ambiguous: 0 });
      const o = await tx.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
      expect(o!.status).toBe("invoiced");
      const i = await tx.query.salesInvoices.findFirst({ where: eq(schema.salesInvoices.id, inv.id) });
      expect(i!.orderId).toBe(order.id);
    });
  });

  it("deja para vincular a mano cuando hay dos pedidos posibles, y valida la vinculación manual", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const a = await deliveredOrder(tx, "Club Náutico", 80000);
      await deliveredOrder(tx, "Club Náutico", 80000);
      const inv = await invoice(tx, a.customerId, 80000, "00009002");
      expect(await autoLinkInvoices(tx, userId, [inv.id], "2026-10-02")).toEqual({ linked: 0, ambiguous: 1 });

      const other = await deliveredOrder(tx, "La Esperanza", 80000);
      await expect(
        linkInvoiceToOrder(tx, userId, { invoiceId: inv.id, orderId: other.order.id }, "2026-10-02"),
      ).rejects.toThrow(/otro cliente/);
      const r = await linkInvoiceToOrder(
        tx,
        userId,
        { invoiceId: inv.id, orderId: a.order.id },
        "2026-10-02",
      );
      expect(r.orderNumber).toBe(a.order.number);
      await expect(
        linkInvoiceToOrder(tx, userId, { invoiceId: inv.id, orderId: a.order.id }, "2026-10-02"),
      ).rejects.toThrow(/ya está vinculada/);
    });
  });
});
