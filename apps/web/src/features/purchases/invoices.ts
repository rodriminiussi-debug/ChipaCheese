import { and, asc, desc, eq, ilike, inArray, ne, or, schema, sql, type Executor } from "@chipa/db";
import {
  bestNameMatch,
  cuitDigits,
  formatDateAR,
  formatInvoiceNumber,
  invoiceDueDate,
  invoiceTotals,
  isValidCuit,
  lineNet,
  lineVat,
  matchSupplier,
  normalizeText,
  roundMoney,
  validateInvoiceTotals,
  type InvoiceLine,
} from "@chipa/domain";
import { toIsoDateAR } from "@/lib/dates";
import { UserError } from "@/server/errors";
import type { ExtractedInvoice } from "./ai/extraction";
import type { InvoiceFormData } from "./schemas";

/**
 * Facturas de compra (RF-08): borrador desde la IA o carga manual → revisión → confirmación,
 * que fija el estado y escribe el historial de precios (RF-09).
 */

const INVOICE_COLUMNS = schema.purchaseInvoices;

export interface InvoiceListFilter {
  status?: "draft" | "confirmed" | "voided";
  supplierId?: string;
  /** "YYYY-MM" por fecha de emisión. */
  month?: string;
  q?: string;
}

export async function listInvoices(db: Executor, f: InvoiceListFilter = {}) {
  const i = INVOICE_COLUMNS;
  const where = and(
    f.status ? eq(i.status, f.status) : undefined,
    f.supplierId ? eq(i.supplierId, f.supplierId) : undefined,
    f.month
      ? and(sql`${i.issueDate} >= ${`${f.month}-01`}::date`, sql`${i.issueDate} < (${`${f.month}-01`}::date + interval '1 month')`)
      : undefined,
    f.q
      ? or(
          ilike(i.number, `%${f.q}%`),
          ilike(i.pointOfSale, `%${f.q}%`),
          sql`${i.supplierId} in (select id from suppliers where legal_name ilike ${`%${f.q}%`} or trade_name ilike ${`%${f.q}%`})`,
        )
      : undefined,
  );
  return db.query.purchaseInvoices.findMany({
    where,
    orderBy: [desc(sql`coalesce(${i.issueDate}, ${i.createdAt}::date)`), desc(i.createdAt)],
    with: { supplier: true },
    limit: 200,
  });
}

export async function getInvoice(db: Executor, id: string) {
  const invoice = await db.query.purchaseInvoices.findFirst({
    where: eq(INVOICE_COLUMNS.id, id),
    with: { supplier: true },
  });
  if (!invoice) return null;
  const items = await db.query.purchaseInvoiceItems.findMany({
    where: eq(schema.purchaseInvoiceItems.invoiceId, id),
    orderBy: asc(schema.purchaseInvoiceItems.createdAt),
  });
  return { ...invoice, items };
}
export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

// --- Sugerencia de insumos ---------------------------------------------------------------

/**
 * Sugiere el insumo de cada línea: primero lo que ese proveedor ya facturó con la misma
 * descripción (historial), luego similitud de nombre entre los insumos que vende y, por último,
 * entre todo el catálogo.
 */
export async function suggestIngredients(db: Executor, supplierId: string | null, descriptions: string[]) {
  const [ingredients, sold, history] = await Promise.all([
    db.query.ingredients.findMany({ where: eq(schema.ingredients.active, true) }),
    supplierId
      ? db.query.supplierIngredients.findMany({ where: eq(schema.supplierIngredients.supplierId, supplierId) })
      : Promise.resolve([]),
    supplierId
      ? db
          .select({
            description: schema.purchaseInvoiceItems.description,
            ingredientId: schema.purchaseInvoiceItems.ingredientId,
          })
          .from(schema.purchaseInvoiceItems)
          .innerJoin(schema.purchaseInvoices, eq(schema.purchaseInvoices.id, schema.purchaseInvoiceItems.invoiceId))
          .where(
            and(
              eq(schema.purchaseInvoices.supplierId, supplierId),
              eq(schema.purchaseInvoices.status, "confirmed"),
            ),
          )
          .orderBy(desc(schema.purchaseInvoices.issueDate), desc(schema.purchaseInvoiceItems.createdAt))
      : Promise.resolve([]),
  ]);
  const known = new Set(ingredients.map((i) => i.id));
  const byHistory = new Map<string, string>();
  for (const h of history) {
    const key = normalizeText(h.description);
    if (h.ingredientId && known.has(h.ingredientId) && !byHistory.has(key)) byHistory.set(key, h.ingredientId);
  }
  const soldIds = new Set(sold.map((s) => s.ingredientId));
  const candidates = (list: typeof ingredients) => list.map((i) => ({ id: i.id, names: [i.name] }));
  const mine = ingredients.filter((i) => soldIds.has(i.id));

  return descriptions.map((d) => {
    const fromHistory = byHistory.get(normalizeText(d));
    if (fromHistory) return fromHistory;
    return (
      bestNameMatch(d, candidates(mine), 0.5)?.id ?? bestNameMatch(d, candidates(ingredients), 0.6)?.id ?? null
    );
  });
}

