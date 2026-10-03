import {
  addDays,
  addMonths,
  canTransition,
  costPerKgDelivered,
  allocateCostByKg,
  isSmallRoute,
  missingCostInputs,
  isoWeekday,
  orderKg,
  roundMoney,
  roundQty,
  routeCost,
  routeHours,
  temperatureStatus,
  zoneDeliversOn,
  type CostGap,
  type IsoDate,
} from "@chipa/domain";
import { and, asc, desc, eq, gte, inArray, lte, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { TZ, toIsoDateAR } from "@/lib/dates";
import { ORDER_STATUS } from "@/lib/labels";
import { changeOrderStatus } from "@/features/orders/service";
import {
  allocateProductFefo,
  finishedLotBalances,
  locationByCode,
  recordProductMovements,
} from "@/features/stock/ledger";
import { formatDispatchNumber, monthOf } from "./labels";
import {
  ROUTE_ORDER_STATUSES,
  type CreateRouteData,
  type FinishRouteData,
  type RegistryFilters,
  type UpdateRouteData,
} from "./schemas";

/**
 * Servicio de despacho y reparto (M5: RF-24 a RF-28). Las funciones reciben un `Executor` (db o tx)
 * y `now` explícito donde importa el instante, para poder testearse con transacciones revertidas.
 */

type RouteStatus = (typeof schema.routeStatusEnum.enumValues)[number];
type DispatchStatus = (typeof schema.dispatchStatusEnum.enumValues)[number];

/** Ubicaciones de producto terminado desde las que se despacha. */
const DISPATCH_LOCATIONS = ["F3", "F4"] as const;
const OPEN_ROUTE: RouteStatus[] = ["planned", "in_progress"];
/** Un remito "vivo": todavía cuenta para el pedido (no fue rechazado ni anulado). */
const LIVE_DISPATCH: DispatchStatus[] = ["prepared", "delivered"];

// ------------------------------------------------------------------------------------------------
// Opciones de formularios
// ------------------------------------------------------------------------------------------------

/** Choferes (rol logística), vehículos y proveedores activos para armar rutas. */
export async function dispatchFormOptions(db: Executor) {
  const [drivers, vehicles, suppliers] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.role, "logistics"), eq(schema.users.active, true)))
      .orderBy(asc(schema.users.name)),
    db
      .select({
        id: schema.vehicles.id,
        name: schema.vehicles.name,
        plate: schema.vehicles.plate,
        hasColdUnit: schema.vehicles.hasColdUnit,
      })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.active, true))
      .orderBy(asc(schema.vehicles.name)),
    db
      .select({ id: schema.suppliers.id, name: schema.suppliers.legalName })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.active, true))
      .orderBy(asc(schema.suppliers.legalName)),
  ]);
  return { drivers, vehicles, suppliers };
}
export type DispatchFormOptions = Awaited<ReturnType<typeof dispatchFormOptions>>;

// ------------------------------------------------------------------------------------------------
// RF-24: propuesta de ruta
// ------------------------------------------------------------------------------------------------

/** Pedidos que ya están en una ruta abierta (planificada o en curso): no se vuelven a proponer. */
const notInOpenRoute = sql`not exists (
  select 1 from route_stops rs inner join routes r on r.id = rs.route_id
  where rs.order_id = ${schema.orders.id} and r.status in ('planned', 'in_progress')
)`;

interface Candidate {
  id: string;
  number: number;
  status: string;
  promisedDate: IsoDate;
  notes: string | null;
  customerId: string;
  customerName: string;
  address: string | null;
  zoneId: string | null;
  zoneName: string | null;
  zoneDays: number[];
  kg: number;
  units: number;
}

async function loadCandidates(
  db: Executor,
  where: ReturnType<typeof and>,
  orderBy: "promised" | "zone" = "promised",
): Promise<Candidate[]> {
  const o = schema.orders;
  const rows = await db
    .select({
      id: o.id,
      number: o.number,
      status: o.status,
      promisedDate: o.promisedDate,
      notes: o.notes,
      customerId: schema.customers.id,
      customerName: schema.customers.legalName,
      address: schema.customers.address,
      zoneId: schema.zones.id,
      zoneName: schema.zones.name,
      zoneDays: schema.zones.deliveryWeekdays,
    })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .leftJoin(schema.zones, eq(schema.zones.id, schema.customers.zoneId))
    .where(where)
    .orderBy(
      ...(orderBy === "zone"
        ? [sql`${schema.zones.name} asc nulls last`, asc(o.number)]
        : [asc(o.promisedDate), asc(o.number)]),
    );
  if (!rows.length) return [];
  const items = await db
    .select({
      orderId: schema.orderItems.orderId,
      qtyUnits: schema.orderItems.qtyUnits,
      netWeightKg: schema.products.netWeightKg,
    })
    .from(schema.orderItems)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
    .where(
      inArray(
        schema.orderItems.orderId,
        rows.map((r) => r.id),
      ),
    );
  const byOrder = new Map<string, { qtyUnits: number; netWeightKg: number }[]>();
  for (const i of items) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  return rows.map((r) => {
    const its = byOrder.get(r.id) ?? [];
    return {
      ...r,
      zoneDays: r.zoneDays ?? [],
      kg: orderKg(its),
      units: its.reduce((a, i) => a + i.qtyUnits, 0),
    };
  });
}

export interface ProposalOrder {
  id: string;
  number: number;
  customerName: string;
  address: string | null;
  promisedDate: IsoDate;
  status: string;
  ready: boolean;
  kg: number;
  units: number;
  notes: string | null;
}
/** RF-10: orden de compra con "retiro en proveedor" sugerida como parada de la ruta. */
export interface ProposalPickup {
  orderId: string;
  number: string;
  supplierId: string;
  supplierName: string;
  expectedAt: IsoDate;
  /** Detalle de lo que hay que retirar: "25 kg Fécula de mandioca, 10 kg Manteca". */
  summary: string;
  /** Nota que queda en la parada (empieza con el número de la OC: así no se vuelve a sugerir). */
  note: string;
}
export interface ProposalZone {
  zoneId: string | null;
  name: string;
  weekdays: number[];
  /** ¿La zona reparte el día de la ruta? */
  deliversOnDate: boolean;
  orders: ProposalOrder[];
}

const UNIT_SHORT = { kg: "kg", l: "L", unit: "u." } as const;

/**
 * RF-10: OC con "retiro en proveedor" (enviadas o parcialmente recibidas) con fecha esperada ≤ `date`
 * que todavía no están en una parada de una ruta abierta (la parada lleva el número de la OC en su nota).
 */
export async function pickupSuggestions(db: Executor, date: IsoDate): Promise<ProposalPickup[]> {
  const o = schema.purchaseOrders;
  const orders = await db
    .select({
      id: o.id,
      number: o.number,
      expectedAt: o.expectedAt,
      supplierId: o.supplierId,
      supplierName: schema.suppliers.legalName,
    })
    .from(o)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, o.supplierId))
    .where(
      and(
        eq(o.pickup, true),
        inArray(o.status, ["sent", "partially_received"]),
        lte(o.expectedAt, date),
        sql`not exists (
          select 1 from route_stops rs inner join routes r on r.id = rs.route_id
          where rs.kind = 'supplier_pickup' and r.status in ('planned', 'in_progress')
            and position(${o.number} in coalesce(rs.notes, '')) > 0
        )`,
      ),
    )
    .orderBy(asc(o.expectedAt), asc(o.number));
  if (!orders.length) return [];
  const items = await db
    .select({
      orderId: schema.purchaseOrderItems.purchaseOrderId,
      name: schema.ingredients.name,
      unit: schema.purchaseOrderItems.unit,
      qty: schema.purchaseOrderItems.qty,
    })
    .from(schema.purchaseOrderItems)
    .innerJoin(schema.ingredients, eq(schema.ingredients.id, schema.purchaseOrderItems.ingredientId))
    .where(
      inArray(
        schema.purchaseOrderItems.purchaseOrderId,
        orders.map((x) => x.id),
      ),
    )
    .orderBy(asc(schema.purchaseOrderItems.createdAt));
  return orders.map((x) => {
    const summary = items
      .filter((i) => i.orderId === x.id)
      .map((i) => `${String(i.qty).replace(".", ",")} ${UNIT_SHORT[i.unit]} ${i.name}`)
      .join(", ");
    return {
      orderId: x.id,
      number: x.number,
      supplierId: x.supplierId,
      supplierName: x.supplierName,
      expectedAt: x.expectedAt!,
      summary,
      note: `${x.number} · retirar ${summary}`,
    };
  });
}

