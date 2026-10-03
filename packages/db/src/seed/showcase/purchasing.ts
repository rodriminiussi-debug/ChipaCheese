import {
  addDays,
  diffDays,
  formatPoNumber,
  invoiceTotals,
  isoWeekday,
  lineNet,
  lineVat,
  roundMoney,
  roundQty,
  type IsoDate,
} from "@chipa/domain";
import { at, clock, mondayOf, plusMin, shiftHoliday } from "./calendar";
import { nextNumber, stamp, type Ctx } from "./ctx";
import { fefoRaw, moveIngredient, rawLotsOf, rawStock, takeRaw } from "./stock";

/**
 * Compras: órdenes de compra semanales a los 4 proveedores, recepciones con lote/vencimiento/temperatura,
 * facturas confirmadas con IVA, historial de precios con inflación mensual y pagos a proveedores.
 */

export type SupplierKey = "leopelle" | "cotar" | "mancinelli" | "jorge";

interface SupplierInfo {
  pointOfSale: string;
  terms: number;
  firstInvoice: number;
  weekdays: number[];
  /** Retira el chofer durante el reparto (la recepción se hace al volver). */
  pickup: boolean;
  /** Hora de entrega (si no es retiro). */
  time: string;
  ings: string[];
  whatsapp: string;
}

export const SUPPLIER: Record<SupplierKey, SupplierInfo> = {
  leopelle: {
    pointOfSale: "0004",
    terms: 15,
    firstInvoice: 21_840,
    weekdays: [4],
    pickup: true,
    time: "14:10",
    ings: ["fecula", "queso_barra", "reggianito", "sal", "queso_feteado"],
    whatsapp: "+54 9 341 555-0171",
  },
  cotar: {
    pointOfSale: "0012",
    terms: 7,
    firstInvoice: 55_120,
    weekdays: [1, 4],
    pickup: false,
    time: "07:20",
    ings: ["leche"],
    whatsapp: "+54 9 341 555-0172",
  },
  mancinelli: {
    pointOfSale: "0003",
    terms: 7,
    firstInvoice: 8_300,
    weekdays: [2],
    pickup: false,
    time: "07:50",
    ings: ["huevo", "jamon"],
    whatsapp: "+54 9 341 555-0173",
  },
  jorge: {
    pointOfSale: "0001",
    terms: 0,
    firstInvoice: 1_450,
    weekdays: [3],
    pickup: false,
    time: "08:05",
    ings: ["manteca"],
    whatsapp: "+54 9 341 555-0174",
  },
};

interface IngredientBuying {
  description: string;
  unit: "kg" | "l" | "unit";
  vatRate: number;
  lotPrefix: string;
  refrigerated: boolean;
  /** Vida útil desde la recepción, en días (null = sin vencimiento). */
  shelfDays: number | null;
  /** Precio sin IVA al 29/09/2026 (último precio del relevamiento) e inflación mensual. */
  base: number;
  monthlyInflation: number;
  pack: number;
  /** Stock de seguridad al comprar. */
  safety: number;
  /** Consumo por kg de fécula (para estimar el consumo diario antes de tener historia). */
  perKgStarch: number;
}

