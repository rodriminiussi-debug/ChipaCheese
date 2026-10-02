import type { CoverageStatus, ExpiryLevel } from "@chipa/domain";
import type { Tone } from "@/components/app/status-badge";
import type { AdjustmentKind } from "./schemas";

/** Etiquetas en español del módulo de stock (M3). */

export const MOVEMENT_TYPE: Record<string, { label: string; tone: Tone }> = {
  receipt: { label: "Recepción", tone: "good" },
  production_consumption: { label: "Consumo de producción", tone: "warn" },
  production_output: { label: "Envasado", tone: "good" },
  dispatch: { label: "Despacho", tone: "info" },
  store_sale: { label: "Venta del local", tone: "info" },
  transfer: { label: "Transferencia", tone: "neutral" },
  adjustment: { label: "Ajuste", tone: "warn" },
  return: { label: "Devolución", tone: "neutral" },
  waste: { label: "Merma / descarte", tone: "bad" },
};

export const COVERAGE_STATUS: Record<CoverageStatus, { label: string; tone: Tone }> = {
  ok: { label: "OK", tone: "good" },
  reorder: { label: "Reponer", tone: "warn" },
  out_of_stock: { label: "Sin stock", tone: "bad" },
  no_consumption: { label: "Sin consumo", tone: "neutral" },
};

export const EXPIRY_LEVEL: Record<ExpiryLevel, Tone> = {
  none: "neutral",
  ok: "neutral",
  soon: "warn",
  expired: "bad",
};

export const ADJUSTMENT_KIND: Record<AdjustmentKind, { label: string; sign: 1 | -1 }> = {
  shrinkage: { label: "Merma (resta)", sign: -1 },
  discard: { label: "Descarte (resta)", sign: -1 },
  correction_in: { label: "Corrección en más (suma)", sign: 1 },
  correction_out: { label: "Corrección en menos (resta)", sign: -1 },
};

/** Texto corto del tipo de ajuste para la nota del movimiento. */
export const ADJUSTMENT_NOTE: Record<AdjustmentKind, string> = {
  shrinkage: "Merma",
  discard: "Descarte",
  correction_in: "Corrección (+)",
  correction_out: "Corrección (−)",
};

/** Documento origen de un movimiento (ref_table). Otros módulos pueden agregar el suyo acá. */
export const REF_TABLE: Record<string, { label: string; href?: (id: string) => string }> = {
  raw_lots: { label: "Lote de materia prima" },
  receptions: { label: "Recepción" },
  production_runs: { label: "Producción" },
  packings: { label: "Envasado" },
  inventory_counts: { label: "Inventario físico", href: (id) => `/stock/inventario/${id}` },
  stock_transfer: { label: "Transferencia" },
  stock_adjustment: { label: "Ajuste manual" },
  dispatch_notes: { label: "Remito" },
  orders: { label: "Pedido" },
  store_sales: { label: "Venta del local" },
};

export const COUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "En curso", tone: "warn" },
  confirmed: { label: "Confirmado", tone: "good" },
  voided: { label: "Anulado", tone: "neutral" },
};

export const ITEM_KIND: Record<string, string> = {
  ingredient: "Materia prima",
  product: "Producto terminado",
};
