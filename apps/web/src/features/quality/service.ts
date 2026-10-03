import {
  addDays,
  cleaningExpectations,
  complianceRate,
  isCleaningDue,
  isLateEntry,
  monthBounds,
  startOfIsoWeek,
  temperatureStatus,
  type CleaningFrequency,
  type IsoDate,
} from "@chipa/domain";
import { and, asc, count, desc, eq, gte, inArray, lte, ne, schema, type Executor } from "@chipa/db";
import { todayAR, toIsoDateAR } from "@/lib/dates";
import { clampRecordedAt } from "@/lib/idempotency";
import { UserError } from "@/server/errors";
import type { ComplaintData } from "./schemas";

/**
 * Servicio de calidad (M7: RF-34 registros digitales, RF-38 alertas de temperatura).
 * Las funciones reciben un `Executor` y, cuando dependen del día, un `today` (por defecto `todayAR()`)
 * para poder testearse con el reloj congelado.
 */

const TEMP_KINDS = ["freezer", "fridge", "vehicle"] as const;
const KIND_RANK: Record<string, number> = { freezer: 0, fridge: 1, vehicle: 2 };

/** Un registro que dice haberse tomado en el futuro se corrige a "ahora" (ver `@/lib/idempotency`). */
export { clampRecordedAt };

// --- Limpieza (RF-34) --------------------------------------------------------------------------

export interface ChecklistItem {
  pointId: string;
  sector: string;
  element: string;
  frequency: CleaningFrequency;
  /** pending: corresponde hoy · done: registrado hoy · done_period: ya cubierto por un registro de la semana/mes. */
  status: "pending" | "done" | "done_period";
  result: "ok" | "deepen" | null;
  notes: string | null;
  doneDate: IsoDate | null;
  recordedAt: Date | null;
  userInitials: string | null;
}

/** Checklist del día: los puntos activos con lo que corresponde según su frecuencia. */
export async function cleaningChecklist(db: Executor, today: IsoDate = todayAR()): Promise<ChecklistItem[]> {
  const points = await db.query.sanitationPoints.findMany({
    where: eq(schema.sanitationPoints.active, true),
    orderBy: [asc(schema.sanitationPoints.sortOrder), asc(schema.sanitationPoints.element)],
  });
  const monthFrom = monthBounds(today).from;
  const weekFrom = startOfIsoWeek(today);
  const from = weekFrom < monthFrom ? weekFrom : monthFrom;
  const recs = await db
    .select({
      pointId: schema.cleaningRecords.pointId,
      date: schema.cleaningRecords.date,
      result: schema.cleaningRecords.result,
      notes: schema.cleaningRecords.notes,
      recordedAt: schema.cleaningRecords.recordedAt,
      initials: schema.users.initials,
    })
    .from(schema.cleaningRecords)
    .leftJoin(schema.users, eq(schema.users.id, schema.cleaningRecords.userId))
    .where(and(gte(schema.cleaningRecords.date, from), lte(schema.cleaningRecords.date, today)))
    .orderBy(desc(schema.cleaningRecords.date));
  return points.map((p) => {
    const mine = recs.filter((r) => r.pointId === p.id);
    const todayRec = mine.find((r) => r.date === today) ?? null;
    const due = isCleaningDue(
      p.frequency,
      today,
      mine.map((r) => r.date),
    );
    const last = todayRec ?? mine[0] ?? null;
    return {
      pointId: p.id,
      sector: p.sector,
      element: p.element,
      frequency: p.frequency,
      status: todayRec ? "done" : due ? "pending" : "done_period",
      result: todayRec?.result ?? null,
      notes: todayRec?.notes ?? null,
      doneDate: last?.date ?? null,
      recordedAt: todayRec?.recordedAt ?? null,
      userInitials: last?.initials ?? null,
    };
  });
}

export interface RecordCleaningInput {
  pointId: string;
  result: "ok" | "deepen";
  notes: string | null;
  clientId?: string | null;
  /** Día al que corresponde la limpieza. Si falta, es el día (argentino) de `recordedAt`. */
  date?: IsoDate | null;
  /** Momento real de la carga (de la tablet, o ahora). */
  recordedAt: Date;
}

/**
 * Registra una limpieza. Idempotente por `clientId` (el reenvío desde la cola offline no duplica) y por
 * punto+día (volver a marcar el mismo punto el mismo día corrige el registro; la auditoría guarda el historial).
 * Carga tardía = el día registrado es anterior al día en que se cargó.
 */
