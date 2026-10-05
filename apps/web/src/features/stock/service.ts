import { randomUUID } from "node:crypto";
import {
  averageDailyConsumption,
  classifyCoverage,
  compareCoverageUrgency,
  coverageDays,
  expiryAlert,
  reorderPoint,
  roundQty,
  shortfallAfterIncoming,
  simulateProduction,
  starchKgForProductKg,
  addDays,
  type CoverageStatus,
  type ExpiryLevel,
  type IsoDate,
  type ProductionSimulation,
} from "@chipa/domain";
import { and, asc, desc, eq, gte, ilike, isNull, lt, ne, or, schema, sql, type Executor } from "@chipa/db";
import { toIsoDateAR, todayAR } from "@/lib/dates";
import { incomingByIngredient, type IncomingOrder } from "@/features/purchases/orders";
import { UserError } from "@/server/errors";
import {
  allocateProductFefo,
  ingredientTotals,
  recordIngredientMovements,
  recordProductMovements,
  type MovementType,
} from "./ledger";
import { ADJUSTMENT_KIND, ADJUSTMENT_NOTE } from "./labels";
import type { IngredientAdjustmentData, IngredientLevelsData, ProductTransferData } from "./schemas";

/** Ventana (días) del consumo diario promedio (Regla 6). */
export const COVERAGE_WINDOW_DAYS = 30;
/** Plazo de entrega que se asume para insumos sin proveedor por defecto. */
export const FALLBACK_LEAD_TIME_DAYS = 1;

// =============================================================================================
// RF-14 · Cobertura y punto de pedido
// =============================================================================================

export interface IngredientCoverage {
  ingredientId: string;
  name: string;
  category: string;
  unit: "kg" | "l" | "unit";
  stock: number;
  minStock: number;
  safetyStock: number;
  /** Consumo diario promedio de los últimos 30 días (Regla 6). */
  avgDailyConsumption: number;
  /** stock ÷ consumo diario; null si no hay consumo. */
  coverageDays: number | null;
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number;
  /** consumo diario × plazo de entrega + stock de seguridad (Regla 7). */
  reorderPoint: number;
  status: CoverageStatus;
  /** Cuánto falta para llegar al punto de pedido (0 si ya lo superó). */
  shortfallToReorderPoint: number;
}

/**
 * Cobertura en días y punto de pedido de cada insumo activo, ordenados por urgencia
 * (sin stock → reponer → ok → sin consumo; menor cobertura primero). Lo usan el tablero (M8) y compras (M2).
 */
