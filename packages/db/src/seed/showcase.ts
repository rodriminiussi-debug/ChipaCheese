import { addDays, type IsoDate } from "@chipa/domain";
import { eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../client";
import * as s from "../schema";
import type { SeedRefs } from "./index";
import {
  complaints,
  cleaningDay,
  maintenance,
  taskAssignments,
  temperatureDay,
  type PlanRef,
} from "./showcase/bpm";
import { eachDay, isWorkday, nextWorkday, at } from "./showcase/calendar";
import { CUSTOMER_DEFS, EXISTING_CUSTOMER_KEYS } from "./showcase/customers";
import { SIM_START, TODAY, createCtx, stamp, type Ctx, type SimCustomer } from "./showcase/ctx";
import {
  delivers,
  morningDeliveries,
  openingPurchases,
  packagingTopUp,
  paySuppliers,
  pendingOrders,
  pickupDelivery,
  writeOffs,
  SUPPLIER,
} from "./showcase/purchasing";
import { closeOldRuns, packPending, runProduction } from "./showcase/production";
import {
  PRICE_HISTORY_ROWS,
  dispatchDay,
  finalizeSales,
  generateOrders,
  planTodayRoute,
} from "./showcase/sales";
import { scheduledTransfer, storeDay } from "./showcase/store";

/**
 * Seed de presentación ("showcase"): ~3 meses de operación realista (01/07/2026 al 02/10/2026) para mostrarle
 * el sistema a la empresa. Es determinista (PRNG con semilla fija) y se carga SOBRE los maestros: no usa el
 * seed demo del que dependen los tests. Ver README, sección "Datos de presentación".
 *
 * La simulación avanza día a día con un espejo en memoria del libro mayor de stock, así que ningún saldo
 * queda negativo; al final se vuelca todo en bloque.
 */

/** Gastos fijos por mes [julio, agosto, septiembre]. Incluye los que faltaban en el Excel de abril. */
const FIXED_EXPENSES: {
  concept: string;
  category: string;
  amounts: [number, number, number];
  notes?: string;
}[] = [
  { concept: "Alquiler", category: "rent", amounts: [300_000, 300_000, 300_000] },
  { concept: "Contadora", category: "professional", amounts: [200_000, 200_000, 220_000] },
  { concept: "Luz", category: "services", amounts: [188_000, 214_000, 198_000] },
  { concept: "Agua", category: "services", amounts: [96_000, 101_000, 104_000] },
  { concept: "Internet y telefonía", category: "services", amounts: [26_000, 27_000, 28_000] },
  { concept: "ASSAL", category: "taxes", amounts: [100_000, 100_000, 100_000] },
  { concept: "Seguro", category: "insurance", amounts: [100_000, 100_000, 108_000] },
  { concept: "Desinfección", category: "services", amounts: [40_000, 40_000, 44_000] },
  {
    concept: "Vehículo: patente, seguro y service",
    category: "vehicle",
    amounts: [60_000, 60_000, 65_000],
    notes: "Faltaba en el Excel de costos",
  },
  {
    concept: "Combustible fuera de ruta",
    category: "fuel",
    amounts: [25_000, 26_000, 28_000],
    notes: "Trámites y compras; el combustible de reparto va en el costo de cada ruta",
  },
  {
    concept: "Sueldos del local (2 empleadas)",
    category: "payroll",
    amounts: [300_000, 310_000, 320_000],
    notes: "Faltaba en el Excel de costos",
  },
  {
    concept: "Impuestos (IIBB y tasas municipales)",
    category: "taxes",
    amounts: [220_000, 230_000, 240_000],
    notes: "Faltaba en el Excel de costos",
  },
  {
    concept: "Amortización de máquinas",
    category: "depreciation",
    amounts: [80_000, 80_000, 80_000],
    notes: "Biscomatic, abatidor y cámaras",
  },
];

const FIXED_MONTHS = ["2026-07-01", "2026-08-01", "2026-09-01"] as const;

async function insertAll<T extends PgTable>(tx: Tx, table: T, rows: T["$inferInsert"][], chunk = 700) {
  for (let i = 0; i < rows.length; i += chunk) {
    await tx.insert(table).values(rows.slice(i, i + chunk) as never);
  }
}

export interface ShowcaseSummary {
  rows: Record<string, number>;
  productionDays: number;
  producedKg: number;
}

export async function seedShowcase(tx: Tx, refs: SeedRefs): Promise<ShowcaseSummary> {
  const vehicle = await tx.query.vehicles.findFirst();
  if (!vehicle) throw new Error("No hay vehículo en los maestros: ¿se cargaron los maestros antes?");
  const ctx = createCtx(tx, refs, vehicle.id);
  ctx.sanitation = (await tx.query.sanitationPoints.findMany()).map((p) => ({
    id: p.id,
    element: p.element,
    frequency: p.frequency,
  }));
  const plantTasks = await tx.query.plantTasks.findMany();
  const plans = await tx.query.maintenancePlans.findMany();

  await setupMasters(ctx);

  // --- Simulación día a día ---------------------------------------------------------------------------------
  openingPurchases(ctx, "2026-06-26");
  generateOrders(ctx);
  const days = eachDay(SIM_START, TODAY);
  let dayIndex = 0;
  for (const day of days) {
    if (isWorkday(day)) {
      morningDeliveries(ctx, day);
      packagingTopUp(ctx, day);
      packPending(ctx, day);
      const pickup = delivers("leopelle", day);
      const routeEnd = dispatchDay(ctx, day, { pickupSupplier: pickup });
      scheduledTransfer(ctx, day);
      const run = runProduction(ctx, day);
      writeOffs(ctx, day);
      pickupDelivery(ctx, day, routeEnd);
      paySuppliers(ctx, day);
      cleaningDay(ctx, day);
      if (run) taskAssignments(ctx, day, plantTasks, dayIndex++);
    }
    temperatureDay(ctx, day);
    storeDay(ctx, day);
  }

  // --- Estado de hoy y cierres -----------------------------------------------------------------------------------
  planTodayRoute(ctx);
  finalizeSales(ctx);
  pendingOrders(ctx, TODAY);
  complaints(ctx);
  closeOldRuns(ctx, TODAY);
  planNextWorkday(ctx);
  const planRefs: PlanRef[] = plans.map((p) => ({
    id: p.id,
    equipment: Object.entries(refs.equipment).find(([, id]) => id === p.equipmentId)![0],
    task: p.task,
    frequencyDays: p.frequencyDays,
  }));
  const lastDone = maintenance(ctx, planRefs);

  await flush(ctx);

  // Plan preventivo vigente desde mediados de junio y última fecha hecha de cada plan.
  await tx.update(s.maintenancePlans).set({ startDate: "2026-06-15" });
  for (const [planId, date] of lastDone) {
    await tx.update(s.maintenancePlans).set({ lastDoneAt: date }).where(eq(s.maintenancePlans.id, planId));
  }

  const rows = Object.fromEntries(Object.entries(ctx.buf).map(([k, v]) => [k, v.length]));
  const producedKg = ctx.buf.productionWeighings.reduce((a, w) => a + w.kg, 0);
  return { rows, productionDays: ctx.buf.productionRuns.length, producedKg: Math.round(producedKg) };
}

/** Plan confirmado para el próximo día hábil (lunes 05/10), para que la pantalla de plan no esté vacía. */
function planNextWorkday(ctx: Ctx) {
  const day = nextWorkday(TODAY);
  const id = ctx.rng.uuid();
  ctx.buf.productionPlans.push({
    id,
    date: day,
    status: "confirmed",
    totalKg: 112,
    notes: "Pedidos de la semana próxima: Arcoiris, Club Barrio Sur y Dietética Sabor Natural.",
    ...stamp(at(TODAY, "09:10")),
  });
  for (const [shape, kg] of [
    ["tapita", 52],
    ["arito", 8],
    ["lenguita", 52],
  ] as const) {
    ctx.buf.productionPlanItems.push({ planId: id, shape, kg, ...stamp(at(TODAY, "09:10")) });
  }
}

/** Clientes nuevos, plazos de proveedores, historial de listas de precios y gastos fijos completos. */
async function setupMasters(ctx: Ctx) {
  const { tx, refs } = ctx;
  for (const [key, info] of Object.entries(SUPPLIER)) {
    await tx
      .update(s.suppliers)
      .set({ paymentTermsDays: info.terms, whatsapp: info.whatsapp })
      .where(eq(s.suppliers.id, refs.suppliers[key]!));
  }

  const newRows: (typeof s.customers.$inferInsert)[] = [];
  for (const def of CUSTOMER_DEFS) {
    const existing = EXISTING_CUSTOMER_KEYS.has(def.key);
    const id = existing ? refs.customers[def.key]! : ctx.rng.uuid();
    const { address, whatsapp, legalName: _legalName, ...sim } = def;
    void _legalName;
    const customer: SimCustomer = { ...sim, id };
    ctx.customers.push(customer);
    if (existing) {
      await tx
        .update(s.customers)
        .set({ address, whatsapp, deliveryWeekdays: def.weekdays })
        .where(eq(s.customers.id, id));
    } else {
      newRows.push({
        id,
        legalName: def.name,
        channel: def.channel,
        priceListId: refs.priceLists[def.priceList]!,
        zoneId: refs.zones[def.zone]!,
        deliveryWeekdays: def.weekdays,
        paymentTermsDays: def.terms,
        paymentNotes:
          def.pay === "check30"
            ? "Cheque a 30 días"
            : def.pay === "on_delivery"
              ? "Contado contra entrega"
              : null,
        whatsapp,
        address,
        ...stamp(at(addDaysIso(def.start ?? "2026-06-20", -10), "10:00")),
      });
    }
  }
  await insertAll(tx, s.customers, newRows);

  // Listas de precios: los precios de julio y agosto eran más bajos (actualizaciones mensuales de ~2,5 %).
  const keys = ["tap500", "ari500", "len500", "sur500", "tap5k", "ari5k", "len5k"];
  await insertAll(
    tx,
    s.priceListItems,
    PRICE_HISTORY_ROWS(keys).map((r) => ({
      priceListId: refs.priceLists[r.list]!,
      productId: refs.products[r.product]!,
      unitPrice: r.price,
      validFrom: r.validFrom,
    })),
  );

  // Chisanwich: tras costearlo con jamón y queso se reprecificó (el precio de los maestros quedaba bajo el costo).
  await insertAll(
    tx,
    s.priceListItems,
    (
      [
        ["mayorista", 4400],
        ["super", 4150],
        ["local", 5300],
      ] as const
    ).map(([list, price]) => ({
      priceListId: refs.priceLists[list]!,
      productId: refs.products.sw!,
      unitPrice: price,
      validFrom: "2026-09-21",
    })),
  );

  // Gastos fijos: se reemplazan los de los maestros por el set completo de julio a septiembre.
  await tx.delete(s.fixedExpenses);
  await insertAll(
    tx,
    s.fixedExpenses,
    FIXED_MONTHS.flatMap((month, i) =>
      FIXED_EXPENSES.map((f) => ({
        month,
        concept: f.concept,
        category: f.category,
        amount: f.amounts[i]!,
        notes: f.notes ?? null,
      })),
    ),
  );
}

const addDaysIso = (d: IsoDate, n: number) => addDays(d, n);

/** Vuelca todo lo simulado respetando el orden de las claves foráneas. */
async function flush(ctx: Ctx) {
  const { tx, buf: b } = ctx;
  b.dispatches.sort((x, y) => x.dispatchedAt!.getTime() - y.dispatchedAt!.getTime());
  b.stockMovements.sort((x, y) => x.occurredAt!.getTime() - y.occurredAt!.getTime());

  await insertAll(tx, s.purchaseOrders, b.purchaseOrders);
  await insertAll(tx, s.purchaseOrderItems, b.purchaseOrderItems);
  await insertAll(tx, s.receptions, b.receptions);
  await insertAll(tx, s.rawLots, b.rawLots);
  await insertAll(tx, s.purchaseInvoices, b.purchaseInvoices);
  await insertAll(tx, s.purchaseInvoiceItems, b.purchaseInvoiceItems);
  await insertAll(tx, s.ingredientPrices, b.ingredientPrices);
  await insertAll(tx, s.supplierPayments, b.supplierPayments);

  await insertAll(tx, s.productionPlans, b.productionPlans);
  await insertAll(tx, s.productionPlanItems, b.productionPlanItems);
  await insertAll(tx, s.productionRuns, b.productionRuns);
  await insertAll(tx, s.productionRunWorkers, b.productionRunWorkers);
  await insertAll(tx, s.productionConsumptions, b.productionConsumptions);
  await insertAll(tx, s.productionWeighings, b.productionWeighings);
  await insertAll(tx, s.finishedLots, b.finishedLots);
  await insertAll(tx, s.packings, b.packings);

  await insertAll(tx, s.orders, b.orders);
  await insertAll(tx, s.orderItems, b.orderItems);
  await insertAll(tx, s.orderEvents, b.orderEvents);
  await insertAll(tx, s.routes, b.routes);
  await insertAll(tx, s.routeStops, b.routeStops);
  await insertAll(tx, s.dispatches, b.dispatches);
  await insertAll(tx, s.dispatchItems, b.dispatchItems);
  await insertAll(tx, s.salesInvoices, b.salesInvoices);
  await insertAll(tx, s.customerPayments, b.customerPayments);
  await insertAll(tx, s.checks, b.checks);

  await insertAll(tx, s.storeSales, b.storeSales);
  await insertAll(tx, s.storeSaleItems, b.storeSaleItems);
  await insertAll(tx, s.storeSalePayments, b.storeSalePayments);
  await insertAll(tx, s.cashClosings, b.cashClosings);

  await insertAll(tx, s.stockMovements, b.stockMovements);

  await insertAll(tx, s.cleaningRecords, b.cleaningRecords);
  await insertAll(tx, s.temperatureLogs, b.temperatureLogs);
  await insertAll(tx, s.complaints, b.complaints);
  await insertAll(tx, s.maintenanceOrders, b.maintenanceOrders);
  await insertAll(tx, s.taskAssignments, b.taskAssignments);
}