export async function recordCleaning(
  db: Executor,
  userId: string,
  input: RecordCleaningInput,
  today: IsoDate = todayAR(),
) {
  if (input.clientId) {
    const dup = await db.query.cleaningRecords.findFirst({
      where: eq(schema.cleaningRecords.clientId, input.clientId),
    });
    if (dup) return { record: dup, duplicate: true as const };
  }
  const point = await db.query.sanitationPoints.findFirst({
    where: eq(schema.sanitationPoints.id, input.pointId),
  });
  if (!point || !point.active) throw new UserError("El punto de limpieza no existe o está inactivo.");

  const loadedOn = input.date ? today : toIsoDateAR(input.recordedAt);
  const date = input.date ?? loadedOn;
  if (date > today) throw new UserError("No se puede registrar una limpieza en una fecha futura.");
  const values = {
    result: input.result,
    notes: input.notes,
    userId,
    recordedAt: input.recordedAt,
    lateEntry: isLateEntry(date, loadedOn),
    clientId: input.clientId ?? null,
  };
  const [record] = await db
    .insert(schema.cleaningRecords)
    .values({ pointId: input.pointId, date, ...values })
    .onConflictDoUpdate({
      target: [schema.cleaningRecords.pointId, schema.cleaningRecords.date],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return { record: record!, duplicate: false as const };
}

export interface CleaningCell {
  id: string;
  result: "ok" | "deepen";
  lateEntry: boolean;
  notes: string | null;
  userInitials: string | null;
  recordedAt: Date;
}
export interface CleaningGridRow {
  pointId: string;
  sector: string;
  element: string;
  frequency: CleaningFrequency;
  cells: Record<IsoDate, CleaningCell>;
  /** Días en que se esperaba un registro y falta (huecos de la planilla). */
  gaps: IsoDate[];
}

/** Planilla mensual: sector/elemento × día del mes, con los huecos (días hábiles sin registro). */
export async function cleaningMonth(db: Executor, month: string, today: IsoDate = todayAR()) {
  const { from, to } = monthBounds(month);
  const days: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  const points = await db.query.sanitationPoints.findMany({
    where: eq(schema.sanitationPoints.active, true),
    orderBy: [asc(schema.sanitationPoints.sortOrder), asc(schema.sanitationPoints.element)],
  });
  // Semanas que cruzan el borde del mes: se traen registros de unos días de más para calcular las cubiertas.
  const recs = await db
    .select({
      id: schema.cleaningRecords.id,
      pointId: schema.cleaningRecords.pointId,
      date: schema.cleaningRecords.date,
      result: schema.cleaningRecords.result,
      lateEntry: schema.cleaningRecords.lateEntry,
      notes: schema.cleaningRecords.notes,
      recordedAt: schema.cleaningRecords.recordedAt,
      initials: schema.users.initials,
    })
    .from(schema.cleaningRecords)
    .leftJoin(schema.users, eq(schema.users.id, schema.cleaningRecords.userId))
    .where(
      and(
        gte(schema.cleaningRecords.date, addDays(from, -6)),
        lte(schema.cleaningRecords.date, addDays(to, 6)),
      ),
    );

  let expected = 0;
  let done = 0;
  const rows: CleaningGridRow[] = points.map((p) => {
    const mine = recs.filter((r) => r.pointId === p.id);
    const cells: Record<IsoDate, CleaningCell> = {};
    for (const r of mine) {
      if (r.date < from || r.date > to) continue;
      cells[r.date] = {
        id: r.id,
        result: r.result,
        lateEntry: r.lateEntry,
        notes: r.notes,
        userInitials: r.initials,
        recordedAt: r.recordedAt,
      };
    }
    const exp = cleaningExpectations(
      p.frequency,
      mine.map((r) => r.date),
      from,
      to,
      today,
    );
    expected += exp.length;
    done += exp.filter((e) => e.done).length;
    return {
      pointId: p.id,
      sector: p.sector,
      element: p.element,
      frequency: p.frequency,
      cells,
      // En una celda con registro no puede haber hueco (un semanal/mensual cubierto por otro día sí).
      gaps: exp.filter((e) => !e.done).map((e) => e.date),
    };
  });
  return {
    month: from.slice(0, 7),
    from,
    to,
    days,
    rows,
    expected,
    done,
    compliancePct: complianceRate(done, expected),
  };
}
export type CleaningMonth = Awaited<ReturnType<typeof cleaningMonth>>;

// --- Temperaturas (RF-34, RF-38) -------------------------------------------------------------------

export async function temperatureEquipment(db: Executor) {
  const rows = await db.query.equipment.findMany({
    where: and(eq(schema.equipment.active, true), inArray(schema.equipment.kind, [...TEMP_KINDS])),
  });
  return rows
    .map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      kind: e.kind,
      min: e.tempMinC,
      max: e.tempMaxC,
    }))
    .sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.code.localeCompare(b.code));
}
export type TemperatureEquipment = Awaited<ReturnType<typeof temperatureEquipment>>[number];