export async function getIngredientCoverage(
  db: Executor,
  opts: { today?: IsoDate; windowDays?: number } = {},
): Promise<IngredientCoverage[]> {
  const today = opts.today ?? todayAR();
  const windowDays = opts.windowDays ?? COVERAGE_WINDOW_DAYS;

  const [ingredients, totals, consumptionRows] = await Promise.all([
    db.query.ingredients.findMany({
      where: eq(schema.ingredients.active, true),
      with: { defaultSupplier: true },
      orderBy: asc(schema.ingredients.name),
    }),
    ingredientTotals(db),
    db
      .select({
        ingredientId: schema.stockMovements.ingredientId,
        occurredAt: schema.stockMovements.occurredAt,
        qty: schema.stockMovements.qty,
      })
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.type, "production_consumption"),
          eq(schema.stockMovements.itemKind, "ingredient"),
          lt(schema.stockMovements.qty, 0),
          // un día de margen por el huso horario; averageDailyConsumption recorta la ventana exacta
          gte(schema.stockMovements.occurredAt, new Date(`${addDays(today, -windowDays - 1)}T00:00:00Z`)),
        ),
      ),
  ]);

  const consumptionByIngredient = new Map<string, { date: IsoDate; qty: number }[]>();
  for (const r of consumptionRows) {
    if (!r.ingredientId) continue;
    const list = consumptionByIngredient.get(r.ingredientId) ?? [];
    list.push({ date: toIsoDateAR(r.occurredAt), qty: -r.qty });
    consumptionByIngredient.set(r.ingredientId, list);
  }

  const rows = ingredients.map((ing): IngredientCoverage => {
    const stock = roundQty(totals[ing.id] ?? 0);
    const avg = averageDailyConsumption(consumptionByIngredient.get(ing.id) ?? [], today, windowDays);
    const leadTimeDays = ing.defaultSupplier?.leadTimeDays ?? FALLBACK_LEAD_TIME_DAYS;
    const rop = reorderPoint(avg, leadTimeDays, ing.safetyStock);
    return {
      ingredientId: ing.id,
      name: ing.name,
      category: ing.category,
      unit: ing.unit,
      stock,
      minStock: ing.minStock,
      safetyStock: ing.safetyStock,
      avgDailyConsumption: avg,
      coverageDays: coverageDays(stock, avg),
      supplierId: ing.defaultSupplier?.id ?? null,
      supplierName: ing.defaultSupplier?.tradeName ?? ing.defaultSupplier?.legalName ?? null,
      leadTimeDays,
      reorderPoint: rop,
      status: classifyCoverage({
        stock,
        minStock: ing.minStock,
        avgDailyConsumption: avg,
        reorderPoint: rop,
      }),
      shortfallToReorderPoint: Math.max(0, roundQty(rop - stock)),
    };
  });
  return rows.sort((a, b) => compareCoverageUrgency(a, b) || a.name.localeCompare(b.name, "es"));
}

/** Insumos que hay que reponer (sin stock o en/bajo el punto de pedido), del más urgente al menos. */
export async function getReorderAlerts(
  db: Executor,
  opts: { today?: IsoDate; windowDays?: number } = {},
): Promise<IngredientCoverage[]> {
  const rows = await getIngredientCoverage(db, opts);
  return rows.filter((r) => r.status === "reorder" || r.status === "out_of_stock");
}

export async function updateIngredientLevels(db: Executor, input: IngredientLevelsData) {
  const [row] = await db
    .update(schema.ingredients)
    .set({ minStock: input.minStock, safetyStock: input.safetyStock })
    .where(eq(schema.ingredients.id, input.ingredientId))
    .returning();
  if (!row) throw new UserError("El insumo no existe.");
  return row;
}

// =============================================================================================
// RF-13 · Stock de materia prima
// =============================================================================================

export interface ExpiryInfo {
  expiryDate: IsoDate | null;
  daysLeft: number | null;
  level: ExpiryLevel;
}

