import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { allocateProductFefo, finishedLotBalances } from "../stock/ledger";
import {
  backdatedCleaningInput,
  backdatedTemperatureInput,
  cleaningRecordInput,
  complaintInput,
  temperatureInput,
} from "./schemas";
import {
  cleaningChecklist,
  cleaningMonth,
  clampRecordedAt,
  createComplaint,
  getQualityAlerts,
  listComplaints,
  missingTemperaturesToday,
  recordCleaning,
  recordTemperature,
  setComplaintStatus,
  setLotHold,
  temperatureMonth,
  temperatureStatusToday,
} from "./service";

const TODAY = "2026-10-02"; // viernes; APP_TODAY de los tests

async function point(tx: Tx, element: string) {
  const p = await tx.query.sanitationPoints.findFirst({
    where: eq(schema.sanitationPoints.element, element),
  });
  return p!;
}
async function equip(tx: Tx, code: string) {
  return (await tx.query.equipment.findFirst({ where: eq(schema.equipment.code, code) }))!;
}
async function userId(tx: Tx, username: string) {
  return (await tx.query.users.findFirst({ where: eq(schema.users.username, username) }))!.id;
}
const at = (iso: string) => new Date(iso);
const NOON = new Date("2026-10-02T15:00:00Z"); // mediodía del día congelado

