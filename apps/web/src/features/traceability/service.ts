import type { IsoDate } from "@chipa/domain";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, schema, sql, type Executor } from "@chipa/db";

/**
 * Trazabilidad de lotes (RF-35): del lote terminado hacia atrás (producción, consumos, lotes de materia
 * prima, proveedores, recepción) y hacia adelante (envasado, stock, remitos y clientes, ventas del local,
 * reclamos); y desde un lote de materia prima hacia todos los lotes terminados que lo usaron y sus clientes
 * (escenario de retiro). Son consultas por índice: resuelven en milisegundos.
 */

export interface FinishedLotTrace {
  kind: "finished";
  lot: { id: string; code: string; productionDate: IsoDate; expiryDate: IsoDate; onHold: boolean };
  production: {
    runId: string;
    date: IsoDate;
    runNumber: number;
    shift: string;
    recipe: string;
    recipeVersion: number;
    starchKg: number;
    batches: number;
    responsible: string | null;
    supervisor: string | null;
    workers: string[];
    freezerCodes: string[];
    frozenAt: Date | null;
  };
  consumptions: {
    ingredient: string;
    unit: string;
    qtyTheoretical: number;
    qtyActual: number;
    rawLot: {
      id: string;
      supplierLotCode: string | null;
      expiryDate: IsoDate | null;
      supplier: string | null;
      receivedAt: Date | null;
      deliveryNote: string | null;
      temperatureC: number | null;
    } | null;
  }[];
  packings: { product: string; units: number; kg: number; location: string; packedAt: Date }[];
  stock: { product: string; location: string; qty: number }[];
  dispatches: {
    dispatchId: string;
    number: number;
    date: Date;
    status: string;
    customerId: string;
    customer: string;
    product: string;
    units: number;
  }[];
  storeSales: { saleId: string; soldAt: Date; product: string; units: number }[];
  complaints: { id: string; date: IsoDate; customer: string | null; reason: string; status: string }[];
  totals: { packedUnits: number; stockUnits: number; dispatchedUnits: number; soldInStoreUnits: number };
}

export interface RawLotTrace {
  kind: "raw";
  rawLot: {
    id: string;
    ingredient: string;
    unit: string;
    supplierLotCode: string | null;
    supplier: string | null;
    expiryDate: IsoDate | null;
    receivedQty: number;
    temperatureC: number | null;
    receivedAt: Date | null;
    deliveryNote: string | null;
  };
  /** Lotes terminados producidos con este lote de materia prima. */
  finishedLots: {
    id: string;
    code: string;
    productionDate: IsoDate;
    expiryDate: IsoDate;
    onHold: boolean;
    qtyUsed: number;
    dispatchedUnits: number;
    stockUnits: number;
  }[];
  /** Clientes que recibieron esos lotes (retiro). */
  customers: {
    customerId: string;
    customer: string;
    units: number;
    lots: string[];
    lastDate: Date;
  }[];
  /**
   * Producciones posteriores a la recepción que consumieron el mismo insumo SIN registrar el lote:
   * no se puede descartar que lo hayan usado.
   */
  unlinkedRuns: { runDate: IsoDate; lotCodes: string[] }[];
}

export interface TraceResult {
  term: string;
  finished: FinishedLotTrace | null;
  raw: RawLotTrace[];
  suggestions: { code: string; kind: "finished" | "raw" }[];
}