/** Próximo vencimiento (entre lotes con saldo) por insumo, con alerta a ≤ 7 días. */
export async function nextExpiryByIngredient(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<Record<string, ExpiryInfo>> {
  const rows = await db
    .select({
      ingredientId: schema.ingredientStock.ingredientId,
      expiryDate: sql<string | null>`min(${schema.rawLots.expiryDate})`,
    })
    .from(schema.ingredientStock)
    .innerJoin(schema.rawLots, eq(schema.rawLots.id, schema.ingredientStock.rawLotId))
    .where(sql`${schema.ingredientStock.qty} > 0`)
    .groupBy(schema.ingredientStock.ingredientId);
  return Object.fromEntries(
    rows.map((r) => [r.ingredientId, { expiryDate: r.expiryDate, ...expiryAlert(r.expiryDate, today) }]),
  );
}

export interface RawStockPosition {
  rawLotId: string | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  supplierLotCode: string | null;
  supplierName: string | null;
  qty: number;
  expiryDate: IsoDate | null;
  daysLeft: number | null;
  expiryLevel: ExpiryLevel;
}

/** Detalle de un insumo: lotes (proveedor, vencimiento, ubicación, días a vencer), totales y cobertura. */
export async function getIngredientStockDetail(
  db: Executor,
  ingredientId: string,
  today: IsoDate = todayAR(),
) {
  const ingredient = await db.query.ingredients.findFirst({
    where: eq(schema.ingredients.id, ingredientId),
    with: { defaultSupplier: true },
  });
  if (!ingredient) return null;

  const rows = await db
    .select({
      rawLotId: schema.ingredientStock.rawLotId,
      locationId: schema.ingredientStock.locationId,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      qty: schema.ingredientStock.qty,
      supplierLotCode: schema.rawLots.supplierLotCode,
      expiryDate: schema.rawLots.expiryDate,
      supplierLegalName: schema.suppliers.legalName,
      supplierTradeName: schema.suppliers.tradeName,
    })
    .from(schema.ingredientStock)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.ingredientStock.locationId))
    .leftJoin(schema.rawLots, eq(schema.rawLots.id, schema.ingredientStock.rawLotId))
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.rawLots.supplierId))
    .where(eq(schema.ingredientStock.ingredientId, ingredientId))
    .orderBy(sql`${schema.rawLots.expiryDate} asc nulls last`, asc(schema.rawLots.supplierLotCode));

  const positions: RawStockPosition[] = rows.map((r) => {
    const exp = expiryAlert(r.expiryDate, today);
    return {
      rawLotId: r.rawLotId,
      locationId: r.locationId,
      locationCode: r.locationCode,
      locationName: r.locationName,
      supplierLotCode: r.supplierLotCode,
      supplierName: r.supplierTradeName ?? r.supplierLegalName ?? null,
      qty: r.qty,
      expiryDate: r.expiryDate,
      daysLeft: exp.daysLeft,
      expiryLevel: exp.level,
    };
  });
  const total = roundQty(positions.reduce((a, p) => a + p.qty, 0));
  const coverage = (await getIngredientCoverage(db, { today })).find((c) => c.ingredientId === ingredientId);
  return { ingredient, positions, total, coverage: coverage ?? null };
}
export type IngredientStockDetail = NonNullable<Awaited<ReturnType<typeof getIngredientStockDetail>>>;

/** Saldo de una posición puntual (ítem × lote × ubicación) leyendo el libro mayor. */
async function positionBalance(
  db: Executor,
  item:
    { ingredientId: string; rawLotId: string | null } | { productId: string; finishedLotId: string | null },
  locationId: string,
): Promise<number> {
  const m = schema.stockMovements;
  const where =
    "ingredientId" in item
      ? and(
          eq(m.itemKind, "ingredient"),
          eq(m.ingredientId, item.ingredientId),
          item.rawLotId ? eq(m.rawLotId, item.rawLotId) : isNull(m.rawLotId),
          eq(m.locationId, locationId),
        )
      : and(
          eq(m.itemKind, "product"),
          eq(m.productId, item.productId),
          item.finishedLotId ? eq(m.finishedLotId, item.finishedLotId) : isNull(m.finishedLotId),
          eq(m.locationId, locationId),
        );
  const [row] = await db
    .select({ qty: sql<number>`coalesce(sum(${m.qty}), 0)`.mapWith(Number) })
    .from(m)
    .where(where);
  return roundQty(row?.qty ?? 0);
}

/**
 * Ajuste manual de materia prima (RF-13): merma / descarte → `waste`; corrección → `adjustment`.
 * El motivo es obligatorio y queda en la nota del movimiento. Las salidas no pueden superar el saldo.
 */
