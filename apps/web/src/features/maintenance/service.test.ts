import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { closeCorrectiveInput, correctiveInput, planInput, registerPreventiveInput } from "./schemas";
import {
  closeCorrective,
  createCorrective,
  createPlan,
  equipmentHistory,
  equipmentSummaries,
  getMaintenanceAlerts,
  listPlans,
  preventiveCompliance,
  registerPreventive,
  updatePlan,
} from "./service";

const TODAY = "2026-10-02";

async function equip(tx: Tx, code: string) {
  return (await tx.query.equipment.findFirst({ where: eq(schema.equipment.code, code) }))!;
}
async function userId(tx: Tx, username: string) {
  return (await tx.query.users.findFirst({ where: eq(schema.users.username, username) }))!.id;
}
async function planOf(tx: Tx, code: string, task: RegExp) {
  const e = await equip(tx, code);
  const plans = await listPlans(tx, { today: TODAY, equipmentId: e.id });
  return plans.find((p) => task.test(p.task))!;
}

describe("planes preventivos (RF-37)", () => {
  it("los planes recién creados no nacen vencidos: vencen a startDate + frecuencia", async () => {
    await inRollback("af", async (tx) => {
      const plans = await listPlans(tx, { today: TODAY });
      expect(plans).toHaveLength(11);
      expect(plans.every((p) => p.status === "ok" || p.status === "due_soon")).toBe(true);
      const wire = plans.find((p) => /alambre/i.test(p.task))!;
      expect(wire).toMatchObject({ nextDue: "2026-10-31", daysLeft: 29, status: "ok" });
    });
  });

  it("estado vencido / por vencer / ok según la fecha de hoy", async () => {
    await inRollback("af", async (tx) => {
      // 25/10: el alambre (30 días desde 01/10) vence en 6 días → por vencer.
      const soon = await listPlans(tx, { today: "2026-10-25" });
      expect(soon.find((p) => /alambre/i.test(p.task))?.status).toBe("due_soon");
      // 05/11: ya venció el de 30 días; los de 60 (selladora) aún no.
      const late = await listPlans(tx, { today: "2026-11-05" });
      const overdue = late.filter((p) => p.status === "overdue").map((p) => p.task);
      expect(overdue).toEqual(
        expect.arrayContaining([expect.stringMatching(/alambre/i), expect.stringMatching(/pesa patrón/i)]),
      );
      // El más urgente va primero.
      expect(late[0]!.status).toBe("overdue");
      const alerts = await getMaintenanceAlerts(tx, "2026-11-05");
      expect(alerts.overdue).toBe(2);
      expect(alerts.dueSoon).toBeGreaterThanOrEqual(0);
    });
  });

  it("registrar un preventivo hecho crea la orden done y mueve el vencimiento", async () => {
    await inRollback("af", async (tx) => {
      const plan = await planOf(tx, "BISCOMATIC", /alambre/i);
      const input = registerPreventiveInput.parse({ planId: plan.id, date: "2026-10-02", cost: "1.500,50" });
      const order = await registerPreventive(tx, await userId(tx, "af"), input, TODAY);
      expect(order).toMatchObject({
        type: "preventive",
        status: "done",
        planId: plan.id,
        doneAt: "2026-10-02",
        cost: 1500.5,
      });
      expect(order.activity).toBe(plan.task);
      const after = await planOf(tx, "BISCOMATIC", /alambre/i);
      expect(after).toMatchObject({ lastDoneAt: "2026-10-02", nextDue: "2026-11-01" });
    });
  });

  it("cargar un preventivo viejo no adelanta el vencimiento ni acepta fechas futuras", async () => {
    await inRollback("af", async (tx) => {
      const uid = await userId(tx, "af");
      const plan = await planOf(tx, "BALANZA", /pesa/i);
      await registerPreventive(
        tx,
        uid,
        registerPreventiveInput.parse({ planId: plan.id, date: "2026-10-02" }),
        TODAY,
      );
      await registerPreventive(
        tx,
        uid,
        registerPreventiveInput.parse({ planId: plan.id, date: "2026-09-20" }),
        TODAY,
      );
      expect((await planOf(tx, "BALANZA", /pesa/i)).lastDoneAt).toBe("2026-10-02");
      await expect(
        registerPreventive(
          tx,
          uid,
          registerPreventiveInput.parse({ planId: plan.id, date: "2026-10-09" }),
          TODAY,
        ),
      ).rejects.toThrow(/futura/);
    });
  });

  it("alta, edición y baja de planes", async () => {
    await inRollback("af", async (tx) => {
      const rallador = await equip(tx, "RALLADOR");
      const created = await createPlan(
        tx,
        planInput.parse({
          equipmentId: rallador.id,
          task: "Afilado de cuchillas",
          frequencyDays: 45,
          startDate: TODAY,
        }),
      );
      expect(created).toMatchObject({ frequencyDays: 45, active: true, lastDoneAt: null });
      await updatePlan(
        tx,
        created.id,
        planInput.parse({
          equipmentId: rallador.id,
          task: "Afilado de cuchillas",
          frequencyDays: 30,
          startDate: TODAY,
          active: false,
        }),
      );
      const all = await listPlans(tx, { today: TODAY, equipmentId: rallador.id, includeInactive: true });
      expect(all[0]).toMatchObject({ frequencyDays: 30, active: false });
      expect(await listPlans(tx, { today: TODAY, equipmentId: rallador.id })).toHaveLength(0);
    });
  });

  it("rechaza frecuencias inválidas", () => {
    expect(
      planInput.safeParse({
        equipmentId: crypto.randomUUID(),
        task: "x y z",
        frequencyDays: 0,
        startDate: TODAY,
      }).success,
    ).toBe(false);
  });
});