// --- Altas -------------------------------------------------------------------------------

async function assertNotDuplicate(
  db: Executor,
  k: { supplierId: string | null; invoiceType: string; pointOfSale: string | null; number: string | null },
  exceptId?: string,
) {
  if (!k.supplierId || !k.pointOfSale || !k.number) return;
  const dup = await db.query.purchaseInvoices.findFirst({
    where: and(
      eq(INVOICE_COLUMNS.supplierId, k.supplierId),
      eq(INVOICE_COLUMNS.invoiceType, k.invoiceType as never),
      eq(INVOICE_COLUMNS.pointOfSale, k.pointOfSale),
      eq(INVOICE_COLUMNS.number, k.number),
      exceptId ? ne(INVOICE_COLUMNS.id, exceptId) : undefined,
    ),
    with: { supplier: true },
  });
  if (dup)
    throw new UserError(
      `Ya está cargada la factura ${k.invoiceType.replace("_", " ")} ${formatInvoiceNumber(k.pointOfSale, k.number)} de ${dup.supplier?.legalName ?? "ese proveedor"} (cargada el ${formatDateAR(toIsoDateAR(dup.createdAt))}).`,
      { number: ["Factura duplicada"] },
    );
}

async function insertItems(
  db: Executor,
  invoiceId: string,
  items: {
    description: string;
    ingredientId: string | null;
    qty: number;
    unit: "kg" | "l" | "unit" | null;
    unitPriceNet: number;
    vatRate: number;
    vatAmount: number | null;
  }[],
) {
  // Las filas de una transacción comparten `now()`: el orden se conserva con createdAt creciente.
  const base = Date.now();
  if (!items.length) return;
  await db.insert(schema.purchaseInvoiceItems).values(
    items.map((it, idx) => {
      const line: InvoiceLine = { qty: it.qty, unitPriceNet: it.unitPriceNet, vatRate: it.vatRate, vatAmount: it.vatAmount };
      const vat = lineVat(line);
      return {
        invoiceId,
        ingredientId: it.ingredientId,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        unitPriceNet: it.unitPriceNet,
        vatRate: it.vatRate,
        vatAmount: vat,
        lineTotal: roundMoney(lineNet(line) + vat),
        createdAt: new Date(base + idx),
      };
    }),
  );
}

/** Borrador vacío para carga manual (sin foto). */
export async function createManualDraft(db: Executor) {
  const [row] = await db.insert(INVOICE_COLUMNS).values({ source: "manual", status: "draft" }).returning();
  return row!;
}

/**
 * Crea el borrador `source: ai` con los datos leídos: proveedor por CUIT/nombre, un renglón por
 * ítem con el insumo sugerido, y la respuesta cruda de la IA para auditoría.
 * Lanza UserError si la factura ya estaba cargada (proveedor + tipo + punto de venta + número).
 */
export async function createDraftFromExtraction(
  db: Executor,
  input: { extraction: ExtractedInvoice; fileKey: string | null },
) {
  const x = input.extraction;
  const suppliers = await db.query.suppliers.findMany();
  const supplierId = matchSupplier({ name: x.supplierName, cuit: x.supplierCuit }, suppliers);
  const invoiceType = x.invoiceType ?? "A";
  await assertNotDuplicate(db, { supplierId, invoiceType, pointOfSale: x.pointOfSale, number: x.number });

  const computed = invoiceTotals(x.items, x.otherTaxes);
  const { meta, ...extracted } = x;
  const [invoice] = await db
    .insert(INVOICE_COLUMNS)
    .values({
      supplierId,
      invoiceType,
      pointOfSale: x.pointOfSale,
      number: x.number,
      issueDate: x.issueDate,
      dueDate: x.dueDate,
      netTotal: x.netTotal ?? computed.net,
      vatTotal: x.vatTotal ?? computed.vat,
      otherTaxes: x.otherTaxes,
      total: x.total ?? computed.total,
      status: "draft",
      source: "ai",
      fileKey: input.fileKey,
      aiExtraction: { provider: meta.provider, model: meta.model, raw: meta.raw, extracted },
      notes: x.notes,
    })
    .returning();

  const suggestions = await suggestIngredients(
    db,
    supplierId,
    x.items.map((i) => i.description),
  );
  const ingredientIds = suggestions.filter((s): s is string => !!s);
  const units = new Map(
    ingredientIds.length
      ? (
          await db.query.ingredients.findMany({ where: inArray(schema.ingredients.id, ingredientIds) })
        ).map((i) => [i.id, i.unit] as const)
      : [],
  );
  await insertItems(
    db,
    invoice!.id,
    x.items.map((it, idx) => ({
      description: it.description,
      ingredientId: suggestions[idx] ?? null,
      qty: it.qty,
      unit: it.unit ?? (suggestions[idx] ? (units.get(suggestions[idx]!) ?? null) : null),
      unitPriceNet: it.unitPriceNet,
      vatRate: it.vatRate,
      vatAmount: it.vatAmount,
    })),
  );
  return invoice!;
}

