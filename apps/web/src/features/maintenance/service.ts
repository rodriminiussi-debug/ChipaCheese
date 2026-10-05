import {
  complianceRate,
  diffDays,
  maintenanceStatus,
  monthBounds,
  nextMaintenanceDue,
  type IsoDate,
} from "@chipa/domain";
import { and, asc, count, desc, eq, inArray, isNotNull, lte, schema, type Executor } from "@chipa/db";
import { todayAR } from "@/lib/dates";
import { UserError } from "@/server/errors";
import type {
  CloseCorrectiveData,
  CorrectiveData,
  PlanData,
  RegisterPreventiveData,
  ReportFaultData,
} from "./schemas";

/**
 * Servicio de mantenimiento (M7, RF-37): planes preventivos por equipo con su próximo vencimiento,
 * registro de preventivos hechos, órdenes correctivas e historial por equipo.
 */

export type PlanStatus = "ok" | "due_soon" | "overdue";
const STATUS_RANK: Record<PlanStatus, number> = { overdue: 0, due_soon: 1, ok: 2 };

export interface PlanRow {
  id: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  area: string;
  task: string;
  frequencyDays: number;
  startDate: IsoDate;
  lastDoneAt: IsoDate | null;
  active: boolean;
  nextDue: IsoDate;
  /** Días hasta el vencimiento (negativo = atrasado). */
  daysLeft: number;
  status: PlanStatus;
}