/**
 * RF-24: pedidos para proponer en la ruta de `date`: listos (y confirmados / en producción, marcados
 * como "no listos") con fecha comprometida ≤ `date`, sin ruta abierta, agrupados por zona del cliente.
 * Las zonas que reparten ese día van primero; "Sin zona" al final.
 */
export async function routeProposal(db: Executor, date: IsoDate) {
  const o = schema.orders;
  const rows = await loadCandidates(
    db,
    and(inArray(o.status, [...ROUTE_ORDER_STATUSES]), lte(o.promisedDate, date), notInOpenRoute),
  );
  const zones = new Map<string, ProposalZone>();
  for (const r of rows) {
    const key = r.zoneId ?? "none";
    let z = zones.get(key);
    if (!z) {
      z = {
        zoneId: r.zoneId,
        name: r.zoneName ?? "Sin zona",
        weekdays: r.zoneDays,
        deliversOnDate: r.zoneId ? zoneDeliversOn(r.zoneDays, date) : true,
        orders: [],
      };
      zones.set(key, z);
    }
    z.orders.push({
      id: r.id,
      number: r.number,
      customerName: r.customerName,
      address: r.address,
      promisedDate: r.promisedDate,
      status: r.status,
      ready: r.status === "ready",
      kg: r.kg,
      units: r.units,
      notes: r.notes,
    });
  }
  const list = [...zones.values()].sort((a, b) => {
    if ((a.zoneId === null) !== (b.zoneId === null)) return a.zoneId === null ? 1 : -1;
    if (a.deliversOnDate !== b.deliversOnDate) return a.deliversOnDate ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  });
  return { date, weekday: isoWeekday(date), zones: list, pickups: await pickupSuggestions(db, date) };
}
export type RouteProposal = Awaited<ReturnType<typeof routeProposal>>;

// ------------------------------------------------------------------------------------------------
// RF-24: alta y edición de rutas
// ------------------------------------------------------------------------------------------------

/** Crea la ruta con paradas de entrega (agrupadas por zona) y retiros en proveedores al final. */
export async function createRoute(db: Executor, input: CreateRouteData) {
  const orderIds = [...new Set(input.orderIds)];
  let candidates: Candidate[] = [];
  if (orderIds.length) {
    const o = schema.orders;
    candidates = await loadCandidates(
      db,
      and(inArray(o.id, orderIds), inArray(o.status, [...ROUTE_ORDER_STATUSES]), notInOpenRoute),
      "zone",
    );
    if (candidates.length !== orderIds.length) {
      throw new UserError(
        "Algún pedido ya no se puede poner en la ruta (cambió de estado o ya está en otra ruta). Actualizá la página.",
        { orderIds: ["Pedido no disponible"] },
      );
    }
  }
  if (input.supplierStops.length) {
    const ids = [...new Set(input.supplierStops.map((s) => s.supplierId))];
    const found = await db
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(and(inArray(schema.suppliers.id, ids), eq(schema.suppliers.active, true)));
    if (found.length !== ids.length) throw new UserError("Algún proveedor no existe o está inactivo.");
  }
  const [route] = await db
    .insert(schema.routes)
    .values({
      date: input.date,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      notes: input.notes,
      status: "planned",
    })
    .returning();
  // Primero las zonas que reparten ese día, después el resto y al final los clientes sin zona.
  candidates.sort(
    (a, b) =>
      Number(a.zoneId === null) - Number(b.zoneId === null) ||
      Number(!zoneDeliversOn(a.zoneDays, input.date)) - Number(!zoneDeliversOn(b.zoneDays, input.date)) ||
      (a.zoneName ?? "").localeCompare(b.zoneName ?? "", "es") ||
      a.number - b.number,
  );
  let seq = 1;
  const stops = [
    ...candidates.map((c) => ({
      routeId: route!.id,
      seq: seq++,
      kind: "delivery" as const,
      orderId: c.id,
      customerId: c.customerId,
    })),
    ...input.supplierStops.map((s) => ({
      routeId: route!.id,
      seq: seq++,
      kind: "supplier_pickup" as const,
      supplierId: s.supplierId,
      notes: s.notes,
    })),
  ];
  await db.insert(schema.routeStops).values(stops);
  return route!;
}

async function lockRoute(db: Executor, id: string) {
  const [row] = await db.select().from(schema.routes).where(eq(schema.routes.id, id)).for("update");
  if (!row) throw new UserError("La ruta no existe.");
  return row;
}

function assertOpen(route: { status: RouteStatus }, what = "modificar") {
  if (!OPEN_ROUTE.includes(route.status))
    throw new UserError(`La ruta está ${ROUTE_STATUS_TEXT[route.status]}: ya no se puede ${what}.`);
}
const ROUTE_STATUS_TEXT: Record<RouteStatus, string> = {
  planned: "planificada",
  in_progress: "en curso",
  done: "cerrada",
  cancelled: "cancelada",
};

export async function updateRoute(db: Executor, input: UpdateRouteData) {
  const route = await lockRoute(db, input.id);
  assertOpen(route);
  await db
    .update(schema.routes)
    .set({ driverId: input.driverId, vehicleId: input.vehicleId, notes: input.notes })
    .where(eq(schema.routes.id, route.id));
  return { id: route.id };
}

async function resequence(db: Executor, routeId: string, orderedStopIds?: string[]) {
  const stops = await db
    .select({ id: schema.routeStops.id, seq: schema.routeStops.seq })
    .from(schema.routeStops)
    .where(eq(schema.routeStops.routeId, routeId))
    .orderBy(asc(schema.routeStops.seq), asc(schema.routeStops.createdAt));
  const ids = orderedStopIds ?? stops.map((s) => s.id);
  const current = new Map(stops.map((s) => [s.id, s.seq]));
  for (const [i, stopId] of ids.entries()) {
    if (current.get(stopId) !== i + 1)
      await db
        .update(schema.routeStops)
        .set({ seq: i + 1 })
        .where(eq(schema.routeStops.id, stopId));
  }
}

