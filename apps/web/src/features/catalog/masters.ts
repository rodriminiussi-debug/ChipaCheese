import type { IsoDate } from "@chipa/domain";
import { and, asc, count, eq, ne, schema, sql, type Executor } from "@chipa/db";
import { UserError } from "@/server/errors";
import { todayAR } from "@/lib/dates";
import { currentPriceMap } from "@/features/orders/service";
import type {
  CopyPricesData,
  EquipmentData,
  LocationData,
  PriceListData,
  VehicleData,
  ZoneData,
} from "./schemas";

/** Maestros chicos del catálogo: zonas de reparto, listas de precios, vehículos, equipos y ubicaciones. */

const norm = (s: string) => s.trim().toLowerCase();

// --- Zonas ------------------------------------------------------------------------------------------

export async function listZones(db: Executor) {
  const [zones, counts] = await Promise.all([
    db.query.zones.findMany({ orderBy: asc(schema.zones.name) }),
    db
      .select({ zoneId: schema.customers.zoneId, n: count() })
      .from(schema.customers)
      .groupBy(schema.customers.zoneId),
  ]);
  const byZone = new Map(counts.map((c) => [c.zoneId, c.n]));
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    deliveryWeekdays: z.deliveryWeekdays,
    customers: byZone.get(z.id) ?? 0,
  }));
}
export type ZoneRow = Awaited<ReturnType<typeof listZones>>[number];

async function assertUniqueZone(db: Executor, name: string, exceptId?: string) {
  const z = schema.zones;
  const dup = await db.query.zones.findFirst({
    where: and(sql`lower(${z.name}) = ${norm(name)}`, exceptId ? ne(z.id, exceptId) : undefined),
  });
  if (dup) throw new UserError(`Ya existe la zona "${dup.name}".`, { name: ["Nombre repetido"] });
}

export async function createZone(db: Executor, input: ZoneData) {
  await assertUniqueZone(db, input.name);
  const [row] = await db.insert(schema.zones).values(input).returning();
  return row!;
}

export async function updateZone(db: Executor, id: string, input: ZoneData) {
  await assertUniqueZone(db, input.name, id);
  const [row] = await db.update(schema.zones).set(input).where(eq(schema.zones.id, id)).returning();
  if (!row) throw new UserError("La zona no existe.");
  return row;
}

/** Solo se borra una zona sin clientes; si ya se usa hay que mover primero sus clientes. */
export async function deleteZone(db: Executor, id: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.customers)
    .where(eq(schema.customers.zoneId, id));
  if (n > 0)
    throw new UserError(
      `La zona tiene ${n} cliente${n === 1 ? "" : "s"}: cambialos de zona antes de borrarla.`,
    );
  const rows = await db.delete(schema.zones).where(eq(schema.zones.id, id)).returning();
  if (!rows.length) throw new UserError("La zona no existe.");
  return { id };
}

// --- Listas de precios --------------------------------------------------------------------------------

export async function listPriceLists(db: Executor, today: IsoDate = todayAR()) {
  const [lists, items, customers] = await Promise.all([
    db.query.priceLists.findMany({ orderBy: asc(schema.priceLists.name) }),
    currentPriceMap(db, today),
    db
      .select({ listId: schema.customers.priceListId, n: count() })
      .from(schema.customers)
      .where(eq(schema.customers.active, true))
      .groupBy(schema.customers.priceListId),
  ]);
  const byList = new Map(customers.map((c) => [c.listId, c.n]));
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    channel: l.channel,
    targetMarginPct: l.targetMarginPct,
    active: l.active,
    pricedProducts: Object.keys(items[l.id] ?? {}).length,
    customers: byList.get(l.id) ?? 0,
  }));
}
export type PriceListRow = Awaited<ReturnType<typeof listPriceLists>>[number];

async function assertUniqueList(db: Executor, name: string, exceptId?: string) {
  const l = schema.priceLists;
  const dup = await db.query.priceLists.findFirst({
    where: and(sql`lower(${l.name}) = ${norm(name)}`, exceptId ? ne(l.id, exceptId) : undefined),
  });
  if (dup) throw new UserError(`Ya existe la lista "${dup.name}".`, { name: ["Nombre repetido"] });
}