export const BUYING: Record<string, IngredientBuying> = {
  fecula: {
    description: "Fécula de mandioca (bolsa 25 kg)",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "FEC",
    refrigerated: false,
    shelfDays: 330,
    base: 1728,
    monthlyInflation: 0.022,
    pack: 25,
    safety: 45,
    perKgStarch: 1,
  },
  queso_barra: {
    description: "Queso Tybo en barra",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "TYBO",
    refrigerated: true,
    shelfDays: 50,
    base: 9880,
    monthlyInflation: 0.03,
    pack: 5,
    safety: 12,
    perKgStarch: 0.3,
  },
  reggianito: {
    description: "Queso reggianito",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "REG",
    refrigerated: true,
    shelfDays: 130,
    base: 13431,
    monthlyInflation: 0.035,
    pack: 5,
    safety: 8,
    perKgStarch: 0.2,
  },
  manteca: {
    description: "Manteca (pan de 5 kg)",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "MAN",
    refrigerated: true,
    shelfDays: 75,
    base: 9800,
    monthlyInflation: 0.038,
    pack: 5,
    safety: 8,
    perKgStarch: 0.19,
  },
  huevo: {
    description: "Huevo blanco (maple x 30)",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "HUE",
    refrigerated: true,
    shelfDays: 26,
    base: 3222,
    monthlyInflation: 0.04,
    pack: 5,
    safety: 9,
    perKgStarch: 0.24,
  },
  leche: {
    description: "Leche entera (sachet 1 L)",
    unit: "l",
    vatRate: 10.5,
    lotPrefix: "LEC",
    refrigerated: true,
    shelfDays: 12,
    base: 1066,
    monthlyInflation: 0.026,
    pack: 12,
    safety: 18,
    perKgStarch: 0.32,
  },
  sal: {
    description: "Sal fina (bolsa 25 kg)",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "SAL",
    refrigerated: false,
    shelfDays: 700,
    base: 708,
    monthlyInflation: 0.02,
    pack: 25,
    safety: 4,
    perKgStarch: 0.028,
  },
  jamon: {
    description: "Jamón cocido feteado",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "JAM",
    refrigerated: true,
    shelfDays: 35,
    base: 13_500,
    monthlyInflation: 0.03,
    pack: 1,
    safety: 0,
    perKgStarch: 0,
  },
  queso_feteado: {
    description: "Queso feteado para sándwich",
    unit: "kg",
    vatRate: 21,
    lotPrefix: "QFE",
    refrigerated: true,
    shelfDays: 55,
    base: 11_800,
    monthlyInflation: 0.03,
    pack: 1,
    safety: 0,
    perKgStarch: 0,
  },
  bolsa500: {
    description: "Bolsa 0,5 kg con etiqueta",
    unit: "unit",
    vatRate: 21,
    lotPrefix: "BOL",
    refrigerated: false,
    shelfDays: null,
    base: 140,
    monthlyInflation: 0.02,
    pack: 500,
    safety: 0,
    perKgStarch: 0,
  },
  bolsa5k: {
    description: "Bolsa granel 5 kg",
    unit: "unit",
    vatRate: 21,
    lotPrefix: "BG",
    refrigerated: false,
    shelfDays: null,
    base: 480,
    monthlyInflation: 0.02,
    pack: 50,
    safety: 0,
    perKgStarch: 0,
  },
};

/** Fecha del último precio de los maestros (29/09/2026): desde ahí el precio es el del relevamiento. */
const PRICE_ANCHOR: IsoDate = "2026-09-29";

/** Precio sin IVA de un insumo en una fecha: retrocede con la inflación mensual y agrega ruido de ±0,8 %. */
export function priceAt(ctx: Ctx, ing: string, day: IsoDate): number {
  const b = BUYING[ing]!;
  if (day >= PRICE_ANCHOR) return b.base;
  const months = diffDays(day, PRICE_ANCHOR) / 30;
  const noise = 1 + ctx.rng.range(-0.008, 0.008);
  return Math.max(1, Math.round(b.base * (1 + b.monthlyInflation) ** months * noise));
}

// --- Cronograma de entregas -------------------------------------------------------------------------

/** ¿El proveedor entrega ese día? (los feriados corren la entrega al día hábil anterior de la semana). */
export function delivers(supplier: SupplierKey, day: IsoDate): boolean {
  const monday = mondayOf(day);
  return SUPPLIER[supplier].weekdays.some((wd) => shiftHoliday(addDays(monday, wd - 1)) === day);
}