async function nextSeq(db: Executor, routeId: string) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${schema.routeStops.seq}), 0)::int` })
    .from(schema.routeStops)
    .where(eq(schema.routeStops.routeId, routeId));
  return (row?.max ?? 0) + 1;
}

/** Suma pedidos a una ruta abierta (al final). */
export async function addOrdersToRoute(db: Executor, input: { routeId: string; orderIds: string[] }) {
  const route = await lockRoute(db, input.routeId);
  assertOpen(route, "agregar pedidos");
  const ids = [...new Set(input.orderIds)];
  const o = schema.orders;
  const candidates = await loadCandidates(
    db,
    and(inArray(o.id, ids), inArray(o.status, [...ROUTE_ORDER_STATUSES]), notInOpenRoute),
    "zone",
  );
  if (candidates.length !== ids.length)
    throw new UserError("Algún pedido ya no se puede poner en la ruta (cambió de estado o ya está en otra).");
  let seq = await nextSeq(db, route.id);
  await db.insert(schema.routeStops).values(
    candidates.map((c) => ({
      routeId: route.id,
      seq: seq++,
      kind: "delivery" as const,
      orderId: c.id,
      customerId: c.customerId,
    })),
  );
  return { id: route.id, added: candidates.length };
}

/** RF-24: retiro en un proveedor, agregado a mano. */
export async function addSupplierStop(
  db: Executor,
  input: { routeId: string; supplierId: string; notes: string | null },
) {
  const route = await lockRoute(db, input.routeId);
  assertOpen(route, "agregar paradas");
  const supplier = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, input.supplierId) });
  if (!supplier || !supplier.active) throw new UserError("El proveedor no existe o está inactivo.");
  const [stop] = await db
    .insert(schema.routeStops)
    .values({
      routeId: route.id,
      seq: await nextSeq(db, route.id),
      kind: "supplier_pickup",
      supplierId: supplier.id,
      notes: input.notes,
    })
    .returning();
  return stop!;
}

async function getStop(db: Executor, stopId: string) {
  const stop = await db.query.routeStops.findFirst({ where: eq(schema.routeStops.id, stopId) });
  if (!stop) throw new UserError("La parada no existe.");
  return stop;
}

/** Sube o baja una parada una posición. */
export async function moveStop(db: Executor, input: { stopId: string; direction: "up" | "down" }) {
  const stop = await getStop(db, input.stopId);
  const route = await lockRoute(db, stop.routeId);
  assertOpen(route, "reordenar");
  const stops = await db
    .select({ id: schema.routeStops.id })
    .from(schema.routeStops)
    .where(eq(schema.routeStops.routeId, route.id))
    .orderBy(asc(schema.routeStops.seq), asc(schema.routeStops.createdAt));
  const ids = stops.map((s) => s.id);
  const from = ids.indexOf(stop.id);
  const to = input.direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return { id: route.id };
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  await resequence(db, route.id, ids);
  return { id: route.id };
}

/** Quita una parada que todavía no tiene remito vivo. */
export async function removeStop(db: Executor, input: { stopId: string }) {
  const stop = await getStop(db, input.stopId);
  const route = await lockRoute(db, stop.routeId);
  assertOpen(route, "quitar paradas");
  if (stop.orderId) {
    const live = await db
      .select({ number: schema.dispatches.number })
      .from(schema.dispatches)
      .where(
        and(
          eq(schema.dispatches.orderId, stop.orderId),
          eq(schema.dispatches.routeId, route.id),
          inArray(schema.dispatches.status, LIVE_DISPATCH),
        ),
      );
    if (live.length)
      throw new UserError(
        `La parada ya tiene el remito ${formatDispatchNumber(live[0]!.number)}: rechazalo antes de sacarla de la ruta.`,
      );
  }
  await db.delete(schema.routeStops).where(eq(schema.routeStops.id, stop.id));
  await resequence(db, route.id);
  return { id: route.id };
}

/** Marca (o desmarca) una parada como hecha. */
export async function setStopDone(db: Executor, input: { stopId: string; done: boolean }, now = new Date()) {
  const stop = await getStop(db, input.stopId);
  await db
    .update(schema.routeStops)
    .set({ doneAt: input.done ? (stop.doneAt ?? now) : null })
    .where(eq(schema.routeStops.id, stop.id));
  return { id: stop.routeId };
}

// ------------------------------------------------------------------------------------------------
// Consulta de rutas
// ------------------------------------------------------------------------------------------------

export interface RouteSummary {
  id: string;
  date: IsoDate;
  status: RouteStatus;
  driverName: string | null;
  vehicleName: string | null;
  plate: string | null;
  deliveries: number;
  pickups: number;
  stopsDone: number;
  kg: number;
  units: number;
}

/** Rutas entre dos fechas (inclusive), con kg y bultos planificados. */
export async function listRoutes(db: Executor, f: { from: IsoDate; to: IsoDate }): Promise<RouteSummary[]> {
  const rows = await db.query.routes.findMany({
    where: and(gte(schema.routes.date, f.from), lte(schema.routes.date, f.to)),
    orderBy: [asc(schema.routes.date), asc(schema.routes.createdAt)],
    with: {
      driver: true,
      vehicle: true,
      stops: { with: { order: { with: { items: { with: { product: true } } } } } },
    },
  });
  return rows.map((r) => {
    const delivery = r.stops.filter((s) => s.kind === "delivery");
    const items = delivery.flatMap((s) => s.order?.items ?? []);
    return {
      id: r.id,
      date: r.date,
      status: r.status,
      driverName: r.driver?.name ?? null,
      vehicleName: r.vehicle?.name ?? null,
      plate: r.vehicle?.plate ?? null,
      deliveries: delivery.length,
      pickups: r.stops.filter((s) => s.kind === "supplier_pickup").length,
      stopsDone: r.stops.filter((s) => s.doneAt).length,
      kg: orderKg(items.map((i) => ({ qtyUnits: i.qtyUnits, netWeightKg: i.product.netWeightKg }))),
      units: items.reduce((a, i) => a + i.qtyUnits, 0),
    };
  });
}

export interface StopDispatch {
  id: string;
  number: number;
  status: DispatchStatus;
  receivedByName: string | null;
  notes: string | null;
  proofFileKey: string | null;
  items: {
    id: string;
    productName: string;
    lotCode: string;
    expiryDate: IsoDate;
    qtyUnits: number;
    /** Unidades realmente entregadas si hubo entrega parcial. */
    qtyDelivered: number | null;
  }[];
}
export interface StopView {
  id: string;
  seq: number;
  kind: "delivery" | "supplier_pickup" | "other";
  done: boolean;
  doneAt: Date | null;
  notes: string | null;
  orderId: string | null;
  orderNumber: number | null;
  orderStatus: string | null;
  customerId: string | null;
  title: string;
  address: string | null;
  zoneName: string | null;
  whatsapp: string | null;
  kg: number;
  units: number;
  lines: { productName: string; qtyUnits: number }[];
  /** El remito vigente (vivo) o, si no hay, el último rechazado. */
  dispatch: StopDispatch | null;
  /** Remitos rechazados anteriores (reentregas). */
  rejectedCount: number;
}

export async function getRoute(db: Executor, id: string) {
  const route = await db.query.routes.findFirst({
    where: eq(schema.routes.id, id),
    with: {
      driver: true,
      vehicle: true,
      stops: {
        orderBy: (t, { asc }) => [asc(t.seq), asc(t.createdAt)],
        with: {
          order: { with: { items: { with: { product: true } } } },
          customer: { with: { zone: true } },
          supplier: true,
        },
      },
      dispatches: {
        orderBy: (t, { asc }) => asc(t.number),
        with: { items: { with: { product: true, lot: true } } },
      },
    },
  });
  if (!route) return null;

  const stops: StopView[] = route.stops.map((s) => {
    const items = s.order?.items ?? [];
    const mine = route.dispatches.filter((d) => d.orderId === s.orderId);
    const live = mine.filter((d) => LIVE_DISPATCH.includes(d.status));
    const current = live.at(-1) ?? mine.filter((d) => d.status === "rejected").at(-1) ?? null;
    return {
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      done: !!s.doneAt,
      doneAt: s.doneAt,
      notes: s.notes,
      orderId: s.orderId,
      orderNumber: s.order?.number ?? null,
      orderStatus: s.order?.status ?? null,
      customerId: s.customerId,
      title: s.customer?.legalName ?? s.supplier?.legalName ?? "Parada",
      address: s.customer?.address ?? null,
      zoneName: s.customer?.zone?.name ?? null,
      whatsapp: s.customer?.whatsapp ?? s.supplier?.whatsapp ?? null,
      kg: orderKg(items.map((i) => ({ qtyUnits: i.qtyUnits, netWeightKg: i.product.netWeightKg }))),
      units: items.reduce((a, i) => a + i.qtyUnits, 0),
      lines: items.map((i) => ({ productName: i.product.name, qtyUnits: i.qtyUnits })),
      dispatch: current && {
        id: current.id,
        number: current.number,
        status: current.status,
        receivedByName: current.receivedByName,
        notes: current.notes,
        proofFileKey: current.proofFileKey,
        items: current.items.map((i) => ({
          id: i.id,
          productName: i.product.name,
          lotCode: i.lot.code,
          expiryDate: i.lot.expiryDate,
          qtyUnits: i.qtyUnits,
          qtyDelivered: i.qtyDelivered,
        })),
      },
      rejectedCount:
        mine.filter((d) => d.status === "rejected").length - (current?.status === "rejected" ? 1 : 0),
    };
  });

  const deliveries = stops.filter((s) => s.kind === "delivery");
  const totals = {
    kg: roundQty(deliveries.reduce((a, s) => a + s.kg, 0)),
    units: deliveries.reduce((a, s) => a + s.units, 0),
    stops: stops.length,
    stopsDone: stops.filter((s) => s.done).length,
    pendingDispatches: route.dispatches.filter((d) => d.status === "prepared").length,
  };
  const { stops: _s, dispatches: _d, ...base } = route;
  void _s;
  void _d;
  return { ...base, stops, totals };
}
export type RouteDetail = NonNullable<Awaited<ReturnType<typeof getRoute>>>;

/** Último km final registrado de un vehículo (sugerencia para el km inicial de la próxima salida). */
export async function lastKmEnd(db: Executor, vehicleId: string): Promise<number | null> {
  const [row] = await db
    .select({ kmEnd: schema.routes.kmEnd })
    .from(schema.routes)
    .where(and(eq(schema.routes.vehicleId, vehicleId), eq(schema.routes.status, "done")))
    .orderBy(desc(schema.routes.date), desc(schema.routes.endedAt))
    .limit(1);
  return row?.kmEnd ?? null;
}

// ------------------------------------------------------------------------------------------------
// RF-26: inicio y cierre de la salida
// ------------------------------------------------------------------------------------------------

export async function startRoute(
  db: Executor,
  input: { id: string; kmStart: number },
  now: Date = new Date(),
) {
  const route = await lockRoute(db, input.id);
  if (route.status !== "planned")
    throw new UserError(
      `La ruta está ${ROUTE_STATUS_TEXT[route.status]}: solo se inicia una ruta planificada.`,
    );
  if (!route.vehicleId) throw new UserError("Asigná un vehículo antes de iniciar la ruta.");
  await db
    .update(schema.routes)
    .set({ status: "in_progress", kmStart: input.kmStart, startedAt: now })
    .where(eq(schema.routes.id, route.id));
  return { id: route.id };
}

/**
 * Cierra la salida: km final (≥ inicial), combustible, otros costos y temperatura del equipo de frío,
 * que además se registra en `temperature_logs` para el equipo del vehículo (VEH-FRIO).
 */
export async function finishRoute(
  db: Executor,
  userId: string | null,
  input: FinishRouteData,
  now: Date = new Date(),
) {
  const route = await lockRoute(db, input.id);
  if (route.status !== "in_progress")
    throw new UserError(`La ruta está ${ROUTE_STATUS_TEXT[route.status]}: solo se cierra una ruta en curso.`);
  if (route.kmStart != null && input.kmEnd < route.kmStart)
    throw new UserError(`El km final no puede ser menor al km inicial (${route.kmStart}).`, {
      kmEnd: ["Menor al km inicial"],
    });
  const vehicle = route.vehicleId
    ? await db.query.vehicles.findFirst({
        where: eq(schema.vehicles.id, route.vehicleId),
        with: { equipment: true },
      })
    : null;
  if (vehicle?.hasColdUnit && input.coldUnitTempC == null)
    throw new UserError("Cargá la temperatura del equipo de frío medida en el trayecto.", {
      coldUnitTempC: ["Requerida"],
    });

  const [{ n: pending } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.dispatches)
    .where(and(eq(schema.dispatches.routeId, route.id), eq(schema.dispatches.status, "prepared")));
  if (pending > 0)
    throw new UserError(
      `Quedan ${pending} ${pending === 1 ? "remito" : "remitos"} sin entregar ni rechazar. Resolvelos antes de cerrar la ruta.`,
    );

  await db
    .update(schema.routes)
    .set({
      status: "done",
      kmEnd: input.kmEnd,
      endedAt: now,
      fuelLiters: input.fuelLiters,
      fuelCost: input.fuelCost,
      otherCosts: input.otherCosts,
      coldUnitTempC: input.coldUnitTempC,
      notes: input.notes ?? route.notes,
    })
    .where(eq(schema.routes.id, route.id));

  if (input.coldUnitTempC != null) {
    const equipment =
      vehicle?.equipment ??
      (await db.query.equipment.findFirst({ where: eq(schema.equipment.code, "VEH-FRIO") })) ??
      null;
    if (equipment) {
      await db.insert(schema.temperatureLogs).values({
        equipmentId: equipment.id,
        date: toIsoDateAR(now),
        measuredAt: now,
        valueC: input.coldUnitTempC,
        outOfRange:
          temperatureStatus(input.coldUnitTempC, { min: equipment.tempMinC, max: equipment.tempMaxC }) !==
          "ok",
        userId,
        source: "manual",
      });
    }
  }
  return { id: route.id };
}

// ------------------------------------------------------------------------------------------------
// RF-25: remito con lotes FEFO y conformidad
// ------------------------------------------------------------------------------------------------

async function dispatchLocationIds(db: Executor) {
  return Promise.all(DISPATCH_LOCATIONS.map(async (c) => (await locationByCode(db, c)).id));
}

/**
 * Genera el remito de un pedido: asigna lotes por FEFO (ubicaciones F3 y F4) para cada ítem, descuenta
 * el stock con un movimiento `dispatch` negativo por lote/ubicación y pasa el pedido a despachado.
 * Si el stock no alcanza no escribe nada y explica qué falta. Un pedido despachado cuya entrega fue
 * rechazada (sin remito vivo) puede volver a salir (reentrega).
 */
export async function createDispatch(
  db: Executor,
  userId: string | null,
  input: { orderId: string; routeId?: string | null },
  now: Date = new Date(),
) {
  await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(eq(schema.orders.id, input.orderId))
    .for("update");
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, input.orderId),
    with: { customer: true, items: { with: { product: true } } },
  });
  if (!order) throw new UserError("El pedido no existe.");
  const label = `Pedido #${order.number}`;

  const live = await db
    .select({ number: schema.dispatches.number })
    .from(schema.dispatches)
    .where(and(eq(schema.dispatches.orderId, order.id), inArray(schema.dispatches.status, LIVE_DISPATCH)));
  if (live.length)
    throw new UserError(`${label} ya tiene el remito ${formatDispatchNumber(live[0]!.number)}.`);
  const redelivery = order.status === "dispatched";
  if (order.status !== "ready" && !redelivery)
    throw new UserError(
      `${label} está "${ORDER_STATUS[order.status]?.label}": solo se genera remito de pedidos listos.`,
    );

  if (input.routeId) {
    const route = await lockRoute(db, input.routeId);
    assertOpen(route, "generar remitos");
    const stop = await db.query.routeStops.findFirst({
      where: and(eq(schema.routeStops.routeId, route.id), eq(schema.routeStops.orderId, order.id)),
    });
    if (!stop) throw new UserError(`${label} no está en esta ruta.`);
  }

  // Asignación FEFO de todos los ítems antes de escribir: si algo falta, no queda nada a medias.
  const locationIds = await dispatchLocationIds(db);
  const wanted = new Map<string, { units: number; name: string }>();
  for (const i of order.items) {
    const w = wanted.get(i.productId) ?? { units: 0, name: i.product.name };
    wanted.set(i.productId, { ...w, units: w.units + i.qtyUnits });
  }
  const lines: { productId: string; finishedLotId: string; locationId: string; qty: number }[] = [];
  const missing: string[] = [];
  for (const [productId, w] of wanted) {
    const res = await allocateProductFefo(db, productId, w.units, { locationIds, allowShortfall: true });
    if (res.shortfall > 0) missing.push(`${w.name} (faltan ${res.shortfall} u.)`);
    for (const a of res.allocations)
      lines.push({ productId, finishedLotId: a.finishedLotId, locationId: a.locationId, qty: a.qty });
  }
  if (missing.length)
    throw new UserError(`No hay stock suficiente para el remito de ${label}: ${missing.join(", ")}.`);

  const [dispatch] = await db
    .insert(schema.dispatches)
    .values({
      routeId: input.routeId ?? null,
      orderId: order.id,
      customerId: order.customerId,
      status: "prepared",
      dispatchedAt: now,
      responsibleId: userId,
    })
    .returning();
  await db.insert(schema.dispatchItems).values(
    lines.map((l) => ({
      dispatchId: dispatch!.id,
      productId: l.productId,
      finishedLotId: l.finishedLotId,
      qtyUnits: l.qty,
    })),
  );
  await recordProductMovements(
    db,
    userId,
    lines.map((l) => ({
      type: "dispatch" as const,
      productId: l.productId,
      finishedLotId: l.finishedLotId,
      locationId: l.locationId,
      qty: -l.qty,
      refTable: "dispatches",
      refId: dispatch!.id,
      note: `Remito ${formatDispatchNumber(dispatch!.number)}`,
      occurredAt: now,
    })),
  );

  const note = `Remito ${formatDispatchNumber(dispatch!.number)}${redelivery ? " (reentrega)" : ""}`;
  if (redelivery)
    await db
      .insert(schema.orderEvents)
      .values({ orderId: order.id, status: "dispatched", at: now, byId: userId, note });
  else await changeOrderStatus(db, userId, { id: order.id, to: "dispatched", note }, now);

  return {
    id: dispatch!.id,
    number: dispatch!.number,
    orderNumber: order.number,
    lots: lines.map((l) => l.finishedLotId),
  };
}