describe("limpieza (RF-34)", () => {
  it("el checklist del día muestra todo lo diario y lo semanal sin registrar en la semana", async () => {
    await inRollback("jt", async (tx) => {
      const list = await cleaningChecklist(tx, TODAY);
      const pending = list.filter((i) => i.status === "pending");
      expect(pending.map((i) => i.element)).toEqual(
        expect.arrayContaining(["Moldes y útiles", "Pisos", "Freezer F1", "Freezer F2"]),
      );
      expect(list.every((i) => i.status === "pending")).toBe(true);
    });
  });

  it("un semanal registrado esta semana ya no corresponde; uno de la semana pasada sí", async () => {
    await inRollback("jt", async (tx) => {
      const uid = await userId(tx, "jt");
      const f1 = await point(tx, "Freezer F1");
      const f2 = await point(tx, "Freezer F2");
      await recordCleaning(
        tx,
        uid,
        {
          pointId: f1.id,
          result: "ok",
          notes: null,
          date: "2026-09-29",
          recordedAt: at("2026-10-02T13:00:00Z"),
        },
        TODAY,
      );
      await recordCleaning(
        tx,
        uid,
        {
          pointId: f2.id,
          result: "ok",
          notes: null,
          date: "2026-09-25",
          recordedAt: at("2026-10-02T13:00:00Z"),
        },
        TODAY,
      );
      const list = await cleaningChecklist(tx, TODAY);
      expect(list.find((i) => i.element === "Freezer F1")?.status).toBe("done_period");
      expect(list.find((i) => i.element === "Freezer F2")?.status).toBe("pending");
    });
  });

  it("registrar un punto lo pasa a 'done' con usuario y hora; no es carga tardía", async () => {
    await inRollback("jt", async (tx) => {
      const uid = await userId(tx, "jt");
      const p = await point(tx, "Pisos");
      const input = cleaningRecordInput.parse({
        clientId: crypto.randomUUID(),
        recordedAt: "2026-10-02T15:30:00-03:00",
        pointId: p.id,
        result: "deepen",
        notes: "Zócalos",
      });
      const { record } = await recordCleaning(
        tx,
        uid,
        { ...input, recordedAt: new Date(input.recordedAt) },
        TODAY,
      );
      expect(record).toMatchObject({
        date: TODAY,
        result: "deepen",
        lateEntry: false,
        userId: uid,
        notes: "Zócalos",
      });
      const item = (await cleaningChecklist(tx, TODAY)).find((i) => i.element === "Pisos")!;
      expect(item).toMatchObject({ status: "done", result: "deepen", userInitials: "J.T." });
    });
  });

  it("la demora de sincronización offline no marca carga tardía (se usa recordedAt)", async () => {
    await inRollback("jt", async (tx) => {
      const uid = await userId(tx, "jt");
      const p = await point(tx, "Bandejas");
      // La tablet cargó ayer a las 17:00 y sincronizó hoy.
      const { record } = await recordCleaning(
        tx,
        uid,
        { pointId: p.id, result: "ok", notes: null, recordedAt: at("2026-10-01T17:00:00-03:00") },
        TODAY,
      );
      expect(record.date).toBe("2026-10-01");
      expect(record.lateEntry).toBe(false);
    });
  });

  it("cargar un día pasado queda marcado como carga tardía", async () => {
    await inRollback("af", async (tx) => {
      const uid = await userId(tx, "af");
      const p = await point(tx, "Batidora");
      const input = backdatedCleaningInput.parse({ date: "2026-09-30", pointId: p.id, result: "ok" });
      const { record } = await recordCleaning(
        tx,
        uid,
        { ...input, recordedAt: new Date("2026-10-02T13:00:00Z") },
        TODAY,
      );
      expect(record).toMatchObject({ date: "2026-09-30", lateEntry: true });
      const month = await cleaningMonth(tx, "2026-09", TODAY);
      expect(month.rows.find((r) => r.element === "Batidora")?.cells["2026-09-30"]).toMatchObject({
        lateEntry: true,
        userInitials: "A.F.",
      });
    });
  });

  it("no acepta fechas futuras", async () => {
    await inRollback("af", async (tx) => {
      const p = await point(tx, "Batidora");
      await expect(
        recordCleaning(
          tx,
          await userId(tx, "af"),
          { pointId: p.id, result: "ok", notes: null, date: "2026-10-05", recordedAt: NOON },
          TODAY,
        ),
      ).rejects.toThrow(/futura/);
    });
  });

  it("es idempotente por clientId y por punto+día (la corrección no duplica)", async () => {
    await inRollback("jt", async (tx) => {
      const uid = await userId(tx, "jt");
      const p = await point(tx, "Pisos");
      const clientId = crypto.randomUUID();
      const base = {
        pointId: p.id,
        result: "ok" as const,
        notes: null,
        clientId,
        recordedAt: at("2026-10-02T12:00:00-03:00"),
      };
      const a = await recordCleaning(tx, uid, base, TODAY);
      const b = await recordCleaning(tx, uid, base, TODAY);
      expect(a.duplicate).toBe(false);
      expect(b.duplicate).toBe(true);
      expect(b.record.id).toBe(a.record.id);
      // Otro envío (otro clientId) del mismo punto y día corrige el registro en vez de duplicarlo.
      await recordCleaning(tx, uid, { ...base, clientId: crypto.randomUUID(), result: "deepen" }, TODAY);
      const rows = await tx.query.cleaningRecords.findMany({
        where: eq(schema.cleaningRecords.pointId, p.id),
      });
      expect(rows.filter((r) => r.date === TODAY)).toHaveLength(1);
      expect(rows.find((r) => r.date === TODAY)?.result).toBe("deepen");
    });
  });

  it("planilla de agosto: solo los días 3 y 4 marcados y el resto son huecos", async () => {
    await inRollback("af", async (tx) => {
      const m = await cleaningMonth(tx, "2026-08", TODAY);
      expect(m.days).toHaveLength(31);
      const pisos = m.rows.find((r) => r.element === "Pisos")!;
      expect(Object.keys(pisos.cells).sort()).toEqual(["2026-08-03", "2026-08-04"]);
      expect(pisos.cells["2026-08-04"]?.result).toBe("deepen");
      // 21 días hábiles en agosto de 2026, 2 marcados → 19 huecos (el lunes 3 y martes 4 no son huecos).
      expect(pisos.gaps).toHaveLength(19);
      expect(pisos.gaps).not.toContain("2026-08-03");
      expect(pisos.gaps).toContain("2026-08-05");
      expect(pisos.gaps).not.toContain("2026-08-08"); // sábado
      expect(m.compliancePct).not.toBeNull();
      expect(m.compliancePct!).toBeLessThan(15);
    });
  });
});