export function nextDelivery(supplier: SupplierKey, day: IsoDate): IsoDate {
  for (let i = 1; i <= 14; i++) if (delivers(supplier, addDays(day, i))) return addDays(day, i);
  return addDays(day, 7);
}

/** Consumo diario estimado (por día corrido) de un insumo: promedio de las últimas 2 semanas. */
function dailyUsage(ctx: Ctx, ing: string, day: IsoDate): number {
  const rows = ctx.usage[ing] ?? [];
  const from = addDays(day, -14);
  const sum = rows.filter((r) => r.date >= from && r.date < day).reduce((a, r) => a + r.qty, 0);
  const prior = 38 * BUYING[ing]!.perKgStarch;
  if (diffDays(day, "2026-06-29") < 10) return prior;
  return sum / 14 || prior;
}

const roundUpTo = (n: number, pack: number) => Math.ceil(n / pack - 1e-9) * pack;

/** Cantidad a pedir de cada insumo del proveedor para llegar a la próxima entrega con stock de seguridad. */
function orderLines(ctx: Ctx, supplier: SupplierKey, day: IsoDate): { ing: string; qty: number }[] {
  const next = nextDelivery(supplier, day);
  const horizon = diffDays(next, day);
  const out: { ing: string; qty: number }[] = [];
  for (const ing of SUPPLIER[supplier].ings) {
    const b = BUYING[ing]!;
    if (b.perKgStarch === 0) continue; // jamón y queso feteado: compras puntuales
    const target = dailyUsage(ctx, ing, day) * (horizon + 1) + b.safety;
    const need = target - rawStock(ctx, ing);
    if (ing === "sal" && rawStock(ctx, ing) > 9) continue;
    if (need < b.pack * 0.35) continue;
    out.push({ ing, qty: roundQty(roundUpTo(need, b.pack)) });
  }
  return out;
}

// --- Orden de compra, recepción y factura ----------------------------------------------------------------

interface OrderResult {
  id: string;
  number: string;
}

export function createPurchaseOrder(
  ctx: Ctx,
  input: {
    supplier: SupplierKey;
    orderedAt: IsoDate;
    expectedAt: IsoDate;
    lines: { ing: string; qty: number }[];
    status: "draft" | "sent" | "partially_received" | "received";
    notes?: string | null;
  },
): OrderResult {
  const id = ctx.rng.uuid();
  const number = formatPoNumber(nextNumber(ctx, "oc", 1));
  const created = at(input.orderedAt, "16:30");
  ctx.buf.purchaseOrders.push({
    id,
    number,
    supplierId: ctx.supplierId[input.supplier]!,
    orderedAt: input.orderedAt,
    expectedAt: input.expectedAt,
    status: input.status,
    responsibleId: ctx.users.af!,
    notes: input.notes ?? null,
    ...stamp(created),
  });
  input.lines.forEach((l, i) => {
    ctx.buf.purchaseOrderItems.push({
      purchaseOrderId: id,
      ingredientId: ctx.ingId[l.ing]!,
      qty: roundQty(l.qty),
      unit: BUYING[l.ing]!.unit,
      estimatedUnitPrice: priceAt(ctx, l.ing, input.orderedAt),
      ...stamp(new Date(created.getTime() + i)),
    });
  });
  return { id, number };
}

export interface ReceiveInput {
  day: IsoDate;
  time: string;
  supplier: SupplierKey;
  lines: { ing: string; qty: number; temp?: number }[];
  poId?: string | null;
  notes?: string | null;
  by?: string;
}

/**
 * Recepción de mercadería + factura de compra confirmada + historial de precios.
 * Es el único camino por el que entra materia prima proveniente de un proveedor.
 */
