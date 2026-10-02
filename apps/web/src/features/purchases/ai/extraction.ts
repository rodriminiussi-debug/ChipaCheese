import { VAT_RATES, assertIsoDate, cuitDigits, normalizeInvoiceNumber, parseDecimalAR } from "@chipa/domain";

/**
 * Datos de una factura de compra leídos de una foto/PDF (RF-08). Es independiente del proveedor
 * de IA: tanto Claude como el extractor simulado devuelven esta forma ya normalizada.
 */
export type InvoiceKind = "A" | "B" | "C" | "X" | "NC_A" | "NC_B" | "NC_C";
export type ExtractedUnit = "kg" | "l" | "unit";

export interface ExtractedItem {
  description: string;
  qty: number;
  unit: ExtractedUnit | null;
  /** Precio unitario SIN IVA. */
  unitPriceNet: number;
  /** Alícuota en % (21, 10.5…). */
  vatRate: number;
  /** IVA de la línea tal como figura en la factura (null si no se pudo leer). */
  vatAmount: number | null;
}

export interface ExtractionMeta {
  provider: "claude" | "mock";
  model: string;
  /** Respuesta cruda de la IA (JSON ya parseado o texto) para auditoría. */
  raw: unknown;
}

export interface ExtractedInvoice {
  supplierName: string | null;
  /** Solo dígitos (11) o null. */
  supplierCuit: string | null;
  invoiceType: InvoiceKind | null;
  pointOfSale: string | null;
  number: string | null;
  issueDate: string | null;
  dueDate: string | null;
  items: ExtractedItem[];
  netTotal: number | null;
  vatTotal: number | null;
  /** Percepciones y otros tributos que no son IVA. */
  otherTaxes: number;
  total: number | null;
  notes: string | null;
  meta: ExtractionMeta;
}

export interface InvoiceExtractor {
  extract(file: { bytes: Buffer; contentType: string }): Promise<ExtractedInvoice>;
}

/** Fallo al leer la factura (servicio caído, respuesta inválida…): se puede cargar a mano. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    public raw?: unknown,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

// --- Esquema JSON para la salida estructurada de Claude -----------------------------------

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const str = { type: "string" };
const num = { type: "number" };

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "supplierName",
    "supplierCuit",
    "invoiceType",
    "pointOfSale",
    "number",
    "issueDate",
    "dueDate",
    "items",
    "netTotal",
    "vatTotal",
    "otherTaxes",
    "total",
    "notes",
  ],
  properties: {
    supplierName: nullable(str),
    supplierCuit: nullable(str),
    invoiceType: nullable({ type: "string", enum: ["A", "B", "C", "X", "NC_A", "NC_B", "NC_C"] }),
    pointOfSale: nullable(str),
    number: nullable(str),
    issueDate: nullable(str),
    dueDate: nullable(str),
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "qty", "unit", "unitPriceNet", "vatRate", "vatAmount"],
        properties: {
          description: str,
          qty: num,
          unit: nullable({ type: "string", enum: ["kg", "l", "unit"] }),
          unitPriceNet: num,
          vatRate: num,
          vatAmount: nullable(num),
        },
      },
    },
    netTotal: nullable(num),
    vatTotal: nullable(num),
    otherTaxes: nullable(num),
    total: nullable(num),
    notes: nullable(str),
  },
} as const;

// --- Normalización de la respuesta -------------------------------------------------------

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

const number = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return parseDecimalAR(v);
  return null;
};

/** "2026-10-01" o "01/10/2026" o "1-10-26" → ISO válido, o null. */
export function normalizeDate(v: unknown): string | null {
  const t = text(v);
  if (!t) return null;
  let iso: string | null = null;
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  const pad = (n: string) => n.padStart(2, "0");
  if (ymd) iso = `${ymd[1]}-${pad(ymd[2]!)}-${pad(ymd[3]!)}`;
  else if (dmy) {
    const year = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]!;
    iso = `${year}-${pad(dmy[2]!)}-${pad(dmy[1]!)}`;
  }
  if (!iso) return null;
  try {
    assertIsoDate(iso);
    return iso;
  } catch {
    return null;
  }
}

const UNITS: Record<string, ExtractedUnit> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  l: "l",
  lt: "l",
  lts: "l",
  litro: "l",
  litros: "l",
  u: "unit",
  un: "unit",
  unid: "unit",
  unidad: "unit",
  unidades: "unit",
  unit: "unit",
};
export const normalizeUnit = (v: unknown): ExtractedUnit | null => {
  const t = text(v);
  return t ? (UNITS[t.toLowerCase().replace(/\./g, "")] ?? null) : null;
};

const KINDS: InvoiceKind[] = ["A", "B", "C", "X", "NC_A", "NC_B", "NC_C"];
export function normalizeInvoiceKind(v: unknown): InvoiceKind | null {
  const t = text(v)?.toUpperCase().replace(/[\s-]+/g, "_");
  if (!t) return null;
  if ((KINDS as string[]).includes(t)) return t as InvoiceKind;
  const m = /^(?:FACTURA_)?([ABCX])$/.exec(t);
  if (m) return m[1] as InvoiceKind;
  const nc = /^NOTA_DE_CREDITO_([ABC])$/.exec(t);
  return nc ? (`NC_${nc[1]}` as InvoiceKind) : null;
}

function normalizeVatRate(v: unknown): number {
  const n = number(v);
  if (n == null || n < 0 || n > 100) return 21;
  const known = VAT_RATES.find((r) => Math.abs(r - n) < 0.05);
  return known ?? n;
}

/**
 * Convierte la respuesta de la IA (cualquier forma razonable) en `ExtractedInvoice`:
 * fechas ISO, números desde "1.234,50", CUIT de 11 dígitos, unidades y alícuotas conocidas.
 * Nunca lanza por datos faltantes: lo que no se puede leer queda en null para que lo complete el usuario.
 */
export function normalizeExtraction(raw: unknown, meta: ExtractionMeta): ExtractedInvoice {
  if (!raw || typeof raw !== "object") throw new ExtractionError("La respuesta de la IA no es un objeto.", raw);
  const r = raw as Record<string, unknown>;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  const items: ExtractedItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    const description = text(i.description);
    if (!description) continue;
    items.push({
      description,
      qty: number(i.qty) ?? 0,
      unit: normalizeUnit(i.unit),
      unitPriceNet: number(i.unitPriceNet) ?? 0,
      vatRate: normalizeVatRate(i.vatRate),
      vatAmount: number(i.vatAmount),
    });
  }
  const cuit = cuitDigits(text(r.supplierCuit));
  return {
    supplierName: text(r.supplierName),
    supplierCuit: cuit.length === 11 ? cuit : null,
    invoiceType: normalizeInvoiceKind(r.invoiceType),
    pointOfSale: normalizeInvoiceNumber(text(r.pointOfSale), 4),
    number: normalizeInvoiceNumber(text(r.number), 8),
    issueDate: normalizeDate(r.issueDate),
    dueDate: normalizeDate(r.dueDate),
    items,
    netTotal: number(r.netTotal),
    vatTotal: number(r.vatTotal),
    otherTaxes: number(r.otherTaxes) ?? 0,
    total: number(r.total),
    notes: text(r.notes),
    meta,
  };
}