export interface RouteDispatchesResult {
  created: { id: string; number: number; orderNumber: number }[];
  failed: { orderNumber: number | null; customerName: string; reason: string }[];
  /** Paradas que ya tenían remito. */
  skipped: number;
}

/** Genera los remitos de todos los pedidos de la ruta que todavía no tienen. Informa los que fallaron. */
export async function createRouteDispatches(
  db: Executor,
  userId: string | null,
  routeId: string,
  now: Date = new Date(),
): Promise<RouteDispatchesResult> {
  const route = await getRoute(db, routeId);
  if (!route) throw new UserError("La ruta no existe.");
  assertOpen(route, "generar remitos");
  const out: RouteDispatchesResult = { created: [], failed: [], skipped: 0 };
  for (const stop of route.stops) {
    if (stop.kind !== "delivery" || !stop.orderId) continue;
    if (stop.dispatch && LIVE_DISPATCH.includes(stop.dispatch.status)) {
      out.skipped++;
      continue;
    }
    try {
      const d = await createDispatch(db, userId, { orderId: stop.orderId, routeId }, now);
      out.created.push({ id: d.id, number: d.number, orderNumber: d.orderNumber });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      out.failed.push({ orderNumber: stop.orderNumber, customerName: stop.title, reason: e.message });
    }
  }
  return out;
}

