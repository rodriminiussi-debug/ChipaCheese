import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { paymentInput } from "../billing/schemas";
import { registerPayment } from "../billing/service";
import { receiveSettlementInput, registerSettlementInput } from "./schemas";
import {
  expectedSettlement,
  listSettlements,
  receiveSettlement,
  registerSettlement,
  routesPendingSettlement,
  settlementView,
} from "./settlement";

const DAY = "2026-10-02";
const MONTH = { from: "2026-10-01", to: "2026-10-31" };

async function user(tx: Tx, username: string) {
  return (await tx.query.users.findFirst({ where: eq(schema.users.username, username) }))!.id;
}
async function customerId(tx: Tx, legalName: string) {
  return (await tx.query.customers.findFirst({ where: eq(schema.customers.legalName, legalName) }))!.id;
}

/** Ruta del día con el chofer dado y el estado pedido. */
async function makeRoute(tx: Tx, driverId: string | null, status: "in_progress" | "done" = "done") {
  const [r] = await tx.insert(schema.routes).values({ date: DAY, driverId, status }).returning();
  return r!;
}

/** Cobros de la ruta: 80.000 en efectivo + 30.000 más a otro cliente, una transferencia y dos cheques. */
async function collect(tx: Tx, routeId: string, serial = 7000) {
  const a = await customerId(tx, "Supermercado Arcoiris");
  const b = await customerId(tx, "Club Náutico");
  const pay = (over: Record<string, unknown>) =>
    registerPayment(tx, null, paymentInput.parse({ routeId, ...over }), DAY);
  await pay({ customerId: a, method: "cash", amount: 80000 });
  await pay({ customerId: b, method: "cash", amount: 30000 });
  await pay({ customerId: b, method: "transfer", amount: 45000, reference: "TR-1" });
  await pay({
    customerId: a,
    method: "check",
    checks: [
      { bank: "Banco Nación", number: String(serial + 1), amount: 40000, cashDate: "2026-10-30" },
      { bank: "Galicia", number: String(serial + 2), amount: 60000, cashDate: "2026-11-15" },
    ],
  });
}

const input = (routeId: string, over: Record<string, unknown> = {}) =>
  registerSettlementInput.parse({ routeId, cashDelivered: 110000, checksDelivered: 2, ...over });

describe("rendición del chofer: lo esperado", () => {
  it("suma lo cobrado en ESA ruta: efectivo, cheques (cantidad e importe) y transferencias", async () => {
    await inRollback("nahuel", async (tx) => {
      const route = await makeRoute(tx, null);
      const other = await makeRoute(tx, null);
      await collect(tx, route.id);
      // Un cobro en otra ruta y otro sin ruta no entran.
      await registerPayment(
        tx,
        null,
        paymentInput.parse({
          customerId: await customerId(tx, "Club Náutico"),
          method: "cash",
          amount: 999,
          routeId: other.id,
        }),
        DAY,
      );
      await registerPayment(
        tx,
        null,
        paymentInput.parse({ customerId: await customerId(tx, "Club Náutico"), method: "cash", amount: 555 }),
        DAY,
      );

      const e = await expectedSettlement(tx, route.id);
      expect(e).toMatchObject({
        cashExpected: 110000,
        transfersExpected: 45000,
        checksExpected: 2,
        checksAmount: 100000,
        payments: 4,
      });
      expect(e.checks.map((c) => `${c.bank} ${c.number}`).sort()).toEqual([
        "Banco Nación 7001",
        "Galicia 7002",
      ]);
      expect(await expectedSettlement(tx, other.id)).toMatchObject({ cashExpected: 999, checksExpected: 0 });
    });
  });
});

