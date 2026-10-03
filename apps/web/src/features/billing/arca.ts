import { parseDecimalAR, roundMoney, type IsoDate } from "@chipa/domain";
import { UserError } from "@/server/errors";

/**
 * RF-32: parser tolerante del CSV de "Mis Comprobantes" de ARCA (emitidos y recibidos).
 *
 *  - Separador `;` o `,` (se detecta en el encabezado), comillas, BOM y fin de línea CRLF.
 *  - Encabezados en español con o sin tildes y variantes ("Fecha de Emisión", "Tipo de Comprobante",
 *    "Punto de Venta", "Número Desde", "Cód. Autorización", "Nro. Doc. Receptor/Emisor",
 *    "Denominación Receptor/Emisor", "Imp. Neto Gravado", "IVA"/"Total IVA", "Imp. Total").
 *  - Importes con coma decimal ("1.234,56") o punto ("1234.56"); fechas "dd/mm/aaaa" o "aaaa-mm-dd".
 *  - Función pura: no toca la base.
 */

export type ArcaKind = "issued" | "received";
export type ArcaInvoiceType = "A" | "B" | "C" | "X" | "NC_A" | "NC_B" | "NC_C";

export interface ArcaRow {
  /** Línea del archivo (1 = encabezado) para reportar errores. */
  line: number;
  date: IsoDate;
  /** null = tipo no soportado (ver `unsupported`). */
  type: ArcaInvoiceType | null;
  typeText: string;
  unsupported: string | null;
  pointOfSale: string;
  number: string;
  cae: string | null;
  /** CUIT/DNI de la contraparte (receptor en emitidos, emisor en recibidos), solo dígitos. */
  docNumber: string;
  name: string;
  net: number;
  vat: number;
  total: number;
}

export interface ArcaParse {
  kind: ArcaKind;
  delimiter: ";" | ",";
  rows: ArcaRow[];
  errors: { line: number; message: string }[];
}

/** Minúsculas, sin tildes ni signos, espacios simples: "Cód. Autorización" → "cod autorizacion". */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectDelimiter(headerLine: string): ";" | "," {
  let semi = 0;
  let comma = 0;
  let quoted = false;
  for (const ch of headerLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ";") semi++;
    else if (!quoted && ch === ",") comma++;
  }
  return semi >= comma ? ";" : ",";
}

/** Divide en registros y campos respetando comillas (y comillas dobles escapadas). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (record.some((f) => f.trim() !== "")) records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) pushField();
    else if (ch === "\n") pushRecord();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRecord();
    } else field += ch;
  }
  if (field !== "" || record.length > 0) pushRecord();
  return records;
}

type Matcher = (h: string) => boolean;

interface ColumnSpec {
  date: Matcher;
  type: Matcher;
  pointOfSale: Matcher;
  number: Matcher;
  cae: Matcher;
  doc: Matcher;
  name: Matcher;
  net: Matcher;
  vat: Matcher;
  total: Matcher;
  currency: Matcher;
}

const SPEC: ColumnSpec = {
  date: (h) => h.startsWith("fecha"),
  type: (h) => h === "tipo" || h.startsWith("tipo de comprobante") || h === "tipo comprobante",
  pointOfSale: (h) => h.startsWith("punto de venta") || h === "pto vta" || h === "pv",
  number: (h) =>
    h === "numero desde" || h === "numero" || h === "nro comprobante" || h === "numero comprobante",
  cae: (h) => h.startsWith("cod autorizacion") || h === "cae" || h.startsWith("codigo de autorizacion"),
  doc: (h) =>
    /^nro doc (receptor|emisor)/.test(h) || h === "nro doc" || h === "cuit" || h === "nro documento",
  name: (h) => h.startsWith("denominacion") || h === "razon social",
  net: (h) => h === "imp neto gravado" || h === "neto gravado" || h === "importe neto gravado",
  vat: (h) => h === "iva" || h === "total iva" || h === "importe iva",
  total: (h) => h === "imp total" || h === "total" || h === "importe total",
  currency: (h) => h === "moneda",
};

const REQUIRED: [keyof ColumnSpec, string][] = [
  ["date", "Fecha"],
  ["type", "Tipo"],
  ["pointOfSale", "Punto de Venta"],
  ["number", "Número Desde"],
  ["total", "Imp. Total"],
];

/** Códigos de comprobante de ARCA → tipo del sistema (null = no soportado). */
const TYPE_BY_CODE: Record<number, ArcaInvoiceType | null> = {
  1: "A",
  6: "B",
  11: "C",
  201: "A",
  206: "B",
  211: "C",
  3: "NC_A",
  8: "NC_B",
  13: "NC_C",
  203: "NC_A",
  208: "NC_B",
  213: "NC_C",
};
const DEBIT_CODES = new Set([2, 7, 12, 202, 207, 212]);