export function receive(ctx: Ctx, p: ReceiveInput) {
  const sup = SUPPLIER[p.supplier];
  const receivedAt = at(p.day, p.time);
  const by = ctx.users[p.by ?? "af"]!;
  const receptionId = ctx.rng.uuid();
  const invoiceNumber = nextNumber(ctx, `inv-${p.supplier}`, sup.firstInvoice) + ctx.rng.int(0, 29);
  ctx.counters[`inv-${p.supplier}`] = invoiceNumber;
  const numberText = String(invoiceNumber).padStart(8, "0");
  ctx.buf.receptions.push({
    id: receptionId,
    supplierId: ctx.supplierId[p.supplier]!,
    purchaseOrderId: p.poId ?? null,
    receivedAt,
    receivedById: by,
    deliveryNote: `R ${sup.pointOfSale}-${String(invoiceNumber - ctx.rng.int(0, 3)).padStart(8, "0")}`,
    notes: p.notes ?? null,
    ...stamp(receivedAt),
  });

  const invoiceId = ctx.rng.uuid();
  const lines: { ing: string; qty: number; price: number; itemId: string }[] = [];
  p.lines.forEach((line, i) => {
    const b = BUYING[line.ing]!;
    const qty = roundQty(line.qty);
    const lotId = ctx.rng.uuid();
    const expiry = b.shelfDays == null ? null : addDays(p.day, b.shelfDays + ctx.rng.int(-3, 3));
    const loc = b.refrigerated ? "heladera" : "seco";
    const mmdd = p.day.slice(5, 7) + p.day.slice(8, 10);
    const code = `${b.lotPrefix}-${mmdd}`;
    const temp = b.refrigerated ? (line.temp ?? Math.round(ctx.rng.range(1.6, 4.7) * 10) / 10) : null;
    ctx.buf.rawLots.push({
      id: lotId,
      ingredientId: ctx.ingId[line.ing]!,
      supplierId: ctx.supplierId[p.supplier]!,
      receptionId,
      supplierLotCode: code,
      expiryDate: expiry,
      receivedQty: qty,
      temperatureC: temp,
      locationId: ctx.loc[loc]!,
      ...stamp(receivedAt),
    });
    rawLotsOf(ctx, line.ing).push({ id: lotId, ing: line.ing, code, expiry, qty, loc, receivedAt });
    moveIngredient(ctx, {
      at: receivedAt,
      type: "receipt",
      ing: line.ing,
      lotId,
      loc,
      qty,
      refTable: "receptions",
      refId: receptionId,
      by,
    });
    // El precio de un mismo proveedor en un mismo día es único para todas las líneas de ese insumo.
    lines.push({ ing: line.ing, qty, price: priceAt(ctx, line.ing, p.day), itemId: ctx.rng.uuid() });
    void i;
  });

  const invLines = lines.map((l) => ({
    qty: l.qty,
    unitPriceNet: l.price,
    vatRate: BUYING[l.ing]!.vatRate,
    vatAmount: null as number | null,
  }));
  const totals = invoiceTotals(invLines);
  const useAi = ctx.rng.chance(0.55);
  ctx.buf.purchaseInvoices.push({
    id: invoiceId,
    supplierId: ctx.supplierId[p.supplier]!,
    purchaseOrderId: p.poId ?? null,
    invoiceType: "A",
    pointOfSale: sup.pointOfSale,
    number: numberText,
    issueDate: p.day,
    dueDate: addDays(p.day, sup.terms),
    netTotal: totals.net,
    vatTotal: totals.vat,
    otherTaxes: 0,
    total: totals.total,
    status: "confirmed",
    source: useAi ? "ai" : "manual",
    aiExtraction: useAi
      ? { provider: "claude", model: "claude-sonnet-5-5", extracted: { supplierName: null } }
      : null,
    notes: null,
    ...stamp(plusMin(receivedAt, 20)),
  });
  lines.forEach((l, i) => {
    const line = invLines[i]!;
    const created = new Date(plusMin(receivedAt, 20).getTime() + i);
    ctx.buf.purchaseInvoiceItems.push({
      id: l.itemId,
      invoiceId,
      ingredientId: ctx.ingId[l.ing]!,
      description: BUYING[l.ing]!.description,
      qty: l.qty,
      unit: BUYING[l.ing]!.unit,
      unitPriceNet: l.price,
      vatRate: line.vatRate,
      vatAmount: lineVat(line),
      lineTotal: roundMoney(lineNet(line) + lineVat(line)),
      ...stamp(created),
    });
    ctx.buf.ingredientPrices.push({
      ingredientId: ctx.ingId[l.ing]!,
      supplierId: ctx.supplierId[p.supplier]!,
      date: p.day,
      unitPriceNet: l.price,
      invoiceItemId: l.itemId,
      ...stamp(new Date(created.getTime() + 1)),
    });
  });
  ctx.payables.push({
    supplier: p.supplier,
    invoiceId,
    due: addDays(p.day, sup.terms),
    total: totals.total,
    paid: false,
  });
  return { receptionId, invoiceId, total: totals.total };
}

