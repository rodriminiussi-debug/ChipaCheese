import { addDays, roundMoney } from "@chipa/domain";
import { ne, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { INVOICE_TYPE_LABEL } from "./labels";
import { invoiceKey, parseArcaCsv, type ArcaKind, type ArcaRow } from "./arca";

/**
 * RF-32: importación de "Mis Comprobantes" de ARCA.
 *  - Emitidos → `sales_invoices` (source `arca_import`, con CAE). Cliente por CUIT. Sin duplicar (tipo + PV + número).
 *  - Recibidos → solo conciliación contra `purchase_invoices` (encontradas / faltan cargar / diferencias).
 *    No crea compras: eso es de M2.
 * La facturación electrónica integrada es de la Fase 3 (ROD-275) y no está acá.
 */

export const ARCA_MAX_BYTES = 8 * 1024 * 1024;
/** Diferencia de importe tolerada al conciliar (redondeos). */
const AMOUNT_TOLERANCE = 1;

export type ArcaRowStatus =
  "new" | "duplicate" | "no_customer" | "unsupported" | "found" | "missing" | "difference";

export interface ArcaPreviewRow {
  line: number;
  date: string;
  label: string;
  docNumber: string;
  name: string;
  total: number;
  status: ArcaRowStatus;
  detail: string | null;
  /** Cliente o proveedor del sistema con el que se matcheó por CUIT. */
  partyName: string | null;
}

export interface ArcaPreview {
  kind: ArcaKind;
  rows: ArcaPreviewRow[];
  errors: { line: number; message: string }[];
  summary: Record<ArcaRowStatus, number> & { total: number; invalid: number };
  /** Contrapartes sin match por CUIT (cliente o proveedor no cargado). */
  unmatched: { docNumber: string; name: string; count: number; total: number }[];
}

/** Decodifica el archivo: UTF-8 y, si no es válido, Windows-1252 (exportaciones viejas de ARCA). */
export async function readArcaText(file: File): Promise<string> {
  if (file.size === 0) throw new UserError("El archivo está vacío.");
  if (file.size > ARCA_MAX_BYTES) throw new UserError("El archivo es demasiado grande (máximo 8 MB).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const emptySummary = (): ArcaPreview["summary"] => ({
  new: 0,
  duplicate: 0,
  no_customer: 0,
  unsupported: 0,
  found: 0,
  missing: 0,
  difference: 0,
  total: 0,
  invalid: 0,
});

function labelOf(r: ArcaRow) {
  return `${r.type ? INVOICE_TYPE_LABEL[r.type] : r.typeText} ${r.pointOfSale}-${r.number}`;
}

function toPreviewRow(
  r: ArcaRow,
  status: ArcaRowStatus,
  detail: string | null,
  partyName: string | null,
): ArcaPreviewRow {
  return {
    line: r.line,
    date: r.date,
    label: labelOf(r),
    docNumber: r.docNumber,
    name: r.name,
    total: r.total,
    status,
    detail,
    partyName,
  };
}

function finish(
  kind: ArcaKind,
  parsed: ReturnType<typeof parseArcaCsv>,
  rows: ArcaPreviewRow[],
): ArcaPreview {
  const summary = emptySummary();
  summary.total = rows.length;
  summary.invalid = parsed.errors.length;
  for (const r of rows) summary[r.status]++;
  const unmatched = new Map<string, { docNumber: string; name: string; count: number; total: number }>();
  for (const r of rows) {
    if (r.status !== "no_customer" && !(kind === "received" && r.status === "missing" && !r.partyName))
      continue;
    const cur = unmatched.get(r.docNumber) ?? { docNumber: r.docNumber, name: r.name, count: 0, total: 0 };
    cur.count++;
    cur.total = roundMoney(cur.total + r.total);
    unmatched.set(r.docNumber, cur);
  }
  return { kind, rows, errors: parsed.errors, summary, unmatched: [...unmatched.values()] };
}

async function classifyIssued(db: Executor, parsed: ReturnType<typeof parseArcaCsv>) {
  const [customers, existing] = await Promise.all([
    db.select().from(schema.customers),
    db
      .select({
        type: schema.salesInvoices.invoiceType,
        pv: schema.salesInvoices.pointOfSale,
        number: schema.salesInvoices.number,
      })
      .from(schema.salesInvoices),
  ]);
  const byCuit = new Map(customers.filter((c) => c.cuit).map((c) => [c.cuit!.replace(/\D/g, ""), c]));
  const seen = new Set(existing.map((e) => invoiceKey(e.type, e.pv, e.number)));

  const rows: ArcaPreviewRow[] = [];
  const toImport: { row: ArcaRow; customer: (typeof customers)[number] }[] = [];
  for (const r of parsed.rows) {
    if (r.unsupported || !r.type) {
      rows.push(toPreviewRow(r, "unsupported", r.unsupported, null));
      continue;
    }
    const customer = byCuit.get(r.docNumber);
    if (!customer) {
      rows.push(toPreviewRow(r, "no_customer", "Ningún cliente tiene ese CUIT", null));
      continue;
    }
    const key = invoiceKey(r.type, r.pointOfSale, r.number);
    if (seen.has(key)) {
      rows.push(toPreviewRow(r, "duplicate", "Ya está cargada", customer.legalName));
      continue;
    }
    seen.add(key);
    rows.push(toPreviewRow(r, "new", null, customer.legalName));
    toImport.push({ row: r, customer });
  }
  return { rows, toImport };
}

async function reconcileReceived(db: Executor, parsed: ReturnType<typeof parseArcaCsv>) {
  const pi = schema.purchaseInvoices;
  const [suppliers, purchases] = await Promise.all([
    db.select().from(schema.suppliers),
    db.select().from(pi).where(ne(pi.status, "voided")),
  ]);
  const byCuit = new Map(suppliers.filter((s) => s.cuit).map((s) => [s.cuit!.replace(/\D/g, ""), s]));
  const loaded = new Map<string, (typeof purchases)[number]>();
  for (const p of purchases) {
    if (!p.supplierId || !p.pointOfSale || !p.number) continue;
    loaded.set(`${p.supplierId}|${invoiceKey(p.invoiceType, p.pointOfSale, p.number)}`, p);
  }
  const rows: ArcaPreviewRow[] = [];
  for (const r of parsed.rows) {
    if (r.unsupported || !r.type) {
      rows.push(toPreviewRow(r, "unsupported", r.unsupported, null));
      continue;
    }
    const supplier = byCuit.get(r.docNumber);
    if (!supplier) {
      rows.push(
        toPreviewRow(r, "missing", "Falta cargar: el proveedor no está registrado (CUIT sin match)", null),
      );
      continue;
    }
    const found = loaded.get(`${supplier.id}|${invoiceKey(r.type, r.pointOfSale, r.number)}`);
    if (!found) {
      rows.push(toPreviewRow(r, "missing", "Falta cargar la factura de compra", supplier.legalName));
    } else if (Math.abs(found.total - r.total) > AMOUNT_TOLERANCE) {
      rows.push(
        toPreviewRow(
          r,
          "difference",
          `Importe distinto: en el sistema $ ${found.total.toLocaleString("es-AR")}, en ARCA $ ${r.total.toLocaleString("es-AR")}`,
          supplier.legalName,
        ),
      );
    } else {
      rows.push(toPreviewRow(r, "found", null, supplier.legalName));
    }
  }
  return rows;
}

/** Vista previa sin escribir: qué se importaría (emitidos) o cómo concilia contra compras (recibidos). */
export async function previewArca(db: Executor, kind: ArcaKind, text: string): Promise<ArcaPreview> {
  const parsed = parseArcaCsv(text, kind);
  if (kind === "issued") return finish(kind, parsed, (await classifyIssued(db, parsed)).rows);
  return finish(kind, parsed, await reconcileReceived(db, parsed));
}

/**
 * Importa los comprobantes emitidos nuevos como `sales_invoices` (idempotente: lo ya cargado se
 * reporta como duplicado). Con recibidos solo concilia. Devuelve el mismo reporte que la vista previa.
 */
export async function importArca(db: Executor, kind: ArcaKind, text: string) {
  const parsed = parseArcaCsv(text, kind);
  if (kind === "received") {
    return { ...finish(kind, parsed, await reconcileReceived(db, parsed)), imported: 0 };
  }
  const { rows, toImport } = await classifyIssued(db, parsed);
  if (toImport.length > 0) {
    await db.insert(schema.salesInvoices).values(
      toImport.map(({ row, customer }) => ({
        customerId: customer.id,
        invoiceType: row.type!,
        pointOfSale: row.pointOfSale,
        number: row.number,
        issueDate: row.date,
        dueDate: addDays(row.date, customer.paymentTermsDays),
        netTotal: row.net,
        vatTotal: row.vat,
        total: row.total,
        cae: row.cae,
        status: "confirmed" as const,
        source: "arca_import" as const,
      })),
    );
  }
  return { ...finish(kind, parsed, rows), imported: toImport.length };
}

export async function previewArcaFile(db: Executor, kind: ArcaKind, file: File) {
  return previewArca(db, kind, await readArcaText(file));
}

export async function importArcaFile(db: Executor, kind: ArcaKind, file: File) {
  return importArca(db, kind, await readArcaText(file));
}