export interface RecordTemperatureInput {
  equipmentId: string;
  valueC: number;
  correctiveAction: string | null;
  clientId?: string | null;
  /** Momento real de la medición. */
  measuredAt: Date;
  /** Día al que corresponde (carga de un día pasado). Si falta, el día de `measuredAt`. */
  date?: IsoDate | null;
}

/**
 * Registra una temperatura. Calcula `outOfRange` con el rango del equipo; si está fuera de rango la
 * acción correctiva es obligatoria. Idempotente por `clientId`.
 */
export async function recordTemperature(
  db: Executor,
  userId: string,
  input: RecordTemperatureInput,
  today: IsoDate = todayAR(),
) {
  if (input.clientId) {
    const dup = await db.query.temperatureLogs.findFirst({
      where: eq(schema.temperatureLogs.clientId, input.clientId),
    });
    if (dup)
      return {
        log: dup,
        duplicate: true as const,
        status: dup.outOfRange ? ("out" as const) : ("ok" as const),
      };
  }
  const eq1 = await db.query.equipment.findFirst({ where: eq(schema.equipment.id, input.equipmentId) });
  if (!eq1 || !eq1.active || !(TEMP_KINDS as readonly string[]).includes(eq1.kind))
    throw new UserError("El equipo no existe o no lleva registro de temperatura.");

  const status = temperatureStatus(input.valueC, { min: eq1.tempMinC, max: eq1.tempMaxC });
  const outOfRange = status !== "ok";
  if (outOfRange && !input.correctiveAction)
    throw new UserError("La temperatura está fuera de rango: registrá la acción correctiva.", {
      correctiveAction: ["Obligatoria cuando la temperatura está fuera de rango"],
    });

  const loadedOn = input.date ? today : toIsoDateAR(input.measuredAt);
  const date = input.date ?? loadedOn;
  if (date > today) throw new UserError("No se puede registrar una temperatura en una fecha futura.");
  const [log] = await db
    .insert(schema.temperatureLogs)
    .values({
      equipmentId: input.equipmentId,
      date,
      measuredAt: input.measuredAt,
      valueC: input.valueC,
      outOfRange,
      userId,
      lateEntry: isLateEntry(date, loadedOn),
      correctiveAction: input.correctiveAction,
      clientId: input.clientId ?? null,
    })
    .returning();
  return { log: log!, duplicate: false as const, status: outOfRange ? ("out" as const) : ("ok" as const) };
}

/** Equipos de los que se espera una lectura hoy: freezers y heladera siempre; el vehículo solo si hay ruta. */
export async function expectedTemperatureEquipment(db: Executor, today: IsoDate = todayAR()) {
  const all = await temperatureEquipment(db);
  const [route] = await db
    .select({ n: count() })
    .from(schema.routes)
    .where(and(eq(schema.routes.date, today), ne(schema.routes.status, "cancelled")));
  const hasRoute = (route?.n ?? 0) > 0;
  return all.filter((e) => e.kind !== "vehicle" || hasRoute);
}

/** Lecturas faltantes del día (equipos esperados sin ninguna lectura hoy). */
export async function missingTemperaturesToday(db: Executor, today: IsoDate = todayAR()) {
  const expected = await expectedTemperatureEquipment(db, today);
  const done = await db
    .selectDistinct({ equipmentId: schema.temperatureLogs.equipmentId })
    .from(schema.temperatureLogs)
    .where(eq(schema.temperatureLogs.date, today));
  const doneIds = new Set(done.map((d) => d.equipmentId));
  return expected.filter((e) => !doneIds.has(e.id));
}

export interface TemperatureReading {
  id: string;
  equipmentId: string;
  date: IsoDate;
  measuredAt: Date;
  valueC: number;
  outOfRange: boolean;
  lateEntry: boolean;
  correctiveAction: string | null;
  userInitials: string | null;
}

