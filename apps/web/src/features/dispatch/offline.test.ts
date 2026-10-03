import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { finishRoutePayload, startRoutePayload } from "./schemas";
import { finishRoute, getRoute, startRoute } from "./service";

/** Salida de ruta sin señal (RF-26): iniciar y cerrar desde el celular del chofer es idempotente. */
const DAY = "2026-10-02";
const DEPARTED = new Date("2026-10-02T09:00:00-03:00");
const RETURNED = new Date("2026-10-02T12:30:00-03:00");

async function newRoute(tx: Tx) {
  const vehicle = await tx.query.vehicles.findFirst();
  const [route] = await tx.insert(schema.routes).values({ date: DAY, vehicleId: vehicle!.id }).returning();
  return route!;
}
async function vehicleColdLogs(tx: Tx) {
  const eq1 = await tx.query.equipment.findFirst({ where: eq(schema.equipment.code, "VEH-FRIO") });
  return tx.select().from(schema.temperatureLogs).where(eq(schema.temperatureLogs.equipmentId, eq1!.id));
}

describe("iniciar y cerrar la ruta sin señal (RF-26)", () => {
  it("el inicio con el mismo clientId se aplica una vez y toma la hora real de salida", async () => {
    await inRollback("logistica", async (tx) => {
      const route = await newRoute(tx);
      const clientId = crypto.randomUUID();
      const first = await startRoute(tx, { id: route.id, kmStart: 12000, clientId }, DEPARTED);
      expect(first.duplicate).toBe(false);
      // Reenvío (se perdió la respuesta): no falla con "solo se inicia una ruta planificada" ni cambia nada.
      const again = await startRoute(tx, { id: route.id, kmStart: 99999, clientId }, new Date());
      expect(again).toMatchObject({ id: route.id, duplicate: true });
      const r = (await getRoute(tx, route.id))!;
      expect(r).toMatchObject({ status: "in_progress", kmStart: 12000 });
      expect(r.startedAt).toEqual(DEPARTED);
    });
  });

  it("el cierre con el mismo clientId se aplica una vez y no repite la temperatura del trayecto", async () => {
    await inRollback("logistica", async (tx, userId) => {
      const route = await newRoute(tx);
      await startRoute(tx, { id: route.id, kmStart: 12000, clientId: crypto.randomUUID() }, DEPARTED);
      const logsBefore = (await vehicleColdLogs(tx)).length;
      const clientId = crypto.randomUUID();
      const payload = finishRoutePayload.parse({
        id: route.id,
        kmEnd: "12085",
        coldUnitTempC: "-20",
        fuelLiters: "9,5",
        clientId,
        recordedAt: RETURNED.toISOString(),
      });

      const first = await finishRoute(tx, userId, payload, RETURNED);
      expect(first.duplicate).toBe(false);
      const again = await finishRoute(tx, userId, { ...payload, kmEnd: 1 }, new Date());
      expect(again).toMatchObject({ id: route.id, duplicate: true });

      const r = (await getRoute(tx, route.id))!;
      expect(r).toMatchObject({ status: "done", kmEnd: 12085, coldUnitTempC: -20 });
      expect(r.endedAt).toEqual(RETURNED);
      const logs = await vehicleColdLogs(tx);
      expect(logs).toHaveLength(logsBefore + 1);
      expect(logs.at(-1)!.measuredAt).toBeDefined();

      // Un cierre distinto (otro clientId) sobre una ruta ya cerrada sigue siendo un error de negocio.
      await expect(
        finishRoute(tx, userId, { ...payload, clientId: crypto.randomUUID() }, RETURNED),
      ).rejects.toThrow(/solo se cierra una ruta en curso/);
    });
  });

  it("los payloads exigen clientId y recordedAt", () => {
    expect(startRoutePayload.safeParse({ id: crypto.randomUUID(), kmStart: "1" }).success).toBe(false);
    expect(
      startRoutePayload.safeParse({
        id: crypto.randomUUID(),
        kmStart: "1",
        clientId: crypto.randomUUID(),
        recordedAt: DEPARTED.toISOString(),
      }).success,
    ).toBe(true);
    expect(finishRoutePayload.safeParse({ id: crypto.randomUUID(), kmEnd: "1" }).success).toBe(false);
  });
});