describe("rendición del chofer: registrar", () => {
  it("sin diferencia: queda registrada con lo esperado y lo entregado", async () => {
    await inRollback("logistica", async (tx, chofer) => {
      const route = await makeRoute(tx, chofer);
      await collect(tx, route.id);
      const res = await registerSettlement(tx, chofer, input(route.id), {
        now: new Date("2026-10-02T18:00:00-03:00"),
      });
      expect(res).toMatchObject({ cash: 0, checks: 0, status: "ok" });
      const view = await settlementView(tx, route.id);
      expect(view.settlement).toMatchObject({
        cashExpected: 110000,
        cashDelivered: 110000,
        checksExpected: 2,
        checksDelivered: 2,
        transfersExpected: 45000,
        receivedById: null,
      });
      expect(view.diff).toEqual({ cash: 0, checks: 0, status: "ok" });
    });
  });

  it("con diferencia: pide el motivo y la deja visible; falta efectivo y un cheque", async () => {
    await inRollback("logistica", async (tx, chofer) => {
      const route = await makeRoute(tx, chofer);
      await collect(tx, route.id);
      await expect(
        registerSettlement(tx, chofer, input(route.id, { cashDelivered: 108500, checksDelivered: 1 })),
      ).rejects.toThrow(/contá a qué se debe/);
      const res = await registerSettlement(
        tx,
        chofer,
        input(route.id, {
          cashDelivered: 108500,
          checksDelivered: 1,
          notes: "Dejé un cheque en el local y pagué un peaje",
        }),
      );
      expect(res).toMatchObject({ cash: -1500, checks: -1, status: "short" });
      const [row] = await listSettlements(tx, MONTH);
      expect(row).toMatchObject({
        routeId: route.id,
        cashExpected: 110000,
        cashDelivered: 108500,
        cashDiff: -1500,
        checksDiff: -1,
        status: "short",
        notes: "Dejé un cheque en el local y pagué un peaje",
        receivedByName: null,
      });
    });
  });

  it("solo con la ruta cerrada y solo el chofer de la ruta (salvo Dirección o la jefa)", async () => {
    await inRollback("logistica", async (tx, chofer) => {
      const nahuel = await user(tx, "nahuel");
      const abierta = await makeRoute(tx, chofer, "in_progress");
      await expect(registerSettlement(tx, chofer, input(abierta.id))).rejects.toThrow(/Cerrá la ruta/);
      const ajena = await makeRoute(tx, nahuel);
      await expect(
        registerSettlement(tx, chofer, input(ajena.id, { cashDelivered: 0, checksDelivered: 0 })),
      ).rejects.toThrow(/Solo el chofer/);
      // Dirección (con permiso para recibir) sí puede cargarla por él.
      await expect(
        registerSettlement(tx, nahuel, input(ajena.id, { cashDelivered: 0, checksDelivered: 0 }), {
          canSettle: true,
        }),
      ).resolves.toMatchObject({ status: "ok" });
      await expect(
        registerSettlement(tx, chofer, input("00000000-0000-4000-8000-000000000000")),
      ).rejects.toThrow(/no existe/);
    });
  });

  it("se puede corregir hasta que la reciben; después queda cerrada", async () => {
    await inRollback("logistica", async (tx, chofer) => {
      const af = await user(tx, "af");
      const route = await makeRoute(tx, chofer);
      await collect(tx, route.id);
      await registerSettlement(tx, chofer, input(route.id, { cashDelivered: 100000, notes: "Falta contar" }));
      // corrección: una sola rendición por ruta
      await registerSettlement(tx, chofer, input(route.id));
      expect(
        await tx.query.routeSettlements.findMany({ where: eq(schema.routeSettlements.routeId, route.id) }),
      ).toHaveLength(1);
      expect((await settlementView(tx, route.id)).diff!.status).toBe("ok");

      await receiveSettlement(
        tx,
        af,
        receiveSettlementInput.parse({ routeId: route.id, notes: "Contado y guardado" }),
      );
      const [row] = await listSettlements(tx, MONTH);
      expect(row!.receivedByName).toBe("A.F. (Jefa de producción)");
      expect(row!.notes).toContain("Contado y guardado");
      await expect(registerSettlement(tx, chofer, input(route.id, { cashDelivered: 1 }))).rejects.toThrow(
        /ya fue recibida/,
      );
      await expect(receiveSettlement(tx, af, { routeId: route.id })).rejects.toThrow(/ya fue recibida/);
    });
  });

  it("no se puede recibir una ruta que el chofer no rindió", async () => {
    await inRollback("af", async (tx, af) => {
      const route = await makeRoute(tx, null);
      await expect(receiveSettlement(tx, af, { routeId: route.id })).rejects.toThrow(/todavía no rindió/);
    });
  });
});

describe("rendiciones: listado y pendientes", () => {
  it("las rutas cerradas con cobros y sin rendir aparecen como pendientes; las rendidas, no", async () => {
    await inRollback("logistica", async (tx, chofer) => {
      const rendida = await makeRoute(tx, chofer);
      const pendiente = await makeRoute(tx, chofer);
      const sinCobros = await makeRoute(tx, chofer);
      await collect(tx, rendida.id);
      await collect(tx, pendiente.id, 8000);
      await registerSettlement(tx, chofer, input(rendida.id));

      const pending = await routesPendingSettlement(tx, MONTH);
      expect(pending.map((p) => p.routeId)).toEqual([pendiente.id]);
      expect(pending[0]).toMatchObject({ payments: 4, collected: 255000 });
      expect(pending.some((p) => p.routeId === sinCobros.id)).toBe(false);
      expect(await listSettlements(tx, { from: "2026-11-01", to: "2026-11-30" })).toHaveLength(0);
    });
  });
});
