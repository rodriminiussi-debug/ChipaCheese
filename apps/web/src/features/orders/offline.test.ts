import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { createOrderInput, createOrderPayload } from "./schemas";
import { createOrder } from "./service";

/** Pedido desde el celular sin señal (RF-02): el reenvío desde la cola crea el pedido una sola vez. */
const TODAY = "2026-10-02";

async function setup(tx: Tx) {
  const customer = await tx.query.customers.findFirst({ where: (t, { eq }) => eq(t.legalName, "Vía Dolce") });
  const product = await tx.query.products.findFirst({ where: (t, { eq }) => eq(t.code, "CH-TAP-500") });
  return { customer: customer!, product: product! };
}

describe("alta de pedido sin señal (RF-02)", () => {
  it("el mismo clientId crea un solo pedido, con sus ítems y su evento", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const { customer, product } = await setup(tx);
      const clientId = crypto.randomUUID();
      const recordedAt = new Date("2026-10-02T09:30:00-03:00");
      const data = createOrderInput.parse({
        customerId: customer.id,
        promisedDate: "2026-10-06",
        items: [{ productId: product.id, qtyUnits: 20 }],
      });

      const first = await createOrder(tx, userId, data, { today: TODAY, clientId, recordedAt });
      const again = await createOrder(tx, userId, data, { today: TODAY, clientId, recordedAt });
      expect(first.duplicate).toBe(false);
      expect(again).toMatchObject({
        id: first.id,
        number: first.number,
        total: first.total,
        duplicate: true,
      });
      expect(again.kg).toBe(first.kg);

      const orders = await tx.select().from(schema.orders).where(eq(schema.orders.clientId, clientId));
      expect(orders).toHaveLength(1);
      expect(orders[0]!.receivedAt.getTime()).toBe(recordedAt.getTime());
      expect(
        await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, first.id)),
      ).toHaveLength(1);
      const events = await tx
        .select()
        .from(schema.orderEvents)
        .where(eq(schema.orderEvents.orderId, first.id));
      expect(events).toHaveLength(1);
      expect(events[0]!.at.getTime()).toBe(recordedAt.getTime());
    });
  });

  it("otro clientId es otro pedido", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const { customer, product } = await setup(tx);
      const data = createOrderInput.parse({
        customerId: customer.id,
        promisedDate: "2026-10-06",
        items: [{ productId: product.id, qtyUnits: 5 }],
      });
      const a = await createOrder(tx, userId, data, { today: TODAY, clientId: crypto.randomUUID() });
      const b = await createOrder(tx, userId, data, { today: TODAY, clientId: crypto.randomUUID() });
      expect(b.id).not.toBe(a.id);
    });
  });

  it("la fecha comprometida se valida contra el día en que se tomó el pedido, no el de la sincronización", async () => {
    await inRollback("nahuel", async (tx, userId) => {
      const { customer, product } = await setup(tx);
      const data = createOrderInput.parse({
        customerId: customer.id,
        promisedDate: "2026-10-02",
        items: [{ productId: product.id, qtyUnits: 5 }],
      });
      // Tomado ayer sin señal para entregar hoy: al sincronizar hoy no debe rechazarse por "fecha anterior a hoy".
      const order = await createOrder(tx, userId, data, {
        clientId: crypto.randomUUID(),
        recordedAt: new Date("2026-10-02T08:00:00-03:00"),
      });
      expect(order.duplicate).toBe(false);
      await expect(
        createOrder(tx, userId, data, { clientId: crypto.randomUUID(), today: "2026-10-03" }),
      ).rejects.toThrow(/anterior a hoy/);
    });
  });

  it("el payload exige clientId y recordedAt", () => {
    const base = { customerId: crypto.randomUUID(), promisedDate: "2026-10-06", items: [] };
    expect(createOrderPayload.safeParse(base).success).toBe(false);
    expect(
      createOrderInput.safeParse({ ...base, items: [{ productId: crypto.randomUUID(), qtyUnits: 1 }] })
        .success,
    ).toBe(true);
  });
});
