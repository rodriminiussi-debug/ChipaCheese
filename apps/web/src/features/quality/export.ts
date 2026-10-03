import { formatDateAR, formatKg, formatNumber, isoWeekday, type IsoDate } from "@chipa/domain";
import { and, asc, eq, gte, lte, ne, schema, type Executor } from "@chipa/db";
import type { BpmSheet } from "@/server/export/pdf";
import { buildXlsx, cols } from "@/server/export/xlsx";
import { formatTimeAR, toIsoDateAR } from "@/lib/dates";
import { SHAPE } from "@/lib/labels";
import { COMPLAINT_STATUS, rangeLabel, tempLabel } from "./labels";
import { cleaningMonth } from "./service";

/**
 * Exportación de los registros BPM con el formato de las planillas en papel que ya conoce ASSAL (RF-36).
 * Cada informe devuelve una `BpmSheet` que sirve tanto para el PDF (`renderBpmPdf`) como para Excel.
 */
export const REPORT_KINDS = [
  "limpieza",
  "temperaturas",
  "reclamos",
  "mantenimiento",
  "elaboracion",
  "despacho",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  limpieza: "Control de limpieza",
  temperaturas: "Registro de temperaturas",
  reclamos: "Reclamos y devoluciones",
  mantenimiento: "Trabajos de mantenimiento",
  elaboracion: "Registro de elaboración",
  despacho: "Registro de despacho",
};

export interface ReportPeriod {
  from: IsoDate;
  to: IsoDate;
  /** Mes (YYYY-MM) del control de limpieza, que es mensual. Por defecto el de `from`. */
  month?: string;
}

type Row = (string | number | null)[];
const SHIFT: Record<string, string> = { morning: "Mañana", afternoon: "Tarde" };
const periodLabel = (p: ReportPeriod) => `${formatDateAR(p.from)} al ${formatDateAR(p.to)}`;
const startOf = (d: IsoDate) => new Date(`${d}T00:00:00-03:00`);
const endOf = (d: IsoDate) => new Date(`${d}T23:59:59.999-03:00`);

export async function buildReport(
  db: Executor,
  kind: ReportKind,
  period: ReportPeriod,
  today: IsoDate,
): Promise<BpmSheet> {
  switch (kind) {
    case "limpieza":
      return cleaningSheet(db, period, today);
    case "temperaturas":
      return temperatureSheet(db, period);
    case "reclamos":
      return complaintsSheet(db, period);
    case "mantenimiento":
      return maintenanceSheet(db, period);
    case "elaboracion":
      return productionSheet(db, period);
    case "despacho":
      return dispatchSheet(db, period);
  }
}

// --- Control de limpieza mensual (sector/elemento × día) --------------------------------------------------

async function cleaningSheet(db: Executor, p: ReportPeriod, today: IsoDate): Promise<BpmSheet> {
  const month = p.month ?? p.from.slice(0, 7);
  const m = await cleaningMonth(db, month, today);
  const [y, mo] = month.split("-");
  return {
    title: "Control de limpieza",
    code: "BPM-LIMP",
    version: "2022",
    period: `${mo}/${y}`,
    columns: [
      { header: "Sector", width: 4 },
      { header: "Elemento", width: 6 },
      ...m.days.map((d) => ({ header: String(Number(d.slice(8))), width: 1, align: "center" as const })),
    ],
    rows: m.rows.map((r) => [
      r.sector,
      r.element,
      ...m.days.map((d) => {
        const c = r.cells[d];
        return c ? `${c.result === "ok" ? "x" : "P"}${c.lateEntry ? "*" : ""}` : "";
      }),
    ]),
    notes: `x = limpieza correcta · P = a profundizar · * = carga tardía. Cumplimiento del mes: ${m.compliancePct == null ? "—" : `${m.compliancePct}%`}. Los fines de semana (${m.days.filter((d) => isoWeekday(d) >= 6).length} días) no se esperan registros.`,
    signatures: ["Responsable", "Supervisor"],
  };
}

// --- Temperaturas --------------------------------------------------------------------------------------

