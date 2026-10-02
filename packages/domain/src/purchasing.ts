import { addDays, diffDays, monthKey, type IsoDate } from "./dates";
import { priceVariationPct } from "./invoices";
import { roundQty } from "./units";

/**
 * Reglas de compras y proveedores (M2): conciliación de textos de facturas con el maestro,
 * vencimientos, series de precios, estado de las órdenes de compra y mensajes de WhatsApp.
 */

/** Temperatura máxima aceptable al recibir insumos refrigerados, en °C (RF-11). */
export const MAX_REFRIGERATED_TEMP_C = 5;

/** ¿La temperatura registrada al recibir supera el máximo para refrigerados? */
export function isTemperatureAlert(temperatureC: number, max: number = MAX_REFRIGERATED_TEMP_C): boolean {
  return temperatureC > max;
}

// --- Conciliación por texto ---------------------------------------------------------------

/** Minúsculas, sin tildes ni signos: "Fécula (x kg)" → "fecula x kg". */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["x", "kg", "kgs", "kilo", "kilos", "lt", "lts", "l", "de", "del", "la", "el", "en", "por", "con", "sin", "u", "un"]);

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeText(s).split(" ")) {
    if (!raw || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    // Singular simple: "huevos" → "huevo", "quesos" → "queso".
    out.add(raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
  }
  return out;
}

/**
 * Similitud 0..1 entre dos descripciones: coeficiente de Dice sobre palabras significativas.
 * Si todas las palabras de la más corta están en la otra ("Huevo" ⊂ "Huevos blancos maple")
 * el puntaje es al menos 0,7.
 */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  if (common === 0) return 0;
  const dice = (2 * common) / (ta.size + tb.size);
  const shorter = Math.min(ta.size, tb.size);
  return common === shorter ? Math.max(dice, 0.7) : dice;
}

export interface NamedCandidate {
  id: string;
  /** Todos los nombres con los que puede aparecer (razón social, fantasía, nombre del insumo…). */
  names: string[];
}

/**
 * Mejor candidato por similitud de nombre, o `null` si ninguno llega al umbral o hay empate
 * entre dos candidatos distintos (ambiguo: mejor que decida el usuario).
 */
export function bestNameMatch(
  query: string,
  candidates: NamedCandidate[],
  threshold = 0.5,
): { id: string; score: number } | null {
  const scored = candidates
    .map((c) => ({ id: c.id, score: Math.max(0, ...c.names.map((n) => textSimilarity(query, n))) }))
    .filter((c) => c.score >= threshold)
    .sort((x, y) => y.score - x.score);
  const top = scored[0];
  if (!top) return null;
  const second = scored[1];
  if (second && top.score - second.score < 0.05) return null;
  return top;
}

/** CUIT solo con dígitos ("30-71234567-4" → "30712345674"). */
export const cuitDigits = (cuit: string | null | undefined): string => (cuit ?? "").replace(/\D/g, "");

/**
 * Proveedor de una factura: primero por CUIT exacto y, si no hay, por similitud de nombre
 * (umbral 0,6). `null` si no hay certeza.
 */
export function matchSupplier(
  extracted: { name?: string | null; cuit?: string | null },
  suppliers: { id: string; cuit: string | null; legalName: string; tradeName: string | null }[],
): string | null {
  const cuit = cuitDigits(extracted.cuit);
  if (cuit.length === 11) {
    const byCuit = suppliers.find((s) => cuitDigits(s.cuit) === cuit);
    if (byCuit) return byCuit.id;
  }
  if (!extracted.name) return null;
  const match = bestNameMatch(
    extracted.name,
    suppliers.map((s) => ({ id: s.id, names: [s.legalName, s.tradeName].filter((n): n is string => !!n) })),
    0.6,
  );
  return match?.id ?? null;
}

// --- Facturas -----------------------------------------------------------------------------

/** Punto de venta a 4 dígitos y número a 8 ("1" → "0001"; "4567" → "00004567"). Vacío → null. */
export function normalizeInvoiceNumber(value: string | null | undefined, width: 4 | 8): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length >= width ? digits.slice(-width) : digits.padStart(width, "0");
}

/** "0003-00004567". */
export function formatInvoiceNumber(pointOfSale: string | null, number: string | null): string {
  if (!pointOfSale && !number) return "s/n";
  return `${pointOfSale ?? "----"}-${number ?? "--------"}`;
}

