import { addDays, isoWeekday, type IsoDate } from "@chipa/domain";
import { at, clock, isWorkday, mondayOf, nextWorkday, plusMin, prevWorkday } from "./calendar";
import { TODAY, stamp, type Ctx } from "./ctx";
import * as D from "../data";

/**
 * Calidad y mantenimiento: limpieza casi completa (con algunos huecos y cargas tardías), temperaturas diarias
 * (dos fuera de rango con su acción correctiva), reclamos, plan preventivo y correctivos de la Biscomatic.
 */

// --- Limpieza ---------------------------------------------------------------------------------------------------------------

const CLEANER: Record<string, string> = {
  "Moldes y útiles": "jt",
  Batidora: "jt",
  Bandejas: "jt",
  "Amasadora y sector": "ea",
  Biscomatic: "sr",
  Pisos: "rot",
  "Selladora y balanza": "sg",
  "Freezer F1": "jt",
  "Freezer F2": "ea",
};

const DEEPEN_NOTES: Record<string, string> = {
  "Moldes y útiles": "Hay que remojar los moldes más tiempo",
  Batidora: "Reforzar la paleta y el aro",
  Bandejas: "Grasa acumulada en las bandejas viejas",
  "Amasadora y sector": "Desengrasar el fondo de la amasadora",
  Biscomatic: "Limpiar la zona del alambre de corte",
  Pisos: "Zócalos y juntas",
  "Selladora y balanza": "Limpiar el teflón",
  "Freezer F1": "Hielo en las paredes",
  "Freezer F2": "Hielo en las paredes",
};

/** Probabilidad de que el registro del día esté (huecos puntuales de la planilla). */
const CLEANING_GAPS: Record<IsoDate, number> = {
  "2026-07-21": 0.15,
  "2026-08-25": 0.2,
  "2026-08-26": 0.3,
  "2026-09-23": 0.55,
};

export function cleaningDay(ctx: Ctx, day: IsoDate) {
  if (!isWorkday(day) || day >= TODAY) return;
  const rng = ctx.rng;
  const produced = ctx.buf.productionRuns.some((r) => r.date === day);
  const rotation = ["jt", "sg", "ea", "sr"];
  const rot = rotation[Number(day.slice(8, 10)) % 4]!;
  for (const p of ctx.sanitation) {
    if (p.frequency === "monthly") continue;
    // El semanal (F1 y F2) se hace el último día hábil de la semana.
    if (p.frequency === "weekly" && nextWorkday(day) <= addDays(mondayOf(day), 6)) continue;
    const keep = day >= "2026-09-28" ? 1 : (CLEANING_GAPS[day] ?? (produced ? 0.965 : 0.9));
    if (!rng.chance(keep)) continue;
    const who = CLEANER[p.element] ?? "jt";
    const userKey = who === "rot" ? rot : who;
    const deepen = rng.chance(0.055);
    const late = rng.chance(0.06);
    const recordedAt = late
      ? at(nextWorkday(day), clock(8 * 60 + rng.int(25, 70)))
      : at(day, clock(17 * 60 + rng.int(5, 55)));
    ctx.buf.cleaningRecords.push({
      pointId: p.id,
      date: day,
      result: deepen ? "deepen" : "ok",
      userId: ctx.users[userKey]!,
      recordedAt,
      lateEntry: late,
      notes: deepen ? (DEEPEN_NOTES[p.element] ?? null) : null,
      ...stamp(recordedAt),
    });
  }
}

// --- Temperaturas -------------------------------------------------------------------------------------------------------------------

const TEMP_EQUIPMENT = ["f1", "f2", "f3", "f4", "heladera"] as const;

export function temperatureDay(ctx: Ctx, day: IsoDate) {
  if (!isWorkday(day)) return;
  const rng = ctx.rng;
  TEMP_EQUIPMENT.forEach((key, i) => {
    const today = day === TODAY;
    if (!today && rng.chance(0.035)) return; // lectura que se olvidaron de tomar
    let value =
      key === "heladera"
        ? Math.min(4.7, Math.max(1.2, rng.gauss(3.0, 0.7)))
        : key === "f1" || key === "f2"
          ? Math.min(-19.5, rng.gauss(-23.2, 1.4))
          : Math.min(-18.6, rng.gauss(-20.4, 0.9));
    let action: string | null = null;
    if (day === "2026-08-12" && key === "f3") {
      value = -15.4;
      action =
        "La tapa quedó mal cerrada. Se cerró, se reacomodó la carga y se volvió a medir a las 11:30 (-19,2 °C).";
    }
    if (day === "2026-09-08" && key === "heladera") {
      value = 7.4;
      action =
        "Corte de luz de unas 2 horas durante la noche. Se revisó la materia prima, se descartaron 6 L de leche y se volvió a medir a las 12:00 (3,8 °C).";
    }
    value = Math.round(value * 10) / 10;
    const late = !today && rng.chance(0.03);
    const measuredAt = late
      ? at(nextWorkday(day), clock(8 * 60 + rng.int(35, 75)))
      : at(day, clock(7 * 60 + 40 + i * 3 + rng.int(0, 25)));
    const eq = ctx.refs.equipment[key]!;
    const out = key === "heladera" ? value > 5 || value < 0 : value > -18;
    ctx.buf.temperatureLogs.push({
      equipmentId: eq,
      date: day,
      measuredAt,
      valueC: value,
      outOfRange: out,
      userId: ctx.users[rng.pick(["jt", "sg", "ea", "sr"])]!,
      source: "manual",
      lateEntry: late,
      correctiveAction: action,
      ...stamp(measuredAt),
    });
    // Re-medición posterior a la acción correctiva.
    if (action) {
      const again = at(day, key === "heladera" ? "12:00" : "11:30");
      ctx.buf.temperatureLogs.push({
        equipmentId: eq,
        date: day,
        measuredAt: again,
        valueC: key === "heladera" ? 3.8 : -19.2,
        outOfRange: false,
        userId: ctx.users.jt!,
        source: "manual",
        lateEntry: false,
        correctiveAction: null,
        ...stamp(again),
      });
    }
  });
}