/** Lote terminado por código exacto (sin distinguir mayúsculas). */
export async function traceFinishedLot(db: Executor, code: string): Promise<FinishedLotTrace | null> {
  const lot = await db.query.finishedLots.findFirst({
    where: sql`lower(${schema.finishedLots.code}) = lower(${code})`,
  });
  if (!lot) return null;

  const run = await db.query.productionRuns.findFirst({
    where: eq(schema.productionRuns.id, lot.runId),
    with: { recipe: true, responsible: true, supervisor: true, workers: { with: { user: true } } },
  });

  const [consumptions, packings, stock, dispatches, storeSales, complaints] = await Promise.all([
    db
      .select({
        ingredient: schema.ingredients.name,
        unit: schema.ingredients.unit,
        qtyTheoretical: schema.productionConsumptions.qtyTheoretical,
        qtyActual: schema.productionConsumptions.qtyActual,
        rawLotId: schema.rawLots.id,
        supplierLotCode: schema.rawLots.supplierLotCode,
        expiryDate: schema.rawLots.expiryDate,
        supplier: schema.suppliers.legalName,
        receivedAt: schema.receptions.receivedAt,
        deliveryNote: schema.receptions.deliveryNote,
        temperatureC: schema.rawLots.temperatureC,
      })
      .from(schema.productionConsumptions)
      .innerJoin(schema.ingredients, eq(schema.ingredients.id, schema.productionConsumptions.ingredientId))
      .leftJoin(schema.rawLots, eq(schema.rawLots.id, schema.productionConsumptions.rawLotId))
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.rawLots.supplierId))
      .leftJoin(schema.receptions, eq(schema.receptions.id, schema.rawLots.receptionId))
      .where(eq(schema.productionConsumptions.runId, lot.runId))
      .orderBy(asc(schema.ingredients.name)),
    db
      .select({
        product: schema.products.name,
        units: schema.packings.units,
        kg: schema.packings.kg,
        location: schema.locations.name,
        packedAt: schema.packings.packedAt,
      })
      .from(schema.packings)
      .innerJoin(schema.products, eq(schema.products.id, schema.packings.productId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.packings.locationId))
      .where(eq(schema.packings.finishedLotId, lot.id))
      .orderBy(asc(schema.products.name)),
    db
      .select({
        product: schema.products.name,
        location: schema.locations.name,
        qty: schema.productStock.qty,
      })
      .from(schema.productStock)
      .innerJoin(schema.products, eq(schema.products.id, schema.productStock.productId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.productStock.locationId))
      .where(eq(schema.productStock.finishedLotId, lot.id))
      .orderBy(asc(schema.products.name)),
    db
      .select({
        dispatchId: schema.dispatches.id,
        number: schema.dispatches.number,
        date: schema.dispatches.dispatchedAt,
        status: schema.dispatches.status,
        customerId: schema.customers.id,
        customer: schema.customers.legalName,
        product: schema.products.name,
        units:
          sql<number>`coalesce(${schema.dispatchItems.qtyDelivered}, ${schema.dispatchItems.qtyUnits})`.mapWith(
            Number,
          ),
      })
      .from(schema.dispatchItems)
      .innerJoin(schema.dispatches, eq(schema.dispatches.id, schema.dispatchItems.dispatchId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.dispatches.customerId))
      .innerJoin(schema.products, eq(schema.products.id, schema.dispatchItems.productId))
      .where(and(eq(schema.dispatchItems.finishedLotId, lot.id), ne(schema.dispatches.status, "cancelled")))
      .orderBy(asc(schema.dispatches.dispatchedAt)),
    db
      .select({
        saleId: schema.storeSales.id,
        soldAt: schema.storeSales.soldAt,
        product: schema.products.name,
        units: schema.storeSaleItems.qtyUnits,
      })
      .from(schema.storeSaleItems)
      .innerJoin(schema.storeSales, eq(schema.storeSales.id, schema.storeSaleItems.saleId))
      .innerJoin(schema.products, eq(schema.products.id, schema.storeSaleItems.productId))
      .where(eq(schema.storeSaleItems.finishedLotId, lot.id))
      .orderBy(asc(schema.storeSales.soldAt)),
    db
      .select({
        id: schema.complaints.id,
        date: schema.complaints.date,
        customer: schema.customers.legalName,
        reason: schema.complaints.reason,
        status: schema.complaints.status,
      })
      .from(schema.complaints)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.complaints.customerId))
      .where(eq(schema.complaints.finishedLotId, lot.id))
      .orderBy(desc(schema.complaints.date)),
  ]);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    kind: "finished",
    lot: {
      id: lot.id,
      code: lot.code,
      productionDate: lot.productionDate,
      expiryDate: lot.expiryDate,
      onHold: lot.onHold,
    },
    production: {
      runId: lot.runId,
      date: run!.date,
      runNumber: run!.runNumber,
      shift: run!.shift,
      recipe: run!.recipe.name,
      recipeVersion: run!.recipe.version,
      starchKg: run!.starchKg,
      batches: run!.batches,
      responsible: run!.responsible?.name ?? null,
      supervisor: run!.supervisor?.name ?? null,
      workers: run!.workers.map((w) => w.user.initials).sort(),
      freezerCodes: run!.freezerCodes,
      frozenAt: run!.frozenAt,
    },
    consumptions: consumptions.map((c) => ({
      ingredient: c.ingredient,
      unit: c.unit,
      qtyTheoretical: c.qtyTheoretical,
      qtyActual: c.qtyActual,
      rawLot: c.rawLotId
        ? {
            id: c.rawLotId,
            supplierLotCode: c.supplierLotCode,
            expiryDate: c.expiryDate,
            supplier: c.supplier,
            receivedAt: c.receivedAt,
            deliveryNote: c.deliveryNote,
            temperatureC: c.temperatureC,
          }
        : null,
    })),
    packings,
    stock,
    dispatches,
    storeSales,
    complaints,
    totals: {
      packedUnits: sum(packings.map((p) => p.units)),
      stockUnits: sum(stock.map((s) => s.qty)),
      dispatchedUnits: sum(dispatches.map((d) => d.units)),
      soldInStoreUnits: sum(storeSales.map((s) => s.units)),
    },
  };
}