/** Vencimiento efectivo de una factura: el de la factura o emisión + plazo de pago del proveedor. */
export function invoiceDueDate(input: {
  issueDate: IsoDate;
  dueDate?: IsoDate | null;
  paymentTermsDays: number;
}): IsoDate {
  return input.dueDate ?? addDays(input.issueDate, input.paymentTermsDays);
}

// --- Historial de precios (RF-09) ---------------------------------------------------------

export interface PricePoint {
  date: IsoDate;
  price: number;
}

/**
 * Serie mensual de precios: el último precio de cada mes y su variación contra el último
 * precio del mes anterior con datos. Ordenada por mes ascendente.
 */
export function monthlyPriceSeries(
  points: PricePoint[],
): { month: string; price: number; variationPct: number | null }[] {
  const lastByMonth = new Map<string, PricePoint>();
  for (const p of [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    lastByMonth.set(monthKey(p.date), p);
  }
  const rows: { month: string; price: number; variationPct: number | null }[] = [];
  let prev: number | null = null;
  for (const [month, p] of [...lastByMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push({ month, price: p.price, variationPct: prev == null ? null : priceVariationPct(prev, p.price) });
    prev = p.price;
  }
  return rows;
}

/** Variación de cada compra contra la anterior de la misma serie (orden cronológico). */
export function purchaseVariations(points: PricePoint[]): (number | null)[] {
  return points.map((p, i) => (i === 0 ? null : priceVariationPct(points[i - 1]!.price, p.price)));
}

// --- Órdenes de compra (RF-10) ------------------------------------------------------------

export const PO_PREFIX = "OC-";

export const formatPoNumber = (n: number): string => `${PO_PREFIX}${String(n).padStart(4, "0")}`;

/** Próximo número correlativo a partir de los existentes ("OC-0007" → "OC-0008"). */
export function nextPoNumber(existing: string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^OC-(\d+)$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatPoNumber(max + 1);
}

export type PoStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";

/**
 * Estado de una OC tras una recepción: "received" si cada línea recibió al menos lo pedido
 * (tolerancia 0,1 %), "partially_received" si llegó algo, y el mismo estado si no llegó nada.
 */
export function poStatusAfterReception(
  ordered: { ingredientId: string; qty: number }[],
  received: Record<string, number>,
  current: PoStatus,
): PoStatus {
  if (current === "cancelled") return current;
  const orderedByIng: Record<string, number> = {};
  for (const o of ordered) orderedByIng[o.ingredientId] = roundQty((orderedByIng[o.ingredientId] ?? 0) + o.qty);
  const ids = Object.keys(orderedByIng);
  const anyReceived = Object.values(received).some((q) => q > 0);
  if (!anyReceived) return current;
  const complete = ids.every((id) => (received[id] ?? 0) >= orderedByIng[id]! * 0.999);
  return complete ? "received" : "partially_received";
}

export type DeliveryTiming = { state: "overdue" | "today" | "upcoming" | "unscheduled"; days: number };

/** Entrega esperada vs hoy: `days` = días de atraso (overdue) o de espera (upcoming). */
export function deliveryTiming(expectedAt: IsoDate | null, today: IsoDate): DeliveryTiming {
  if (!expectedAt) return { state: "unscheduled", days: 0 };
  const d = diffDays(expectedAt, today);
  if (d < 0) return { state: "overdue", days: -d };
  if (d === 0) return { state: "today", days: 0 };
  return { state: "upcoming", days: d };
}

// --- WhatsApp (un solo canal con cada proveedor) ------------------------------------------

/**
 * Número para wa.me (solo dígitos, con código de país). Acepta formatos locales argentinos:
 * "+54 9 341 555-1234", "0341 15 555 1234", "341 5551234". `null` si no parece un teléfono.
 */
export function whatsappNumber(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) {
    // 54 + 10 dígitos (sin el 9 de celular) → insertar el 9.
    if (d.length === 12) d = `549${d.slice(2)}`;
    return d.length >= 12 && d.length <= 13 ? d : null;
  }
  if (d.startsWith("0")) d = d.slice(1);
  // "341 15 5551234" → quitar el 15 después del código de área (2 a 4 dígitos).
  const m = /^(\d{2,4})15(\d{6,8})$/.exec(d);
  if (m && m[1]!.length + m[2]!.length === 10) d = m[1]! + m[2]!;
  return d.length === 10 ? `549${d}` : null;
}

export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
