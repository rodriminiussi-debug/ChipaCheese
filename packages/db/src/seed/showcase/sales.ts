import { addDays, diffDays, isoWeekday, roundMoney, roundQty, type IsoDate } from "@chipa/domain";
import { at, clock, dateOf, isWorkday, nextWorkday, plusMin, prevWorkday, shiftHoliday } from "./calendar";
import {
  PERIOD_START,
  SIM_START,
  TODAY,
  nextNumber,
  stamp,
  type Ctx,
  type SimCustomer,
  type SimOrder,
} from "./ctx";
import { allocateFinished, moveProduct } from "./stock";

/**
 * Ventas: pedidos por cliente según su frecuencia, remitos FEFO, rutas por zona (km, horas, combustible,
 * temperatura del equipo de frío), facturas con vencimiento según plazo y cobros (efectivo, transferencia,
 * cheques; deudores y un cheque rechazado).
 */

const ZONE_DAYS: Record<string, number[]> = { rosario: [1, 3, 5], funes: [2], pesther: [4] };
const ZONE_BASE_KM: Record<string, number> = { rosario: 34, funes: 58, pesther: 52 };
const ZONE_EXTRA_HOURS: Record<string, number> = { rosario: 0, funes: 0.9, pesther: 0.8 };

/** Historial de listas de precios (los vigentes desde el 01/09 son los de los maestros). */
const PRICE_STEPS: Record<string, Record<"bag" | "bulk", [IsoDate, number][]>> = {
  mayorista: {
    bag: [
      ["2026-07-01", 4100],
      ["2026-08-01", 4150],
    ],
    bulk: [
      ["2026-07-01", 38_800],
      ["2026-08-01", 39_400],
    ],
  },
  super: {
    bag: [
      ["2026-07-01", 3800],
      ["2026-08-01", 3850],
    ],
    bulk: [
      ["2026-07-01", 35_800],
      ["2026-08-01", 36_400],
    ],
  },
  local: {
    bag: [
      ["2026-07-01", 4650],
      ["2026-08-01", 4725],
    ],
    bulk: [
      ["2026-07-01", 44_500],
      ["2026-08-01", 45_200],
    ],
  },
};
const CURRENT_PRICE: Record<string, { bag: number; bulk: number }> = {
  mayorista: { bag: 4200, bulk: 40_000 },
  super: { bag: 3900, bulk: 37_000 },
  local: { bag: 4800, bulk: 46_000 },
};

export const PRICE_HISTORY_ROWS = (productKeys: string[]) =>
  Object.entries(PRICE_STEPS).flatMap(([list, steps]) =>
    productKeys.flatMap((p) => {
      const kind = p.endsWith("5k") ? "bulk" : "bag";
      return steps[kind].map(([validFrom, price]) => ({ list, product: p, validFrom, price }));
    }),
  );

export function listPrice(list: string, product: string, date: IsoDate): number {
  const kind = product.endsWith("5k") ? "bulk" : "bag";
  const steps = PRICE_STEPS[list]![kind];
  let price = steps[0]![1];
  for (const [from, p] of steps) if (date >= from) price = p;
  if (date >= "2026-09-01") price = CURRENT_PRICE[list]![kind];
  return price;
}

const volumeScale = (d: IsoDate) => (d < "2026-08-01" ? 1.22 : d < "2026-09-01" ? 1.0 : 1.12);

// --- Fechas de entrega ------------------------------------------------------------------------------------

export function deliveryDays(c: SimCustomer): number[] {
  return c.weekdays.length ? c.weekdays : ZONE_DAYS[c.zone]!;
}

/** Primera fecha de entrega del cliente estrictamente posterior a `after`. */
export function nextDeliveryDate(c: SimCustomer, after: IsoDate): IsoDate {
  const days = deliveryDays(c);
  for (let i = 1; i <= 21; i++) {
    const nominal = addDays(after, i);
    if (!days.includes(isoWeekday(nominal))) continue;
    const real = shiftHoliday(nominal);
    if (real > after) return real;
  }
  return addDays(after, 7);
}

// --- Generación de pedidos ---------------------------------------------------------------------------------------------