describe("temperaturas (RF-34, RF-38)", () => {
  it("dentro de rango se guarda sin acción correctiva", async () => {
    await inRollback("jt", async (tx) => {
      const f3 = await equip(tx, "F3");
      const input = temperatureInput.parse({
        clientId: crypto.randomUUID(),
        recordedAt: "2026-10-02T08:05:00-03:00",
        equipmentId: f3.id,
        valueC: "-20,5",
      });
      expect(input.valueC).toBe(-20.5);
      const r = await recordTemperature(
        tx,
        await userId(tx, "jt"),
        { ...input, measuredAt: new Date(input.recordedAt) },
        TODAY,
      );
      expect(r.log).toMatchObject({ outOfRange: false, lateEntry: false, date: TODAY, valueC: -20.5 });
    });
  });

  it("fuera de rango exige acción correctiva y la guarda con outOfRange", async () => {
    await inRollback("jt", async (tx) => {
      const f3 = await equip(tx, "F3");
      const base = { equipmentId: f3.id, valueC: -12, measuredAt: new Date("2026-10-02T11:00:00Z") };
      await expect(
        recordTemperature(tx, await userId(tx, "jt"), { ...base, correctiveAction: null }, TODAY),
      ).rejects.toThrow(/acción correctiva/);
      const r = await recordTemperature(
        tx,
        await userId(tx, "jt"),
        { ...base, correctiveAction: "Se cerró la puerta y se avisó al técnico" },
        TODAY,
      );
      expect(r.log.outOfRange).toBe(true);
      expect(r.status).toBe("out");
    });
  });

  it("la heladera se evalúa contra su rango 0 a 5 °C", async () => {
    await inRollback("jt", async (tx) => {
      const h = await equip(tx, "HELADERA");
      const uid = await userId(tx, "jt");
      const ok = await recordTemperature(
        tx,
        uid,
        { equipmentId: h.id, valueC: 4, correctiveAction: null, measuredAt: NOON },
        TODAY,
      );
      expect(ok.log.outOfRange).toBe(false);
      await expect(
        recordTemperature(
          tx,
          uid,
          { equipmentId: h.id, valueC: -2, correctiveAction: null, measuredAt: NOON },
          TODAY,
        ),
      ).rejects.toThrow(/fuera de rango/);
    });
  });

  it("es idempotente por clientId", async () => {
    await inRollback("jt", async (tx) => {
      const f4 = await equip(tx, "F4");
      const uid = await userId(tx, "jt");
      const base = {
        equipmentId: f4.id,
        valueC: -19,
        correctiveAction: null,
        clientId: crypto.randomUUID(),
        measuredAt: new Date("2026-10-02T11:00:00Z"),
      };
      const a = await recordTemperature(tx, uid, base, TODAY);
      const b = await recordTemperature(tx, uid, base, TODAY);
      expect(b.duplicate).toBe(true);
      expect(b.log.id).toBe(a.log.id);
      const n = await tx.query.temperatureLogs.findMany({
        where: eq(schema.temperatureLogs.clientId, base.clientId),
      });
      expect(n).toHaveLength(1);
    });
  });

  it("rechaza equipos sin registro de temperatura", async () => {
    await inRollback("jt", async (tx) => {
      const m = await equip(tx, "BISCOMATIC");
      await expect(
        recordTemperature(
          tx,
          await userId(tx, "jt"),
          { equipmentId: m.id, valueC: 20, correctiveAction: null, measuredAt: NOON },
          TODAY,
        ),
      ).rejects.toThrow(/no lleva registro/);
    });
  });

  it("carga de un día pasado: lateEntry y fecha elegida", async () => {
    await inRollback("af", async (tx) => {
      const f1 = await equip(tx, "F1");
      const input = backdatedTemperatureInput.parse({
        equipmentId: f1.id,
        date: "2026-09-30",
        time: "07:30",
        valueC: -22,
      });
      const r = await recordTemperature(
        tx,
        await userId(tx, "af"),
        {
          equipmentId: input.equipmentId,
          valueC: input.valueC,
          correctiveAction: null,
          date: input.date,
          measuredAt: new Date(`${input.date}T${input.time}:00-03:00`),
        },
        TODAY,
      );
      expect(r.log).toMatchObject({ date: "2026-09-30", lateEntry: true });
    });
  });

  it("faltantes del día: sin lecturas hoy faltan freezers y heladera; el vehículo solo con ruta", async () => {
    await inRollback("jt", async (tx) => {
      const missing = await missingTemperaturesToday(tx, TODAY);
      expect(missing.map((e) => e.code).sort()).toEqual(["F1", "F2", "F3", "F4", "HELADERA"]);
      const f1 = await equip(tx, "F1");
      await recordTemperature(
        tx,
        await userId(tx, "jt"),
        {
          equipmentId: f1.id,
          valueC: -23,
          correctiveAction: null,
          measuredAt: new Date("2026-10-02T11:00:00Z"),
        },
        TODAY,
      );
      expect((await missingTemperaturesToday(tx, TODAY)).map((e) => e.code)).not.toContain("F1");
      await tx.insert(schema.routes).values({ date: TODAY });
      expect((await missingTemperaturesToday(tx, TODAY)).map((e) => e.code)).toContain("VEH-FRIO");
    });
  });

  it("vista por equipo: última lectura y faltantes del día", async () => {
    await inRollback("jt", async (tx) => {
      const status = await temperatureStatusToday(tx, TODAY);
      const f3 = status.find((e) => e.code === "F3")!;
      expect(f3.last).toMatchObject({ date: "2026-10-01", valueC: -21 });
      expect(f3.missingToday).toBe(true);
      const month = await temperatureMonth(tx, "2026-10", TODAY);
      expect(month.rows.find((r) => r.equipment.code === "F3")?.cells["2026-10-01"]?.last.valueC).toBe(-21);
      expect(month.list.length).toBe(5);
    });
  });

  it("clampRecordedAt corrige horas futuras de una tablet desfasada", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    expect(clampRecordedAt(new Date("2026-10-02T11:00:00Z"), now)).toEqual(new Date("2026-10-02T11:00:00Z"));
    expect(clampRecordedAt(new Date("2026-10-05T11:00:00Z"), now)).toEqual(now);
  });
});