/**
 * Copia los precios vigentes de una lista a otra con un ajuste en % (p. ej. +15 % para un distribuidor).
 * Carga un precio nuevo vigente desde hoy por producto activo; el historial se conserva.
 */
export async function copyPrices(db: Executor, input: CopyPricesData, today: IsoDate = todayAR()) {
  if (input.fromListId === input.toListId) throw new UserError("Elegí dos listas distintas.");
  const [from, to] = await Promise.all([
    db.query.priceLists.findFirst({ where: eq(schema.priceLists.id, input.fromListId) }),
    db.query.priceLists.findFirst({ where: eq(schema.priceLists.id, input.toListId) }),
  ]);
  if (!from) throw new UserError("La lista de origen no existe.");
  if (!to) throw new UserError("La lista de destino no existe.");
  const prices = (await currentPriceMap(db, today, from.id))[from.id] ?? {};
  const active = await db.query.products.findMany({ where: eq(schema.products.active, true) });
  const rows = active
    .filter((p) => prices[p.id] != null)
    .map((p) => {
      const base = prices[p.id]!;
      const adjusted = input.adjustPct ? Math.round(base * (1 + input.adjustPct / 100)) : base;
      return { priceListId: to.id, productId: p.id, unitPrice: adjusted, validFrom: today };
    });
  if (!rows.length) throw new UserError(`La lista "${from.name}" no tiene precios vigentes para copiar.`);
  const t = schema.priceListItems;
  await db
    .insert(t)
    .values(rows)
    .onConflictDoUpdate({
      target: [t.priceListId, t.productId, t.validFrom],
      set: { unitPrice: sql`excluded.unit_price` },
    });
  return { copied: rows.length, from: from.name, to: to.name };
}

export async function createPriceList(db: Executor, input: PriceListData, today: IsoDate = todayAR()) {
  await assertUniqueList(db, input.name);
  const [row] = await db
    .insert(schema.priceLists)
    .values({
      name: input.name,
      channel: input.channel,
      targetMarginPct: input.targetMarginPct,
      active: input.active,
    })
    .returning();
  let copied = 0;
  if (input.copyFromListId)
    copied = (
      await copyPrices(
        db,
        { fromListId: input.copyFromListId, toListId: row!.id, adjustPct: input.adjustPct },
        today,
      )
    ).copied;
  return { ...row!, copied };
}

export async function updatePriceList(db: Executor, id: string, input: PriceListData) {
  await assertUniqueList(db, input.name, id);
  const current = await db.query.priceLists.findFirst({ where: eq(schema.priceLists.id, id) });
  if (!current) throw new UserError("La lista de precios no existe.");
  if (current.active && !input.active) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.customers)
      .where(and(eq(schema.customers.priceListId, id), eq(schema.customers.active, true)));
    if (n > 0)
      throw new UserError(
        `La lista la usan ${n} cliente${n === 1 ? "" : "s"} activo${n === 1 ? "" : "s"}: cambialos de lista antes de desactivarla.`,
      );
  }
  const [row] = await db
    .update(schema.priceLists)
    .set({
      name: input.name,
      channel: input.channel,
      targetMarginPct: input.targetMarginPct,
      active: input.active,
    })
    .where(eq(schema.priceLists.id, id))
    .returning();
  return row!;
}

// --- Equipos ----------------------------------------------------------------------------------------

export async function listEquipment(db: Executor) {
  const rows = await db.query.equipment.findMany({
    orderBy: [asc(schema.equipment.area), asc(schema.equipment.code)],
    with: { location: true },
  });
  return rows.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    area: e.area,
    kind: e.kind,
    tempMinC: e.tempMinC,
    tempMaxC: e.tempMaxC,
    locationId: e.locationId,
    locationName: e.location?.name ?? null,
    active: e.active,
  }));
}
export type EquipmentRow = Awaited<ReturnType<typeof listEquipment>>[number];