async function readings(db: Executor, from: IsoDate, to: IsoDate): Promise<TemperatureReading[]> {
  return db
    .select({
      id: schema.temperatureLogs.id,
      equipmentId: schema.temperatureLogs.equipmentId,
      date: schema.temperatureLogs.date,
      measuredAt: schema.temperatureLogs.measuredAt,
      valueC: schema.temperatureLogs.valueC,
      outOfRange: schema.temperatureLogs.outOfRange,
      lateEntry: schema.temperatureLogs.lateEntry,
      correctiveAction: schema.temperatureLogs.correctiveAction,
      userInitials: schema.users.initials,
    })
    .from(schema.temperatureLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.temperatureLogs.userId))
    .where(and(gte(schema.temperatureLogs.date, from), lte(schema.temperatureLogs.date, to)))
    .orderBy(desc(schema.temperatureLogs.measuredAt));
}

/** Estado por equipo hoy: última lectura (de siempre) y si falta la del día. */
export async function temperatureStatusToday(db: Executor, today: IsoDate = todayAR()) {
  const equipment = await temperatureEquipment(db);
  const expectedIds = new Set((await expectedTemperatureEquipment(db, today)).map((e) => e.id));
  const recent = await readings(db, addDays(today, -30), today);
  return equipment.map((e) => {
    const mine = recent.filter((r) => r.equipmentId === e.id);
    return {
      ...e,
      last: mine[0] ?? null,
      todayCount: mine.filter((r) => r.date === today).length,
      missingToday: expectedIds.has(e.id) && !mine.some((r) => r.date === today),
    };
  });
}

/** Vista mensual de temperaturas: por equipo y día (última lectura, hay fuera de rango) + listado completo. */
export async function temperatureMonth(db: Executor, month: string, today: IsoDate = todayAR()) {
  const { from, to } = monthBounds(month);
  const days: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const status = await temperatureStatusToday(db, today);
  const list = await readings(db, from, to);
  const rows = status.map((e) => {
    const cells: Record<IsoDate, { last: TemperatureReading; count: number; anyOut: boolean }> = {};
    for (const r of list.filter((x) => x.equipmentId === e.id)) {
      const cur = cells[r.date];
      // `list` viene ordenada de la más reciente a la más antigua: la primera es la última lectura del día.
      cells[r.date] = cur
        ? { last: cur.last, count: cur.count + 1, anyOut: cur.anyOut || r.outOfRange }
        : { last: r, count: 1, anyOut: r.outOfRange };
    }
    return { equipment: e, cells };
  });
  return { month: from.slice(0, 7), from, to, days, rows, list };
}
export type TemperatureMonth = Awaited<ReturnType<typeof temperatureMonth>>;

/** Lecturas fuera de rango de hoy y ayer (RF-38), con equipo y acción correctiva. */
export async function recentOutOfRange(db: Executor, today: IsoDate = todayAR()) {
  return db
    .select({
      id: schema.temperatureLogs.id,
      date: schema.temperatureLogs.date,
      measuredAt: schema.temperatureLogs.measuredAt,
      valueC: schema.temperatureLogs.valueC,
      correctiveAction: schema.temperatureLogs.correctiveAction,
      equipmentCode: schema.equipment.code,
      equipmentName: schema.equipment.name,
    })
    .from(schema.temperatureLogs)
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.temperatureLogs.equipmentId))
    .where(
      and(
        eq(schema.temperatureLogs.outOfRange, true),
        gte(schema.temperatureLogs.date, addDays(today, -1)),
        lte(schema.temperatureLogs.date, today),
      ),
    )
    .orderBy(desc(schema.temperatureLogs.measuredAt));
}

// --- Reclamos y devoluciones ------------------------------------------------------------------------

export function listComplaints(db: Executor, f: { status?: "open" | "closed"; lotId?: string } = {}) {
  return db.query.complaints.findMany({
    where: and(
      f.status ? eq(schema.complaints.status, f.status) : undefined,
      f.lotId ? eq(schema.complaints.finishedLotId, f.lotId) : undefined,
    ),
    orderBy: [desc(schema.complaints.date), desc(schema.complaints.createdAt)],
    with: { customer: true, lot: true, supervisor: true },
  });
}
export type ComplaintRow = Awaited<ReturnType<typeof listComplaints>>[number];

