import { isMain } from "../is-main";
import { hash } from "@node-rs/argon2";
import { createDb, type Tx } from "../client";
import { DATABASE_URL } from "../env";
import * as s from "../schema";
import * as D from "./data";
import { seedDemo } from "./demo";

export type Ids = Record<string, string>;
export interface SeedRefs {
  users: Ids;
  zones: Ids;
  suppliers: Ids;
  ingredients: Ids;
  products: Ids;
  priceLists: Ids;
  locations: Ids;
  equipment: Ids;
  customers: Ids;
  recipeId: string;
}

/** Maestros del relevamiento (usuarios, catálogo, receta, listas, equipos…). Lo reutiliza el seed de presentación. */
export async function seedMasters(tx: Tx): Promise<SeedRefs> {
  const refs: SeedRefs = {
    users: {},
    zones: {},
    suppliers: {},
    ingredients: {},
    products: {},
    priceLists: {},
    locations: {},
    equipment: {},
    customers: {},
    recipeId: "",
  };

  const passwordHash = await hash(D.DEV_PASSWORD);
  for (const u of D.USERS) {
    const [row] = await tx
      .insert(s.users)
      .values({
        name: u.name,
        initials: u.initials,
        username: u.username,
        email: u.email,
        role: u.role,
        passwordHash,
        pinHash: u.pin ? await hash(u.pin) : null,
      })
      .returning({ id: s.users.id });
    refs.users[u.key] = row!.id;
  }

  await tx
    .insert(s.appSettings)
    .values(
      Object.entries(D.SETTINGS).map(([key, v]) => ({ key, value: v.value, description: v.description })),
    )
    // Algunos parámetros nuevos también los inserta una migración (upsert): no duplicar.
    .onConflictDoNothing();

  for (const z of D.ZONES) {
    const [row] = await tx
      .insert(s.zones)
      .values({ name: z.name, deliveryWeekdays: z.deliveryWeekdays })
      .returning();
    refs.zones[z.key] = row!.id;
  }

  for (const sup of D.SUPPLIERS) {
    const [row] = await tx
      .insert(s.suppliers)
      .values({ legalName: sup.legalName, leadTimeDays: sup.leadTimeDays, notes: sup.notes })
      .returning();
    refs.suppliers[sup.key] = row!.id;
  }

  for (const ing of D.INGREDIENTS) {
    const supplierId = ing.supplier ? refs.suppliers[ing.supplier] : null;
    const [row] = await tx
      .insert(s.ingredients)
      .values({
        name: ing.name,
        category: ing.category,
        unit: ing.unit,
        refrigerated: ing.refrigerated,
        minStock: ing.minStock,
        safetyStock: Math.round(ing.minStock / 2),
        defaultSupplierId: supplierId,
      })
      .returning();
    refs.ingredients[ing.key] = row!.id;
    if (supplierId) await tx.insert(s.supplierIngredients).values({ supplierId, ingredientId: row!.id });
    if (ing.price != null) {
      await tx
        .insert(s.ingredientPrices)
        .values({ ingredientId: row!.id, supplierId, date: "2026-09-29", unitPriceNet: ing.price });
    }
  }

  const [recipe] = await tx
    .insert(s.recipes)
    .values({
      name: D.RECIPE_V1.name,
      version: D.RECIPE_V1.version,
      status: "active",
      expectedYieldPerKgStarch: D.RECIPE_V1.expectedYieldPerKgStarch,
      deviationThresholdPct: D.RECIPE_V1.deviationThresholdPct,
      effectiveFrom: "2026-09-29",
      notes: D.RECIPE_V1.notes,
    })
    .returning();
  refs.recipeId = recipe!.id;
  await tx.insert(s.recipeItems).values(
    D.RECIPE_V1.items.map((it, i) => ({
      recipeId: recipe!.id,
      ingredientId: refs.ingredients[it.ingredient]!,
      qtyPerKgStarch: it.qty,
      minPerKgStarch: it.min,
      maxPerKgStarch: it.max,
      instructions: it.instructions,
      sortOrder: i,
    })),
  );

  for (const p of D.PRODUCTS) {
    const [row] = await tx
      .insert(s.products)
      .values({
        code: p.code,
        name: p.name,
        shape: p.shape,
        presentation: p.presentation,
        netWeightKg: p.netWeightKg,
        boardCode: p.boardCode,
        minStockUnits: p.minStock,
      })
      .returning();
    refs.products[p.key] = row!.id;
    for (const [ingKey, q] of p.packaging) {
      await tx
        .insert(s.productComponents)
        .values({ productId: row!.id, ingredientId: refs.ingredients[ingKey]!, qtyPerUnit: q });
    }
  }

  for (const pl of D.PRICE_LISTS) {
    const [row] = await tx
      .insert(s.priceLists)
      .values({ name: pl.name, channel: pl.channel, targetMarginPct: pl.targetMarginPct })
      .returning();
    refs.priceLists[pl.key] = row!.id;
    await tx.insert(s.priceListItems).values(
      Object.entries(pl.prices).map(([prodKey, price]) => ({
        priceListId: row!.id,
        productId: refs.products[prodKey]!,
        unitPrice: price,
        validFrom: "2026-09-01",
      })),
    );
  }

  for (const l of D.LOCATIONS) {
    const [row] = await tx
      .insert(s.locations)
      .values({ code: l.code, name: l.name, kind: l.kind, capacityKg: l.capacityKg })
      .returning();
    refs.locations[l.key] = row!.id;
  }

  for (const e of D.EQUIPMENT) {
    const [row] = await tx
      .insert(s.equipment)
      .values({
        code: e.code,
        name: e.name,
        area: e.area,
        kind: e.kind,
        tempMinC: e.min,
        tempMaxC: e.max,
        locationId: "location" in e ? refs.locations[e.location] : null,
      })
      .returning();
    refs.equipment[e.key] = row!.id;
  }

  await tx.insert(s.vehicles).values({
    plate: "AA000AA",
    name: "Utilitario con equipo de frío",
    hasColdUnit: true,
    costPerKm: 250, // SUPUESTO hasta tener costos del vehículo
    equipmentId: refs.equipment.vehiculo,
    locationId: refs.locations.vehiculo,
  });

  for (const [i, t] of D.PLANT_TASKS.entries()) {
    const [row] = await tx
      .insert(s.plantTasks)
      .values({ stage: t.stage, name: t.name, critical: t.critical, sortOrder: i })
      .returning();
    for (const person of t.people) {
      await tx.insert(s.userSkills).values({
        userId: refs.users[person]!,
        taskId: row!.id,
        level: person === "af" && t.critical ? "expert" : "able",
      });
    }
  }

  for (const [i, p] of D.SANITATION_POINTS.entries()) {
    await tx.insert(s.sanitationPoints).values({
      sector: p.sector,
      element: p.element,
      frequency: p.frequency,
      equipmentId: "equipment" in p ? refs.equipment[p.equipment] : null,
      sortOrder: i,
    });
  }

  for (const m of D.MAINTENANCE_PLANS) {
    await tx.insert(s.maintenancePlans).values({
      equipmentId: refs.equipment[m.equipment]!,
      task: m.task,
      frequencyDays: m.frequencyDays,
      startDate: "2026-10-01",
    });
  }

  for (const month of ["2026-08-01", "2026-09-01"]) {
    await tx.insert(s.fixedExpenses).values(D.FIXED_EXPENSES.map((f) => ({ ...f, month })));
  }

  for (const c of D.CUSTOMERS) {
    const [row] = await tx
      .insert(s.customers)
      .values({
        legalName: c.legalName,
        channel: c.channel,
        priceListId: refs.priceLists[c.priceList],
        zoneId: c.zone ? refs.zones[c.zone] : null,
        paymentTermsDays: c.paymentTermsDays,
        paymentNotes: "paymentNotes" in c ? c.paymentNotes : null,
        whatsapp: c.whatsapp,
      })
      .returning();
    refs.customers[c.key] = row!.id;
  }

  return refs;
}

export async function seed(url = DATABASE_URL, opts: { demo?: boolean } = {}) {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      const refs = await seedMasters(tx);
      if (opts.demo !== false) await seedDemo(tx, refs);
    });
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  seed(DATABASE_URL, { demo: !process.argv.includes("--no-demo") })
    .then(() => console.log("✔ seed cargado"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