async function assertUniqueEquipment(db: Executor, code: string, exceptId?: string) {
  const e = schema.equipment;
  const dup = await db.query.equipment.findFirst({
    where: and(sql`lower(${e.code}) = ${norm(code)}`, exceptId ? ne(e.id, exceptId) : undefined),
  });
  if (dup)
    throw new UserError(`Ya existe el equipo ${dup.code} (${dup.name}).`, { code: ["Código repetido"] });
}

async function assertLocation(db: Executor, id: string | null) {
  if (!id) return;
  const l = await db.query.locations.findFirst({ where: eq(schema.locations.id, id) });
  if (!l) throw new UserError("La ubicación no existe.", { locationId: ["Ubicación inexistente"] });
}

/** Un freezer, heladera o equipo de frío activo aparece solo en temperaturas; todo equipo activo, en mantenimiento. */
export async function createEquipment(db: Executor, input: EquipmentData) {
  await assertUniqueEquipment(db, input.code);
  await assertLocation(db, input.locationId);
  const [row] = await db.insert(schema.equipment).values(input).returning();
  return row!;
}

export async function updateEquipment(db: Executor, id: string, input: EquipmentData) {
  await assertUniqueEquipment(db, input.code, id);
  await assertLocation(db, input.locationId);
  const [row] = await db.update(schema.equipment).set(input).where(eq(schema.equipment.id, id)).returning();
  if (!row) throw new UserError("El equipo no existe.");
  return row;
}

// --- Vehículos --------------------------------------------------------------------------------------

export const normalizePlate = (p: string) => p.toUpperCase().replace(/[\s-]/g, "");

export async function listVehicles(db: Executor) {
  const rows = await db.query.vehicles.findMany({
    orderBy: asc(schema.vehicles.name),
    with: { equipment: true },
  });
  return rows.map((v) => ({
    id: v.id,
    plate: v.plate,
    name: v.name,
    hasColdUnit: v.hasColdUnit,
    costPerKm: v.costPerKm,
    active: v.active,
    equipmentCode: v.equipment?.code ?? null,
  }));
}
export type VehicleRow = Awaited<ReturnType<typeof listVehicles>>[number];

async function assertUniquePlate(db: Executor, plate: string, exceptId?: string) {
  const v = schema.vehicles;
  const dup = await db.query.vehicles.findFirst({
    where: and(eq(v.plate, plate), exceptId ? ne(v.id, exceptId) : undefined),
  });
  if (dup)
    throw new UserError(`Ya existe un vehículo con la patente ${plate} (${dup.name}).`, {
      plate: ["Patente repetida"],
    });
}

/**
 * Alta de vehículo. Si tiene equipo de frío se crea también su equipo (control de temperatura al cerrar la ruta
 * y plan de mantenimiento) y queda en la ubicación "VEHICULO" para el stock a bordo.
 */
export async function createVehicle(db: Executor, input: VehicleData) {
  const plate = normalizePlate(input.plate);
  await assertUniquePlate(db, plate);
  const location = await db.query.locations.findFirst({ where: eq(schema.locations.code, "VEHICULO") });
  let equipmentId: string | null = null;
  if (input.hasColdUnit && input.createColdEquipment) {
    const code = `VEH-${plate}`;
    await assertUniqueEquipment(db, code);
    const [eq1] = await db
      .insert(schema.equipment)
      .values({
        code,
        name: `Equipo de frío — ${input.name}`,
        area: "Reparto",
        kind: "vehicle",
        tempMaxC: -18,
        locationId: location?.id ?? null,
        active: input.active,
      })
      .returning();
    equipmentId = eq1!.id;
  }
  const [row] = await db
    .insert(schema.vehicles)
    .values({
      plate,
      name: input.name,
      hasColdUnit: input.hasColdUnit,
      costPerKm: input.costPerKm,
      active: input.active,
      equipmentId,
      locationId: location?.id ?? null,
    })
    .returning();
  return row!;
}

