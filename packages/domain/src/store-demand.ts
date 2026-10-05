import { addDays, diffDays, type IsoDate } from "./dates";
import { roundQty, roundTo } from "./units";

/**
 * Stock del local por demanda: venta diaria promedio, días hasta agotarse y cantidad sugerida de
 * reposición. Reglas puras: la app aporta las ventas y el stock; acá solo se calcula.
 *
 * Convenciones:
 * - La ventana de demanda son los últimos `STORE_DEMAND_WINDOW_DAYS` días, contando hoy: (hoy − 29 … hoy).
 * - Si el local empezó a vender hace menos días, se promedia solo sobre los días con datos
 *   (desde la primera venta del local hasta hoy), para no subestimar la demanda.
 * - Un elaborado (p. ej. chipá horneado) consume `baseQty` del producto base por unidad vendida:
 *   su demanda se suma a la del base (ver `demandInBaseUnits`).
 */

export const STORE_DEMAND_WINDOW_DAYS = 30;
/** Días de venta que debe cubrir una reposición (parámetro `store.target_days`). */
export const DEFAULT_STORE_TARGET_DAYS = 3;
/** Días que tarda la planta en reponer (parámetro `store.replenish_lead_days`). */
export const DEFAULT_STORE_LEAD_DAYS = 1;

/** Primer día de la ventana de demanda (inclusive). */
export function demandWindowStart(today: IsoDate, windowDays: number = STORE_DEMAND_WINDOW_DAYS): IsoDate {
  if (!(windowDays >= 1)) throw new RangeError("windowDays must be >= 1");
  return addDays(today, -(windowDays - 1));
}

/**
 * Días con datos de la ventana: desde la primera venta del local (o el inicio de la ventana, lo que
 * sea más reciente) hasta hoy, inclusive. 0 si el local nunca vendió.
 */
export function demandObservedDays(
  today: IsoDate,
  firstSaleDay: IsoDate | null,
  windowDays: number = STORE_DEMAND_WINDOW_DAYS,
): number {
  if (!firstSaleDay || firstSaleDay > today) return 0;
  return Math.min(windowDays, diffDays(today, firstSaleDay) + 1);
}

/** Venta diaria promedio = unidades vendidas en la ventana ÷ días con datos (3 decimales). */
export function averageDailyDemand(unitsSold: number, observedDays: number): number {
  if (!(observedDays > 0) || !(unitsSold > 0)) return 0;
  return roundQty(unitsSold / observedDays);
}

/** Unidades del producto base que consume vender `units` de un elaborado. */
export function demandInBaseUnits(units: number, baseQty: number): number {
  return roundQty(units * baseQty);
}

/** Cuántas unidades de un elaborado se pueden armar con el stock del producto base. */
export function preparedAvailable(baseStock: number, baseQty: number): number {
  if (!(baseQty > 0) || !(baseStock > 0)) return 0;
  return Math.floor(baseStock / baseQty + 1e-9);
}

/**
 * Reparte las unidades vendidas de un elaborado entre los lotes del producto base consumidos (FEFO).
 * Cada unidad se atribuye al lote donde empieza su consumo; así la línea de venta queda con cantidades
 * enteras por lote y la trazabilidad conserva el lote del base.
 */
export function splitPreparedUnitsByLot(
  units: number,
  baseQty: number,
  allocations: { lotId: string; qty: number }[],
): { lotId: string; units: number }[] {
  const out = new Map<string, number>();
  const ends: { lotId: string; end: number }[] = [];
  let acc = 0;
  for (const a of allocations) {
    acc = roundQty(acc + a.qty);
    ends.push({ lotId: a.lotId, end: acc });
  }
  for (let i = 0; i < units; i++) {
    const start = roundQty(i * baseQty);
    const lot = ends.find((e) => e.end > start + 1e-9) ?? ends[ends.length - 1];
    if (!lot) throw new RangeError("allocations required");
    out.set(lot.lotId, (out.get(lot.lotId) ?? 0) + 1);
  }
  return [...out].map(([lotId, n]) => ({ lotId, units: n }));
}

export type StoreStockStatus = "ok" | "reorder" | "out" | "no_sales";

export interface StoreStockAlertInput {
  /** Unidades hoy en el local. */
  stock: number;
  /** Unidades ya pedidas a la planta y todavía no enviadas. */
  incoming?: number;
  /** Venta diaria promedio (unidades). */
  avgDaily: number;
  /** Días de venta que debe cubrir la reposición. */
  targetDays: number;
  /** Días que tarda la planta en reponer. */
  leadDays: number;
}

export interface StoreStockAlert {
  status: StoreStockStatus;
  avgDaily: number;
  /** Días hasta agotarse a la venta promedio (1 decimal); null sin ventas. */
  daysLeft: number | null;
  /** Se agota antes de que llegue una reposición pedida hoy. */
  runsOutBeforeArrival: boolean;
  /** Unidades a pedir (enteras) para cubrir plazo de reposición + días objetivo, descontando lo ya pedido. */
  suggestedQty: number;
}

/**
 * Estado y reposición sugerida de un producto del local.
 * - agotado: sin stock y con ventas recientes;
 * - reponer: el stock no alcanza para el plazo de reposición + los días objetivo;
 * - ok: alcanza; sin ventas: no hubo ventas en la ventana (no hay demanda para medir).
 * Sugerido = ⌈venta diaria × (plazo + días objetivo) − stock − ya pedido⌉, nunca negativo.
 */
export function classifyStoreStock(input: StoreStockAlertInput): StoreStockAlert {
  const { stock, avgDaily, targetDays, leadDays } = input;
  const incoming = Math.max(0, input.incoming ?? 0);
  if (!(avgDaily > 0)) {
    return { status: "no_sales", avgDaily: 0, daysLeft: null, runsOutBeforeArrival: false, suggestedQty: 0 };
  }
  const needed = avgDaily * (leadDays + targetDays);
  const suggestedQty = Math.max(0, Math.ceil(roundTo(needed - stock - incoming, 6)));
  const available = Math.max(0, stock);
  const daysLeft = roundTo(available / avgDaily, 1);
  const status: StoreStockStatus = stock <= 0 ? "out" : stock < needed ? "reorder" : "ok";
  return {
    status,
    avgDaily,
    daysLeft,
    runsOutBeforeArrival: stock <= 0 || available / avgDaily < leadDays,
    suggestedQty,
  };
}

const STATUS_RANK: Record<StoreStockStatus, number> = { out: 0, reorder: 1, ok: 2, no_sales: 3 };

/** Orden por urgencia: agotado → reponer → ok → sin ventas; dentro de cada grupo, menos días de stock primero. */
export function compareStoreAlertUrgency(
  a: { status: StoreStockStatus; daysLeft: number | null },
  b: { status: StoreStockStatus; daysLeft: number | null },
): number {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  const da = a.daysLeft ?? Infinity;
  const db = b.daysLeft ?? Infinity;
  if (da === db) return 0;
  return da < db ? -1 : 1;
}