/** Lotes de materia prima por código de proveedor (puede haber más de uno con el mismo código). */
export async function traceRawLots(db: Executor, supplierLotCode: string): Promise<RawLotTrace[]> {
  const lots = await db
    .select({
      id: schema.rawLots.id,
      ingredientId: schema.rawLots.ingredientId,
      ingredient: schema.ingredients.name,
      unit: schema.ingredients.unit,
      supplierLotCode: schema.rawLots.supplierLotCode,
      supplier: schema.suppliers.legalName,
      expiryDate: schema.rawLots.expiryDate,
      receivedQty: schema.rawLots.receivedQty,
      temperatureC: schema.rawLots.temperatureC,
      receivedAt: schema.receptions.receivedAt,
      createdAt: schema.rawLots.createdAt,
      deliveryNote: schema.receptions.deliveryNote,
    })
    .from(schema.rawLots)
    .innerJoin(schema.ingredients, eq(schema.ingredients.id, schema.rawLots.ingredientId))
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.rawLots.supplierId))
    .leftJoin(schema.receptions, eq(schema.receptions.id, schema.rawLots.receptionId))
    .where(sql`lower(${schema.rawLots.supplierLotCode}) = lower(${supplierLotCode})`);

  const out: RawLotTrace[] = [];
  for (const l of lots) {
    const used = await db
      .select({
        lotId: schema.finishedLots.id,
        code: schema.finishedLots.code,
        productionDate: schema.finishedLots.productionDate,
        expiryDate: schema.finishedLots.expiryDate,
        onHold: schema.finishedLots.onHold,
        qty: schema.productionConsumptions.qtyActual,
      })
      .from(schema.productionConsumptions)
      .innerJoin(schema.finishedLots, eq(schema.finishedLots.runId, schema.productionConsumptions.runId))
      .where(eq(schema.productionConsumptions.rawLotId, l.id))
      .orderBy(asc(schema.finishedLots.productionDate), asc(schema.finishedLots.code));
    const lotIds = [...new Set(used.map((u) => u.lotId))];

    const dispatched = lotIds.length
      ? await db
          .select({
            lotId: schema.dispatchItems.finishedLotId,
            code: schema.finishedLots.code,
            customerId: schema.customers.id,
            customer: schema.customers.legalName,
            units:
              sql<number>`coalesce(${schema.dispatchItems.qtyDelivered}, ${schema.dispatchItems.qtyUnits})`.mapWith(
                Number,
              ),
            date: schema.dispatches.dispatchedAt,
          })
          .from(schema.dispatchItems)
          .innerJoin(schema.dispatches, eq(schema.dispatches.id, schema.dispatchItems.dispatchId))
          .innerJoin(schema.customers, eq(schema.customers.id, schema.dispatches.customerId))
          .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.dispatchItems.finishedLotId))
          .where(
            and(
              inArray(schema.dispatchItems.finishedLotId, lotIds),
              ne(schema.dispatches.status, "cancelled"),
            ),
          )
      : [];
    const stock = lotIds.length
      ? await db
          .select({ lotId: schema.productStock.finishedLotId, qty: schema.productStock.qty })
          .from(schema.productStock)
          .where(inArray(schema.productStock.finishedLotId, lotIds))
      : [];

    const customers = new Map<string, RawLotTrace["customers"][number]>();
    for (const d of dispatched) {
      const cur = customers.get(d.customerId);
      if (cur) {
        cur.units += d.units;
        if (!cur.lots.includes(d.code)) cur.lots.push(d.code);
        if (d.date > cur.lastDate) cur.lastDate = d.date;
      } else {
        customers.set(d.customerId, {
          customerId: d.customerId,
          customer: d.customer,
          units: d.units,
          lots: [d.code],
          lastDate: d.date,
        });
      }
    }

    // Producciones posteriores a la recepción que consumieron el insumo sin registrar lote.
    const since = (l.receivedAt ?? l.createdAt).toISOString().slice(0, 10);
    const unlinked = await db
      .select({ runDate: schema.productionRuns.date, runId: schema.productionRuns.id })
      .from(schema.productionConsumptions)
      .innerJoin(schema.productionRuns, eq(schema.productionRuns.id, schema.productionConsumptions.runId))
      .where(
        and(
          eq(schema.productionConsumptions.ingredientId, l.ingredientId),
          isNull(schema.productionConsumptions.rawLotId),
          sql`${schema.productionRuns.date} >= ${since}`,
        ),
      );
    const unlinkedRuns: RawLotTrace["unlinkedRuns"] = [];
    for (const u of unlinked) {
      const codes = await db
        .select({ code: schema.finishedLots.code })
        .from(schema.finishedLots)
        .where(eq(schema.finishedLots.runId, u.runId));
      unlinkedRuns.push({ runDate: u.runDate, lotCodes: codes.map((c) => c.code) });
    }

    out.push({
      kind: "raw",
      rawLot: {
        id: l.id,
        ingredient: l.ingredient,
        unit: l.unit,
        supplierLotCode: l.supplierLotCode,
        supplier: l.supplier,
        expiryDate: l.expiryDate,
        receivedQty: l.receivedQty,
        temperatureC: l.temperatureC,
        receivedAt: l.receivedAt,
        deliveryNote: l.deliveryNote,
      },
      finishedLots: lotIds.map((id) => {
        const u = used.filter((x) => x.lotId === id);
        const first = u[0]!;
        return {
          id,
          code: first.code,
          productionDate: first.productionDate,
          expiryDate: first.expiryDate,
          onHold: first.onHold,
          qtyUsed: u.reduce((a, x) => a + x.qty, 0),
          dispatchedUnits: dispatched.filter((d) => d.lotId === id).reduce((a, d) => a + d.units, 0),
          stockUnits: stock.filter((s) => s.lotId === id).reduce((a, s) => a + s.qty, 0),
        };
      }),
      customers: [...customers.values()].sort((a, b) => b.units - a.units),
      unlinkedRuns,
    });
  }
  return out;
}

