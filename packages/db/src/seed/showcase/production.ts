import {
  addDays,
  diffDays,
  finishedLotCode,
  finishedLotExpiry,
  isoWeekday,
  roundQty,
  type IsoDate,
} from "@chipa/domain";
import { at, isWorkday, mondayOf, nextWorkday, plusMin } from "./calendar";
import { PERIOD_START, stamp, type Ctx, type FinLoc } from "./ctx";
import { emergencyPurchase, takePackaging } from "./purchasing";
import { finishedPosition, finishedStock, moveIngredient, moveProduct, rawStock, takeRaw } from "./stock";
import * as D from "../data";

/**
 * Producción: una receta (37,5 a 75 kg de fécula) por día hábil de 4 a 5 días por semana.
 * El tamaño sale de la demanda del día siguiente (pedidos, local, stock) acotado a 75–150 kg.
 * Cada corrida consume materia prima por FEFO, se pesa por forma, se congela de noche y se envasa
 * la mañana del día hábil siguiente (ahí nace el lote AAMMDD-1).
 */

const RECIPE = D.RECIPE_V1.items;
const STARCH_STEP = 12.5;
const MIN_STARCH = 37.5;
const MAX_STARCH = 75;
const PACK_EFFICIENCY = 0.985;

/** Stock de seguridad objetivo de producto terminado (unidades). */
const BUFFER: Record<string, number> = {
  tap500: 40,
  len500: 40,
  sur500: 12,
  ari500: 8,
  tap5k: 1,
  len5k: 1,
  ari5k: 0,
};
/** Promedio diario de ventas del local (unidades), que reponen las transferencias desde F3/F4. */
export const STORE_DAILY: Record<string, number> = {
  tap500: 4,
  len500: 3.4,
  sur500: 2.2,
  ari500: 1,
  tap5k: 0.15,
  len5k: 0.1,
};
/** Reparto por kg del excedente de producción. */
const DEFAULT_MIX: [string, number][] = [
  ["tap500", 0.36],
  ["len500", 0.32],
  ["sur500", 0.14],
  ["ari500", 0.05],
  ["tap5k", 0.06],
  ["len5k", 0.06],
  ["ari5k", 0.01],
];

const productKeys = ["tap500", "ari500", "len500", "sur500", "tap5k", "ari5k", "len5k"] as const;

function openDemand(ctx: Ctx, from: IsoDate, to: IsoDate, includeOverdue = false) {
  const demand: Record<string, number> = {};
  for (const o of ctx.orders) {
    if (o.state !== "open") continue;
    const inRange = o.promised >= from && o.promised <= to;
    const overdue = includeOverdue && o.promised < from && (!o.holdUntil || o.holdUntil <= from);
    if (!inRange && !overdue) continue;
    for (const it of o.items) demand[it.product] = (demand[it.product] ?? 0) + it.qty;
  }
  return demand;
}

const kgOf = (ctx: Ctx, units: Record<string, number>) =>
  Object.entries(units).reduce((a, [p, u]) => a + u * (ctx.products[p]?.weightKg ?? 0), 0);

/** Corridas del último período semanal ya hechas (para respetar "4 a 5 días por semana"). */
function productionDaysThisWeek(ctx: Ctx, day: IsoDate) {
  const monday = mondayOf(day);
  return ctx.buf.productionRuns.filter((r) => r.date >= monday && r.date < day).length;
}