async function temperatureSheet(db: Executor, p: ReportPeriod): Promise<BpmSheet> {
  const list = await db
    .select({
      measuredAt: schema.temperatureLogs.measuredAt,
      date: schema.temperatureLogs.date,
      code: schema.equipment.code,
      name: schema.equipment.name,
      min: schema.equipment.tempMinC,
      max: schema.equipment.tempMaxC,
      valueC: schema.temperatureLogs.valueC,
      outOfRange: schema.temperatureLogs.outOfRange,
      action: schema.temperatureLogs.correctiveAction,
      lateEntry: schema.temperatureLogs.lateEntry,
      user: schema.users.initials,
    })
    .from(schema.temperatureLogs)
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.temperatureLogs.equipmentId))
    .leftJoin(schema.users, eq(schema.users.id, schema.temperatureLogs.userId))
    .where(and(gte(schema.temperatureLogs.date, p.from), lte(schema.temperatureLogs.date, p.to)))
    .orderBy(asc(schema.temperatureLogs.date), asc(schema.temperatureLogs.measuredAt));
  const out = list.filter((r) => r.outOfRange).length;
  return {
    title: "Registro de temperaturas",
    code: "BPM-TEMP",
    version: "2026",
    period: periodLabel(p),
    columns: [
      { header: "Fecha", width: 1.2 },
      { header: "Hora", width: 0.8 },
      { header: "Equipo", width: 2.2 },
      { header: "Rango", width: 1.2 },
      { header: "°C", width: 0.8, align: "right" },
      { header: "Fuera de rango", width: 1 },
      { header: "Acción correctiva", width: 3 },
      { header: "Responsable", width: 1 },
      { header: "Carga tardía", width: 0.9 },
    ],
    rows: list.map((r) => [
      formatDateAR(r.date),
      formatTimeAR(r.measuredAt),
      `${r.code} — ${r.name}`,
      rangeLabel(r.min, r.max),
      tempLabel(r.valueC).replace(" °C", ""),
      r.outOfRange ? "SÍ" : "",
      r.action,
      r.user,
      r.lateEntry ? "Sí" : "",
    ]),
    notes: `${list.length} lecturas en el período, ${out} fuera de rango.`,
    signatures: ["Responsable", "Supervisor"],
  };
}

// --- Reclamos y devoluciones -------------------------------------------------------------------------------

async function complaintsSheet(db: Executor, p: ReportPeriod): Promise<BpmSheet> {
  const rows = await db.query.complaints.findMany({
    where: and(gte(schema.complaints.date, p.from), lte(schema.complaints.date, p.to)),
    orderBy: [asc(schema.complaints.date), asc(schema.complaints.createdAt)],
    with: { customer: true, lot: true, supervisor: true },
  });
  return {
    title: "Reclamos y devoluciones",
    code: "BPM-RECL",
    version: "2022",
    period: periodLabel(p),
    columns: [
      { header: "Fecha", width: 1.1 },
      { header: "Cliente", width: 2.2 },
      { header: "Cantidad", width: 0.8, align: "right" },
      { header: "Lote", width: 1.1 },
      { header: "Vencimiento", width: 1.1 },
      { header: "Motivo", width: 2.4 },
      { header: "Acción sobre cliente", width: 2 },
      { header: "Acción sobre producto", width: 2 },
      { header: "Supervisor", width: 1 },
      { header: "Estado", width: 0.9 },
    ],
    rows: rows.map((c) => [
      formatDateAR(c.date),
      c.customer?.legalName ?? "",
      c.qtyUnits,
      c.lot?.code ?? "",
      c.lot ? formatDateAR(c.lot.expiryDate) : "",
      c.reason,
      c.customerAction,
      c.productAction,
      c.supervisor?.initials ?? "",
      COMPLAINT_STATUS[c.status]!.label,
    ]),
    signatures: ["Responsable", "Supervisor"],
  };
}

// --- Trabajos de mantenimiento ---------------------------------------------------------------------------

async function maintenanceSheet(db: Executor, p: ReportPeriod): Promise<BpmSheet> {
  const rows = await db.query.maintenanceOrders.findMany({
    where: and(gte(schema.maintenanceOrders.date, p.from), lte(schema.maintenanceOrders.date, p.to)),
    orderBy: [asc(schema.maintenanceOrders.date), asc(schema.maintenanceOrders.createdAt)],
    with: { equipment: true, responsible: true, supervisor: true },
  });
  return {
    title: "Trabajos de mantenimiento",
    code: "BPM-MANT",
    version: "2022",
    period: periodLabel(p),
    columns: [
      { header: "Área", width: 1.3 },
      { header: "Equipo", width: 1.8 },
      { header: "Tipo", width: 1.1 },
      { header: "Actividad", width: 3 },
      { header: "Causa / repuesto", width: 2 },
      { header: "Fecha", width: 1.1 },
      { header: "Responsable", width: 1 },
      { header: "Supervisor", width: 1 },
      { header: "Estado", width: 0.9 },
    ],
    rows: rows.map((o) => [
      o.equipment.area,
      o.equipment.name,
      o.type === "preventive" ? "Preventivo" : "Correctivo",
      o.activity,
      [o.cause, o.spareParts].filter(Boolean).join(" · "),
      formatDateAR(o.date),
      o.responsible?.initials ?? "",
      o.supervisor?.initials ?? "",
      o.status === "done" ? "Hecho" : o.status === "open" ? "Abierto" : "Cancelado",
    ]),
    signatures: ["Responsable", "Supervisor"],
  };
}

// --- Registro de elaboración -------------------------------------------------------------------------------