// --- Reclamos ---------------------------------------------------------------------------------------------------------------------------

/** Lote producido en la fecha más cercana (hacia atrás) a `date`. */
function lotBefore(ctx: Ctx, date: IsoDate) {
  const dates = Object.keys(ctx.lotByDate)
    .filter((d) => d <= date)
    .sort();
  const d = dates[dates.length - 1];
  return d ? ctx.lotByDate[d]! : null;
}

export function complaints(ctx: Ctx) {
  const byKey = (k: string) => ctx.customers.find((c) => c.key === k)!;
  const l1 = lotBefore(ctx, "2026-08-13");
  const l2 = lotBefore(ctx, "2026-09-22");
  ctx.buf.complaints.push(
    {
      date: "2026-08-19",
      customerId: byKey("naturaleza").id,
      finishedLotId: l1?.id ?? null,
      qtyUnits: 4,
      reason: "Bolsas mal selladas: se abrieron en el freezer del comercio",
      customerAction: "Nota de crédito por 4 bolsas (NC A 0002-00000021)",
      productAction:
        "Se revisó la temperatura y el teflón de la selladora; se reforzó el control de sellado al envasar.",
      status: "closed",
      supervisorId: ctx.users.nr!,
      userId: ctx.users.af!,
      ...stamp(at("2026-08-19", "11:40")),
    },
    {
      date: "2026-09-28",
      customerId: byKey("vidasana").id,
      finishedLotId: l2?.id ?? null,
      qtyUnits: 6,
      reason: "Producto con escarcha: posible corte de la cadena de frío en el reparto",
      customerAction: "Reposición sin cargo en la próxima entrega",
      productAction: "Se revisaron los registros de temperatura del vehículo y de F4; en seguimiento.",
      status: "open",
      supervisorId: ctx.users.nr!,
      userId: ctx.users.af!,
      ...stamp(at("2026-09-28", "15:10")),
    },
  );
}

// --- Mantenimiento ---------------------------------------------------------------------------------------------------------------------------

export interface PlanRef {
  id: string;
  equipment: string;
  task: string;
  frequencyDays: number;
}

type Prev = { match: RegExp; equipment: string; dates: IsoDate[]; cost?: number; spare?: string };

const PREVENTIVES: Prev[] = [
  {
    equipment: "biscomatic",
    match: /alambre/i,
    dates: ["2026-07-06", "2026-08-05", "2026-09-04", "2026-10-01"],
    cost: 10_500,
    spare: "Alambre de corte",
  },
  {
    equipment: "biscomatic",
    match: /lubricaci/i,
    dates: ["2026-08-12"],
    cost: 6_800,
    spare: "Grasa grado alimenticio",
  },
  { equipment: "amasadora", match: /correas/i, dates: ["2026-08-18"] },
  { equipment: "batidora", match: /engranajes/i, dates: ["2026-07-02"] },
  { equipment: "f1", match: /condensador/i, dates: ["2026-08-25"] },
  { equipment: "f2", match: /condensador/i, dates: ["2026-08-25"] },
  { equipment: "f3", match: /condensador/i, dates: ["2026-09-01"] },
  { equipment: "f4", match: /condensador/i, dates: ["2026-09-01"] },
  {
    equipment: "vehiculo",
    match: /fr[ií]o/i,
    dates: ["2026-07-28"],
    cost: 48_000,
    spare: "Filtro y gas refrigerante",
  },
  {
    equipment: "selladora",
    match: /resistencia/i,
    dates: ["2026-07-29", "2026-09-25"],
    cost: 3_900,
    spare: "Cinta de teflón",
  },
  {
    equipment: "balanza",
    match: /pesa patr/i,
    dates: ["2026-07-07", "2026-08-06", "2026-09-08", "2026-10-02"],
  },
];

