import { and, asc, eq, ilike, ne, or, schema, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import type { CustomerData } from "./schemas";

/**
 * Servicio de clientes. Las funciones reciben un `Executor` (db o tx) para poder testearse con
 * transacciones revertidas y componerse dentro de otras operaciones.
 */
export async function listCustomers(
  db: Executor,
  f: { q?: string; channel?: string; zoneId?: string; includeInactive?: boolean } = {},
) {
  const c = schema.customers;
  const where = and(
    f.includeInactive ? undefined : eq(c.active, true),
    f.q
      ? or(
          ilike(c.legalName, `%${f.q}%`),
          ilike(c.tradeName, `%${f.q}%`),
          ilike(c.cuit, `%${f.q.replace(/\D/g, "") || f.q}%`),
        )
      : undefined,
    f.channel ? eq(c.channel, f.channel as CustomerData["channel"]) : undefined,
    f.zoneId ? eq(c.zoneId, f.zoneId) : undefined,
  );
  return db.query.customers.findMany({
    where,
    orderBy: asc(c.legalName),
    with: { zone: true, priceList: true },
  });
}

export function getCustomer(db: Executor, id: string) {
  return db.query.customers.findFirst({
    where: eq(schema.customers.id, id),
    with: { zone: true, priceList: true },
  });
}

async function assertUniqueCuit(db: Executor, cuit: string | null, exceptId?: string) {
  if (!cuit) return;
  const dup = await db.query.customers.findFirst({
    where: and(eq(schema.customers.cuit, cuit), exceptId ? ne(schema.customers.id, exceptId) : undefined),
  });
  if (dup)
    throw new UserError(`Ya existe un cliente con ese CUIT (${dup.legalName}).`, {
      cuit: ["CUIT duplicado"],
    });
}

export async function createCustomer(db: Executor, input: CustomerData) {
  await assertUniqueCuit(db, input.cuit);
  const [row] = await db.insert(schema.customers).values(input).returning();
  return row!;
}

export async function updateCustomer(db: Executor, id: string, input: CustomerData) {
  await assertUniqueCuit(db, input.cuit, id);
  const [row] = await db.update(schema.customers).set(input).where(eq(schema.customers.id, id)).returning();
  if (!row) throw new UserError("El cliente no existe.");
  return row;
}

/** Opciones para selects del formulario. */
export async function customerFormOptions(db: Executor) {
  const [zones, priceLists] = await Promise.all([
    db.query.zones.findMany({ orderBy: asc(schema.zones.name) }),
    db.query.priceLists.findMany({
      where: eq(schema.priceLists.active, true),
      orderBy: asc(schema.priceLists.name),
    }),
  ]);
  return {
    zones: zones.map((z) => ({ id: z.id, name: z.name, deliveryWeekdays: z.deliveryWeekdays })),
    priceLists: priceLists.map((p) => ({ id: p.id, name: p.name, channel: p.channel })),
  };
}
export type CustomerFormOptions = Awaited<ReturnType<typeof customerFormOptions>>;