async function productionSheet(db: Executor, p: ReportPeriod): Promise<BpmSheet> {
  const runs = await db.query.productionRuns.findMany({
    where: and(gte(schema.productionRuns.date, p.from), lte(schema.productionRuns.date, p.to)),
    orderBy: [asc(schema.productionRuns.date), asc(schema.productionRuns.runNumber)],
    with: {
      recipe: true,
      responsible: true,
      supervisor: true,
      lots: true,
      weighings: true,
      consumptions: { with: { ingredient: true, rawLot: true } },
    },
  });
  const rows: Row[] = runs.map((r) => {
    const kg = r.weighings.reduce((a, w) => a + w.kg, 0);
    const byShape = new Map<string, number>();
    for (const w of r.weighings) byShape.set(w.shape, (byShape.get(w.shape) ?? 0) + w.kg);
    return [
      formatDateAR(r.date),
      r.recipe.name,
      r.lots.map((l) => `${l.code}\nVto ${formatDateAR(l.expiryDate)}`).join("\n"),
      SHIFT[r.shift] ?? r.shift,
      r.responsible?.initials ?? "",
      r.supervisor?.initials ?? "",
      kg ? formatKg(kg) : "",
      r.consumptions
        .map((c) => {
          const unit = c.ingredient.unit === "l" ? "L" : c.ingredient.unit === "unit" ? "u." : "kg";
          const lot = c.rawLot
            ? `lote ${c.rawLot.supplierLotCode ?? "s/d"}${c.rawLot.expiryDate ? ` vto ${formatDateAR(c.rawLot.expiryDate)}` : ""}`
            : "lote s/d";
          return `${c.ingredient.name}: ${formatNumber(c.qtyActual, 2)} ${unit} · ${lot}`;
        })
        .join("\n"),
      [...byShape.entries()].map(([s, k]) => `${SHAPE[s] ?? s}: ${formatKg(k)}`).join("\n"),
    ];
  });
  return {
    title: "Registro de elaboración",
    code: "BPM-ELAB",
    version: "2022",
    period: periodLabel(p),
    columns: [
      { header: "Fecha", width: 1.1 },
      { header: "Producto", width: 1.4 },
      { header: "Lote / vencimiento", width: 1.4 },
      { header: "Turno", width: 0.8 },
      { header: "Resp.", width: 0.8 },
      { header: "Superv.", width: 0.8 },
      { header: "Cantidad elaborada", width: 1.3, align: "right" },
      { header: "Materia prima (cantidad, lote, vencimiento)", width: 5 },
      { header: "Pesadas por forma", width: 2 },
    ],
    rows,
    signatures: ["Responsable", "Supervisor"],
  };
}

// --- Registro de despacho (BPM) ------------------------------------------------------------------------------

async function dispatchSheet(db: Executor, p: ReportPeriod): Promise<BpmSheet> {
  const rows = await db
    .select({
      product: schema.products.name,
      lot: schema.finishedLots.code,
      at: schema.dispatches.dispatchedAt,
      units: schema.dispatchItems.qtyUnits,
      customer: schema.customers.legalName,
      plate: schema.vehicles.plate,
      vehicle: schema.vehicles.name,
      responsible: schema.users.initials,
      number: schema.dispatches.number,
    })
    .from(schema.dispatchItems)
    .innerJoin(schema.dispatches, eq(schema.dispatches.id, schema.dispatchItems.dispatchId))
    .innerJoin(schema.products, eq(schema.products.id, schema.dispatchItems.productId))
    .innerJoin(schema.finishedLots, eq(schema.finishedLots.id, schema.dispatchItems.finishedLotId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.dispatches.customerId))
    .leftJoin(schema.routes, eq(schema.routes.id, schema.dispatches.routeId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.routes.vehicleId))
    .leftJoin(schema.users, eq(schema.users.id, schema.dispatches.responsibleId))
    .where(
      and(
        gte(schema.dispatches.dispatchedAt, startOf(p.from)),
        lte(schema.dispatches.dispatchedAt, endOf(p.to)),
        ne(schema.dispatches.status, "cancelled"),
      ),
    )
    .orderBy(asc(schema.dispatches.dispatchedAt), asc(schema.dispatches.number));
  return {
    title: "Registro de despacho",
    code: "BPM-DESP",
    version: "2022",
    period: periodLabel(p),
    columns: [
      { header: "Producto", width: 2.4 },
      { header: "Lote", width: 1.1 },
      { header: "Fecha de despacho", width: 1.3 },
      { header: "Cantidad", width: 0.9, align: "right" },
      { header: "Destino", width: 2.4 },
      { header: "Transporte / patente", width: 2 },
      { header: "Responsable", width: 1 },
    ],
    rows: rows.map((r) => [
      r.product,
      r.lot,
      formatDateAR(toIsoDateAR(r.at)),
      r.units,
      r.customer,
      r.plate ? `${r.vehicle ?? ""} · ${r.plate}`.replace(/^ · /, "") : "",
      r.responsible ?? "",
    ]),
    signatures: ["Responsable", "Supervisor"],
  };
}

/** Misma planilla en Excel (una hoja, encabezado fijo con autofiltro). */
export async function sheetToXlsx(sheet: BpmSheet): Promise<Buffer> {
  return buildXlsx([
    {
      name: sheet.title,
      rows: sheet.rows,
      columns: cols<(typeof sheet.rows)[number]>(
        sheet.columns.map((c, i) => ({
          header: c.header,
          value: (r) => r[i] ?? null,
          width: Math.max(8, Math.round((c.width ?? 1) * 10)),
        })),
      ),
    },
  ]);
}