// --- Entregas programadas -----------------------------------------------------------------------------

/** Entregas de los proveedores que llegan por su cuenta (Cotar, Mancinelli, Jorge): antes de producir. */
export function morningDeliveries(ctx: Ctx, day: IsoDate) {
  for (const supplier of ["cotar", "mancinelli", "jorge"] as const) {
    if (!delivers(supplier, day)) continue;
    deliverScheduled(ctx, supplier, day, SUPPLIER[supplier].time);
  }
}

/** Retiro en Leo Pelle durante el reparto del jueves: se recepciona al volver de la ruta. */
export function pickupDelivery(ctx: Ctx, day: IsoDate, routeEnd: Date | null) {
  if (!delivers("leopelle", day)) return;
  const time = routeEnd ? clock(routeEnd.getUTCHours() * 60 - 180 + routeEnd.getUTCMinutes() + 25) : "14:10";
  deliverScheduled(ctx, "leopelle", day, time);
}

function deliverScheduled(ctx: Ctx, supplier: SupplierKey, day: IsoDate, time: string) {
  const lines = orderLines(ctx, supplier, day);
  const specials = specialLines(supplier, day);
  const all = [...lines, ...specials];
  if (all.length === 0) return;
  const orderedAt = addDays(day, -1) === day ? day : prevBusiness(day);
  const partial = supplier === "cotar" && day === "2026-09-28";
  const ordered = partial ? all.map((l) => ({ ...l, qty: roundQty(l.qty * 1.5) })) : all;
  const po = createPurchaseOrder(ctx, {
    supplier,
    orderedAt,
    expectedAt: day,
    lines: ordered,
    status: partial ? "partially_received" : "received",
    notes: partial ? "El proveedor entregó una parte: el resto queda pendiente." : null,
  });
  const alert = supplier === "mancinelli" && day === "2026-08-04";
  receive(ctx, {
    day,
    time,
    supplier,
    poId: po.id,
    lines: all.map((l) => (alert && l.ing === "huevo" ? { ...l, temp: 6.2 } : l)),
    notes: alert
      ? "Temperatura alta al recibir (6,2 °C): se controló el producto, se aceptó y se avisó al proveedor."
      : null,
    by: ctx.rng.chance(0.6) ? "af" : "sg",
  });
}

function prevBusiness(day: IsoDate): IsoDate {
  let d = addDays(day, -1);
  while (isoWeekday(d) > 5) d = addDays(d, -1);
  return d;
}

/** Compras puntuales: jamón y queso feteado para las pruebas del Chisanwich. */
function specialLines(supplier: SupplierKey, day: IsoDate) {
  if (supplier === "mancinelli" && day === "2026-09-15") return [{ ing: "jamon", qty: 3 }];
  if (supplier === "leopelle" && day === "2026-09-17") return [{ ing: "queso_feteado", qty: 3 }];
  return [];
}