/** "1 - Factura A", "Factura B", "11", "Nota de Crédito C"… → tipo del sistema. */
export function parseArcaType(text: string): { type: ArcaInvoiceType | null; unsupported: string | null } {
  const raw = text.trim();
  const code = /^(\d{1,3})\b/.exec(raw);
  if (code) {
    const n = Number(code[1]);
    if (n in TYPE_BY_CODE) return { type: TYPE_BY_CODE[n]!, unsupported: null };
    if (DEBIT_CODES.has(n)) return { type: null, unsupported: "Nota de débito (no soportada)" };
    return { type: null, unsupported: `Tipo de comprobante no soportado (${raw})` };
  }
  const t = normalizeHeader(raw);
  const letter = /\b([abc])$/.exec(t)?.[1]?.toUpperCase();
  if (t.includes("nota de debito")) return { type: null, unsupported: "Nota de débito (no soportada)" };
  if (t.includes("nota de credito") && letter)
    return { type: `NC_${letter}` as ArcaInvoiceType, unsupported: null };
  if (t.includes("factura") && letter) return { type: letter as ArcaInvoiceType, unsupported: null };
  return { type: null, unsupported: `Tipo de comprobante no soportado (${raw})` };
}

/** Fecha "dd/mm/aaaa" o "aaaa-mm-dd" (con o sin hora) → ISO; null si es inválida. */
export function parseArcaDate(text: string): IsoDate | null {
  const t = text.trim();
  let y: string, m: string, d: string;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (match) [, y, m, d] = match as unknown as string[];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t))) [, d, m, y] = match as unknown as string[];
  else return null;
  const iso = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function parseAmount(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  const n = parseDecimalAR(t);
  return n == null ? null : roundMoney(n);
}

/** Parsea el CSV. Lanza UserError si faltan columnas esenciales; las filas con problemas van a `errors`. */
export function parseArcaCsv(text: string, kind: ArcaKind): ArcaParse {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records = splitCsv(clean, delimiter);
  if (records.length === 0) throw new UserError("El archivo está vacío.");

  const headers = records[0]!.map(normalizeHeader);
  const idx: Partial<Record<keyof ColumnSpec, number>> = {};
  for (const key of Object.keys(SPEC) as (keyof ColumnSpec)[]) {
    const i = headers.findIndex((h) => SPEC[key](h));
    if (i >= 0) idx[key] = i;
  }
  const missing = REQUIRED.filter(([k]) => idx[k] === undefined).map(([, label]) => label);
  if (missing.length > 0)
    throw new UserError(`No parece un CSV de "Mis Comprobantes": faltan las columnas ${missing.join(", ")}.`);

  const get = (rec: string[], k: keyof ColumnSpec) =>
    idx[k] === undefined ? "" : (rec[idx[k]!] ?? "").trim();
  const rows: ArcaRow[] = [];
  const errors: ArcaParse["errors"] = [];

  records.slice(1).forEach((rec, n) => {
    const line = n + 2;
    const date = parseArcaDate(get(rec, "date"));
    if (!date) return void errors.push({ line, message: `Fecha inválida ("${get(rec, "date")}")` });

    const typeText = get(rec, "type");
    const { type, unsupported } = parseArcaType(typeText);

    const pv = get(rec, "pointOfSale").replace(/\D/g, "");
    const number = get(rec, "number").replace(/\D/g, "");
    if (!pv || pv.length > 5)
      return void errors.push({ line, message: `Punto de venta inválido ("${get(rec, "pointOfSale")}")` });
    if (!number || number.length > 8)
      return void errors.push({ line, message: `Número inválido ("${get(rec, "number")}")` });

    const net = parseAmount(get(rec, "net"));
    const vat = parseAmount(get(rec, "vat"));
    const total = parseAmount(get(rec, "total"));
    if (net == null || vat == null || total == null)
      return void errors.push({ line, message: "Importe inválido" });

    const currency = get(rec, "currency");
    let unsupportedReason = unsupported;
    if (!unsupportedReason && currency && !/^(\$|pes|ars)/i.test(currency))
      unsupportedReason = `Moneda no soportada (${currency})`;

    const isCredit = type?.startsWith("NC_") ?? false;
    if (!unsupportedReason && !isCredit && total < 0)
      return void errors.push({
        line,
        message: "Importe total negativo en un comprobante que no es nota de crédito",
      });
    // Las notas de crédito pueden venir con signo negativo: se guardan en positivo.
    const absTotal = Math.abs(total);
    if (!unsupportedReason && !(absTotal > 0))
      return void errors.push({ line, message: "El importe total debe ser mayor a 0" });

    const cae = get(rec, "cae").replace(/\D/g, "");
    rows.push({
      line,
      date,
      type: unsupportedReason ? null : type,
      typeText,
      unsupported: unsupportedReason,
      pointOfSale: pv.padStart(4, "0"),
      number: number.padStart(8, "0"),
      cae: cae && !/^0+$/.test(cae) ? cae : null,
      docNumber: get(rec, "doc").replace(/\D/g, ""),
      name: get(rec, "name"),
      net: Math.abs(net),
      vat: Math.abs(vat),
      total: absTotal,
    });
  });

  return { kind, delimiter, rows, errors };
}

/** Clave estable de un comprobante para detectar duplicados aunque cambie el relleno con ceros. */
export function invoiceKey(type: string, pointOfSale: string, number: string): string {
  return `${type}|${Number(pointOfSale)}|${Number(number)}`;
}