export async function adjustIngredientStock(
  db: Executor,
  userId: string | null,
  input: IngredientAdjustmentData,
) {
  const ingredient = await db.query.ingredients.findFirst({
    where: eq(schema.ingredients.id, input.ingredientId),
  });
  if (!ingredient) throw new UserError("El insumo no existe.");
  const location = await db.query.locations.findFirst({ where: eq(schema.locations.id, input.locationId) });
  if (!location) throw new UserError("La ubicación no existe.", { locationId: ["Ubicación inválida"] });
  if (input.rawLotId) {
    const lot = await db.query.rawLots.findFirst({ where: eq(schema.rawLots.id, input.rawLotId) });
    if (!lot || lot.ingredientId !== input.ingredientId) {
      throw new UserError("El lote no corresponde a este insumo.", { rawLotId: ["Lote inválido"] });
    }
  }

  const label = ADJUSTMENT_NOTE[input.kind];
  const delta = roundQty(ADJUSTMENT_KIND[input.kind].sign * input.qty);
  if (delta < 0) {
    const balance = await positionBalance(
      db,
      { ingredientId: input.ingredientId, rawLotId: input.rawLotId },
      input.locationId,
    );
    if (input.qty > balance) {
      throw new UserError(`El saldo de esa posición es ${balance} y querés restar ${input.qty}.`, {
        qty: ["Supera el saldo disponible"],
      });
    }
  }
  const adjustmentId = randomUUID();
  await recordIngredientMovements(db, userId, [
    {
      type: input.kind === "shrinkage" || input.kind === "discard" ? "waste" : "adjustment",
      ingredientId: input.ingredientId,
      rawLotId: input.rawLotId,
      locationId: input.locationId,
      qty: delta,
      refTable: "stock_adjustment",
      refId: adjustmentId,
      note: `${label}: ${input.reason}`,
    },
  ]);
  return { adjustmentId, qty: delta };
}

// =============================================================================================
// RF-16 · Producto terminado
// =============================================================================================

/** Ubicaciones donde puede haber producto terminado (F3, F4, LOCAL, VEHICULO). */
export function productLocations(db: Executor) {
  return db.query.locations.findMany({
    where: and(eq(schema.locations.active, true), ne(schema.locations.kind, "raw")),
    orderBy: asc(schema.locations.code),
  });
}

/** Ubicaciones de materia prima (heladera, depósito seco). */
export function rawLocations(db: Executor) {
  return db.query.locations.findMany({
    where: and(eq(schema.locations.active, true), eq(schema.locations.kind, "raw")),
    orderBy: asc(schema.locations.code),
  });
}

export interface ProductMatrixRow {
  productId: string;
  kind: "manufactured" | "resale" | "prepared";
  code: string;
  name: string;
  netWeightKg: number;
  minStockUnits: number;
  byLocation: Record<string, number>;
  totalUnits: number;
  totalKg: number;
  belowMin: boolean;
}

/** Matriz producto × ubicación en unidades y kg, contra el mínimo del producto. */
export async function getProductStockMatrix(db: Executor) {
  const [locations, products, stock] = await Promise.all([
    productLocations(db),
    // Los elaborados en el local no tienen stock propio (descuentan del producto base).
    db.query.products.findMany({
      where: and(eq(schema.products.active, true), ne(schema.products.kind, "prepared")),
      orderBy: asc(schema.products.code),
    }),
    db
      .select({
        productId: schema.productStock.productId,
        locationId: schema.productStock.locationId,
        qty: sql<number>`sum(${schema.productStock.qty})`.mapWith(Number),
      })
      .from(schema.productStock)
      .groupBy(schema.productStock.productId, schema.productStock.locationId),
  ]);
  const byProduct = new Map<string, Record<string, number>>();
  for (const s of stock) {
    const rec = byProduct.get(s.productId) ?? {};
    rec[s.locationId] = roundQty(s.qty);
    byProduct.set(s.productId, rec);
  }
  const rows = products.map((p): ProductMatrixRow => {
    const byLocation = byProduct.get(p.id) ?? {};
    const totalUnits = roundQty(Object.values(byLocation).reduce((a, q) => a + q, 0));
    return {
      productId: p.id,
      kind: p.kind,
      code: p.code,
      name: p.name,
      netWeightKg: p.netWeightKg,
      minStockUnits: p.minStockUnits,
      byLocation,
      totalUnits,
      totalKg: roundQty(totalUnits * p.netWeightKg),
      belowMin: totalUnits < p.minStockUnits,
    };
  });
  const totalsByLocation: Record<string, { units: number; kg: number }> = {};
  for (const l of locations) {
    totalsByLocation[l.id] = {
      units: roundQty(rows.reduce((a, r) => a + (r.byLocation[l.id] ?? 0), 0)),
      kg: roundQty(rows.reduce((a, r) => a + (r.byLocation[l.id] ?? 0) * r.netWeightKg, 0)),
    };
  }
  return {
    locations,
    rows,
    totalsByLocation,
    totalUnits: roundQty(rows.reduce((a, r) => a + r.totalUnits, 0)),
    totalKg: roundQty(rows.reduce((a, r) => a + r.totalKg, 0)),
  };
}
export type ProductStockMatrix = Awaited<ReturnType<typeof getProductStockMatrix>>;