export async function complaintFormOptions(db: Executor) {
  const [customers, lots, supervisors] = await Promise.all([
    db.query.customers.findMany({ orderBy: asc(schema.customers.legalName) }),
    db.query.finishedLots.findMany({
      orderBy: [desc(schema.finishedLots.productionDate), desc(schema.finishedLots.code)],
      limit: 80,
    }),
    db.query.users.findMany({
      where: and(eq(schema.users.active, true), inArray(schema.users.role, ["admin", "production_manager"])),
      orderBy: asc(schema.users.name),
    }),
  ]);
  return {
    customers: customers.map((c) => ({ id: c.id, name: c.legalName })),
    lots: lots.map((l) => ({ id: l.id, code: l.code, expiryDate: l.expiryDate, onHold: l.onHold })),
    supervisors: supervisors.map((u) => ({ id: u.id, name: u.name })),
  };
}
export type ComplaintFormOptions = Awaited<ReturnType<typeof complaintFormOptions>>;

/** Retiene (o libera) un lote terminado: un lote retenido no sale en despacho (el ledger lo excluye del FEFO). */
export async function setLotHold(db: Executor, finishedLotId: string, onHold: boolean) {
  const [lot] = await db
    .update(schema.finishedLots)
    .set({ onHold })
    .where(eq(schema.finishedLots.id, finishedLotId))
    .returning();
  if (!lot) throw new UserError("El lote no existe.");
  return lot;
}

export async function createComplaint(db: Executor, userId: string, input: ComplaintData) {
  const { holdLot, ...values } = input;
  if (holdLot && !values.finishedLotId) throw new UserError("Elegí el lote para poder retenerlo.");
  const [row] = await db
    .insert(schema.complaints)
    .values({ ...values, userId, supervisorId: values.supervisorId ?? userId })
    .returning();
  if (holdLot && values.finishedLotId) await setLotHold(db, values.finishedLotId, true);
  return row!;
}

export async function updateComplaint(db: Executor, id: string, input: ComplaintData) {
  const { holdLot, ...values } = input;
  const [row] = await db
    .update(schema.complaints)
    .set(values)
    .where(eq(schema.complaints.id, id))
    .returning();
  if (!row) throw new UserError("El reclamo no existe.");
  if (holdLot && values.finishedLotId) await setLotHold(db, values.finishedLotId, true);
  return row;
}

export async function setComplaintStatus(db: Executor, id: string, status: "open" | "closed") {
  const [row] = await db
    .update(schema.complaints)
    .set({ status })
    .where(eq(schema.complaints.id, id))
    .returning();
  if (!row) throw new UserError("El reclamo no existe.");
  return row;
}

// --- Alertas para el tablero (RF-38, M8) -------------------------------------------------------------

export interface QualityAlerts {
  /** Lecturas fuera de rango de hoy y ayer (las últimas 24 h de calendario, con el reloj de negocio). */
  outOfRangeLast24h: number;
  /** Equipos esperados hoy sin ninguna lectura de temperatura. */
  missingTemperaturesToday: number;
  /** % de limpiezas esperadas del mes (hasta ayer) que están registradas; null si todavía no había nada esperado. */
  cleaningComplianceMonthPct: number | null;
  openComplaints: number;
  lotsOnHold: number;
}

export async function getQualityAlerts(db: Executor, today: IsoDate = todayAR()): Promise<QualityAlerts> {
  const [out] = await db
    .select({ n: count() })
    .from(schema.temperatureLogs)
    .where(
      and(
        eq(schema.temperatureLogs.outOfRange, true),
        gte(schema.temperatureLogs.date, addDays(today, -1)),
        lte(schema.temperatureLogs.date, today),
      ),
    );
  const missing = await missingTemperaturesToday(db, today);
  const month = await cleaningMonth(db, today, today);
  const [open] = await db
    .select({ n: count() })
    .from(schema.complaints)
    .where(eq(schema.complaints.status, "open"));
  const [held] = await db
    .select({ n: count() })
    .from(schema.finishedLots)
    .where(eq(schema.finishedLots.onHold, true));
  return {
    outOfRangeLast24h: out?.n ?? 0,
    missingTemperaturesToday: missing.length,
    cleaningComplianceMonthPct: month.compliancePct,
    openComplaints: open?.n ?? 0,
    lotsOnHold: held?.n ?? 0,
  };
}

/** Lotes retenidos con su último reclamo abierto (para la vista de alertas). */
export async function heldLots(db: Executor) {
  return db
    .select({
      id: schema.finishedLots.id,
      code: schema.finishedLots.code,
      expiryDate: schema.finishedLots.expiryDate,
    })
    .from(schema.finishedLots)
    .where(eq(schema.finishedLots.onHold, true))
    .orderBy(asc(schema.finishedLots.code));
}