async function lockDispatch(db: Executor, id: string) {
  const [row] = await db.select().from(schema.dispatches).where(eq(schema.dispatches.id, id)).for("update");
  if (!row) throw new UserError("El remito no existe.");
  return row;
}

const DISPATCH_STATUS_TEXT: Record<DispatchStatus, string> = {
  prepared: "preparado",
  delivered: "entregado",
  rejected: "rechazado",
  cancelled: "anulado",
};

async function markRouteStopDone(db: Executor, d: { routeId: string | null; orderId: string }, now: Date) {
  if (!d.routeId) return;
  await db
    .update(schema.routeStops)
    .set({ doneAt: now })
    .where(
      and(
        eq(schema.routeStops.routeId, d.routeId),
        eq(schema.routeStops.orderId, d.orderId),
        sql`${schema.routeStops.doneAt} is null`,
      ),
    );
}

/**
 * Entrega con conformidad: quién recibió y, si hay, la foto o firma ya guardada (`proofFileKey`).
 * Entrega parcial (RF-25): `quantities` trae la cantidad realmente entregada por línea del remito; lo que
 * no se entregó vuelve al stock del lote en F3 con un movimiento `return`. Las líneas que no se informan
 * se consideran entregadas completas. Si no se entregó nada hay que rechazar el remito.
 */
export async function deliverDispatch(
  db: Executor,
  userId: string | null,
  input: {
    dispatchId: string;
    receivedByName: string;
    proofFileKey?: string | null;
    quantities?: { dispatchItemId: string; qty: number }[];
  },
  now: Date = new Date(),
) {
  const name = input.receivedByName.trim();
  if (name.length < 2)
    throw new UserError("Ingresá el nombre de quien recibe.", { receivedByName: ["Requerido"] });
  const d = await lockDispatch(db, input.dispatchId);
  if (d.status !== "prepared")
    throw new UserError(
      `El remito ${formatDispatchNumber(d.number)} está ${DISPATCH_STATUS_TEXT[d.status]}: solo se entrega un remito preparado.`,
    );

  const items = await db.select().from(schema.dispatchItems).where(eq(schema.dispatchItems.dispatchId, d.id));
  const delivered = new Map(items.map((i) => [i.id, i.qtyUnits]));
  for (const q of input.quantities ?? []) {
    const item = items.find((i) => i.id === q.dispatchItemId);
    if (!item) throw new UserError("Una línea de la entrega no pertenece a este remito.");
    if (!Number.isInteger(q.qty) || q.qty < 0 || q.qty > item.qtyUnits)
      throw new UserError(
        `La cantidad entregada tiene que estar entre 0 y ${item.qtyUnits} unidades (la del remito).`,
        { quantities: ["Cantidad inválida"] },
      );
    delivered.set(item.id, q.qty);
  }
  const deliveredUnits = [...delivered.values()].reduce((a, n) => a + n, 0);
  if (deliveredUnits === 0)
    throw new UserError("Si no se entregó nada, rechazá el remito: el stock vuelve al lote.");

  const partial = items.filter((i) => (delivered.get(i.id) ?? i.qtyUnits) < i.qtyUnits);
  if (partial.length) {
    const f3 = await locationByCode(db, "F3");
    await recordProductMovements(
      db,
      userId,
      partial.map((i) => ({
        type: "return" as const,
        productId: i.productId,
        finishedLotId: i.finishedLotId,
        locationId: f3.id,
        qty: i.qtyUnits - delivered.get(i.id)!,
        refTable: "dispatches",
        refId: d.id,
        note: `Entrega parcial del remito ${formatDispatchNumber(d.number)}: devolución al stock`,
        occurredAt: now,
      })),
    );
    for (const i of partial)
      await db
        .update(schema.dispatchItems)
        .set({ qtyDelivered: delivered.get(i.id)! })
        .where(eq(schema.dispatchItems.id, i.id));
  }

  await db
    .update(schema.dispatches)
    .set({
      status: "delivered",
      deliveredAt: now,
      receivedByName: name,
      proofFileKey: input.proofFileKey ?? null,
    })
    .where(eq(schema.dispatches.id, d.id));
  const totalUnits = items.reduce((a, i) => a + i.qtyUnits, 0);
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, d.orderId) });
  if (order && canTransition(order.status, "delivered"))
    await changeOrderStatus(
      db,
      userId,
      {
        id: order.id,
        to: "delivered",
        note: `Remito ${formatDispatchNumber(d.number)}: recibió ${name}${
          partial.length ? `. Entrega parcial: ${deliveredUnits} de ${totalUnits} u.` : ""
        }`,
      },
      now,
    );
  await markRouteStopDone(db, d, now);
  return {
    id: d.id,
    number: d.number,
    orderId: d.orderId,
    partial: partial.length > 0,
    deliveredUnits,
    returnedUnits: totalUnits - deliveredUnits,
  };
}