export interface FinishedLotPosition {
  productId: string;
  productCode: string;
  productName: string;
  netWeightKg: number;
  finishedLotId: string | null;
  lotCode: string | null;
  expiryDate: IsoDate | null;
  daysLeft: number | null;
  expiryLevel: ExpiryLevel;
  onHold: boolean;
  locationId: string;
  locationCode: string;
  qty: number;
}

/** Detalle por lote y ubicación con vencimiento y días restantes (más próximo a vencer primero). */
export async function getFinishedLotPositions(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<FinishedLotPosition[]> {
  const rows = await db
    .select({
      productId: schema.productStock.productId,
      productCode: schema.products.code,
      productName: schema.products.name,
      netWeightKg: schema.products.netWeightKg,
      finishedLotId: schema.productStock.finishedLotId,
      lotCode: schema.finishedLots.code,
      expiryDate: schema.finishedLots.expiryDate,
      onHold: schema.finishedLots.onHold,
      locationId: schema.productStock.locationId,
      locationCode: schema.locations.code,
      qty: schema.productStock.qty,
    })
    .from(schema.productStock)
    .innerJoin(schema.products, eq(schema.products.id, schema.productStock.productId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.productStock.locationId))
    .leftJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.productStock.finishedLotId))
    .orderBy(
      asc(schema.products.code),
      sql`${schema.finishedLots.expiryDate} asc nulls last`,
      asc(schema.locations.code),
    );
  return rows.map((r) => {
    const exp = expiryAlert(r.expiryDate, today, 30);
    return {
      ...r,
      onHold: r.onHold ?? false,
      daysLeft: exp.daysLeft,
      expiryLevel: exp.level,
    };
  });
}

/**
 * Transferencia entre ubicaciones (p. ej. F3 → LOCAL): por cada lote movido, un par de movimientos
 * `transfer` (− en el origen, + en el destino) con el mismo lote y el mismo `refId`.
 * Sin lote indicado se asigna FEFO (Regla 5) entre los lotes del origen, sin los retenidos por calidad.
 */