function remainingWorkdays(day: IsoDate) {
  const friday = addDays(mondayOf(day), 4);
  let n = 0;
  for (let d = addDays(day, 1); d <= friday; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return n;
}

export interface RunPlan {
  starchKg: number;
  units: Record<string, number>;
}

/** Decide si se produce y cuánto, según la demanda del día hábil siguiente. null = no se produce. */
function plan(ctx: Ctx, day: IsoDate): RunPlan | null {
  const rng = ctx.rng;
  const yieldFactor = 1.975;
  let starchKg: number;
  const units: Record<string, number> = {};

  const pw = nextWorkday(day);
  const pw2 = nextWorkday(pw);
  const d1 = openDemand(ctx, pw, pw, true);
  const d2 = openDemand(ctx, pw2, pw2);
  const kg2 = kgOf(ctx, d2);
  const f2 = kg2 > 130 ? (kg2 - 130) / kg2 : 0;
  // Pedidos grandes: se empiezan a preparar con varios días de anticipación.
  const big = ctx.orders.filter(
    (o) => o.state === "open" && o.big && o.promised > pw && diffDays(o.promised, day) <= 6,
  );

  const need: Record<string, number> = {};
  for (const p of productKeys) {
    const demand =
      (d1[p] ?? 0) +
      (d2[p] ?? 0) * f2 +
      big.reduce((a, o) => a + (o.items.find((i) => i.product === p)?.qty ?? 0) * 0.55, 0);
    const store = (STORE_DAILY[p] ?? 0) * 1.3;
    const stock = finishedStock(ctx, p, ["f3", "f4"]);
    need[p] = Math.max(0, Math.ceil(demand + store + (BUFFER[p] ?? 0) - stock));
  }
  const needKg = kgOf(ctx, need);

  if (day < PERIOD_START) {
    starchKg = 62.5; // arranque: se acumula stock antes del 1 de julio
  } else {
    const skippable = productionDaysThisWeek(ctx, day) + remainingWorkdays(day) >= 4;
    const yesterdayWorked = ctx.buf.productionRuns.some((r) => r.date === addDays(day, -1));
    if (needKg < 45 && skippable && yesterdayWorked) return null;
    const raw = needKg / (yieldFactor * PACK_EFFICIENCY);
    starchKg = Math.min(MAX_STARCH, Math.max(MIN_STARCH, Math.round(raw / STARCH_STEP) * STARCH_STEP));
  }

  // Unidades a envasar: primero lo que hace falta, después el excedente según el mix habitual.
  const packedKg = starchKg * yieldFactor * PACK_EFFICIENCY;
  const scale = needKg > packedKg ? packedKg / needKg : 1;
  for (const p of productKeys) units[p] = Math.floor((need[p] ?? 0) * scale);
  let rest = packedKg - kgOf(ctx, units);
  for (const [p, share] of DEFAULT_MIX) {
    const w = ctx.products[p]!.weightKg;
    units[p] = (units[p] ?? 0) + Math.max(0, Math.floor(((rest * share) / w) * (0.92 + rng.next() * 0.1)));
  }
  rest = packedKg - kgOf(ctx, units);
  // Lo que queda sin asignar (redondeos) se completa con bolsas de tapitas y lengüitas.
  while (rest >= 1) {
    const p = rng.chance(0.5) ? "tap500" : "len500";
    units[p] = (units[p] ?? 0) + 2;
    rest -= 1;
  }
  return { starchKg, units };
}

export function runProduction(ctx: Ctx, day: IsoDate) {
  const rng = ctx.rng;
  const p = plan(ctx, day);
  if (!p) return null;
  const { starchKg, units } = p;

  // --- Materia prima: lo que falte se compra de urgencia antes de arrancar -----------------------
  const theoretical: Record<string, number> = {};
  const actual: Record<string, number> = {};
  const outOfRangeFor = new Set<string>();
  const forceOut = rng.chance(0.035) ? rng.pick(["queso_barra", "sal", "manteca"] as const) : null;
  for (const it of RECIPE) {
    const t = roundQty(it.qty * starchKg);
    theoretical[it.ingredient] = t;
    const lo = it.min == null ? null : roundQty(it.min * starchKg);
    const hi = it.max == null ? null : roundQty(it.max * starchKg);
    let a = t;
    if (it.ingredient === "fecula") a = t;
    else if (it.ingredient === "reggianito" || it.ingredient === "huevo") a = t;
    else if (it.ingredient === "leche") a = Math.round(starchKg * rng.range(0.28, 0.39));
    else if (it.ingredient === "manteca") a = Math.round(starchKg * rng.range(0.134, 0.2) * 2) / 2;
    else if (it.ingredient === "queso_barra") a = Math.round(starchKg * rng.range(0.2945, 0.2995) * 10) / 10;
    else if (it.ingredient === "sal") a = Math.round(starchKg * rng.range(0.0256, 0.0298) * 20) / 20;
    if (lo != null) a = Math.max(a, lo);
    if (hi != null) a = Math.min(a, hi);
    if (forceOut === it.ingredient) {
      a = it.ingredient === "sal" ? roundQty((hi ?? t) * 1.12) : roundQty((lo ?? t) * 0.95);
      outOfRangeFor.add(it.ingredient);
    }
    actual[it.ingredient] = roundQty(a);
  }
  for (const it of RECIPE) {
    const need = actual[it.ingredient]!;
    const stock = rawStock(ctx, it.ingredient);
    if (stock < need) emergencyPurchase(ctx, day, "08:40", it.ingredient, need - stock);
  }

  const runId = ctx.rng.uuid();
  const planId = ctx.rng.uuid();
  const runNumber = 1;
  const startAt = at(day, "08:55");
  const consumeAt = at(day, "09:25");

  // --- Pesadas: kg por forma a partir de lo que se va a envasar --------------------------------
  const kgBy = { tapita: 0, arito: 0, lenguita: 0 };
  for (const [prod, u] of Object.entries(units)) {
    const info = ctx.products[prod]!;
    const kg = u * info.weightKg;
    if (info.shape === "mixed") {
      kgBy.tapita += kg / 3;
      kgBy.arito += kg / 3;
      kgBy.lenguita += kg / 3;
    } else kgBy[info.shape as keyof typeof kgBy] += kg;
  }
  const weighed: [keyof typeof kgBy, number][] = (["tapita", "arito", "lenguita"] as const).map((shape) => [
    shape,
    Math.round((kgBy[shape] / PACK_EFFICIENCY) * (1 + rng.range(-0.004, 0.006)) * 10) / 10,
  ]);
  const weighedTotal = roundQty(weighed.reduce((a, [, kg]) => a + kg, 0));

  // --- Filas ---------------------------------------------------------------------------------------------
  const lateEntry = day === "2026-08-03" || day === "2026-09-14";
  const plannedKg = Math.round(starchKg * 1.975);
  ctx.buf.productionPlans.push({
    id: planId,
    date: day,
    status: "done",
    totalKg: plannedKg,
    notes: null,
    ...stamp(at(addDays(day, -1), "17:00")),
  });
  for (const [shape, kg] of weighed) {
    ctx.buf.productionPlanItems.push({
      planId,
      shape,
      kg: Math.round(kg),
      ...stamp(at(addDays(day, -1), "17:00")),
    });
  }
  const crew = ["jt", "sg", "ea", "sr"].filter((u) => u === "ea" || rng.chance(0.93));
  const runRow = {
    id: runId,
    date: day,
    runNumber,
    shift: "morning" as const,
    recipeId: ctx.refs.recipeId,
    planId,
    starchKg,
    batches: starchKg > 40 ? 2 : 1,
    status: "freezing" as "freezing" | "packed" | "closed",
    responsibleId: ctx.users.af!,
    supervisorId: ctx.users.nr!,
    freezerCodes: [rng.chance(0.5) ? "F1" : "F2", rng.chance(0.5) ? "F2" : "F1"].filter(
      (c, i, arr) => arr.indexOf(c) === i,
    ),
    frozenAt: at(day, `${13 + rng.int(0, 1)}:${String(rng.int(0, 5) * 10).padStart(2, "0")}`),
    lateEntry,
    notes: lateEntry ? "Registro cargado al día siguiente por la tarde." : null,
    ...stamp(lateEntry ? at(addDays(day, 1), "09:30") : startAt),
  };
  ctx.buf.productionRuns.push(runRow);
  for (const u of ["af", ...crew]) {
    ctx.buf.productionRunWorkers.push({ runId, userId: ctx.users[u]!, ...stamp(startAt) });
  }

  // --- Consumos por lote FEFO -------------------------------------------------------------------------------
  for (const it of RECIPE) {
    const total = actual[it.ingredient]!;
    const taken = takeRaw(ctx, it.ingredient, total)!;
    const t = theoretical[it.ingredient]!;
    let assigned = 0;
    taken.forEach((x, i) => {
      const last = i === taken.length - 1;
      const share = last ? roundQty(t - assigned) : roundQty((t * x.qty) / total);
      assigned = roundQty(assigned + share);
      ctx.buf.productionConsumptions.push({
        runId,
        ingredientId: ctx.ingId[it.ingredient]!,
        rawLotId: x.lot.id,
        qtyTheoretical: share,
        qtyActual: x.qty,
        outOfRange: outOfRangeFor.has(it.ingredient),
        notes: outOfRangeFor.has(it.ingredient) ? "Revisar dosificación con la jefa de producción." : null,
        ...stamp(consumeAt),
      });
      moveIngredient(ctx, {
        at: consumeAt,
        type: "production_consumption",
        ing: it.ingredient,
        lotId: x.lot.id,
        loc: x.lot.loc,
        qty: -x.qty,
        refTable: "production_runs",
        refId: runId,
        by: ctx.users.af!,
      });
    });
    (ctx.usage[it.ingredient] ??= []).push({ date: day, qty: total });
  }

  // --- Pesadas ---------------------------------------------------------------------------------------------------
  const weigher = ctx.users[rng.chance(0.6) ? "sg" : "sr"]!;
  weighed.forEach(([shape, kg], i) => {
    ctx.buf.productionWeighings.push({
      runId,
      shape,
      kg,
      weighedById: weigher,
      weighedAt: plusMin(at(day, "12:05"), i * 4),
      ...stamp(plusMin(at(day, "12:05"), i * 4)),
    });
  });

  ctx.unpackedRuns.push({ runId, date: day, runNumber, units });
  void weighedTotal;
  return { runId, starchKg, weighedKg: weighedTotal };
}

/** Envasa las corridas pendientes (de ayer o del viernes) al arrancar el día. */
export function packPending(ctx: Ctx, day: IsoDate) {
  const rng = ctx.rng;
  const pending = ctx.unpackedRuns.filter((r) => r.date < day);
  ctx.unpackedRuns = ctx.unpackedRuns.filter((r) => r.date >= day);
  let minute = 0;
  for (const run of pending) {
    const lotId = ctx.rng.uuid();
    const code = finishedLotCode(run.date, run.runNumber);
    const lot = {
      id: lotId,
      code,
      productionDate: run.date,
      expiry: finishedLotExpiry(run.date),
      runId: run.runId,
    };
    ctx.finishedLots.push(lot);
    ctx.lotByDate[run.date] = lot;
    const lotAt = at(day, "07:35");
    ctx.buf.finishedLots.push({
      id: lotId,
      code,
      runId: run.runId,
      productionDate: run.date,
      expiryDate: lot.expiry,
      onHold: false,
      ...stamp(lotAt),
    });
    for (const prod of productKeys) {
      const units = run.units[prod] ?? 0;
      if (units <= 0) continue;
      const info = ctx.products[prod]!;
      const loc: FinLoc =
        info.presentation === "bulk_5kg"
          ? rng.chance(0.8)
            ? "f4"
            : "f3"
          : prod === "len500"
            ? rng.chance(0.55)
              ? "f4"
              : "f3"
            : rng.chance(0.85)
              ? "f3"
              : "f4";
      const packedAt = plusMin(at(day, "07:40"), minute);
      minute += rng.int(2, 5);
      const packingId = rng.uuid();
      ctx.buf.packings.push({
        id: packingId,
        finishedLotId: lotId,
        productId: info.id,
        units,
        kg: roundQty(units * info.weightKg),
        locationId: ctx.loc[loc]!,
        packedById: ctx.users[rng.chance(0.5) ? "sr" : "sg"]!,
        packedAt,
        ...stamp(packedAt),
      });
      finishedPosition(ctx, prod, lotId, loc)!.qty += units;
      moveProduct(ctx, {
        at: packedAt,
        type: "production_output",
        product: prod,
        lotId,
        loc,
        qty: units,
        refTable: "packings",
        refId: packingId,
        by: ctx.users.af!,
      });
      // Envase (no se mide el lote del envase: se toma de la bobina más antigua).
      const bag = info.presentation === "bulk_5kg" ? "bolsa5k" : "bolsa500";
      for (const t of takePackaging(ctx, day, bag, units)) {
        moveIngredient(ctx, {
          at: packedAt,
          type: "production_consumption",
          ing: bag,
          lotId: t.lot.id,
          loc: "seco",
          qty: -t.qty,
          refTable: "packings",
          refId: packingId,
          note: `Envase de ${D.PRODUCTS.find((x) => x.key === prod)!.name}`,
          by: ctx.users.af!,
        });
      }
      (ctx.usage[bag] ??= []).push({ date: day, qty: units });
    }
    const row = ctx.buf.productionRuns.find((r) => r.id === run.runId)!;
    row.status = diffDays(day, run.date) > 6 ? "closed" : "packed";
  }
  // Los viernes no hay envasado: el abatidor guarda la tanda hasta el lunes.
  void isoWeekday;
}

/** Cierra el estado de las corridas packed con más de una semana (para que el tablero muestre ambos). */
export function closeOldRuns(ctx: Ctx, today: IsoDate) {
  for (const r of ctx.buf.productionRuns) {
    if (r.status === "packed" && diffDays(today, r.date) > 7) r.status = "closed";
  }
}