describe("reclamos y retención de lotes (RF-34)", () => {
  it("un reclamo con retención deja el lote retenido, y un lote retenido sale del FEFO", async () => {
    await inRollback("af", async (tx) => {
      const lot = (await tx.query.finishedLots.findFirst({
        where: eq(schema.finishedLots.code, "261001-1"),
      }))!;
      const customer = (await tx.query.customers.findFirst())!;
      const bal = await tx
        .select({ productId: schema.packings.productId })
        .from(schema.packings)
        .where(eq(schema.packings.finishedLotId, lot.id));
      const productId = bal[0]!.productId;
      const before = await finishedLotBalances(tx, productId);
      expect(before.map((b) => b.code)).toContain("261001-1");

      const data = complaintInput.parse({
        date: TODAY,
        customerId: customer.id,
        finishedLotId: lot.id,
        qtyUnits: "3",
        reason: "Bolsa mal sellada",
        holdLot: true,
      });
      const c = await createComplaint(tx, await userId(tx, "af"), data);
      expect(c).toMatchObject({ status: "open", qtyUnits: 3, finishedLotId: lot.id });

      const after = await finishedLotBalances(tx, productId);
      expect(after.map((b) => b.code)).not.toContain("261001-1");
      await expect(allocateProductFefo(tx, productId, 1, { allowShortfall: true })).resolves.toMatchObject({
        allocations: expect.not.arrayContaining([expect.objectContaining({ code: "261001-1" })]),
      });

      await setLotHold(tx, lot.id, false);
      expect((await finishedLotBalances(tx, productId)).map((b) => b.code)).toContain("261001-1");
    });
  });

  it("retener sin lote elegido es un error de negocio", async () => {
    await inRollback("af", async (tx) => {
      const data = complaintInput.parse({ date: TODAY, reason: "Sin etiqueta", holdLot: true });
      await expect(createComplaint(tx, await userId(tx, "af"), data)).rejects.toThrow(/Elegí el lote/);
    });
  });

  it("lista, filtra y cierra reclamos", async () => {
    await inRollback("af", async (tx) => {
      const open = await listComplaints(tx, { status: "open" });
      expect(open.length).toBeGreaterThanOrEqual(1);
      expect(open[0]!.lot?.code).toBe("260901-1");
      const closed = await setComplaintStatus(tx, open[0]!.id, "closed");
      expect(closed.status).toBe("closed");
      expect((await listComplaints(tx, { status: "open" })).map((c) => c.id)).not.toContain(open[0]!.id);
    });
  });
});

describe("alertas de calidad (RF-38, M8)", () => {
  it("devuelve los contadores para el tablero", async () => {
    await inRollback("af", async (tx) => {
      const base = await getQualityAlerts(tx, TODAY);
      expect(base).toMatchObject({
        outOfRangeLast24h: 0,
        missingTemperaturesToday: 5,
        openComplaints: 1,
        lotsOnHold: 0,
      });
      // Octubre: hasta ayer (jueves 1/10) había 9 limpiezas esperadas (diarias; las semanales vencen el viernes).
      expect(base.cleaningComplianceMonthPct).toBe(0);

      const f3 = await equip(tx, "F3");
      await recordTemperature(
        tx,
        await userId(tx, "jt"),
        { equipmentId: f3.id, valueC: -10, correctiveAction: "Aviso al técnico", measuredAt: NOON },
        TODAY,
      );
      await setLotHold(tx, (await tx.query.finishedLots.findFirst())!.id, true);
      const after = await getQualityAlerts(tx, TODAY);
      expect(after.outOfRangeLast24h).toBe(1);
      expect(after.missingTemperaturesToday).toBe(4);
      expect(after.lotsOnHold).toBe(1);
    });
  });
});