export async function transferProduct(db: Executor, userId: string | null, input: ProductTransferData) {
  const [from, to] = await Promise.all([
    db.query.locations.findFirst({ where: eq(schema.locations.id, input.fromLocationId) }),
    db.query.locations.findFirst({ where: eq(schema.locations.id, input.toLocationId) }),
  ]);
  if (!from) throw new UserError("El origen no existe.", { fromLocationId: ["Origen inválido"] });
  if (!to) throw new UserError("El destino no existe.", { toLocationId: ["Destino inválido"] });
  if (from.kind === "raw" || to.kind === "raw") {
    throw new UserError("El producto terminado solo se mueve entre F3, F4, local y vehículo.");
  }
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, input.productId) });
  if (!product) throw new UserError("El producto no existe.", { productId: ["Producto inválido"] });
  if (product.kind !== "manufactured")
    throw new UserError(
      `"${product.name}" no se transfiere: la reventa entra directo al local y los elaborados no tienen stock propio.`,
      { productId: ["Solo se transfieren productos fabricados"] },
    );

  let moves: { finishedLotId: string; qty: number; code: string | null }[];
  if (input.finishedLotId) {
    const balance = await positionBalance(
      db,
      { productId: input.productId, finishedLotId: input.finishedLotId },
      input.fromLocationId,
    );
    if (input.units > balance) {
      throw new UserError(`En ${from.code} hay ${balance} unidades de ese lote.`, {
        units: ["Supera el saldo del lote en el origen"],
      });
    }
    const lot = await db.query.finishedLots.findFirst({
      where: eq(schema.finishedLots.id, input.finishedLotId),
    });
    moves = [{ finishedLotId: input.finishedLotId, qty: input.units, code: lot?.code ?? null }];
  } else {
    try {
      const { allocations } = await allocateProductFefo(db, input.productId, input.units, {
        locationIds: [input.fromLocationId],
      });
      moves = allocations.map((a) => ({ finishedLotId: a.finishedLotId, qty: a.qty, code: a.code }));
    } catch (e) {
      if (e instanceof UserError) {
        throw new UserError(`${e.message} (en ${from.code}, sin contar lotes retenidos)`, {
          units: ["Supera el stock del origen"],
        });
      }
      throw e;
    }
  }

  const transferId = randomUUID();
  const note = input.note ?? `Transferencia ${from.code} → ${to.code}`;
  await recordProductMovements(
    db,
    userId,
    moves.flatMap((m) => [
      {
        type: "transfer" as const,
        productId: input.productId,
        finishedLotId: m.finishedLotId,
        locationId: from.id,
        qty: -m.qty,
        refTable: "stock_transfer",
        refId: transferId,
        note,
      },
      {
        type: "transfer" as const,
        productId: input.productId,
        finishedLotId: m.finishedLotId,
        locationId: to.id,
        qty: m.qty,
        refTable: "stock_transfer",
        refId: transferId,
        note,
      },
    ]),
  );
  return { transferId, moved: moves };
}

// =============================================================================================
// Libro mayor de movimientos
// =============================================================================================

export interface MovementFilters {
  type?: MovementType;
  itemKind?: "ingredient" | "product";
  ingredientId?: string;
  productId?: string;
  /** Código de lote (del proveedor o terminado), búsqueda parcial. */
  lot?: string;
  from?: IsoDate;
  to?: IsoDate;
}

const AR_OFFSET = "-03:00";

