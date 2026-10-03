import { isoWeekday, roundMoney, type IsoDate } from "@chipa/domain";
import { at, clock, isWorkday, HOLIDAYS } from "./calendar";
import { PERIOD_START, TODAY, stamp, type Ctx } from "./ctx";
import { listPrice } from "./sales";
import { allocateFinished, finishedPosition, finishedStock, moveProduct } from "./stock";

/**
 * Local comercial: transferencias F3/F4 → LOCAL los lunes y jueves, ventas diarias por lote FEFO desde
 * el local y cierre de caja con alguna diferencia menor. Es un depósito más (ubicación LOCAL).
 */

const TARGET: Record<string, number> = {
  tap500: 70,
  len500: 60,
  sur500: 40,
  ari500: 20,
  tap5k: 3,
  len5k: 3,
  ari5k: 1,
};
const SALE_MIX: [string, number][] = [
  ["tap500", 0.34],
  ["len500", 0.28],
  ["sur500", 0.2],
  ["ari500", 0.08],
  ["tap5k", 0.05],
  ["len5k", 0.04],
  ["ari5k", 0.01],
];

/** Transfiere de F3/F4 al local hasta el objetivo; devuelve lo transferido. */
function replenish(ctx: Ctx, when: Date, products: string[], note: string, onlyIfBelow = 0.6) {
  const rng = ctx.rng;
  for (const p of products) {
    const target = TARGET[p] ?? 0;
    const have = finishedStock(ctx, p, ["local"]);
    if (have >= target * onlyIfBelow) continue;
    const want = target - have;
    const available = finishedStock(ctx, p, ["f3", "f4"]);
    // No se deja a F3/F4 sin el producto que ya está comprometido en pedidos.
    const units = Math.min(want, Math.max(0, Math.floor(available * 0.35)));
    if (units <= 0) continue;
    const alloc = allocateFinished(ctx, p, units, ["f3", "f4"]);
    if (!alloc) continue;
    const refId = rng.uuid();
    for (const a of alloc) {
      a.pos.qty -= a.qty;
      finishedPosition(ctx, p, a.pos.lot.id, "local")!.qty += a.qty;
      moveProduct(ctx, {
        at: when,
        type: "transfer",
        product: p,
        lotId: a.pos.lot.id,
        loc: a.pos.loc,
        qty: -a.qty,
        refTable: "stock_transfer",
        refId,
        note,
        by: ctx.users.af!,
      });
      moveProduct(ctx, {
        at: when,
        type: "transfer",
        product: p,
        lotId: a.pos.lot.id,
        loc: "local",
        qty: a.qty,
        refTable: "stock_transfer",
        refId,
        note,
        by: ctx.users.af!,
      });
    }
  }
}

export const storeIsOpen = (day: IsoDate) => isoWeekday(day) <= 6 && !HOLIDAYS.has(day);

/** Transferencias programadas (lunes y jueves, después de cargar el reparto). */
export function scheduledTransfer(ctx: Ctx, day: IsoDate) {
  const wd = isoWeekday(day);
  if (!isWorkday(day) || (wd !== 1 && wd !== 4)) return;
  replenish(
    ctx,
    at(day, "08:55"),
    Object.keys(TARGET),
    `Reposición del local ${day.slice(8, 10)}/${day.slice(5, 7)}`,
    0.85,
  );
}

const methodMix = [
  ["cash", 0.5],
  ["transfer", 0.3],
  ["card", 0.2],
] as const;