/** Compra de emergencia cuando el stock no alcanza para producir (queda registrada como cualquier otra). */
export function emergencyPurchase(ctx: Ctx, day: IsoDate, time: string, ing: string, missing: number) {
  const b = BUYING[ing]!;
  const supplier = (Object.keys(SUPPLIER) as SupplierKey[]).find((k) => SUPPLIER[k].ings.includes(ing))!;
  const qty = roundQty(roundUpTo(missing + b.safety * 0.5, b.pack));
  receive(ctx, {
    day,
    time,
    supplier,
    lines: [{ ing, qty }],
    notes: "Compra urgente: el stock no alcanzó para la producción del día.",
    by: "af",
  });
}

// --- Envases (sin proveedor fijo: se cargan como lote sin recepción) ------------------------------------------

export function receivePackaging(ctx: Ctx, day: IsoDate, ing: "bolsa500" | "bolsa5k", qty: number) {
  const b = BUYING[ing]!;
  const receivedAt = at(day, "10:15");
  const lotId = ctx.rng.uuid();
  const code = `${b.lotPrefix}-${day.slice(5, 7)}${day.slice(8, 10)}`;
  ctx.buf.rawLots.push({
    id: lotId,
    ingredientId: ctx.ingId[ing]!,
    supplierId: null,
    receptionId: null,
    supplierLotCode: code,
    expiryDate: null,
    receivedQty: qty,
    temperatureC: null,
    locationId: ctx.loc.seco!,
    ...stamp(receivedAt),
  });
  rawLotsOf(ctx, ing).push({ id: lotId, ing, code, expiry: null, qty, loc: "seco", receivedAt });
  moveIngredient(ctx, {
    at: receivedAt,
    type: "receipt",
    ing,
    lotId,
    loc: "seco",
    qty,
    refTable: "raw_lots",
    refId: lotId,
    by: ctx.users.af!,
  });
  ctx.buf.ingredientPrices.push({
    ingredientId: ctx.ingId[ing]!,
    supplierId: null,
    date: day,
    unitPriceNet: priceAt(ctx, ing, day),
    ...stamp(receivedAt),
  });
}

/** Reposición de envases los lunes cuando quedan pocos. */
export function packagingTopUp(ctx: Ctx, day: IsoDate) {
  if (isoWeekday(day) !== 1) return;
  if (rawStock(ctx, "bolsa500") < 1100) receivePackaging(ctx, day, "bolsa500", 3000);
  if (rawStock(ctx, "bolsa5k") < 90) receivePackaging(ctx, day, "bolsa5k", 150);
}

/** Descuento de envases por FEFO/antigüedad al envasar. Devuelve el lote usado de cada tramo. */
export function takePackaging(ctx: Ctx, day: IsoDate, ing: "bolsa500" | "bolsa5k", units: number) {
  if (rawStock(ctx, ing) < units) receivePackaging(ctx, day, ing, ing === "bolsa500" ? 3000 : 150);
  return takeRaw(ctx, ing, units)!;
}

// --- Mermas y descartes ------------------------------------------------------------------------------------------

const WRITE_OFFS: { day: IsoDate; ing: string; qty: number; note: string }[] = [
  { day: "2026-07-31", ing: "leche", qty: 6, note: "Descarte por vencimiento (sachets hinchados)" },
  { day: "2026-08-21", ing: "huevo", qty: 3, note: "Merma: maples con huevos rotos en el traslado" },
  { day: "2026-08-28", ing: "manteca", qty: 0.8, note: "Merma: recorte del pan abierto" },
  { day: "2026-09-08", ing: "leche", qty: 6, note: "Descarte tras el corte de luz de la noche del 07/09" },
  { day: "2026-09-25", ing: "queso_barra", qty: 1.2, note: "Merma: corte y oreo de la barra" },
];