/** Busca por código de lote terminado o por lote de proveedor de materia prima. */
export async function searchTrace(db: Executor, rawTerm: string): Promise<TraceResult> {
  const term = rawTerm.trim();
  const [finished, raw] = await Promise.all([traceFinishedLot(db, term), traceRawLots(db, term)]);
  let suggestions: TraceResult["suggestions"] = [];
  if (!finished && raw.length === 0 && term.length >= 2) {
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const [f, r] = await Promise.all([
      db
        .select({ code: schema.finishedLots.code })
        .from(schema.finishedLots)
        .where(ilike(schema.finishedLots.code, like))
        .orderBy(desc(schema.finishedLots.code))
        .limit(8),
      db
        .selectDistinct({ code: schema.rawLots.supplierLotCode })
        .from(schema.rawLots)
        .where(ilike(schema.rawLots.supplierLotCode, like))
        .limit(8),
    ]);
    suggestions = [
      ...f.map((x) => ({ code: x.code, kind: "finished" as const })),
      ...r.flatMap((x) => (x.code ? [{ code: x.code, kind: "raw" as const }] : [])),
    ];
  }
  return { term, finished, raw, suggestions };
}

/** Lotes terminados recientes (atajo para el buscador). */
export async function recentFinishedLots(db: Executor, limit = 8) {
  return db
    .select({
      code: schema.finishedLots.code,
      productionDate: schema.finishedLots.productionDate,
      onHold: schema.finishedLots.onHold,
    })
    .from(schema.finishedLots)
    .orderBy(desc(schema.finishedLots.productionDate), desc(schema.finishedLots.code))
    .limit(limit);
}

/** Búsqueda con el tiempo de la consulta en milisegundos (se muestra en pantalla: meta < 1 minuto). */
export async function timedSearchTrace(db: Executor, term: string) {
  const t0 = performance.now();
  const result = await searchTrace(db, term);
  return { result, elapsedMs: performance.now() - t0 };
}