/** Borrador sin datos (la IA falló): queda con la foto para completarlo a mano. */
export async function createDraftWithFileOnly(db: Executor, fileKey: string, error: string) {
  const [row] = await db
    .insert(INVOICE_COLUMNS)
    .values({ source: "ai", status: "draft", fileKey, aiExtraction: { error } })
    .returning();
  return row!;
}

// --- Edición y confirmación --------------------------------------------------------------

async function loadDraft(db: Executor, id: string) {
  const invoice = await db.query.purchaseInvoices.findFirst({ where: eq(INVOICE_COLUMNS.id, id) });
  if (!invoice) throw new UserError("La factura no existe.");
  if (invoice.status !== "draft") throw new UserError("La factura ya está confirmada y no se puede editar.");
  return invoice;
}

function toLines(items: InvoiceFormData["items"]): InvoiceLine[] {
  return items.map((i) => ({ qty: i.qty, unitPriceNet: i.unitPriceNet, vatRate: i.vatRate, vatAmount: i.vatAmount }));
}

/** Totales calculados desde las líneas y comparación con los de la factura (para mostrar diferencias). */
export function checkInvoice(input: {
  items: InvoiceFormData["items"];
  otherTaxes: number;
  declaredNet: number | null;
  declaredVat: number | null;
  declaredTotal: number | null;
}) {
  const lines = toLines(input.items);
  const totals = invoiceTotals(lines, input.otherTaxes);
  const validation = validateInvoiceTotals({
    lines,
    otherTaxes: input.otherTaxes,
    declared: { net: input.declaredNet, vat: input.declaredVat, total: input.declaredTotal ?? totals.total },
  });
  return { totals, ...validation };
}

/** Guarda el borrador: datos de cabecera, totales de la factura y reemplazo de todas las líneas. */
export async function saveInvoice(db: Executor, input: InvoiceFormData) {
  const current = await loadDraft(db, input.id);
  await assertNotDuplicate(db, input, input.id);
  const { totals } = checkInvoice(input);
  const [row] = await db
    .update(INVOICE_COLUMNS)
    .set({
      supplierId: input.supplierId,
      invoiceType: input.invoiceType,
      pointOfSale: input.pointOfSale,
      number: input.number,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      netTotal: input.declaredNet ?? totals.net,
      vatTotal: input.declaredVat ?? totals.vat,
      otherTaxes: input.otherTaxes,
      total: input.declaredTotal ?? totals.total,
      notes: input.notes,
    })
    .where(eq(INVOICE_COLUMNS.id, current.id))
    .returning();
  await db.delete(schema.purchaseInvoiceItems).where(eq(schema.purchaseInvoiceItems.invoiceId, current.id));
  await insertItems(
    db,
    current.id,
    input.items.map((i) => ({ ...i, vatAmount: i.vatAmount })),
  );
  return row!;
}

const FIELD_LABEL = { net: "neto", vat: "IVA", total: "total" } as const;

/**
 * Confirma la factura (Regla 11: el IVA es el de la factura). Exige proveedor, fecha, número y
 * líneas; que cierren los totales (o `acceptDifferences`); y que las unidades coincidan con las del
 * insumo. Escribe el historial de precios (neto unitario, fecha de emisión, proveedor) de las líneas
 * mapeadas, salvo en notas de crédito.
 */