const ORDER_NOTES = [
  "Entregar antes de las 10",
  "Pasar por el depósito del fondo",
  "Piden factura A",
  "Reponen por el fin de semana largo",
  "Llamar antes de llegar",
  "Hay que dejarlo en el freezer del local",
];

const HORIZON: IsoDate = "2026-10-12";

export function generateOrders(ctx: Ctx) {
  const rng = ctx.rng;
  for (const c of ctx.customers) {
    // Primera entrega: a partir del 01/07 (o del alta del cliente).
    let target = nextDeliveryDate(
      c,
      addDays(
        c.start ? (c.start < PERIOD_START ? PERIOD_START : c.start) : PERIOD_START,
        rng.int(-1, c.intervalDays - 2),
      ),
    );
    if (target < PERIOD_START) target = nextDeliveryDate(c, addDays(PERIOD_START, -1));
    while (target <= HORIZON) {
      const lead = rng.weighted([
        [1, 0.6],
        [2, 0.28],
        [3, 0.12],
      ] as const);
      let received = addDays(target, -lead);
      while (!isWorkday(received) && !(isoWeekday(received) === 6 && rng.chance(0.5)))
        received = addDays(received, -1);
      if (received < SIM_START) received = SIM_START;
      const stopped = c.stop != null && received > c.stop;
      if (!stopped) {
        const o = buildOrder(ctx, c, received, target);
        if (o) ctx.orders.push(o);
      }
      if (stopped) break;
      if (deliveryDays(c).length === 1) {
        // Un solo día de entrega por semana: el intervalo se reparte entre 1, 2 y 3 semanas.
        const weeks =
          c.intervalDays <= 7
            ? 1
            : c.intervalDays >= 14
              ? rng.chance(0.85)
                ? 2
                : 3
              : rng.chance((14 - c.intervalDays) / 7)
                ? 1
                : 2;
        target = nextDeliveryDate(c, addDays(target, weeks * 7 - 1));
      } else {
        const step = Math.max(1, Math.round(c.intervalDays * rng.range(0.9, 1.15)));
        target = nextDeliveryDate(c, addDays(target, step - 1));
      }
    }
  }
  specialOrders(ctx);
  ctx.orders.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

function buildOrder(ctx: Ctx, c: SimCustomer, received: IsoDate, promised: IsoDate): SimOrder | null {
  const rng = ctx.rng;
  const scale = volumeScale(promised);
  const items: SimOrder["items"] = [];
  for (const mix of c.mix) {
    if (!rng.chance(mix.prob)) continue;
    const base = rng.range(mix.min, mix.max) * (mix.step >= 5 ? scale : 1);
    const qty = Math.max(mix.min > 0 ? mix.step : 0, Math.round(base / mix.step) * mix.step);
    if (qty <= 0) continue;
    items.push({ product: mix.product, qty, price: listPrice(c.priceList, mix.product, received) });
  }
  if (items.length === 0) {
    const m = c.mix[0]!;
    items.push({
      product: m.product,
      qty: Math.max(m.step, m.min),
      price: listPrice(c.priceList, m.product, received),
    });
  }
  const hour = rng.int(8, 17);
  const minute = rng.int(0, 59);
  let receivedAt = at(received, clock(hour * 60 + minute));
  if (received === TODAY && hour > 10) receivedAt = at(received, clock(8 * 60 + rng.int(5, 140)));
  const source = rng.weighted([
    ["whatsapp", 0.68],
    ["phone", 0.16],
    ["visit", 0.12],
    ["other", 0.04],
  ] as const);
  const createdBy = rng.chance(0.85) ? "af" : "nahuel";
  const o: SimOrder = {
    id: rng.uuid(),
    customer: c,
    receivedAt,
    promised,
    items,
    total: 0,
    source,
    notes: rng.chance(0.1) ? rng.pick(ORDER_NOTES) : null,
    createdBy,
    state: "open",
    events: [],
    kg: 0,
  };
  recomputeTotals(ctx, o);
  // Una parte de los pedidos sale con un día de atraso (ruta completa o falta de producto).
  if (rng.chance(0.055) && promised < "2026-09-24") o.holdUntil = nextDeliveryDate(c, promised);
  return o;
}

function recomputeTotals(ctx: Ctx, o: SimOrder) {
  o.total = roundMoney(o.items.reduce((a, i) => a + i.qty * i.price, 0));
  o.kg = roundQty(o.items.reduce((a, i) => a + i.qty * ctx.products[i.product]!.weightKg, 0));
}

/** Casos puntuales para la demostración: pedido grande, cancelados y el pedido atrasado de hoy. */
function specialOrders(ctx: Ctx) {
  const rng = ctx.rng;
  // Pedido grande de La Reina (promoción de aniversario): ~700 bolsas = 350 kg, casi tres días de capacidad.
  const big = ctx.orders
    .filter((o) => o.customer.key === "lareina" && o.promised >= "2026-08-24" && o.promised <= "2026-08-31")
    .sort((a, b) => a.promised.localeCompare(b.promised))[0];
  if (big) {
    big.items = [
      {
        product: "tap500",
        qty: 320,
        price: listPrice("super", "tap500", big.receivedAt.toISOString().slice(0, 10)),
      },
      {
        product: "len500",
        qty: 280,
        price: listPrice("super", "len500", big.receivedAt.toISOString().slice(0, 10)),
      },
      {
        product: "sur500",
        qty: 100,
        price: listPrice("super", "sur500", big.receivedAt.toISOString().slice(0, 10)),
      },
    ];
    big.notes = "Promoción de aniversario del supermercado: pedido especial de 350 kg";
    big.big = true;
    big.holdUntil = undefined;
    big.receivedAt = at(addDays(big.promised, -6), "10:20");
    recomputeTotals(ctx, big);
  }
  // Pedidos cancelados por el cliente.
  const cancellable = ctx.orders.filter(
    (o) =>
      o.customer.channel === "reseller" && o.promised >= "2026-08-05" && o.promised <= "2026-09-20" && !o.big,
  );
  for (const n of [11, 37]) {
    const o = cancellable[n % cancellable.length];
    if (!o) continue;
    o.state = "cancelled";
    o.events.push({
      status: "cancelled",
      at: plusMin(o.receivedAt, 380),
      by: "af",
      note: rng.pick(["El cliente canceló: tiene stock suficiente", "Se cayó el evento del club"]),
    });
  }
  // Pedido atrasado de hoy: el comercio estaba cerrado el miércoles 30/09 y se reprograma para la ruta de hoy.
  const late = ctx.orders.find((o) => o.customer.key === "donpepe" && o.promised === "2026-09-30");
  if (late) late.holdUntil = TODAY;
}

// --- Ruta del día ----------------------------------------------------------------------------------------------------------------

const fuelPrice = (d: IsoDate) => Math.round(1480 * 1.025 ** (diffDays(d, "2026-07-01") / 30));

interface Allocation {
  pos: { qty: number; loc: "f3" | "f4" | "local"; lot: { id: string } };
  qty: number;
  product: string;
}

function tryAllocate(ctx: Ctx, o: SimOrder): Allocation[] | null {
  const all: Allocation[] = [];
  for (const it of o.items) {
    const a = allocateFinished(ctx, it.product, it.qty, ["f3", "f4"]);
    if (!a) return null;
    all.push(...a.map((x) => ({ ...x, product: it.product })));
  }
  return all;
}

const zoneOrder = (z: string) => ["rosario", "funes", "pesther"].indexOf(z);

/** Orden de las paradas: por zona y, dentro de la zona, por cliente (estable). */
function sortStops(orders: SimOrder[]) {
  return [...orders].sort(
    (a, b) =>
      zoneOrder(a.customer.zone) - zoneOrder(b.customer.zone) ||
      a.customer.name.localeCompare(b.customer.name, "es"),
  );
}

function routeNumbers(ctx: Ctx, day: IsoDate, zones: Set<string>, deliveries: number, pickup: boolean) {
  const rng = ctx.rng;
  let km = 0;
  let hours = 2.4;
  [...zones].sort().forEach((z, i) => {
    km += ZONE_BASE_KM[z]! * (i === 0 ? 1 : 0.55);
    hours += ZONE_EXTRA_HOURS[z]!;
  });
  km += deliveries * 2.6 + (pickup ? 9 : 0);
  hours += deliveries * 0.33 + (pickup ? 0.6 : 0);
  if (deliveries === 0) {
    km = 24 + rng.range(0, 6);
    hours = 2.1;
  }
  km = Math.round(km * rng.range(0.94, 1.07));
  hours = Math.round(Math.min(7.5, Math.max(2, hours * rng.range(0.92, 1.1))) * 4) / 4;
  const liters = Math.round(km * 0.135 * rng.range(0.95, 1.06) * 10) / 10;
  return { km, hours, liters, fuelCost: Math.round(liters * fuelPrice(day)) };
}

/**
 * Despacha el día: genera los remitos FEFO de los pedidos que corresponden (y de los que quedaron atrasados),
 * arma la ruta cerrada con sus costos y deja los pedidos entregados. Devuelve el cierre de la ruta.
 */
export function dispatchDay(ctx: Ctx, day: IsoDate, opts: { pickupSupplier?: boolean } = {}): Date | null {
  if (day >= TODAY) return null;
  const rng = ctx.rng;
  const due = sortStops(
    ctx.orders.filter(
      (o) =>
        o.state === "open" &&
        o.promised <= day &&
        (!o.holdUntil || o.holdUntil <= day) &&
        o.receivedAt <= at(day, "07:00"),
    ),
  );
  const loaded: { order: SimOrder; allocations: Allocation[] }[] = [];
  for (const o of due) {
    const allocations = tryAllocate(ctx, o);
    if (!allocations) continue;
    // Reserva el stock de este pedido antes de pasar al siguiente.
    for (const a of allocations) a.pos.qty -= a.qty;
    loaded.push({ order: o, allocations });
  }
  const pickup = !!opts.pickupSupplier;
  if (loaded.length === 0 && !pickup) return null;

  const zones = new Set(loaded.map((l) => l.order.customer.zone));
  const nums = routeNumbers(ctx, day, zones, loaded.length, pickup);
  const routeId = rng.uuid();
  const start = plusMin(at(day, "08:50"), rng.int(0, 22));
  const end = plusMin(start, Math.round(nums.hours * 60));
  const kmStart = ctx.odometer + rng.int(0, 12);
  const kmEnd = kmStart + nums.km;
  ctx.odometer = kmEnd;
  const coldTemp = day === "2026-08-25" ? -16.8 : Math.round(rng.gauss(-20.6, 0.8) * 10) / 10;
  const coldAction =
    day === "2026-08-25"
      ? "Alarma del equipo de frío durante el reparto: se cortó el ciclo de descongelado y se verificó la carga (producto firme)."
      : null;
  ctx.routeEnd[day] = end;
  const other = rng.chance(0.1) ? rng.int(25, 60) * 100 : 0;
  ctx.buf.routes.push({
    id: routeId,
    date: day,
    driverId: ctx.users.padre!,
    vehicleId: ctx.vehicleId,
    status: "done",
    kmStart,
    kmEnd,
    startedAt: start,
    endedAt: end,
    fuelLiters: nums.liters,
    fuelCost: nums.fuelCost,
    otherCosts: other,
    coldUnitTempC: Math.min(coldTemp, day === "2026-08-25" ? -16.8 : -18.3),
    notes: day === "2026-08-25" ? coldAction : other ? "Estacionamiento y peaje" : null,
    ...stamp(at(day, "07:40")),
  });

  let seq = 1;
  const deliveryWindow = (nums.hours - (pickup ? 0.9 : 0.4)) * 60;
  loaded.forEach(({ order: o, allocations }, i) => {
    const dispatchId = rng.uuid();
    const dispatchedAt = plusMin(at(day, "08:20"), i * 3);
    const deliveredAt = plusMin(start, Math.round(((i + 1) / (loaded.length + 1)) * deliveryWindow) + 10);
    ctx.buf.routeStops.push({
      routeId,
      seq: seq++,
      kind: "delivery",
      orderId: o.id,
      customerId: o.customer.id,
      doneAt: deliveredAt,
      ...stamp(at(day, "07:45")),
    });
    const late = o.promised < day;
    ctx.buf.dispatches.push({
      id: dispatchId,
      routeId,
      orderId: o.id,
      customerId: o.customer.id,
      status: "delivered",
      dispatchedAt,
      deliveredAt,
      responsibleId: ctx.users.padre!,
      receivedByName: rng.pick(o.customer.contacts),
      notes: late ? "Entrega con atraso respecto de la fecha comprometida." : null,
      ...stamp(dispatchedAt),
    });
    for (const a of allocations) {
      ctx.buf.dispatchItems.push({
        dispatchId,
        productId: ctx.products[a.product]!.id,
        finishedLotId: a.pos.lot.id,
        qtyUnits: a.qty,
        ...stamp(dispatchedAt),
      });
      moveProduct(ctx, {
        at: dispatchedAt,
        type: "dispatch",
        product: a.product,
        lotId: a.pos.lot.id,
        loc: a.pos.loc,
        qty: -a.qty,
        refTable: "dispatches",
        refId: dispatchId,
        by: ctx.users.padre!,
      });
    }
    o.events.push(
      { status: "ready", at: at(day, "07:55"), by: "af" },
      { status: "dispatched", at: dispatchedAt, by: "padre", note: "Remito generado al cargar el vehículo" },
      { status: "delivered", at: deliveredAt, by: "padre", note: `Recibió ${rng.pick(o.customer.contacts)}` },
    );
    o.state = "delivered";
    o.deliveredAt = deliveredAt;
    o.deliveredDate = day;
    o.dispatchId = dispatchId;
    o.routeId = routeId;
  });
  if (pickup) {
    ctx.buf.routeStops.push({
      routeId,
      seq: seq++,
      kind: "supplier_pickup",
      supplierId: ctx.supplierId.leopelle!,
      notes: "Retiro semanal de fécula, quesos y sal",
      doneAt: plusMin(end, -35),
      ...stamp(at(day, "07:45")),
    });
  }
  // Temperatura del equipo de frío medida al cerrar la ruta.
  ctx.buf.temperatureLogs.push({
    equipmentId: ctx.refs.equipment.vehiculo!,
    date: day,
    measuredAt: end,
    valueC: Math.min(coldTemp, day === "2026-08-25" ? -16.8 : -18.3),
    outOfRange: day === "2026-08-25",
    userId: ctx.users.padre!,
    source: "manual",
    lateEntry: false,
    correctiveAction: coldAction,
    ...stamp(end),
  });
  return end;
}

/** Ruta planificada para hoy: pedidos listos esperando que el chofer cargue el vehículo. */
export function planTodayRoute(ctx: Ctx) {
  const rng = ctx.rng;
  const due = sortStops(
    ctx.orders.filter(
      (o) =>
        o.state === "open" &&
        o.promised <= TODAY &&
        (!o.holdUntil || o.holdUntil <= TODAY) &&
        o.receivedAt <= at(TODAY, "07:30"),
    ),
  );
  if (due.length === 0) return;
  const routeId = rng.uuid();
  ctx.buf.routes.push({
    id: routeId,
    date: TODAY,
    driverId: ctx.users.padre!,
    vehicleId: ctx.vehicleId,
    status: "planned",
    notes: "Incluye el pedido atrasado de Rotisería Don Pepe (estaba cerrado el miércoles).",
    ...stamp(at(TODAY, "07:35")),
  });
  due.forEach((o, i) => {
    ctx.buf.routeStops.push({
      routeId,
      seq: i + 1,
      kind: "delivery",
      orderId: o.id,
      customerId: o.customer.id,
      ...stamp(at(TODAY, "07:40")),
    });
    // El pedido atrasado ya estaba listo desde el día prometido; el resto se prepara hoy.
    const readyAt = o.promised < TODAY ? at(o.promised, "07:55") : at(TODAY, "07:50");
    o.events.push({ status: "ready", at: readyAt, by: "af" });
  });
}

// --- Facturas y cobros -----------------------------------------------------------------------------------------------------------------

const BANKS = [
  "Banco Macro",
  "Banco Santander",
  "Banco Nación",
  "Banco Galicia",
  "Banco Credicoop",
  "Banco Patagonia",
];

interface PlannedPayment {
  customer: SimCustomer;
  invoiceIds: string[];
  date: IsoDate;
  amount: number;
  method: "cash" | "transfer" | "check";
  routeId: string | null;
  cashDate?: IsoDate;
  bounced?: boolean;
}

export function finalizeSales(ctx: Ctx) {
  const rng = ctx.rng;
  const delivered = ctx.orders
    .filter((o) => o.state === "delivered")
    .sort((a, b) => a.deliveredAt!.getTime() - b.deliveredAt!.getTime());

  // 1) Facturas ---------------------------------------------------------------------------------------------------
  for (const o of delivered) {
    const c = o.customer;
    const sameDay = c.terms === 0 || c.invoiceB || rng.chance(0.4);
    let issue = o.deliveredDate!;
    if (!sameDay) issue = nextWorkday(issue);
    if (issue > TODAY) continue;
    const type = c.invoiceB ? "B" : "A";
    const number = nextNumber(ctx, `sinv-${type}`, type === "A" ? 1260 : 340);
    const net = o.total;
    const vat = roundMoney(net * 0.21);
    const id = rng.uuid();
    const issuedAt = at(issue, clock(10 * 60 + rng.int(0, 240)));
    ctx.buf.salesInvoices.push({
      id,
      customerId: c.id,
      orderId: o.id,
      invoiceType: type,
      pointOfSale: "0002",
      number: String(number).padStart(8, "0"),
      issueDate: issue,
      dueDate: addDays(issue, c.terms),
      netTotal: net,
      vatTotal: vat,
      total: roundMoney(net + vat),
      cae: String(rng.int(70_000_000, 79_999_999)) + String(rng.int(100_000, 999_999)),
      status: "confirmed",
      source: "manual",
      ...stamp(issuedAt),
    });
    o.invoiceId = id;
    ctx.invoices.push({
      id,
      orderId: o.id,
      customerKey: c.key,
      issueDate: issue,
      dueDate: addDays(issue, c.terms),
      total: roundMoney(net + vat),
      paidFully: false,
    });
    o.events.push({
      status: "invoiced",
      at: issuedAt,
      by: "nahuel",
      note: `Factura ${type} 0002-${String(number).padStart(8, "0")}`,
    });
  }
  creditNote(ctx);

  // 2) Cobros --------------------------------------------------------------------------------------------------------------
  const payments: PlannedPayment[] = [];
  for (const c of ctx.customers) planPayments(ctx, c, payments);
  let checkSeq = 45_879_600;
  let transferSeq = 118_400;
  for (const p of payments.sort((a, b) => a.date.localeCompare(b.date))) {
    if (p.date > TODAY) continue;
    const id = rng.uuid();
    const routeId = p.routeId;
    ctx.buf.customerPayments.push({
      id,
      customerId: p.customer.id,
      date: p.date,
      amount: p.amount,
      method: p.method,
      routeId,
      receivedById: ctx.users[routeId ? "padre" : "nahuel"]!,
      reference:
        p.method === "transfer" ? `Transferencia ${++transferSeq}` : p.method === "check" ? null : null,
      notes: null,
      ...stamp(at(p.date, "12:30")),
    });
    let rejected = false;
    if (p.method === "check") {
      const cashDate = p.cashDate!;
      const daysAgo = diffDays(TODAY, cashDate);
      let status: "in_portfolio" | "deposited" | "cashed" | "rejected" =
        daysAgo < 0
          ? "in_portfolio"
          : daysAgo <= 1
            ? rng.chance(0.5)
              ? "in_portfolio"
              : "deposited"
            : daysAgo <= 4
              ? "deposited"
              : "cashed";
      if (p.bounced && daysAgo > 4) {
        status = "rejected";
        rejected = true;
      }
      if (p.customer.key === "lareina" && cashDate === "2026-09-30") status = "in_portfolio";
      const bank = p.customer.key === "lareina" ? "Banco Macro" : BANKS[(checkSeq + 3) % BANKS.length]!;
      ctx.buf.checks.push({
        paymentId: id,
        bank,
        number: String(++checkSeq),
        issuer: p.customer.name,
        amount: p.amount,
        issueDate: p.date,
        cashDate,
        status,
        notes: rejected ? "Rechazado por falta de fondos. Se le reclamó al cliente." : null,
        ...stamp(at(p.date, "12:30")),
      });
    }
    for (const invId of p.invoiceIds) {
      const inv = ctx.invoices.find((x) => x.id === invId)!;
      if (rejected) continue;
      if (!inv.paidOn || p.date > inv.paidOn) inv.paidOn = p.date;
      inv.paidFully = true;
    }
  }

  // 3) Estados finales de los pedidos y volcado de eventos ----------------------------------------------------------
  for (const o of ctx.orders) {
    const inv = o.invoiceId ? ctx.invoices.find((x) => x.id === o.invoiceId) : undefined;
    if (inv?.paidFully && inv.paidOn) {
      o.events.push({
        status: "paid",
        at: at(inv.paidOn, "12:40"),
        by: "nahuel",
        note: "Facturas cobradas en su totalidad",
      });
    }
  }
  persistOrders(ctx);
}

/** Nota de crédito por el reclamo de bolsas mal selladas (se descuenta de la cuenta del cliente). */
function creditNote(ctx: Ctx) {
  const c = ctx.customers.find((x) => x.key === "naturaleza");
  if (!c) return;
  const net = roundMoney(4 * listPrice(c.priceList, "tap500", "2026-08-20"));
  const vat = roundMoney(net * 0.21);
  const id = ctx.rng.uuid();
  ctx.buf.salesInvoices.push({
    id,
    customerId: c.id,
    orderId: null,
    invoiceType: "NC_A",
    pointOfSale: "0002",
    number: "00000021",
    issueDate: "2026-08-21",
    dueDate: "2026-08-21",
    netTotal: net,
    vatTotal: vat,
    total: roundMoney(net + vat),
    cae: "74116629884431",
    status: "confirmed",
    source: "manual",
    ...stamp(at("2026-08-21", "11:15")),
  });
}

/** Arma los cobros de un cliente según su forma de pago. */
function planPayments(ctx: Ctx, c: SimCustomer, out: PlannedPayment[]) {
  const rng = ctx.rng;
  const invs = ctx.invoices
    .filter((i) => i.customerKey === c.key && i.orderId)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  if (invs.length === 0) return;
  const skip = c.unpaidLast ?? 0;
  const payable = invs.slice(0, invs.length - skip);
  const routeOf = (orderId: string | null) => {
    return ctx.orders.find((x) => x.id === orderId)?.routeId ?? null;
  };

  const group = (
    list: typeof invs,
    payDate: (i: (typeof invs)[number]) => IsoDate,
    method: (n: number) => PlannedPayment["method"],
    cash?: (d: IsoDate) => IsoDate,
  ) => {
    const byDate = new Map<string, typeof invs>();
    for (const i of list) {
      const d = payDate(i);
      const key = d;
      (byDate.get(key) ?? byDate.set(key, []).get(key)!).push(i);
    }
    for (const [date, items] of byDate) {
      const m = method(items.length);
      out.push({
        customer: c,
        invoiceIds: items.map((i) => i.id),
        date,
        amount: roundMoney(items.reduce((a, i) => a + i.total, 0)),
        method: m,
        routeId: null,
        cashDate: m === "check" ? cash!(date) : undefined,
      });
    }
  };

  switch (c.pay) {
    case "on_delivery":
      for (const i of payable) {
        const delayed = rng.chance(0.05);
        const date = delayed ? addDays(i.issueDate, rng.int(5, 9)) : i.issueDate;
        const cashPay = rng.chance(0.7);
        out.push({
          customer: c,
          invoiceIds: [i.id],
          date,
          amount: i.total,
          method: cashPay ? "cash" : "transfer",
          routeId: !delayed && cashPay ? routeOf(i.orderId) : null,
        });
      }
      break;
    case "check30":
      for (const i of payable) {
        out.push({
          customer: c,
          invoiceIds: [i.id],
          date: i.issueDate,
          amount: i.total,
          method: "check",
          routeId: routeOf(i.orderId),
          cashDate: addDays(i.issueDate, 30),
        });
      }
      break;
    case "monthly":
      group(
        payable,
        (i) => {
          // Paga el 10 y el 25: la primera fecha de pago posterior al vencimiento.
          let d = addDays(i.dueDate, rng.int(0, 2));
          for (let k = 0; k < 40; k++, d = addDays(d, 1)) {
            const day = Number(d.slice(8, 10));
            if (day === 10 || day === 25) return d;
          }
          return d;
        },
        () => "transfer",
      );
      break;
    case "check": {
      const bounce = !!c.bouncesCheck;
      let bounced = false;
      for (const i of payable) {
        const date = addDays(i.dueDate, rng.int(c.lag[0], c.lag[1]));
        const useCheck = rng.chance(0.65);
        if (useCheck) {
          const cashDate = addDays(date, rng.pick([15, 30, 30, 45]));
          const p: PlannedPayment = {
            customer: c,
            invoiceIds: [i.id],
            date,
            amount: i.total,
            method: "check",
            routeId: null,
            cashDate,
          };
          // El cheque de agosto que rebota: se acredita y el cliente vuelve a deber.
          if (bounce && !bounced && cashDate >= "2026-09-10" && cashDate <= "2026-09-24") {
            p.bounced = true;
            bounced = true;
          }
          out.push(p);
        } else {
          out.push({
            customer: c,
            invoiceIds: [i.id],
            date,
            amount: i.total,
            method: "transfer",
            routeId: null,
          });
        }
      }
      if (bounce && !bounced) {
        // Garantiza el cheque rechazado de la demostración: el primer pago desde mediados de agosto se hizo con cheque.
        const mine = out.filter((p) => p.customer === c && p.date >= "2026-08-10" && p.date <= "2026-09-05");
        const p = mine[0];
        if (p) {
          p.method = "check";
          p.cashDate = addDays(p.date, 25);
          p.bounced = true;
        }
      }
      break;
    }
    default:
      group(
        payable,
        (i) => addDays(i.dueDate, rng.int(c.lag[0], c.lag[1])),
        () => "transfer",
      );
  }
}

// --- Volcado de pedidos -------------------------------------------------------------------------------------------------------

function persistOrders(ctx: Ctx) {
  const rng = ctx.rng;
  for (const o of ctx.orders) {
    if (o.receivedAt > at(TODAY, "10:30")) continue; // pedidos que todavía no entraron
    type Ev = {
      status: SimOrder["events"][number]["status"];
      at: Date;
      by: string | null;
      note?: string | null;
    };
    const events: Ev[] = [{ status: "received", at: o.receivedAt, by: o.createdBy }];
    // Los pedidos que entraron hoy a la mañana todavía no están confirmados.
    if (o.receivedAt < at(TODAY, "08:30") || o.events.length > 0) {
      events.push({ status: "confirmed", at: plusMin(o.receivedAt, rng.int(25, 110)), by: "af" });
    }
    const all = [...events, ...o.events].sort((a, b) => a.at.getTime() - b.at.getTime());
    ctx.buf.orders.push({
      id: o.id,
      customerId: o.customer.id,
      priceListId: ctx.refs.priceLists[o.customer.priceList]!,
      source: o.source,
      receivedAt: o.receivedAt,
      promisedDate: o.promised,
      status: statusOf(all),
      deliveredAt: o.deliveredAt ?? null,
      total: o.total,
      notes: o.notes,
      createdById: ctx.users[o.createdBy]!,
      ...stamp(o.receivedAt),
    });
    for (const it of o.items) {
      ctx.buf.orderItems.push({
        orderId: o.id,
        productId: ctx.products[it.product]!.id,
        qtyUnits: it.qty,
        unitPrice: it.price,
        ...stamp(o.receivedAt),
      });
    }
    for (const e of all) {
      ctx.buf.orderEvents.push({
        orderId: o.id,
        status: e.status,
        at: e.at,
        byId: e.by ? ctx.users[e.by]! : null,
        note: e.note ?? null,
      });
    }
  }
}

const STATUS_RANK = [
  "received",
  "confirmed",
  "in_production",
  "ready",
  "dispatched",
  "delivered",
  "invoiced",
  "paid",
];

/** Estado actual de un pedido a partir de sus eventos (el más avanzado; "cancelled" manda si está). */
function statusOf(events: { status: string }[]): SimOrder["events"][number]["status"] {
  if (events.some((e) => e.status === "cancelled")) return "cancelled";
  let best = 0;
  for (const e of events) best = Math.max(best, STATUS_RANK.indexOf(e.status));
  return STATUS_RANK[best] as SimOrder["events"][number]["status"];
}