const CORRECTIVES: {
  equipment: string;
  date: IsoDate;
  activity: string;
  cause: string;
  spare?: string;
  cost?: number;
  downtime?: number;
  open?: boolean;
}[] = [
  {
    equipment: "biscomatic",
    date: "2026-05-12",
    activity: "Cambio de alambre de corte",
    cause: "Alambre cortado",
    spare: "Alambre de corte",
    cost: 8_900,
    downtime: 70,
  },
  {
    equipment: "f4",
    date: "2026-06-03",
    activity: "Cambio de burlete de la tapa",
    cause: "Burlete deteriorado",
    spare: "Burlete",
    cost: 24_000,
    downtime: 0,
  },
  {
    equipment: "biscomatic",
    date: "2026-07-22",
    activity: "Corte de alambre y reajuste de tensión",
    cause: "Alambre cortado",
    spare: "Alambre de corte",
    cost: 10_500,
    downtime: 55,
  },
  {
    equipment: "f3",
    date: "2026-08-13",
    activity: "Cambio de burlete y ajuste de bisagras",
    cause: "Tapa que no cerraba bien (evento del 12/08)",
    spare: "Burlete",
    cost: 31_500,
    downtime: 40,
  },
  {
    equipment: "biscomatic",
    date: "2026-08-26",
    activity: "Cambio de alambre de corte",
    cause: "Alambre cortado",
    spare: "Alambre de corte",
    cost: 10_800,
    downtime: 45,
  },
  {
    equipment: "selladora",
    date: "2026-09-09",
    activity: "Cambio de teflón de la selladora",
    cause: "Teflón quemado",
    spare: "Cinta de teflón",
    cost: 7_200,
    downtime: 30,
  },
  {
    equipment: "biscomatic",
    date: "2026-09-17",
    activity: "Reemplazo de correa de transmisión",
    cause: "Desgaste por uso",
    spare: "Correa de transmisión",
    cost: 28_000,
    downtime: 120,
  },
  {
    equipment: "selladora",
    date: "2026-09-30",
    activity: "Resistencia que no calienta parejo: a la espera del repuesto",
    cause: "Resistencia gastada",
    spare: "Resistencia 500 mm",
    open: true,
  },
];

/** Devuelve la última fecha hecha de cada plan (para actualizar `last_done_at`). */
export function maintenance(ctx: Ctx, plans: PlanRef[]) {
  const lastDone = new Map<string, IsoDate>();
  for (const prev of PREVENTIVES) {
    const plan = plans.find((p) => p.equipment === prev.equipment && prev.match.test(p.task));
    if (!plan) continue;
    for (const date of prev.dates) {
      if (date > TODAY) continue;
      ctx.buf.maintenanceOrders.push({
        equipmentId: ctx.refs.equipment[prev.equipment]!,
        planId: plan.id,
        type: "preventive",
        status: "done",
        activity: plan.task,
        spareParts: prev.spare ?? null,
        cost: prev.cost ?? null,
        date,
        doneAt: date,
        responsibleId: ctx.users.af!,
        supervisorId: ctx.users.nr!,
        ...stamp(at(date, "16:30")),
      });
      if (!lastDone.has(plan.id) || date > lastDone.get(plan.id)!) lastDone.set(plan.id, date);
    }
  }
  for (const c of CORRECTIVES) {
    ctx.buf.maintenanceOrders.push({
      equipmentId: ctx.refs.equipment[c.equipment]!,
      planId: null,
      type: "corrective",
      status: c.open ? "open" : "done",
      activity: c.activity,
      cause: c.cause,
      spareParts: c.spare ?? null,
      cost: c.cost ?? null,
      date: c.date,
      doneAt: c.open ? null : c.date,
      responsibleId: ctx.users.af!,
      supervisorId: ctx.users.nr!,
      downtimeMinutes: c.downtime ?? null,
      ...stamp(at(c.date, "15:00")),
    });
  }
  return lastDone;
}

// --- Pizarrón: asignación de tareas del día ---------------------------------------------------------------------------------------

export function taskAssignments(
  ctx: Ctx,
  day: IsoDate,
  tasks: { id: string; name: string }[],
  dayIndex: number,
) {
  const created = at(prevWorkday(day), "17:30");
  D.PLANT_TASKS.forEach((t, i) => {
    const task = tasks.find((x) => x.name === t.name);
    if (!task) return;
    const people = t.people as readonly string[];
    const chosen = t.name.startsWith("Pisos")
      ? [people[dayIndex % people.length]!]
      : t.name.startsWith("Sellado")
        ? [people[dayIndex % people.length]!, people[(dayIndex + 1) % people.length]!]
        : people.length > 1
          ? [people[(dayIndex + i) % people.length]!]
          : [people[0]!];
    for (const u of new Set(chosen)) {
      ctx.buf.taskAssignments.push({ date: day, taskId: task.id, userId: ctx.users[u]!, ...stamp(created) });
    }
  });
}

void plusMin;
