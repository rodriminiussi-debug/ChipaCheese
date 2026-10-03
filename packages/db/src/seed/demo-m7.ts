import type { Tx } from "../client";
import * as s from "../schema";
import type { SeedRefs } from "./index";

/**
 * Datos de demo del módulo M7 (calidad y mantenimiento), coherentes con el relevamiento:
 * planilla de limpieza de agosto con solo los días 3 y 4 marcados, correctivos repetidos de la
 * Biscomatic desde 2025 y un par de reclamos históricos.
 */
export async function seedDemoQuality(tx: Tx, r: SeedRefs, lots: { sepLotId: string }) {
  // --- Limpieza de agosto: solo los días 3 y 4 (el hueco es el problema que el sistema resuelve) ---
  const points = await tx.query.sanitationPoints.findMany();
  for (const date of ["2026-08-03", "2026-08-04"]) {
    for (const p of points.filter((x) => x.frequency === "daily")) {
      const deepen = date === "2026-08-04" && p.element === "Pisos";
      await tx.insert(s.cleaningRecords).values({
        pointId: p.id,
        date,
        result: deepen ? "deepen" : "ok",
        notes: deepen ? "Zócalos y juntas" : null,
        userId: r.users.jt!,
        recordedAt: new Date(`${date}T17:30:00-03:00`),
      });
    }
  }

  // --- Trabajos de mantenimiento desde 2025: correctivos repetidos en la Biscomatic ---------------
  const eq = r.equipment;
  const history: {
    equipment: string;
    type: "preventive" | "corrective";
    activity: string;
    cause?: string;
    spare?: string;
    cost?: number;
    date: string;
    downtime?: number;
  }[] = [
    {
      equipment: "biscomatic",
      type: "corrective",
      activity: "Cambio de alambre de corte",
      cause: "Alambre cortado",
      spare: "Alambre de corte",
      cost: 8500,
      date: "2025-03-12",
      downtime: 90,
    },
    {
      equipment: "biscomatic",
      type: "corrective",
      activity: "Corte de alambre y ajuste de tensión",
      cause: "Alambre cortado",
      cost: 0,
      date: "2025-11-04",
      downtime: 60,
    },
    {
      equipment: "biscomatic",
      type: "corrective",
      activity: "Cambio de alambre de corte",
      cause: "Desgaste por uso",
      spare: "Alambre de corte",
      cost: 9800,
      date: "2026-06-18",
      downtime: 75,
    },
    {
      equipment: "biscomatic",
      type: "corrective",
      activity: "Corte de alambre",
      cause: "Alambre cortado",
      cost: 0,
      date: "2026-09-15",
      downtime: 45,
    },
    {
      equipment: "amasadora",
      type: "preventive",
      activity: "Revisión de correas y lubricación",
      date: "2026-02-10",
    },
    { equipment: "f1", type: "preventive", activity: "Limpieza de condensador", date: "2026-03-05" },
  ];
  for (const h of history) {
    await tx.insert(s.maintenanceOrders).values({
      equipmentId: eq[h.equipment]!,
      type: h.type,
      status: "done",
      activity: h.activity,
      cause: h.cause ?? null,
      spareParts: h.spare ?? null,
      cost: h.cost ?? null,
      date: h.date,
      doneAt: h.date,
      responsibleId: r.users.af!,
      supervisorId: r.users.nr!,
      downtimeMinutes: h.downtime ?? null,
    });
  }
  // Correctivo abierto (ayer): se ve en las alertas del módulo.
  await tx.insert(s.maintenanceOrders).values({
    equipmentId: eq.selladora!,
    type: "corrective",
    status: "open",
    activity: "Cambio de teflón de la selladora",
    cause: "Teflón quemado",
    spareParts: "Cinta de teflón",
    date: "2026-10-01",
    responsibleId: r.users.af!,
    supervisorId: r.users.nr!,
  });

  // --- Reclamos y devoluciones -----------------------------------------------------------------
  await tx.insert(s.complaints).values([
    {
      date: "2025-04-22",
      customerId: r.customers.esperanza!,
      qtyUnits: 6,
      reason: "Bolsas rotas",
      customerAction: "Reposición sin cargo",
      productAction: "Descarte",
      status: "closed",
      supervisorId: r.users.nr!,
      userId: r.users.af!,
    },
    {
      date: "2026-09-12",
      customerId: r.customers.lareina!,
      finishedLotId: lots.sepLotId,
      qtyUnits: 4,
      reason: "Bolsas mal selladas",
      customerAction: "Nota de crédito",
      productAction: "Revisión de la selladora",
      status: "closed",
      supervisorId: r.users.nr!,
      userId: r.users.af!,
    },
    {
      date: "2026-09-29",
      customerId: r.customers.viadolce!,
      finishedLotId: lots.sepLotId,
      qtyUnits: 2,
      reason: "Bolsa sin etiqueta",
      customerAction: "Reposición pendiente",
      status: "open",
      supervisorId: r.users.nr!,
      userId: r.users.af!,
    },
  ]);
}