/**
 * Cambio manual del lote asignado por FEFO a una línea del remito (RF-25), con motivo obligatorio. Solo en
 * remitos preparados. Valida que el lote elegido tenga stock suficiente en F3/F4 (y no esté retenido): la
 * línea vuelve al lote anterior (movimiento `return` en F3) y se descuenta del nuevo.
 */
export async function changeDispatchLot(
  db: Executor,
  userId: string | null,
  input: { dispatchItemId: string; finishedLotId: string; reason: string },
  now: Date = new Date(),
) {
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new UserError("Contá por qué se cambia el lote.", { reason: ["Motivo obligatorio"] });
  const [item] = await db
    .select()
    .from(schema.dispatchItems)
    .where(eq(schema.dispatchItems.id, input.dispatchItemId));
  if (!item) throw new UserError("La línea del remito no existe.");
  const d = await lockDispatch(db, item.dispatchId);
  if (d.status !== "prepared")
    throw new UserError(
      `El remito ${formatDispatchNumber(d.number)} está ${DISPATCH_STATUS_TEXT[d.status]}: solo se cambia el lote de un remito preparado.`,
    );
  if (item.finishedLotId === input.finishedLotId)
    throw new UserError("Esa línea ya tiene ese lote.", { finishedLotId: ["Elegí otro lote"] });
  const lot = await db.query.finishedLots.findFirst({
    where: eq(schema.finishedLots.id, input.finishedLotId),
  });
  if (!lot) throw new UserError("El lote no existe.");
  if (lot.onHold) throw new UserError(`El lote ${lot.code} está retenido por calidad.`);

  // Stock del lote elegido para ese producto en F3/F4 (primero donde más hay).
  const locationIds = await dispatchLocationIds(db);
  const positions = (await finishedLotBalances(db, item.productId, { locationIds }))
    .filter((b) => b.finishedLotId === lot.id)
    .sort((a, b) => b.qty - a.qty);
  const available = positions.reduce((a, b) => a + b.qty, 0);
  if (available < item.qtyUnits)
    throw new UserError(
      `El lote ${lot.code} tiene ${available} u. en F3/F4: no alcanza para las ${item.qtyUnits} u. de la línea.`,
      { finishedLotId: ["Stock insuficiente"] },
    );
  const takes: { locationId: string; qty: number }[] = [];
  let left = item.qtyUnits;
  for (const p of positions) {
    if (left <= 0) break;
    const qty = Math.min(left, p.qty);
    takes.push({ locationId: p.locationId, qty });
    left -= qty;
  }

  const oldLot = await db.query.finishedLots.findFirst({
    where: eq(schema.finishedLots.id, item.finishedLotId),
  });
  const f3 = await locationByCode(db, "F3");
  const note = `Cambio de lote del remito ${formatDispatchNumber(d.number)}: ${reason}`;
  await recordProductMovements(db, userId, [
    {
      type: "return",
      productId: item.productId,
      finishedLotId: item.finishedLotId,
      locationId: f3.id,
      qty: item.qtyUnits,
      refTable: "dispatches",
      refId: d.id,
      note: `${note} (vuelve ${oldLot?.code ?? "el lote anterior"})`,
      occurredAt: now,
    },
    ...takes.map((t) => ({
      type: "dispatch" as const,
      productId: item.productId,
      finishedLotId: lot.id,
      locationId: t.locationId,
      qty: -t.qty,
      refTable: "dispatches",
      refId: d.id,
      note,
      occurredAt: now,
    })),
  ]);
  await db
    .update(schema.dispatchItems)
    .set({ finishedLotId: lot.id, lotChangeReason: reason })
    .where(eq(schema.dispatchItems.id, item.id));
  return { id: item.id, dispatchId: d.id, lotCode: lot.code };
}

/** Lotes con stock en F3/F4 entre los que se puede cambiar una línea del remito (RF-25). */
export async function dispatchLotOptions(db: Executor, productId: string) {
  const locationIds = await dispatchLocationIds(db);
  const balances = await finishedLotBalances(db, productId, { locationIds });
  const byLot = new Map<
    string,
    { finishedLotId: string; code: string; expiryDate: IsoDate; available: number }
  >();
  for (const b of balances) {
    if (!b.finishedLotId) continue;
    const cur = byLot.get(b.finishedLotId);
    if (cur) cur.available += b.qty;
    else
      byLot.set(b.finishedLotId, {
        finishedLotId: b.finishedLotId,
        code: b.code,
        expiryDate: b.expiryDate,
        available: b.qty,
      });
  }
  return [...byLot.values()].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}
export type DispatchLotOption = Awaited<ReturnType<typeof dispatchLotOptions>>[number];

/**
 * Rechazo total en la entrega: el stock vuelve a cada lote en F3 (movimiento `return`) y el remito
 * queda rechazado. El pedido vuelve a "listo" solo si el dominio permite esa transición; si no
 * (hoy el estado no retrocede) queda "despachado" y el motivo se anota en su historial.
 */
export async function rejectDispatch(
  db: Executor,
  userId: string | null,
  input: { dispatchId: string; reason: string; receivedByName?: string | null },
  now: Date = new Date(),
) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new UserError("Contá por qué se rechazó.", { reason: ["Requerido"] });
  const d = await lockDispatch(db, input.dispatchId);
  if (d.status !== "prepared")
    throw new UserError(
      `El remito ${formatDispatchNumber(d.number)} está ${DISPATCH_STATUS_TEXT[d.status]}: solo se rechaza un remito preparado.`,
    );
  const items = await db.select().from(schema.dispatchItems).where(eq(schema.dispatchItems.dispatchId, d.id));
  const f3 = await locationByCode(db, "F3");
  await recordProductMovements(
    db,
    userId,
    items.map((i) => ({
      type: "return" as const,
      productId: i.productId,
      finishedLotId: i.finishedLotId,
      locationId: f3.id,
      qty: i.qtyUnits,
      refTable: "dispatches",
      refId: d.id,
      note: `Rechazo del remito ${formatDispatchNumber(d.number)}: ${reason}`,
      occurredAt: now,
    })),
  );
  await db
    .update(schema.dispatches)
    .set({ status: "rejected", notes: reason, receivedByName: input.receivedByName ?? null })
    .where(eq(schema.dispatches.id, d.id));

  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, d.orderId) });
  if (order) {
    const note = `Entrega rechazada (remito ${formatDispatchNumber(d.number)}): ${reason}. Stock devuelto.`;
    if (canTransition(order.status, "ready"))
      await changeOrderStatus(db, userId, { id: order.id, to: "ready", note }, now);
    else
      await db.insert(schema.orderEvents).values({
        orderId: order.id,
        status: order.status,
        at: now,
        byId: userId,
        note: `${note} El pedido sigue despachado.`,
      });
  }
  await markRouteStopDone(db, d, now);
  return { id: d.id, number: d.number, orderId: d.orderId };
}