export async function confirmInvoice(db: Executor, input: InvoiceFormData & { acceptDifferences?: boolean }) {
  await saveInvoice(db, input);
  const invoice = (await getInvoice(db, input.id))!;
  const fail = (msg: string, field?: string) =>
    new UserError(msg, field ? { [field]: [msg] } : undefined);

  if (!invoice.supplierId || !invoice.supplier) throw fail("Elegí el proveedor.", "supplierId");
  if (!invoice.issueDate) throw fail("Ingresá la fecha de emisión.", "issueDate");
  if (!invoice.pointOfSale || !invoice.number)
    throw fail("Ingresá el punto de venta y el número de la factura.", "number");
  if (!invoice.items.length) throw fail("La factura no tiene líneas.", "items");
  const bad = invoice.items.findIndex((i) => !(i.qty > 0));
  if (bad >= 0) throw fail(`La línea ${bad + 1} no tiene cantidad.`, `items.${bad}.qty`);

  const ingredientIds = [...new Set(invoice.items.map((i) => i.ingredientId).filter((x): x is string => !!x))];
  const ingredients = ingredientIds.length
    ? await db.query.ingredients.findMany({ where: inArray(schema.ingredients.id, ingredientIds) })
    : [];
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  for (const [idx, it] of invoice.items.entries()) {
    const ing = it.ingredientId ? byId.get(it.ingredientId) : null;
    if (ing && it.unit && it.unit !== ing.unit)
      throw fail(
        `La línea ${idx + 1} está en ${it.unit} pero el insumo "${ing.name}" se maneja en ${ing.unit}. Convertí cantidad y precio a la unidad del insumo.`,
        `items.${idx}.unit`,
      );
  }

  const check = checkInvoice({
    items: invoice.items.map((i) => ({
      description: i.description,
      ingredientId: i.ingredientId,
      qty: i.qty,
      unit: i.unit,
      unitPriceNet: i.unitPriceNet,
      vatRate: i.vatRate,
      vatAmount: i.vatAmount,
    })),
    otherTaxes: invoice.otherTaxes,
    declaredNet: invoice.netTotal,
    declaredVat: invoice.vatTotal,
    declaredTotal: invoice.total,
  });
  if (!check.ok && !input.acceptDifferences) {
    const detail = check.diffs
      .map((d) => `${FIELD_LABEL[d.field]}: calculado ${d.computed.toFixed(2)} vs factura ${d.declared.toFixed(2)}`)
      .join("; ");
    throw new UserError(`Los totales no coinciden con la factura (${detail}). Revisá las líneas o aceptá la diferencia.`, {
      declaredTotal: ["No coincide con las líneas"],
    });
  }

  const dueDate = invoiceDueDate({
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTermsDays: invoice.supplier.paymentTermsDays,
  });
  await db.update(INVOICE_COLUMNS).set({ status: "confirmed", dueDate }).where(eq(INVOICE_COLUMNS.id, invoice.id));

  const isCreditNote = invoice.invoiceType.startsWith("NC_");
  const priced = invoice.items.filter((i) => i.ingredientId && !isCreditNote);
  if (priced.length)
    await db.insert(schema.ingredientPrices).values(
      priced.map((i) => ({
        ingredientId: i.ingredientId!,
        supplierId: invoice.supplierId,
        date: invoice.issueDate!,
        unitPriceNet: i.unitPriceNet,
        invoiceItemId: i.id,
      })),
    );

  // Si el proveedor no tenía CUIT cargado y la factura lo trae (válido y libre), se completa.
  const extracted = (invoice.aiExtraction as { extracted?: { supplierCuit?: string | null } } | null)?.extracted;
  const cuit = cuitDigits(extracted?.supplierCuit);
  if (!invoice.supplier.cuit && cuit && isValidCuit(cuit)) {
    const taken = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.cuit, cuit) });
    if (!taken) await db.update(schema.suppliers).set({ cuit }).where(eq(schema.suppliers.id, invoice.supplierId));
  }

  return { id: invoice.id, pricesRecorded: priced.length, unmappedLines: invoice.items.length - priced.length, differences: check.diffs };
}

/** Elimina un borrador (no las confirmadas). */
export async function deleteDraftInvoice(db: Executor, id: string) {
  await loadDraft(db, id);
  await db.delete(INVOICE_COLUMNS).where(eq(INVOICE_COLUMNS.id, id));
}

/** Da de alta el proveedor con los datos que la IA leyó en la factura y lo asigna al borrador. */
export async function createSupplierFromDraft(db: Executor, invoiceId: string) {
  const invoice = await loadDraft(db, invoiceId);
  const x = (invoice.aiExtraction as { extracted?: { supplierName?: string | null; supplierCuit?: string | null } } | null)
    ?.extracted;
  if (!x?.supplierName) throw new UserError("La factura no tiene el nombre del proveedor leído.");
  const cuit = cuitDigits(x.supplierCuit);
  const validCuit = cuit && isValidCuit(cuit) ? cuit : null;
  if (validCuit) {
    const dup = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.cuit, validCuit) });
    if (dup) {
      await db.update(INVOICE_COLUMNS).set({ supplierId: dup.id }).where(eq(INVOICE_COLUMNS.id, invoiceId));
      return dup;
    }
  }
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ legalName: x.supplierName, cuit: validCuit })
    .returning();
  await db.update(INVOICE_COLUMNS).set({ supplierId: supplier!.id }).where(eq(INVOICE_COLUMNS.id, invoiceId));
  return supplier!;
}