export function writeOffs(ctx: Ctx, day: IsoDate) {
  for (const w of WRITE_OFFS.filter((x) => x.day === day)) {
    const taken = takeRaw(ctx, w.ing, w.qty);
    if (!taken) continue;
    const refId = ctx.rng.uuid();
    for (const t of taken) {
      moveIngredient(ctx, {
        at: at(day, "17:10"),
        type: "waste",
        ing: w.ing,
        lotId: t.lot.id,
        loc: t.lot.loc,
        qty: -t.qty,
        refTable: "stock_adjustment",
        refId,
        note: w.note,
        by: ctx.users.af!,
      });
    }
  }
}

// --- Pagos a proveedores ------------------------------------------------------------------------------------------

/** Los viernes se pagan las facturas vencidas (alguna se demora una semana); Jorge cobra al contado. */
export function paySuppliers(ctx: Ctx, day: IsoDate) {
  const friday = isoWeekday(day) === 5 || shiftHoliday(addDays(mondayOf(day), 4)) === day;
  for (const supplier of ["leopelle", "cotar", "mancinelli", "jorge"] as const) {
    const cash = supplier === "jorge";
    if (!cash && !friday) continue;
    let due = ctx.payables.filter((x) => x.supplier === supplier && !x.paid && x.due <= day);
    if (!cash && due.length > 1 && ctx.rng.chance(0.18)) due = due.slice(0, -1); // una factura se deja para la semana próxima
    if (due.length === 0) continue;
    const amount = roundMoney(due.reduce((a, x) => a + x.total, 0));
    ctx.buf.supplierPayments.push({
      supplierId: ctx.supplierId[supplier]!,
      date: day,
      amount,
      method: cash ? "cash" : "transfer",
      reference: cash ? "Contado contra entrega" : `Transferencia ${String(ctx.rng.int(100000, 999999))}`,
      notes: null,
      ...stamp(at(day, "11:30")),
    });
    for (const x of due) x.paid = true;
  }
}

// --- Órdenes pendientes al día de hoy -----------------------------------------------------------------------------------

/** Pedidos de la semana próxima ya enviados a los proveedores (entregas esperadas). */
export function pendingOrders(ctx: Ctx, today: IsoDate) {
  const pending: {
    supplier: SupplierKey;
    lines: { ing: string; qty: number }[];
    status: "sent" | "draft";
  }[] = [
    { supplier: "cotar", lines: [{ ing: "leche", qty: 72 }], status: "sent" },
    { supplier: "mancinelli", lines: [{ ing: "huevo", qty: 60 }], status: "sent" },
    { supplier: "jorge", lines: [{ ing: "manteca", qty: 50 }], status: "draft" },
  ];
  for (const p of pending) {
    createPurchaseOrder(ctx, {
      supplier: p.supplier,
      orderedAt: today,
      expectedAt: nextDelivery(p.supplier, today),
      lines: p.lines,
      status: p.status,
    });
  }
}

/** Compra inicial (antes del período): deja stock para arrancar el 29/06. */
export function openingPurchases(ctx: Ctx, day: IsoDate) {
  receive(ctx, {
    day,
    time: "14:00",
    supplier: "leopelle",
    lines: [
      { ing: "fecula", qty: 300 },
      { ing: "queso_barra", qty: 90 },
      { ing: "reggianito", qty: 60 },
      { ing: "sal", qty: 25 },
    ],
    notes: "Compra de arranque del trimestre.",
  });
  receive(ctx, { day, time: "08:10", supplier: "jorge", lines: [{ ing: "manteca", qty: 60 }] });
  receive(ctx, { day, time: "07:40", supplier: "mancinelli", lines: [{ ing: "huevo", qty: 60 }] });
  receive(ctx, { day, time: "07:25", supplier: "cotar", lines: [{ ing: "leche", qty: 120 }] });
  receivePackaging(ctx, day, "bolsa500", 3000);
  receivePackaging(ctx, day, "bolsa5k", 200);
}

export { fefoRaw };