export function storeDay(ctx: Ctx, day: IsoDate) {
  if (!storeIsOpen(day) || day < PERIOD_START) return;
  const rng = ctx.rng;
  const wd = isoWeekday(day);
  const today = day === TODAY;
  const base = wd === 6 ? rng.int(6, 10) : rng.int(4, 8);
  const n = today ? rng.int(2, 4) : base;
  const seller = ctx.users[(Number(day.slice(8, 10)) + wd) % 2 === 0 ? "local1" : "local2"]!;
  const endMin = today ? 10 * 60 + 15 : wd === 6 ? 13 * 60 : 20 * 60;
  const startMin = 9 * 60 + 5;
  const minutes = Array.from({ length: n }, () => rng.int(startMin, endMin - 5)).sort((a, b) => a - b);

  const sold: { method: string; total: number }[] = [];
  for (const m of minutes) {
    const soldAt = at(day, clock(m));
    const lines = new Map<string, number>();
    const kinds = rng.weighted([
      [1, 0.6],
      [2, 0.3],
      [3, 0.1],
    ] as const);
    for (let k = 0; k < kinds; k++) {
      const p = rng.weighted(SALE_MIX);
      const bulk = p.endsWith("5k");
      const qty = bulk
        ? 1
        : rng.weighted([
            [1, 0.45],
            [2, 0.35],
            [3, 0.15],
            [4, 0.05],
          ] as const);
      lines.set(p, (lines.get(p) ?? 0) + qty);
    }
    // Reposición urgente desde F3/F4 si el local se quedó sin algún producto.
    for (const [p, qty] of lines) {
      if (finishedStock(ctx, p, ["local"]) < qty)
        replenish(ctx, plusMinutes(soldAt, -4), [p], "Reposición urgente del local", 1);
    }
    const items: { product: string; qty: number }[] = [];
    for (const [p, qty] of lines) {
      const q = Math.min(qty, finishedStock(ctx, p, ["local"]));
      if (q > 0) items.push({ product: p, qty: q });
    }
    if (items.length === 0) continue;
    const saleId = rng.uuid();
    const prices = new Map(items.map((i) => [i.product, listPrice("local", i.product, day)]));
    const total = roundMoney(items.reduce((a, i) => a + i.qty * prices.get(i.product)!, 0));
    const method = rng.weighted(methodMix);
    ctx.buf.storeSales.push({
      id: saleId,
      soldAt,
      locationId: ctx.loc.local!,
      method,
      total,
      sellerId: seller,
      ...stamp(soldAt),
    });
    for (const i of items) {
      const alloc = allocateFinished(ctx, i.product, i.qty, ["local"])!;
      for (const a of alloc) {
        a.pos.qty -= a.qty;
        ctx.buf.storeSaleItems.push({
          saleId,
          productId: ctx.products[i.product]!.id,
          finishedLotId: a.pos.lot.id,
          qtyUnits: a.qty,
          unitPrice: prices.get(i.product)!,
          ...stamp(soldAt),
        });
        moveProduct(ctx, {
          at: soldAt,
          type: "store_sale",
          product: i.product,
          lotId: a.pos.lot.id,
          loc: "local",
          qty: -a.qty,
          refTable: "store_sales",
          refId: saleId,
          by: seller,
        });
      }
    }
    sold.push({ method, total });
  }

  // Cierre de caja (el de hoy todavía no se hizo; en dos días del trimestre se olvidaron de cerrarla).
  if (today || ["2026-07-18", "2026-08-29", "2026-09-19"].includes(day)) return;
  const expectedCash = roundMoney(sold.filter((s) => s.method === "cash").reduce((a, s) => a + s.total, 0));
  const electronic = roundMoney(sold.filter((s) => s.method !== "cash").reduce((a, s) => a + s.total, 0));
  const r = rng.next();
  const diff =
    r < 0.84 ? 0 : r < 0.95 ? rng.pick([-1200, -800, -300, 200, 500, 900]) : rng.pick([-4800, -2600, 3100]);
  ctx.buf.cashClosings.push({
    date: day,
    locationId: ctx.loc.local!,
    expectedCash,
    countedCash: roundMoney(expectedCash + diff),
    expectedTransfer: electronic,
    closedById: seller,
    notes:
      diff === 0
        ? null
        : diff < 0
          ? "Faltante: se revisaron los vueltos del día."
          : "Sobrante: se anotó para revisar mañana.",
    ...stamp(at(day, endMin >= 20 * 60 ? "20:25" : "13:20")),
  });
}

const plusMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