export async function listMovements(db: Executor, f: MovementFilters = {}, page = 1, pageSize = 50) {
  const m = schema.stockMovements;
  const where = and(
    f.type ? eq(m.type, f.type) : undefined,
    f.itemKind ? eq(m.itemKind, f.itemKind) : undefined,
    f.ingredientId ? eq(m.ingredientId, f.ingredientId) : undefined,
    f.productId ? eq(m.productId, f.productId) : undefined,
    f.lot
      ? or(ilike(schema.rawLots.supplierLotCode, `%${f.lot}%`), ilike(schema.finishedLots.code, `%${f.lot}%`))
      : undefined,
    f.from ? gte(m.occurredAt, new Date(`${f.from}T00:00:00${AR_OFFSET}`)) : undefined,
    f.to ? lt(m.occurredAt, new Date(`${addDays(f.to, 1)}T00:00:00${AR_OFFSET}`)) : undefined,
  );

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: m.id,
        occurredAt: m.occurredAt,
        type: m.type,
        itemKind: m.itemKind,
        qty: m.qty,
        refTable: m.refTable,
        refId: m.refId,
        note: m.note,
        ingredientName: schema.ingredients.name,
        ingredientUnit: schema.ingredients.unit,
        productName: schema.products.name,
        rawLotCode: schema.rawLots.supplierLotCode,
        finishedLotCode: schema.finishedLots.code,
        locationCode: schema.locations.code,
        userName: schema.users.name,
      })
      .from(m)
      .innerJoin(schema.locations, eq(schema.locations.id, m.locationId))
      .leftJoin(schema.ingredients, eq(schema.ingredients.id, m.ingredientId))
      .leftJoin(schema.products, eq(schema.products.id, m.productId))
      .leftJoin(schema.rawLots, eq(schema.rawLots.id, m.rawLotId))
      .leftJoin(schema.finishedLots, eq(schema.finishedLots.id, m.finishedLotId))
      .leftJoin(schema.users, eq(schema.users.id, m.createdById))
      .where(where)
      .orderBy(desc(m.occurredAt), desc(m.createdAt), asc(m.id))
      .limit(pageSize)
      .offset((Math.max(1, page) - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(m)
      .leftJoin(schema.rawLots, eq(schema.rawLots.id, m.rawLotId))
      .leftJoin(schema.finishedLots, eq(schema.finishedLots.id, m.finishedLotId))
      .where(where),
  ]);
  const total = totalRow?.total ?? 0;
  return {
    rows: rows.map((r) => ({
      ...r,
      itemName: (r.itemKind === "ingredient" ? r.ingredientName : r.productName) ?? "—",
      unit: r.itemKind === "ingredient" ? (r.ingredientUnit ?? "kg") : ("unit" as const),
      lotCode: r.itemKind === "ingredient" ? r.rawLotCode : r.finishedLotCode,
    })),
    total,
    page: Math.max(1, page),
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
export type MovementRow = Awaited<ReturnType<typeof listMovements>>["rows"][number];

/** Opciones para los filtros del libro mayor y los formularios. */
export async function stockFilterOptions(db: Executor) {
  const [ingredients, products] = await Promise.all([
    db.query.ingredients.findMany({ orderBy: asc(schema.ingredients.name) }),
    db.query.products.findMany({ orderBy: asc(schema.products.code) }),
  ]);
  return {
    ingredients: ingredients.map((i) => ({ id: i.id, name: i.name })),
    products: products.map((p) => ({ id: p.id, name: p.name, code: p.code })),
  };
}

// =============================================================================================
// RF-17 · Simulador
// =============================================================================================

export type SimulationMode = "product_kg" | "starch_kg";

export interface SimulationResult extends ProductionSimulation {
  mode: SimulationMode;
  inputKg: number;
  recipe: { id: string; name: string; version: number; expectedYieldPerKgStarch: number };
  /** Líneas con nombre y unidad de insumo, en el orden de la receta. */
  rows: (ProductionSimulation["lines"][number] & {
    name: string;
    unit: "kg" | "l" | "unit";
    /** Compras en camino (OC enviadas sin recibir): disponibilidad futura, separada del stock actual. */
    incoming: number;
    incomingOrders: IncomingOrder[];
    /** Primera fecha esperada entre las órdenes en camino. */
    incomingDate: IsoDate | null;
    /** Faltante si llega todo lo que está en camino. */
    shortfallAfterIncoming: number;
  })[];
  /** Alcanzaría si llegara todo lo que está en camino. */
  okWithIncoming: boolean;
}

/**
 * "¿Alcanza la materia prima para producir X?" con la receta activa y el stock actual.
 * `kg` son kg de producto (se convierte a fécula con el rendimiento esperado) o kg de fécula.
 */
export async function simulateProductionFromStock(
  db: Executor,
  input: { mode: SimulationMode; kg: number },
): Promise<SimulationResult | null> {
  const recipe = await db.query.recipes.findFirst({
    where: eq(schema.recipes.status, "active"),
    orderBy: desc(schema.recipes.version),
    with: { items: { with: { ingredient: true }, orderBy: asc(schema.recipeItems.sortOrder) } },
  });
  if (!recipe) return null;
  const [stockByIngredient, incomingMap] = await Promise.all([
    ingredientTotals(db),
    incomingByIngredient(db),
  ]);
  const starchKg =
    input.mode === "starch_kg" ? input.kg : starchKgForProductKg(input.kg, recipe.expectedYieldPerKgStarch);
  const sim = simulateProduction({
    starchKg,
    lines: recipe.items.map((i) => ({
      ingredientId: i.ingredientId,
      qtyPerKgStarch: i.qtyPerKgStarch,
      minPerKgStarch: i.minPerKgStarch,
      maxPerKgStarch: i.maxPerKgStarch,
    })),
    stockByIngredient,
    expectedYieldPerKgStarch: recipe.expectedYieldPerKgStarch,
  });
  const byId = new Map(recipe.items.map((i) => [i.ingredientId, i.ingredient]));
  const rows: SimulationResult["rows"] = sim.lines.map((l) => {
    const incomingOrders = incomingMap[l.ingredientId] ?? [];
    const incoming = roundQty(incomingOrders.reduce((a, o) => a + o.qty, 0));
    return {
      ...l,
      name: byId.get(l.ingredientId)?.name ?? l.ingredientId,
      unit: byId.get(l.ingredientId)?.unit ?? "kg",
      incoming,
      incomingOrders,
      incomingDate: incomingOrders.find((o) => o.expectedAt)?.expectedAt ?? null,
      shortfallAfterIncoming: shortfallAfterIncoming(l.shortfall, incoming),
    };
  });
  return {
    ...sim,
    mode: input.mode,
    inputKg: input.kg,
    recipe: {
      id: recipe.id,
      name: recipe.name,
      version: recipe.version,
      expectedYieldPerKgStarch: recipe.expectedYieldPerKgStarch,
    },
    rows,
    okWithIncoming: rows.every((r) => r.shortfallAfterIncoming === 0),
  };
}

// =============================================================================================
// Exportación
// =============================================================================================

/** Datos del stock actual de MP y PT para el Excel (ver export.ts). */
export async function getStockExportData(db: Executor, today: IsoDate = todayAR()) {
  const [coverage, expiries, matrix, lots, rawPositions] = await Promise.all([
    getIngredientCoverage(db, { today }),
    nextExpiryByIngredient(db, today),
    getProductStockMatrix(db),
    getFinishedLotPositions(db, today),
    db
      .select({
        ingredientName: schema.ingredients.name,
        unit: schema.ingredients.unit,
        lotCode: schema.rawLots.supplierLotCode,
        expiryDate: schema.rawLots.expiryDate,
        locationCode: schema.locations.code,
        qty: schema.ingredientStock.qty,
      })
      .from(schema.ingredientStock)
      .innerJoin(schema.ingredients, eq(schema.ingredients.id, schema.ingredientStock.ingredientId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.ingredientStock.locationId))
      .leftJoin(schema.rawLots, eq(schema.rawLots.id, schema.ingredientStock.rawLotId))
      .orderBy(asc(schema.ingredients.name), sql`${schema.rawLots.expiryDate} asc nulls last`),
  ]);
  return { today, coverage, expiries, matrix, lots, rawPositions };
}

// =============================================================================================
// RF-11 · Etiqueta del lote de materia prima
// =============================================================================================

/** Datos para imprimir la etiqueta de un lote de materia prima (el QR lleva el id del lote). */
export async function getRawLotLabel(db: Executor, rawLotId: string) {
  const [lot] = await db
    .select({
      id: schema.rawLots.id,
      ingredientId: schema.rawLots.ingredientId,
      ingredient: schema.ingredients.name,
      unit: schema.ingredients.unit,
      supplierLotCode: schema.rawLots.supplierLotCode,
      supplier: schema.suppliers.legalName,
      expiryDate: schema.rawLots.expiryDate,
      receivedQty: schema.rawLots.receivedQty,
      receivedAt: schema.receptions.receivedAt,
    })
    .from(schema.rawLots)
    .innerJoin(schema.ingredients, eq(schema.ingredients.id, schema.rawLots.ingredientId))
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.rawLots.supplierId))
    .leftJoin(schema.receptions, eq(schema.receptions.id, schema.rawLots.receptionId))
    .where(eq(schema.rawLots.id, rawLotId))
    .limit(1);
  return lot ?? null;
}
export type RawLotLabel = NonNullable<Awaited<ReturnType<typeof getRawLotLabel>>>;