describe("correctivos (RF-37)", () => {
  it("abre una orden con causa, repuesto, costo y parada; después se cierra", async () => {
    await inRollback("af", async (tx) => {
      const uid = await userId(tx, "af");
      const bisco = await equip(tx, "BISCOMATIC");
      const input = correctiveInput.parse({
        equipmentId: bisco.id,
        date: TODAY,
        cause: "Alambre cortado",
        activity: "Cambio de alambre",
        spareParts: "Alambre 0,5 mm",
        cost: "9.800",
        downtimeMinutes: "60",
      });
      const open = await createCorrective(tx, uid, input, TODAY);
      expect(open).toMatchObject({
        type: "corrective",
        status: "open",
        cost: 9800,
        downtimeMinutes: 60,
        responsibleId: uid,
        doneAt: null,
      });
      expect((await getMaintenanceAlerts(tx, TODAY)).openCorrectives).toBe(2);

      const closed = await closeCorrective(
        tx,
        closeCorrectiveInput.parse({
          id: open.id,
          doneAt: TODAY,
          activity: "Se cambió el alambre y se ajustó la tensión",
          downtimeMinutes: 75,
        }),
        TODAY,
      );
      expect(closed).toMatchObject({ status: "done", doneAt: TODAY, downtimeMinutes: 75, cost: 9800 });
      expect((await getMaintenanceAlerts(tx, TODAY)).openCorrectives).toBe(1);
      await expect(
        closeCorrective(
          tx,
          closeCorrectiveInput.parse({ id: open.id, doneAt: TODAY, activity: "otra vez" }),
          TODAY,
        ),
      ).rejects.toThrow(/ya está cerrada/);
    });
  });

  it("el historial de la Biscomatic muestra los correctivos repetidos", async () => {
    await inRollback("af", async (tx) => {
      const bisco = await equip(tx, "BISCOMATIC");
      const h = (await equipmentHistory(tx, bisco.id, TODAY))!;
      expect(h.orders.filter((o) => o.type === "corrective")).toHaveLength(4);
      expect(h.repeated[0]).toMatchObject({ label: "Alambre cortado", count: 3 });
      expect(h.totals.correctives).toBe(4);
      expect(h.totals.cost).toBe(8500 + 9800);
      const summaries = await equipmentSummaries(tx, TODAY);
      const s = summaries.find((x) => x.code === "BISCOMATIC")!;
      expect(s).toMatchObject({ correctives: 4, openCorrectives: 0, lastCorrective: "2026-09-15" });
      expect(summaries.find((x) => x.code === "SELLADORA")?.openCorrectives).toBe(1);
    });
  });

  it("no acepta correctivos con fecha futura", async () => {
    await inRollback("af", async (tx) => {
      const bisco = await equip(tx, "BISCOMATIC");
      const input = correctiveInput.parse({
        equipmentId: bisco.id,
        date: "2026-10-10",
        cause: "Prueba",
        activity: "Prueba",
      });
      await expect(createCorrective(tx, await userId(tx, "af"), input, TODAY)).rejects.toThrow(/futura/);
    });
  });
});

describe("preventivos cumplidos del mes y alertas (RF-37, M8)", () => {
  it("hechos ÷ programados del mes", async () => {
    await inRollback("af", async (tx) => {
      const before = await preventiveCompliance(tx, TODAY);
      // Octubre: los planes de 30 días (alambre, balanza) vencen el 31/10.
      expect(before).toMatchObject({ expected: 2, done: 0, pct: 0 });
      const plan = await planOf(tx, "BISCOMATIC", /alambre/i);
      await registerPreventive(
        tx,
        await userId(tx, "af"),
        registerPreventiveInput.parse({ planId: plan.id, date: TODAY }),
        TODAY,
      );
      expect(await preventiveCompliance(tx, TODAY)).toMatchObject({ expected: 2, done: 1, pct: 50 });
    });
  });

  it("getMaintenanceAlerts expone vencidos, por vencer, % y correctivos abiertos", async () => {
    await inRollback("af", async (tx) => {
      expect(await getMaintenanceAlerts(tx, TODAY)).toEqual({
        overdue: 0,
        dueSoon: 0,
        preventiveCompliancePct: 0,
        openCorrectives: 1,
      });
    });
  });
});