/** Remito para imprimir. */
export async function getDispatch(db: Executor, id: string) {
  const d = await db.query.dispatches.findFirst({
    where: eq(schema.dispatches.id, id),
    with: {
      customer: { with: { zone: true } },
      order: true,
      route: { with: { vehicle: true, driver: true } },
      responsible: true,
      items: { with: { product: true, lot: true } },
    },
  });
  if (!d) return null;
  const items = [...d.items]
    .sort(
      (a, b) =>
        a.product.name.localeCompare(b.product.name, "es") ||
        a.lot.expiryDate.localeCompare(b.lot.expiryDate),
    )
    .map((i) => ({
      id: i.id,
      productName: i.product.name,
      lotCode: i.lot.code,
      expiryDate: i.lot.expiryDate,
      productId: i.productId,
      finishedLotId: i.finishedLotId,
      qtyUnits: i.qtyUnits,
      qtyDelivered: i.qtyDelivered,
      lotChangeReason: i.lotChangeReason,
      kg: roundQty(i.qtyUnits * i.product.netWeightKg),
    }));
  return {
    ...d,
    items,
    totalUnits: items.reduce((a, i) => a + i.qtyUnits, 0),
    /** Unidades realmente entregadas (RF-25): igual al total salvo entrega parcial. */
    deliveredUnits: items.reduce((a, i) => a + (i.qtyDelivered ?? i.qtyUnits), 0),
    totalKg: roundQty(items.reduce((a, i) => a + i.kg, 0)),
  };
}
export type DispatchDetail = NonNullable<Awaited<ReturnType<typeof getDispatch>>>;

// ------------------------------------------------------------------------------------------------
// RF-27: costo por ruta y por kg
// ------------------------------------------------------------------------------------------------

export interface RouteCostRow {
  id: string;
  date: IsoDate;
  driverName: string | null;
  vehicleName: string | null;
  plate: string | null;
  km: number;
  hours: number;
  /** kg entregados (remitos entregados). */
  kg: number;
  deliveries: number;
  fuel: number;
  labor: number;
  other: number;
  cost: number;
  costPerKg: number | null;
  /** Ruta chica: menos de 50 kg entregados. */
  small: boolean;
  /** RF-27: costo parcial, falta el costo por km del vehículo o el costo hora del chofer. */
  partial: boolean;
  missing: CostGap[];
}

/** Costo de las rutas cerradas entre dos fechas: km, horas, kg entregados, costo y costo/kg. */
export async function listRouteCosts(
  db: Executor,
  f: { from: IsoDate; to: IsoDate },
): Promise<RouteCostRow[]> {
  const routes = await db.query.routes.findMany({
    where: and(
      eq(schema.routes.status, "done"),
      gte(schema.routes.date, f.from),
      lte(schema.routes.date, f.to),
    ),
    orderBy: [desc(schema.routes.date), desc(schema.routes.createdAt)],
    with: { driver: true, vehicle: true },
  });
  if (!routes.length) return [];
  const ids = routes.map((r) => r.id);
  const delivered = await db
    .select({
      routeId: schema.dispatches.routeId,
      kg: sql<number>`coalesce(sum(coalesce(${schema.dispatchItems.qtyDelivered}, ${schema.dispatchItems.qtyUnits}) * ${schema.products.netWeightKg}), 0)`.mapWith(
        Number,
      ),
      deliveries: sql<number>`count(distinct ${schema.dispatches.id})::int`,
    })
    .from(schema.dispatchItems)
    .innerJoin(schema.dispatches, eq(schema.dispatches.id, schema.dispatchItems.dispatchId))
    .innerJoin(schema.products, eq(schema.products.id, schema.dispatchItems.productId))
    .where(and(inArray(schema.dispatches.routeId, ids), eq(schema.dispatches.status, "delivered")))
    .groupBy(schema.dispatches.routeId);
  const byRoute = new Map(delivered.map((d) => [d.routeId, d]));
  // Sin costo hora configurado la mano de obra no se estima (cuenta 0) y la ruta queda como costo parcial.
  const configuredHourly = await getSetting<number | null>("delivery.driver_hourly_cost", null);
  const driverHourlyCost = configuredHourly != null && configuredHourly > 0 ? configuredHourly : 0;

  return routes.map((r) => {
    const kmStart = r.kmStart ?? 0;
    const kmEnd = r.kmEnd ?? kmStart;
    const hours = r.startedAt && r.endedAt ? routeHours(r.startedAt, r.endedAt) : 0;
    const costPerKm = r.vehicle?.costPerKm ?? 0;
    const { km, total } = routeCost({
      kmStart,
      kmEnd,
      costPerKm,
      hours,
      driverHourlyCost,
      ...(r.fuelCost != null ? { fuelCost: r.fuelCost } : {}),
      otherCosts: r.otherCosts ?? 0,
    });
    const d = byRoute.get(r.id);
    const kg = roundQty(d?.kg ?? 0);
    return {
      id: r.id,
      date: r.date,
      driverName: r.driver?.name ?? null,
      vehicleName: r.vehicle?.name ?? null,
      plate: r.vehicle?.plate ?? null,
      km,
      hours,
      kg,
      deliveries: d?.deliveries ?? 0,
      fuel: roundMoney(r.fuelCost ?? km * costPerKm),
      labor: roundMoney(hours * driverHourlyCost),
      other: roundMoney(r.otherCosts ?? 0),
      cost: total,
      costPerKg: costPerKgDelivered(total, kg),
      small: isSmallRoute(kg),
      ...costGaps(
        missingCostInputs({
          km,
          hours,
          costPerKm: r.vehicle?.costPerKm ?? null,
          hasRealFuelCost: r.fuelCost != null,
          driverHourlyCost: configuredHourly,
        }),
      ),
    };
  });
}

const costGaps = (missing: CostGap[]) => ({ partial: missing.length > 0, missing });

export interface DeliveryCostSummary {
  routes: number;
  km: number;
  hours: number;
  kg: number;
  cost: number;
  /** Costo de reparto por kg entregado; null si no se entregó nada. */
  costPerKg: number | null;
}

