import { settlementDifference, roundMoney, type IsoDate } from "@chipa/domain";
import { and, asc, desc, eq, gte, inArray, lte, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import type { RegisterSettlementData } from "./schemas";

/**
 * Rendición del chofer al volver (una por ruta). Lo ESPERADO lo calcula el sistema con lo que se cobró en
 * esa ruta (`customer_payments.routeId`): efectivo, cheques y transferencias. El chofer carga lo que
 * entrega; la diferencia queda registrada y Dirección o la jefa reciben la rendición.
 */

export interface ExpectedSettlement {
  cashExpected: number;
  transfersExpected: number;
  checksExpected: number;
  checksAmount: number;
  checks: { id: string; bank: string; number: string; amount: number; customerName: string }[];
  /** Cobros registrados en la ruta (de cualquier medio). */
  payments: number;
}

/** Lo cobrado en la ruta, por medio de pago. Efectivo = `cash`; cheques por cantidad; el resto, a cuenta bancaria. */
export async function expectedSettlement(db: Executor, routeId: string): Promise<ExpectedSettlement> {
  const payments = await db.query.customerPayments.findMany({
    where: eq(schema.customerPayments.routeId, routeId),
    with: { customer: true, checks: true },
    orderBy: asc(schema.customerPayments.createdAt),
  });
  const sum = (xs: number[]) => roundMoney(xs.reduce((a, n) => a + n, 0));
  const checks = payments
    .filter((p) => p.method === "check")
    .flatMap((p) =>
      p.checks.map((c) => ({
        id: c.id,
        bank: c.bank,
        number: c.number,
        amount: c.amount,
        customerName: p.customer.legalName,
      })),
    );
  return {
    cashExpected: sum(payments.filter((p) => p.method === "cash").map((p) => p.amount)),
    transfersExpected: sum(
      payments.filter((p) => p.method !== "cash" && p.method !== "check").map((p) => p.amount),
    ),
    checksExpected: checks.length,
    checksAmount: sum(checks.map((c) => c.amount)),
    checks,
    payments: payments.length,
  };
}

export async function getRouteSettlement(db: Executor, routeId: string) {
  return (
    (await db.query.routeSettlements.findFirst({
      where: eq(schema.routeSettlements.routeId, routeId),
      with: { receivedBy: true },
    })) ?? null
  );
}
export type RouteSettlement = NonNullable<Awaited<ReturnType<typeof getRouteSettlement>>>;

/** Vista de la rendición de una ruta: lo esperado hoy, lo rendido (si hay) y su diferencia. */
export async function settlementView(db: Executor, routeId: string) {
  const [expected, settlement] = await Promise.all([
    expectedSettlement(db, routeId),
    getRouteSettlement(db, routeId),
  ]);
  const diff = settlement ? settlementDifference(settlement) : null;
  return { expected, settlement, diff };
}
export type SettlementView = Awaited<ReturnType<typeof settlementView>>;

/**
 * El chofer registra lo que entrega al cerrar la ruta. Solo con la ruta cerrada. Se puede corregir hasta que
 * la reciba Dirección o la jefa. Si hay diferencia, el motivo es obligatorio.
 */
export async function registerSettlement(
  db: Executor,
  userId: string | null,
  input: RegisterSettlementData,
  opts: { now?: Date; canSettle?: boolean } = {},
) {
  const [route] = await db
    .select()
    .from(schema.routes)
    .where(eq(schema.routes.id, input.routeId))
    .for("update");
  if (!route) throw new UserError("La ruta no existe.");
  if (route.status !== "done") throw new UserError("Cerrá la ruta antes de rendir lo cobrado.");
  if (!opts.canSettle && route.driverId && userId && route.driverId !== userId)
    throw new UserError("Solo el chofer de esta ruta puede rendirla.");

  const existing = await getRouteSettlement(db, route.id);
  if (existing?.receivedById) throw new UserError("La rendición ya fue recibida: no se puede modificar.");

  const expected = await expectedSettlement(db, route.id);
  const diff = settlementDifference({
    cashExpected: expected.cashExpected,
    cashDelivered: input.cashDelivered,
    checksExpected: expected.checksExpected,
    checksDelivered: input.checksDelivered,
  });
  if (diff.status !== "ok" && !input.notes)
    throw new UserError("Hay diferencia con lo cobrado: contá a qué se debe en las observaciones.", {
      notes: ["Contá el motivo de la diferencia"],
    });

  const values = {
    cashExpected: expected.cashExpected,
    cashDelivered: input.cashDelivered,
    checksExpected: expected.checksExpected,
    checksDelivered: input.checksDelivered,
    transfersExpected: expected.transfersExpected,
    notes: input.notes,
    settledAt: opts.now ?? new Date(),
  };
  const [row] = existing
    ? await db
        .update(schema.routeSettlements)
        .set(values)
        .where(eq(schema.routeSettlements.id, existing.id))
        .returning()
    : await db
        .insert(schema.routeSettlements)
        .values({ routeId: route.id, ...values })
        .returning();
  return { id: row!.id, routeId: route.id, ...diff };
}

/** Dirección o la jefa reciben la rendición (contaron lo entregado). Queda quién y cuándo. */
export async function receiveSettlement(
  db: Executor,
  userId: string,
  input: { routeId: string; notes?: string | null },
) {
  const existing = await getRouteSettlement(db, input.routeId);
  if (!existing) throw new UserError("El chofer todavía no rindió esta ruta.");
  if (existing.receivedById) throw new UserError("La rendición ya fue recibida.");
  const notes = input.notes
    ? [existing.notes, `Recepción: ${input.notes}`].filter(Boolean).join(" · ")
    : existing.notes;
  await db
    .update(schema.routeSettlements)
    .set({ receivedById: userId, notes })
    .where(eq(schema.routeSettlements.id, existing.id));
  return { id: existing.id, routeId: input.routeId };
}

export interface SettlementRow {
  id: string;
  routeId: string;
  routeDate: IsoDate;
  driverName: string | null;
  vehicleName: string | null;
  cashExpected: number;
  cashDelivered: number;
  checksExpected: number;
  checksDelivered: number;
  transfersExpected: number;
  cashDiff: number;
  checksDiff: number;
  status: "ok" | "short" | "over";
  notes: string | null;
  settledAt: Date;
  receivedByName: string | null;
}

/** Rendiciones de las rutas entre dos fechas (las más nuevas primero), con su diferencia. */
export async function listSettlements(
  db: Executor,
  range: { from: IsoDate; to: IsoDate },
): Promise<SettlementRow[]> {
  const rows = await db
    .select({ s: schema.routeSettlements, r: schema.routes })
    .from(schema.routeSettlements)
    .innerJoin(schema.routes, eq(schema.routes.id, schema.routeSettlements.routeId))
    .where(and(gte(schema.routes.date, range.from), lte(schema.routes.date, range.to)))
    .orderBy(desc(schema.routes.date), desc(schema.routeSettlements.settledAt));
  if (!rows.length) return [];
  const userIds = [
    ...new Set(rows.flatMap((x) => [x.r.driverId, x.s.receivedById]).filter((x): x is string => !!x)),
  ];
  const vehicleIds = [...new Set(rows.map((x) => x.r.vehicleId).filter((x): x is string => !!x))];
  const [users, vehicles] = await Promise.all([
    userIds.length ? db.query.users.findMany({ where: inArray(schema.users.id, userIds) }) : [],
    vehicleIds.length ? db.query.vehicles.findMany({ where: inArray(schema.vehicles.id, vehicleIds) }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const vehicleName = new Map(vehicles.map((v) => [v.id, v.name]));
  return rows.map(({ s, r }) => {
    const d = settlementDifference(s);
    return {
      id: s.id,
      routeId: r.id,
      routeDate: r.date,
      driverName: r.driverId ? (userName.get(r.driverId) ?? null) : null,
      vehicleName: r.vehicleId ? (vehicleName.get(r.vehicleId) ?? null) : null,
      cashExpected: s.cashExpected,
      cashDelivered: s.cashDelivered,
      checksExpected: s.checksExpected,
      checksDelivered: s.checksDelivered,
      transfersExpected: s.transfersExpected,
      cashDiff: d.cash,
      checksDiff: d.checks,
      status: d.status,
      notes: s.notes,
      settledAt: s.settledAt,
      receivedByName: s.receivedById ? (userName.get(s.receivedById) ?? null) : null,
    };
  });
}

/** Rutas cerradas con cobros que todavía no fueron rendidas por el chofer. */
export async function routesPendingSettlement(db: Executor, range: { from: IsoDate; to: IsoDate }) {
  const routes = await db.query.routes.findMany({
    where: and(
      eq(schema.routes.status, "done"),
      gte(schema.routes.date, range.from),
      lte(schema.routes.date, range.to),
    ),
    with: { driver: true, vehicle: true },
    orderBy: desc(schema.routes.date),
  });
  if (!routes.length) return [];
  const ids = routes.map((r) => r.id);
  const [settled, paid] = await Promise.all([
    db
      .select({ routeId: schema.routeSettlements.routeId })
      .from(schema.routeSettlements)
      .where(inArray(schema.routeSettlements.routeId, ids)),
    db.query.customerPayments.findMany({ where: inArray(schema.customerPayments.routeId, ids) }),
  ]);
  const settledIds = new Set(settled.map((s) => s.routeId));
  return routes
    .filter((r) => !settledIds.has(r.id))
    .map((r) => {
      const mine = paid.filter((p) => p.routeId === r.id);
      return {
        routeId: r.id,
        date: r.date,
        driverName: r.driver?.name ?? null,
        vehicleName: r.vehicle?.name ?? null,
        payments: mine.length,
        collected: roundMoney(mine.reduce((a, p) => a + p.amount, 0)),
      };
    })
    .filter((r) => r.payments > 0);
}
export type PendingSettlement = Awaited<ReturnType<typeof routesPendingSettlement>>[number];
