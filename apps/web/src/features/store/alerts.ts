import {
  addDays,
  averageDailyDemand,
  classifyStoreStock,
  compareStoreAlertUrgency,
  DEFAULT_STORE_LEAD_DAYS,
  DEFAULT_STORE_TARGET_DAYS,
  demandInBaseUnits,
  demandObservedDays,
  demandWindowStart,
  preparedAvailable,
  roundQty,
  type IsoDate,
  type StoreStockAlert,
} from "@chipa/domain";
import { and, asc, eq, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { TZ, todayAR } from "@/lib/dates";
import { locationByCode } from "@/features/stock/ledger";
import { activeSale, localStockByProduct, STORE_LOCATION } from "./service";

/**
 * Alertas automáticas del stock del local según la demanda: por producto, venta diaria promedio de los
 * últimos 30 días (o los días con datos), días hasta agotarse y cantidad sugerida de reposición.
 * Las reglas de cálculo son puras (packages/domain/src/store-demand.ts).
 */

export const SETTING_TARGET_DAYS = "store.target_days";
export const SETTING_LEAD_DAYS = "store.replenish_lead_days";

const SOLD_DAY = sql`(${schema.storeSales.soldAt} at time zone ${TZ})::date`;

async function numericSetting(db: Executor, key: string, fallback: number, min: number): Promise<number> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Parámetros del stock del local: días que debe cubrir una reposición y días que tarda la planta. */
export async function getStoreStockSettings(db: Executor) {
  const [targetDays, leadDays] = await Promise.all([
    numericSetting(db, SETTING_TARGET_DAYS, DEFAULT_STORE_TARGET_DAYS, 1),
    numericSetting(db, SETTING_LEAD_DAYS, DEFAULT_STORE_LEAD_DAYS, 0),
  ]);
  return { targetDays, leadDays };
}

/** Upsert de los parámetros (siempre dentro de action() para que quede auditado). */
export async function setStoreStockSettings(db: Executor, input: { targetDays?: number; leadDays?: number }) {
  const up = async (key: string, value: number, description: string) =>
    db
      .insert(schema.appSettings)
      .values({ key, value, description })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  if (input.targetDays != null) {
    if (!(input.targetDays >= 1)) throw new UserError("Los días a cubrir deben ser al menos 1.");
    await up(SETTING_TARGET_DAYS, input.targetDays, "Días de venta que debe cubrir una reposición del local");
  }
  if (input.leadDays != null) {
    if (!(input.leadDays >= 0)) throw new UserError("El plazo de reposición no puede ser negativo.");
    await up(SETTING_LEAD_DAYS, input.leadDays, "Días que tarda la planta en reponer el local");
  }
  return getStoreStockSettings(db);
}

export interface StoreStockRow extends StoreStockAlert {
  productId: string;
  code: string;
  name: string;
  kind: "manufactured" | "resale";
  unitLabel: string;
  /** Unidades hoy en el local. */
  stock: number;
  /** Unidades pedidas a la planta que todavía no se enviaron. */
  incoming: number;
  /** Fecha estimada de agotamiento a la venta promedio (null sin ventas). */
  runsOutOn: IsoDate | null;
  /** La venta promedio incluye lo que consumen los elaborados con este producto. */
  includesPrepared: boolean;
  /** Se repone desde la planta (fabricados); la reventa se repone con el proveedor. */
  fromPlant: boolean;
}

export interface StoreStockAlerts {
  today: IsoDate;
  targetDays: number;
  leadDays: number;
  /** Días con datos que se usaron para el promedio (hasta 30). */
  observedDays: number;
  /** Todos los productos del local, de más a menos urgente. */
  rows: StoreStockRow[];
  counts: { out: number; reorder: number; ok: number; noSales: number };
}

/** Unidades pedidas a la planta y aún no enviadas, por producto. */
export async function pendingRequestedByProduct(db: Executor): Promise<Map<string, number>> {
  const rows = await db
    .select({
      productId: schema.storeReplenishmentItems.productId,
      qty: sql<number>`coalesce(sum(${schema.storeReplenishmentItems.qtyRequested}), 0)::int`,
    })
    .from(schema.storeReplenishmentItems)
    .innerJoin(
      schema.storeReplenishments,
      eq(schema.storeReplenishments.id, schema.storeReplenishmentItems.replenishmentId),
    )
    .where(eq(schema.storeReplenishments.status, "requested"))
    .groupBy(schema.storeReplenishmentItems.productId);
  return new Map(rows.map((r) => [r.productId, r.qty]));
}

/**
 * Alertas de stock del local por demanda (para /local y el tablero).
 * Demanda: unidades vendidas en los últimos 30 días (ventas vigentes, no anuladas) ÷ días con datos;
 * lo que se vende de un elaborado cuenta como demanda de su producto base.
 */
export async function getStoreStockAlerts(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<StoreStockAlerts> {
  const location = await locationByCode(db, STORE_LOCATION);
  const from = demandWindowStart(today);
  const [settings, stockBy, incomingBy, products, sold, first] = await Promise.all([
    getStoreStockSettings(db),
    localStockByProduct(db, location.id),
    pendingRequestedByProduct(db),
    db.query.products.findMany({
      where: and(eq(schema.products.active, true), eq(schema.products.availableInStore, true)),
      orderBy: asc(schema.products.code),
    }),
    db
      .select({
        productId: schema.storeSaleItems.productId,
        units: sql<number>`coalesce(sum(${schema.storeSaleItems.qtyUnits}), 0)::int`,
      })
      .from(schema.storeSaleItems)
      .innerJoin(schema.storeSales, eq(schema.storeSales.id, schema.storeSaleItems.saleId))
      .where(
        and(
          eq(schema.storeSales.locationId, location.id),
          activeSale,
          sql`${SOLD_DAY} >= ${from}::date`,
          sql`${SOLD_DAY} <= ${today}::date`,
        ),
      )
      .groupBy(schema.storeSaleItems.productId),
    db
      .select({ day: sql<string>`min(${SOLD_DAY})::text` })
      .from(schema.storeSales)
      .where(and(eq(schema.storeSales.locationId, location.id), activeSale)),
  ]);
  const observedDays = demandObservedDays(today, first[0]?.day ?? null);
  const byId = new Map(products.map((p) => [p.id, p]));
  const soldBy = new Map(sold.map((s) => [s.productId, s.units]));

  // Demanda en unidades de cada producto con stock: lo propio + lo que consumen sus elaborados.
  const demand = new Map<string, number>();
  const withPrepared = new Set<string>();
  for (const [productId, units] of soldBy) {
    const p = byId.get(productId);
    if (!p) continue;
    if (p.kind === "prepared" && p.baseProductId && p.baseQty) {
      demand.set(p.baseProductId, (demand.get(p.baseProductId) ?? 0) + demandInBaseUnits(units, p.baseQty));
      withPrepared.add(p.baseProductId);
    } else demand.set(productId, (demand.get(productId) ?? 0) + units);
  }

  const rows: StoreStockRow[] = products
    .filter((p): p is typeof p & { kind: "manufactured" | "resale" } => p.kind !== "prepared")
    .map((p) => {
      const stock = stockBy.get(p.id) ?? 0;
      const incoming = incomingBy.get(p.id) ?? 0;
      const alert = classifyStoreStock({
        stock,
        incoming,
        avgDaily: averageDailyDemand(demand.get(p.id) ?? 0, observedDays),
        targetDays: settings.targetDays,
        leadDays: settings.leadDays,
      });
      return {
        ...alert,
        productId: p.id,
        code: p.code,
        name: p.name,
        kind: p.kind,
        unitLabel: p.unitLabel,
        stock,
        incoming,
        runsOutOn: alert.daysLeft == null ? null : addDays(today, Math.floor(alert.daysLeft)),
        includesPrepared: withPrepared.has(p.id),
        fromPlant: p.kind === "manufactured",
      };
    })
    .sort(compareStoreAlertUrgency);

  return {
    today,
    ...settings,
    observedDays,
    rows,
    counts: {
      out: rows.filter((r) => r.status === "out").length,
      reorder: rows.filter((r) => r.status === "reorder").length,
      ok: rows.filter((r) => r.status === "ok").length,
      noSales: rows.filter((r) => r.status === "no_sales").length,
    },
  };
}

/** Elaborados del local y cuántos se pueden armar con el stock actual de su producto base. */
export async function getPreparedAvailability(db: Executor) {
  const location = await locationByCode(db, STORE_LOCATION);
  const [stockBy, products] = await Promise.all([
    localStockByProduct(db, location.id),
    db.query.products.findMany({
      where: and(
        eq(schema.products.active, true),
        eq(schema.products.availableInStore, true),
        eq(schema.products.kind, "prepared"),
      ),
      with: { baseProduct: true },
      orderBy: asc(schema.products.code),
    }),
  ]);
  return products
    .filter((p) => p.baseProduct && p.baseQty)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      unitLabel: p.unitLabel,
      baseName: p.baseProduct!.name,
      baseQty: p.baseQty!,
      available: preparedAvailable(stockBy.get(p.baseProductId!) ?? 0, p.baseQty!),
      baseStock: roundQty(stockBy.get(p.baseProductId!) ?? 0),
    }));
}