/** Planes con próximo vencimiento y estado, los más urgentes primero. */
export async function listPlans(
  db: Executor,
  opts: { today?: IsoDate; equipmentId?: string; includeInactive?: boolean } = {},
): Promise<PlanRow[]> {
  const today = opts.today ?? todayAR();
  const p = schema.maintenancePlans;
  const rows = await db
    .select({
      id: p.id,
      equipmentId: p.equipmentId,
      equipmentCode: schema.equipment.code,
      equipmentName: schema.equipment.name,
      area: schema.equipment.area,
      task: p.task,
      frequencyDays: p.frequencyDays,
      startDate: p.startDate,
      lastDoneAt: p.lastDoneAt,
      active: p.active,
    })
    .from(p)
    .innerJoin(schema.equipment, eq(schema.equipment.id, p.equipmentId))
    .where(
      and(
        opts.includeInactive ? undefined : eq(p.active, true),
        opts.equipmentId ? eq(p.equipmentId, opts.equipmentId) : undefined,
      ),
    );
  return rows
    .map((r) => {
      const nextDue = nextMaintenanceDue(r.lastDoneAt, r.frequencyDays, r.startDate);
      return { ...r, nextDue, daysLeft: diffDays(nextDue, today), status: maintenanceStatus(nextDue, today) };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        a.nextDue.localeCompare(b.nextDue) ||
        a.equipmentCode.localeCompare(b.equipmentCode),
    );
}

export async function maintenanceFormOptions(db: Executor) {
  const [equipment, users] = await Promise.all([
    db.query.equipment.findMany({
      where: eq(schema.equipment.active, true),
      orderBy: [asc(schema.equipment.area), asc(schema.equipment.name)],
    }),
    db.query.users.findMany({
      where: and(eq(schema.users.active, true), inArray(schema.users.role, ["admin", "production_manager"])),
      orderBy: asc(schema.users.name),
    }),
  ]);
  return {
    equipment: equipment.map((e) => ({ id: e.id, code: e.code, name: e.name, area: e.area })),
    people: users.map((u) => ({ id: u.id, name: u.name })),
  };
}
export type MaintenanceFormOptions = Awaited<ReturnType<typeof maintenanceFormOptions>>;

// --- Planes ----------------------------------------------------------------------------------------------

export async function createPlan(db: Executor, input: PlanData) {
  const [row] = await db.insert(schema.maintenancePlans).values(input).returning();
  return row!;
}

export async function updatePlan(db: Executor, id: string, input: PlanData) {
  const [row] = await db
    .update(schema.maintenancePlans)
    .set(input)
    .where(eq(schema.maintenancePlans.id, id))
    .returning();
  if (!row) throw new UserError("El plan no existe.");
  return row;
}

/**
 * Registra un preventivo hecho: crea una orden `done` (tipo preventivo, ligada al plan) y actualiza
 * `lastDoneAt` del plan (nunca hacia atrás: cargar un preventivo viejo no adelanta el vencimiento).
 */
export async function registerPreventive(
  db: Executor,
  userId: string,
  input: RegisterPreventiveData,
  today: IsoDate = todayAR(),
) {
  const plan = await db.query.maintenancePlans.findFirst({
    where: eq(schema.maintenancePlans.id, input.planId),
  });
  if (!plan) throw new UserError("El plan no existe.");
  if (!plan.active) throw new UserError("El plan está dado de baja.");
  if (input.date > today) throw new UserError("No se puede registrar un preventivo en una fecha futura.");
  const [order] = await db
    .insert(schema.maintenanceOrders)
    .values({
      equipmentId: plan.equipmentId,
      planId: plan.id,
      type: "preventive",
      status: "done",
      activity: input.notes ? `${plan.task} — ${input.notes}` : plan.task,
      spareParts: input.spareParts,
      cost: input.cost,
      date: input.date,
      doneAt: input.date,
      responsibleId: userId,
      supervisorId: input.supervisorId,
    })
    .returning();
  if (!plan.lastDoneAt || input.date > plan.lastDoneAt) {
    await db
      .update(schema.maintenancePlans)
      .set({ lastDoneAt: input.date })
      .where(eq(schema.maintenancePlans.id, plan.id));
  }
  return order!;
}

// --- Correctivos -------------------------------------------------------------------------------------------

export function listOrders(
  db: Executor,
  f: {
    type?: "preventive" | "corrective";
    status?: "open" | "done" | "cancelled";
    equipmentId?: string;
    limit?: number;
  } = {},
) {
  const o = schema.maintenanceOrders;
  return db.query.maintenanceOrders.findMany({
    where: and(
      f.type ? eq(o.type, f.type) : undefined,
      f.status ? eq(o.status, f.status) : undefined,
      f.equipmentId ? eq(o.equipmentId, f.equipmentId) : undefined,
    ),
    orderBy: [desc(o.date), desc(o.createdAt)],
    limit: f.limit,
    with: { equipment: true, responsible: true, supervisor: true, reportedBy: true },
  });
}
export type OrderRow = Awaited<ReturnType<typeof listOrders>>[number];

export async function createCorrective(
  db: Executor,
  userId: string,
  input: CorrectiveData,
  today: IsoDate = todayAR(),
) {
  const { closed, ...v } = input;
  if (v.date > today) throw new UserError("No se puede registrar un correctivo en una fecha futura.");
  const [row] = await db
    .insert(schema.maintenanceOrders)
    .values({
      ...v,
      type: "corrective",
      status: closed ? "done" : "open",
      doneAt: closed ? v.date : null,
      responsibleId: v.responsibleId ?? userId,
    })
    .returning();
  return row!;
}

// --- Avisos de falla ---------------------------------------------------------------------------------------

/** Equipos a los que se les puede avisar una falla: máquinas, freezers, heladera y el equipo de frío del vehículo. */
export async function faultEquipmentOptions(db: Executor) {
  const equipment = await db.query.equipment.findMany({
    where: eq(schema.equipment.active, true),
    orderBy: [asc(schema.equipment.area), asc(schema.equipment.name)],
  });
  return equipment.map((e) => ({ id: e.id, code: e.code, name: e.name, area: e.area }));
}
export type FaultEquipmentOption = Awaited<ReturnType<typeof faultEquipmentOptions>>[number];

/**
 * Aviso de falla de quien la ve (operario, chofer, local, jefa): crea una orden correctiva ABIERTA con
 * quién y cuándo avisó. Mantenimiento la completa (causa, repuesto, costo) y la cierra.
 */
export async function reportFault(
  db: Executor,
  userId: string,
  input: ReportFaultData,
  now: Date = new Date(),
  today: IsoDate = todayAR(),
) {
  const equipment = await db.query.equipment.findFirst({
    where: eq(schema.equipment.id, input.equipmentId),
  });
  if (!equipment || !equipment.active) throw new UserError("El equipo no existe.");
  const [row] = await db
    .insert(schema.maintenanceOrders)
    .values({
      equipmentId: equipment.id,
      type: "corrective",
      status: "open",
      activity: input.description,
      date: today,
      stopped: input.stopped,
      reportedById: userId,
      reportedAt: now,
    })
    .returning();
  return { id: row!.id, equipmentName: equipment.name, stopped: input.stopped };
}

/** Fallas avisadas que siguen abiertas (las paradas primero): lo que la jefa y Dirección tienen que mirar. */
export function listOpenFaultReports(db: Executor) {
  const o = schema.maintenanceOrders;
  return db.query.maintenanceOrders.findMany({
    where: and(eq(o.type, "corrective"), eq(o.status, "open"), isNotNull(o.reportedAt)),
    orderBy: [desc(o.stopped), desc(o.reportedAt)],
    with: { equipment: true, reportedBy: true },
  });
}
export type FaultReportRow = Awaited<ReturnType<typeof listOpenFaultReports>>[number];

export async function updateCorrective(db: Executor, id: string, input: CorrectiveData) {
  const { closed, ...v } = input;
  const current = await db.query.maintenanceOrders.findFirst({ where: eq(schema.maintenanceOrders.id, id) });
  if (!current || current.type !== "corrective") throw new UserError("La orden no existe.");
  const [row] = await db
    .update(schema.maintenanceOrders)
    .set({
      ...v,
      status: closed ? "done" : "open",
      doneAt: closed ? (current.doneAt ?? v.date) : null,
      responsibleId: v.responsibleId ?? current.responsibleId,
    })
    .where(eq(schema.maintenanceOrders.id, id))
    .returning();
  return row!;
}

/** Cierra una orden correctiva con lo que se hizo, repuesto, costo y tiempo de parada. */
export async function closeCorrective(db: Executor, input: CloseCorrectiveData, today: IsoDate = todayAR()) {
  const current = await db.query.maintenanceOrders.findFirst({
    where: eq(schema.maintenanceOrders.id, input.id),
  });
  if (!current || current.type !== "corrective") throw new UserError("La orden no existe.");
  if (current.status === "done") throw new UserError("La orden ya está cerrada.");
  if (input.doneAt > today) throw new UserError("La fecha de cierre no puede ser futura.");
  if (input.doneAt < current.date)
    throw new UserError("El cierre no puede ser anterior a la fecha de la orden.");
  const [row] = await db
    .update(schema.maintenanceOrders)
    .set({
      status: "done",
      doneAt: input.doneAt,
      activity: input.activity,
      spareParts: input.spareParts ?? current.spareParts,
      cost: input.cost ?? current.cost,
      downtimeMinutes: input.downtimeMinutes ?? current.downtimeMinutes,
    })
    .where(eq(schema.maintenanceOrders.id, input.id))
    .returning();
  return row!;
}

// --- Equipos e historial -----------------------------------------------------------------------------------

export interface EquipmentSummary {
  id: string;
  code: string;
  name: string;
  area: string;
  plans: number;
  worstStatus: PlanStatus | null;
  correctives: number;
  openCorrectives: number;
  lastCorrective: IsoDate | null;
  downtimeMinutes: number;
}

/** Resumen por equipo: planes, peor estado, correctivos totales y abiertos (los repetidos se ven acá). */
export async function equipmentSummaries(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<EquipmentSummary[]> {
  const [equipment, plans, orders] = await Promise.all([
    db.query.equipment.findMany({
      where: eq(schema.equipment.active, true),
      orderBy: [asc(schema.equipment.area), asc(schema.equipment.name)],
    }),
    listPlans(db, { today }),
    db.query.maintenanceOrders.findMany({ where: eq(schema.maintenanceOrders.type, "corrective") }),
  ]);
  return equipment
    .map((e) => {
      const ps = plans.filter((p) => p.equipmentId === e.id);
      const os = orders.filter((o) => o.equipmentId === e.id && o.status !== "cancelled");
      const worst = ps.length
        ? ps.reduce((a, b) => (STATUS_RANK[b.status] < STATUS_RANK[a.status] ? b : a)).status
        : null;
      return {
        id: e.id,
        code: e.code,
        name: e.name,
        area: e.area,
        plans: ps.length,
        worstStatus: worst,
        correctives: os.length,
        openCorrectives: os.filter((o) => o.status === "open").length,
        lastCorrective:
          os
            .map((o) => o.date)
            .sort()
            .at(-1) ?? null,
        downtimeMinutes: os.reduce((a, o) => a + (o.downtimeMinutes ?? 0), 0),
      };
    })
    .filter((e) => e.plans > 0 || e.correctives > 0);
}

export interface RepeatedFailure {
  /** Causa o actividad normalizada. */
  label: string;
  count: number;
  dates: IsoDate[];
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Historial de un equipo: planes, órdenes y fallas repetidas (misma causa en 2 o más correctivos). */
export async function equipmentHistory(db: Executor, equipmentId: string, today: IsoDate = todayAR()) {
  const equipment = await db.query.equipment.findFirst({ where: eq(schema.equipment.id, equipmentId) });
  if (!equipment) return null;
  const [plans, orders] = await Promise.all([
    listPlans(db, { today, equipmentId, includeInactive: true }),
    listOrders(db, { equipmentId }),
  ]);
  const groups = new Map<string, { label: string; dates: IsoDate[] }>();
  for (const o of orders.filter((x) => x.type === "corrective" && x.status !== "cancelled")) {
    const key = norm(o.cause ?? o.activity);
    const g = groups.get(key) ?? { label: o.cause ?? o.activity, dates: [] };
    g.dates.push(o.date);
    groups.set(key, g);
  }
  const repeated: RepeatedFailure[] = [...groups.values()]
    .filter((g) => g.dates.length >= 2)
    .map((g) => ({ label: g.label, count: g.dates.length, dates: g.dates.sort() }))
    .sort((a, b) => b.count - a.count);
  const correctives = orders.filter((o) => o.type === "corrective" && o.status !== "cancelled");
  return {
    equipment,
    plans,
    orders,
    repeated,
    totals: {
      correctives: correctives.length,
      cost: correctives.reduce((a, o) => a + (o.cost ?? 0), 0),
      downtimeMinutes: correctives.reduce((a, o) => a + (o.downtimeMinutes ?? 0), 0),
    },
  };
}

// --- Indicadores y alertas ------------------------------------------------------------------------------------

/**
 * "Preventivos cumplidos" del mes = hechos ÷ programados. Programado = plan activo cuyo vencimiento
 * (contando desde la última vez hecho ANTES del mes) cae hasta fin de mes; hecho = tiene una orden
 * preventiva cerrada dentro del mes. null si no había nada programado.
 */
export async function preventiveCompliance(
  db: Executor,
  today: IsoDate = todayAR(),
  month = today.slice(0, 7),
) {
  const { from, to } = monthBounds(month);
  const plans = await db.query.maintenancePlans.findMany({
    where: and(eq(schema.maintenancePlans.active, true), lte(schema.maintenancePlans.startDate, to)),
  });
  if (plans.length === 0) return { expected: 0, done: 0, pct: null as number | null };
  const orders = await db
    .select({ planId: schema.maintenanceOrders.planId, doneAt: schema.maintenanceOrders.doneAt })
    .from(schema.maintenanceOrders)
    .where(
      and(
        eq(schema.maintenanceOrders.type, "preventive"),
        eq(schema.maintenanceOrders.status, "done"),
        inArray(
          schema.maintenanceOrders.planId,
          plans.map((p) => p.id),
        ),
        lte(schema.maintenanceOrders.doneAt, to),
      ),
    );
  let expected = 0;
  let done = 0;
  for (const p of plans) {
    const mine = orders.filter((o) => o.planId === p.id && o.doneAt);
    const before =
      mine
        .map((o) => o.doneAt!)
        .filter((d) => d < from)
        .sort()
        .at(-1) ?? null;
    if (nextMaintenanceDue(before, p.frequencyDays, p.startDate) > to) continue;
    expected++;
    if (mine.some((o) => o.doneAt! >= from)) done++;
  }
  return { expected, done, pct: complianceRate(done, expected) };
}

export interface MaintenanceAlerts {
  /** Planes preventivos vencidos. */
  overdue: number;
  /** Planes que vencen hoy o en los próximos 7 días. */
  dueSoon: number;
  /** % de preventivos cumplidos del mes; null si no había programados. */
  preventiveCompliancePct: number | null;
  /** Órdenes correctivas abiertas. */
  openCorrectives: number;
}

export async function getMaintenanceAlerts(
  db: Executor,
  today: IsoDate = todayAR(),
): Promise<MaintenanceAlerts> {
  const [plans, compliance, [open]] = await Promise.all([
    listPlans(db, { today }),
    preventiveCompliance(db, today),
    db
      .select({ n: count() })
      .from(schema.maintenanceOrders)
      .where(
        and(eq(schema.maintenanceOrders.type, "corrective"), eq(schema.maintenanceOrders.status, "open")),
      ),
  ]);
  return {
    overdue: plans.filter((p) => p.status === "overdue").length,
    dueSoon: plans.filter((p) => p.status === "due_soon").length,
    preventiveCompliancePct: compliance.pct,
    openCorrectives: open?.n ?? 0,
  };
}
