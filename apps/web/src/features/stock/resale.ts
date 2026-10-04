import { eq, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { locationByCode, recordProductMovements } from "./ledger";

/**
 * Ingreso de mercadería de reventa (gaseosas, aguas…): suma stock del producto en la ubicación
 * (por defecto el LOCAL, sin lote) y registra su costo de compra sin IVA para margen y costeo.
 * Lo usan la carga de facturas de compra y el ingreso rápido desde el local.
 */
export async function receiveResaleProducts(
  db: Executor,
  userId: string | null,
  input: {
    items: { productId: string; qty: number; unitCostNet?: number | null }[];
    supplierId?: string | null;
    date: string;
    locationCode?: string;
    refTable?: string;
    refId?: string | null;
    invoiceItemIds?: (string | null)[];
  },
) {
  if (!input.items.length) throw new UserError("Agregá al menos un producto.");
  const location = await locationByCode(db, input.locationCode ?? "LOCAL");
  for (const [i, it] of input.items.entries()) {
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, it.productId) });
    if (!product) throw new UserError("Producto inexistente.");
    if (product.kind !== "resale") throw new UserError(`${product.name} no es un producto de reventa.`);
    if (!(it.qty > 0)) throw new UserError(`Cantidad inválida para ${product.name}.`);
    if (it.unitCostNet != null) {
      await db.insert(schema.productCosts).values({
        productId: it.productId,
        supplierId: input.supplierId ?? null,
        date: input.date,
        unitCostNet: it.unitCostNet,
        invoiceItemId: input.invoiceItemIds?.[i] ?? null,
      });
    }
  }
  await recordProductMovements(
    db,
    userId,
    input.items.map((it) => ({
      type: "receipt" as const,
      productId: it.productId,
      finishedLotId: null,
      locationId: location.id,
      qty: it.qty,
      refTable: input.refTable ?? "resale_receipt",
      refId: input.refId ?? null,
    })),
  );
  return { location: location.code, items: input.items.length };
}