/** Rango [primer día, último día] de un mes "YYYY-MM". */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UserError("Mes inválido (usá AAAA-MM).");
  const from = `${month}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

export function summarizeCosts(rows: RouteCostRow[]): DeliveryCostSummary {
  const sum = (f: (r: RouteCostRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const kg = roundQty(sum((r) => r.kg));
  const cost = roundMoney(sum((r) => r.cost));
  return {
    routes: rows.length,
    km: roundQty(sum((r) => r.km)),
    hours: Math.round(sum((r) => r.hours) * 100) / 100,
    kg,
    cost,
    costPerKg: costPerKgDelivered(cost, kg),
  };
}

/** Resumen mensual del costo de reparto (lo consume el tablero M8). `month`: "YYYY-MM". */
export async function getDeliveryCostSummary(db: Executor, month: string): Promise<DeliveryCostSummary> {
  return summarizeCosts(await listRouteCosts(db, monthRange(month)));
}

// ------------------------------------------------------------------------------------------------
// RF-28: registro de despacho BPM
// ------------------------------------------------------------------------------------------------

export interface RegistryRow {
  id: string;
  dispatchId: string;
  dispatchNumber: number;
  date: IsoDate;
  dispatchedAt: Date;
  productId: string;
  productName: string;
  lotCode: string;
  expiryDate: IsoDate;
  qtyUnits: number;
  kg: number;
  destination: string;
  transport: string;
  plate: string | null;
  responsible: string | null;
  status: DispatchStatus;
}

/** Una fila por producto y lote despachado, tal como la planilla de papel (se completa sola). */
export async function listDispatchRegistry(db: Executor, f: RegistryFilters): Promise<RegistryRow[]> {
  const d = schema.dispatches;
  const day = sql`(${d.dispatchedAt} at time zone ${TZ})::date`;
  const rows = await db
    .select({
      id: schema.dispatchItems.id,
      dispatchId: d.id,
      dispatchNumber: d.number,
      dispatchedAt: d.dispatchedAt,
      status: d.status,
      productId: schema.products.id,
      productName: schema.products.name,
      netWeightKg: schema.products.netWeightKg,
      lotCode: schema.finishedLots.code,
      expiryDate: schema.finishedLots.expiryDate,
      qtyUnits: schema.dispatchItems.qtyUnits,
      customerName: schema.customers.legalName,
      address: schema.customers.address,
      vehicleName: schema.vehicles.name,
      plate: schema.vehicles.plate,
      responsible: schema.users.name,
    })
    .from(schema.dispatchItems)
    .innerJoin(d, eq(d.id, schema.dispatchItems.dispatchId))
    .innerJoin(schema.products, eq(schema.products.id, schema.dispatchItems.productId))
    .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.dispatchItems.finishedLotId))
    .innerJoin(schema.customers, eq(schema.customers.id, d.customerId))
    .leftJoin(schema.routes, eq(schema.routes.id, d.routeId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.routes.vehicleId))
    .leftJoin(schema.users, eq(schema.users.id, d.responsibleId))
    .where(
      and(
        sql`${d.status} <> 'cancelled'`,
        sql`${day} >= ${f.from}::date`,
        sql`${day} <= ${f.to}::date`,
        f.productId ? eq(schema.products.id, f.productId) : undefined,
      ),
    )
    .orderBy(
      asc(d.dispatchedAt),
      asc(d.number),
      asc(schema.products.name),
      asc(schema.finishedLots.expiryDate),
    );
  return rows.map((r) => ({
    id: r.id,
    dispatchId: r.dispatchId,
    dispatchNumber: r.dispatchNumber,
    date: toIsoDateAR(r.dispatchedAt),
    dispatchedAt: r.dispatchedAt,
    productId: r.productId,
    productName: r.productName,
    lotCode: r.lotCode,
    expiryDate: r.expiryDate,
    qtyUnits: r.qtyUnits,
    kg: roundQty(r.qtyUnits * r.netWeightKg),
    destination: r.address ? `${r.customerName} — ${r.address}` : r.customerName,
    transport: r.vehicleName ? `${r.vehicleName} (${r.plate})` : "Sin vehículo",
    plate: r.plate,
    responsible: r.responsible,
    status: r.status,
  }));
}

/** Productos activos para el filtro del registro. */
export function registryProducts(db: Executor) {
  return db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products)
    .where(eq(schema.products.active, true))
    .orderBy(asc(schema.products.name));
}

/** Pedidos listos sin ruta (aviso en la pantalla principal). */
export async function readyOrdersWithoutRoute(db: Executor) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(eq(schema.orders.status, "ready"), notInOpenRoute));
  return row?.n ?? 0;
}

// ------------------------------------------------------------------------------------------------
// RF-27: costo de reparto por zona y por mes
// ------------------------------------------------------------------------------------------------

export interface ZoneCostRow {
  zoneId: string | null;
  zone: string;
  routes: number;
  deliveries: number;
  kg: number;
  /** Costo de las rutas repartido por los kg entregados en la zona. */
  cost: number;
  costPerKg: number | null;
  /** Alguna de las rutas que reparten en la zona tiene costo parcial. */
  partial: boolean;
}

/**
 * Costo de reparto por zona de un mes: el costo de cada ruta cerrada se reparte entre las zonas de sus
 * entregas en proporción a los kg entregados (una ruta que visita Rosario y Funes carga a cada zona su parte).
 * Las rutas sin entregas no se pueden repartir y se informan aparte.
 */
export async function costByZone(db: Executor, month: string) {
  const rows = await listRouteCosts(db, monthRange(month));
  const empty = { zones: [] as ZoneCostRow[], unallocatedCost: 0, unallocatedRoutes: 0 };
  if (!rows.length) return empty;
  const perZone = await db
    .select({
      routeId: schema.dispatches.routeId,
      zoneId: schema.customers.zoneId,
      zone: schema.zones.name,
      kg: sql<number>`coalesce(sum(coalesce(${schema.dispatchItems.qtyDelivered}, ${schema.dispatchItems.qtyUnits}) * ${schema.products.netWeightKg}), 0)`.mapWith(
        Number,
      ),
      deliveries: sql<number>`count(distinct ${schema.dispatches.id})::int`,
    })
    .from(schema.dispatchItems)
    .innerJoin(schema.dispatches, eq(schema.dispatches.id, schema.dispatchItems.dispatchId))
    .innerJoin(schema.products, eq(schema.products.id, schema.dispatchItems.productId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.dispatches.customerId))
    .leftJoin(schema.zones, eq(schema.zones.id, schema.customers.zoneId))
    .where(
      and(
        inArray(
          schema.dispatches.routeId,
          rows.map((r) => r.id),
        ),
        eq(schema.dispatches.status, "delivered"),
      ),
    )
    .groupBy(schema.dispatches.routeId, schema.customers.zoneId, schema.zones.name);

  const acc = new Map<string, ZoneCostRow>();
  let unallocatedCost = 0;
  let unallocatedRoutes = 0;
  for (const r of rows) {
    const parts = perZone.filter((z) => z.routeId === r.id && z.kg > 0);
    if (!parts.length) {
      unallocatedCost += r.cost;
      unallocatedRoutes += 1;
      continue;
    }
    const shares = allocateCostByKg(
      r.cost,
      parts.map((z) => ({ key: z.zoneId ?? "none", kg: z.kg })),
    );
    for (const z of parts) {
      const key = z.zoneId ?? "none";
      const share = shares.find((x) => x.key === key)!;
      const cur = acc.get(key) ?? {
        zoneId: z.zoneId,
        zone: z.zone ?? "Sin zona",
        routes: 0,
        deliveries: 0,
        kg: 0,
        cost: 0,
        costPerKg: null,
        partial: false,
      };
      cur.routes += 1;
      cur.deliveries += z.deliveries;
      cur.kg = roundQty(cur.kg + z.kg);
      cur.cost = roundMoney(cur.cost + share.cost);
      cur.partial = cur.partial || r.partial;
      acc.set(key, cur);
    }
  }
  const zones = [...acc.values()]
    .map((z) => ({ ...z, costPerKg: costPerKgDelivered(z.cost, z.kg) }))
    .sort((a, b) => (a.zoneId === null ? 1 : b.zoneId === null ? -1 : a.zone.localeCompare(b.zone, "es")));
  return { zones, unallocatedCost: roundMoney(unallocatedCost), unallocatedRoutes };
}

export interface MonthCostRow extends DeliveryCostSummary {
  month: string;
  /** Rutas del mes con costo parcial (falta el costo por km del vehículo o el costo hora del chofer). */
  partialRoutes: number;
}

/** Costo de reparto por mes: los `months` meses que terminan en `endMonth` ("YYYY-MM"), del más viejo al más nuevo. */
export async function costByMonth(db: Executor, endMonth: string, months = 6): Promise<MonthCostRow[]> {
  const keys = Array.from({ length: months }, (_, i) =>
    monthOf(addMonths(`${endMonth}-01`, i - (months - 1))),
  );
  const rows = await listRouteCosts(db, { from: `${keys[0]}-01`, to: monthRange(endMonth).to });
  return keys.map((month) => {
    const ofMonth = rows.filter((r) => r.date.startsWith(month));
    return { month, ...summarizeCosts(ofMonth), partialRoutes: ofMonth.filter((r) => r.partial).length };
  });
}