export async function updateVehicle(db: Executor, id: string, input: VehicleData) {
  const plate = normalizePlate(input.plate);
  await assertUniquePlate(db, plate, id);
  const [row] = await db
    .update(schema.vehicles)
    .set({
      plate,
      name: input.name,
      hasColdUnit: input.hasColdUnit,
      costPerKm: input.costPerKm,
      active: input.active,
    })
    .where(eq(schema.vehicles.id, id))
    .returning();
  if (!row) throw new UserError("El vehículo no existe.");
  return row;
}

// --- Ubicaciones / depósitos ----------------------------------------------------------------------------

export async function listLocations(db: Executor) {
  const [rows, product, ingredient] = await Promise.all([
    db.query.locations.findMany({ orderBy: [asc(schema.locations.kind), asc(schema.locations.code)] }),
    db
      .select({
        locationId: schema.productStock.locationId,
        n: sql<number>`sum(${schema.productStock.qty})`.mapWith(Number),
      })
      .from(schema.productStock)
      .groupBy(schema.productStock.locationId),
    db
      .select({
        locationId: schema.ingredientStock.locationId,
        n: sql<number>`sum(${schema.ingredientStock.qty})`.mapWith(Number),
      })
      .from(schema.ingredientStock)
      .groupBy(schema.ingredientStock.locationId),
  ]);
  const stock = new Map<string, number>();
  for (const r of [...product, ...ingredient])
    stock.set(r.locationId, (stock.get(r.locationId) ?? 0) + Math.abs(r.n ?? 0));
  return rows.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    kind: l.kind,
    capacityKg: l.capacityKg,
    active: l.active,
    hasStock: (stock.get(l.id) ?? 0) > 0,
  }));
}
export type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];

async function assertUniqueLocation(db: Executor, code: string, exceptId?: string) {
  const l = schema.locations;
  const dup = await db.query.locations.findFirst({
    where: and(sql`lower(${l.code}) = ${norm(code)}`, exceptId ? ne(l.id, exceptId) : undefined),
  });
  if (dup)
    throw new UserError(`Ya existe la ubicación ${dup.code} (${dup.name}).`, { code: ["Código repetido"] });
}

/**
 * Alta de un depósito o freezer nuevo. Los de producto terminado aparecen en el stock y en las transferencias;
 * con `createEquipment` también se da de alta su equipo (temperaturas y mantenimiento).
 */
export async function createLocation(db: Executor, input: LocationData) {
  await assertUniqueLocation(db, input.code);
  const [row] = await db
    .insert(schema.locations)
    .values({
      code: input.code,
      name: input.name,
      kind: input.kind,
      capacityKg: input.capacityKg,
      active: input.active,
    })
    .returning();
  if (input.createEquipment !== "none") {
    await assertUniqueEquipment(db, input.code);
    await db.insert(schema.equipment).values({
      code: input.code,
      name: input.name,
      area: input.kind === "finished" ? "Congelado" : "Depósito",
      kind: input.createEquipment,
      tempMaxC: input.createEquipment === "freezer" ? -18 : 5,
      locationId: row!.id,
      active: input.active,
    });
  }
  return row!;
}

export async function updateLocation(db: Executor, id: string, input: LocationData) {
  await assertUniqueLocation(db, input.code, id);
  const current = await db.query.locations.findFirst({ where: eq(schema.locations.id, id) });
  if (!current) throw new UserError("La ubicación no existe.");
  if (current.kind !== input.kind)
    throw new UserError("El tipo de ubicación no se puede cambiar.", { kind: ["No se puede cambiar"] });
  if (current.active && !input.active) {
    const stock = (await listLocations(db)).find((l) => l.id === id);
    if (stock?.hasStock)
      throw new UserError(`${current.name} todavía tiene stock: transferilo antes de desactivarla.`);
  }
  const [row] = await db
    .update(schema.locations)
    .set({ code: input.code, name: input.name, capacityKg: input.capacityKg, active: input.active })
    .where(eq(schema.locations.id, id))
    .returning();
  return row!;
}
