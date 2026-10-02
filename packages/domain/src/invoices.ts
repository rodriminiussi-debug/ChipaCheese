import { roundMoney, roundTo } from "./units";

export interface InvoiceLine {
  qty: number;
  unitPriceNet: number;
  /** Alícuota en porcentaje (21, 10.5…). */
  vatRate: number;
  /** IVA tal como figura en la factura; si viene, se usa en lugar de calcularlo. */
  vatAmount?: number | null;
}

/** Neto de la línea = cantidad × precio unitario neto. */
export function lineNet(line: InvoiceLine): number {
  return roundMoney(line.qty * line.unitPriceNet);
}

/**
 * Regla 11: el IVA se toma de la factura (`vatAmount`); solo si no viene se calcula
 * como neto × alícuota (nunca "a mano").
 */
export function lineVat(line: InvoiceLine): number {
  if (line.vatAmount != null) return roundMoney(line.vatAmount);
  return roundMoney((lineNet(line) * line.vatRate) / 100);
}

export interface InvoiceTotals {
  net: number;
  vat: number;
  vatByRate: Record<string, number>;
  otherTaxes: number;
  total: number;
}

/** Totales de una factura; `vatByRate` se indexa por alícuota ("21", "10.5"). */
export function invoiceTotals(lines: InvoiceLine[], otherTaxes = 0): InvoiceTotals {
  let net = 0;
  let vat = 0;
  const vatByRate: Record<string, number> = {};
  for (const l of lines) {
    const n = lineNet(l);
    const v = lineVat(l);
    net += n;
    vat += v;
    const key = String(l.vatRate);
    vatByRate[key] = roundMoney((vatByRate[key] ?? 0) + v);
  }
  const other = roundMoney(otherTaxes);
  return {
    net: roundMoney(net),
    vat: roundMoney(vat),
    vatByRate,
    otherTaxes: other,
    total: roundMoney(net + vat + other),
  };
}

/**
 * Regla 11 / RF-08: compara los totales calculados contra los declarados en la factura
 * (p. ej. leídos por IA). Cada campo declarado se compara con tolerancia (default $1).
 * `diffs` lista solo los campos que difieren más que la tolerancia.
 */
export function validateInvoiceTotals(input: {
  lines: InvoiceLine[];
  declared: { net?: number | null; vat?: number | null; total: number };
  otherTaxes?: number;
  tolerance?: number;
}): {
  ok: boolean;
  diffs: { field: "net" | "vat" | "total"; computed: number; declared: number }[];
} {
  const tolerance = input.tolerance ?? 1;
  const t = invoiceTotals(input.lines, input.otherTaxes ?? 0);
  const diffs: { field: "net" | "vat" | "total"; computed: number; declared: number }[] = [];
  const check = (field: "net" | "vat" | "total", declared: number | null | undefined): void => {
    if (declared == null) return;
    if (Math.abs(t[field] - declared) > tolerance) {
      diffs.push({ field, computed: t[field], declared });
    }
  };
  check("net", input.declared.net);
  check("vat", input.declared.vat);
  check("total", input.declared.total);
  return { ok: diffs.length === 0, diffs };
}

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Valida un CUIT/CUIL con el algoritmo módulo 11 de AFIP/ARCA. Acepta "20-12345678-6"
 * o "20123456786". Dígito verificador = 11 − (Σ dígito × peso) mod 11; 11 → 0, 10 → 9.
 */
export function isValidCuit(cuit: string): boolean {
  if (!/^\d{2}-?\d{8}-?\d$/.test(cuit)) return false;
  const digits = cuit.replace(/-/g, "");
  let sum = 0;
  for (let i = 0; i < CUIT_WEIGHTS.length; i++) {
    sum += Number(digits[i]) * (CUIT_WEIGHTS[i] as number);
  }
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  else if (check === 10) check = 9;
  return check === Number(digits[10]);
}

/** Formatea un CUIT como "30-12345678-9". Lanza error si no tiene 11 dígitos. */
export function formatCuit(cuit: string): string {
  const digits = cuit.replace(/\D/g, "");
  if (digits.length !== 11) throw new RangeError(`Invalid CUIT: "${cuit}"`);
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

/**
 * RF-09: variación porcentual de precio (actual vs. anterior), 2 decimales.
 * `null` si no hay precio anterior válido (<= 0).
 */
export function priceVariationPct(previous: number, current: number): number | null {
  if (!(previous > 0)) return null;
  return roundTo(((current - previous) / previous) * 100, 2);
}
