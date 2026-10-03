import type { Tx } from "../client";
import * as s from "../schema";
import type { SeedRefs } from "./index";
import { seedDemoQuality } from "./demo-m7";

/**
 * Datos de demostración coherentes con el relevamiento: stock inicial de materia prima,
 * dos producciones (01/09 con las pesadas reales y 01/10), pedidos con historial y cuenta corriente.
 * Los tests E2E dependen de estos datos: si los cambiás, actualizá apps/web/e2e/fixtures.
 */
export async function seedDemo(tx: Tx, r: SeedRefs) {
  const I = r.ingredients;
  const L = r.locations;
  const P = r.products;

  // --- Recepción inicial de materia prima (28/09) -----------------------------------------
  const opening: {
    ing: string;
    qty: number;
    supplier: string | null;
    lot: string;
    expiry: string | null;
    loc: string;
    temp?: number;
  }[] = [
    { ing: "fecula", qty: 225, supplier: "leopelle", lot: "FEC-2609", expiry: "2027-06-30", loc: "seco" },
    {
      ing: "queso_barra",
      qty: 50,
      supplier: "leopelle",
      lot: "TYBO-0925",
      expiry: "2026-11-15",
      loc: "heladera",
      temp: 4,
    },
    {
      ing: "reggianito",
      qty: 32,
      supplier: "leopelle",
      lot: "REG-0918",
      expiry: "2027-01-10",
      loc: "heladera",
      temp: 4,
    },
    {
      ing: "manteca",
      qty: 30,
      supplier: "jorge",
      lot: "MAN-0927",
      expiry: "2026-11-30",
      loc: "heladera",
      temp: 3,
    },
    {
      ing: "huevo",
      qty: 40,
      supplier: "mancinelli",
      lot: "HUE-0927",
      expiry: "2026-10-20",
      loc: "heladera",
      temp: 5,
    },
    {
      ing: "leche",
      qty: 60,
      supplier: "cotar",
      lot: "LEC-0928",
      expiry: "2026-10-12",
      loc: "heladera",
      temp: 4,
    },
    { ing: "sal", qty: 10, supplier: "leopelle", lot: "SAL-0901", expiry: "2028-09-01", loc: "seco" },
    { ing: "bolsa500", qty: 1500, supplier: null, lot: "BOL-0901", expiry: null, loc: "seco" },
    { ing: "bolsa5k", qty: 120, supplier: null, lot: "BG-0901", expiry: null, loc: "seco" },
  ];
  const rawLotIds: Record<string, string> = {};
  const receptionBySupplier: Record<string, string> = {};
  for (const o of opening) {
    let receptionId: string | null = null;
    if (o.supplier) {
      receptionId = receptionBySupplier[o.supplier] ?? null;
      if (!receptionId) {
        const [rec] = await tx
          .insert(s.receptions)
          .values({
            supplierId: r.suppliers[o.supplier]!,
            receivedAt: new Date("2026-09-28T10:00:00-03:00"),
            receivedById: r.users.af,
            notes: "Stock inicial (demo)",
          })
          .returning();
        receptionId = rec!.id;
        receptionBySupplier[o.supplier] = receptionId;
      }
    }
    const [lot] = await tx
      .insert(s.rawLots)
      .values({
        ingredientId: I[o.ing]!,
        supplierId: o.supplier ? r.suppliers[o.supplier] : null,
        receptionId,
        supplierLotCode: o.lot,
        expiryDate: o.expiry,
        receivedQty: o.qty,
        temperatureC: o.temp ?? null,
        locationId: L[o.loc],
      })
      .returning();
    rawLotIds[o.ing] = lot!.id;
    await tx.insert(s.stockMovements).values({
      occurredAt: new Date("2026-09-28T10:00:00-03:00"),
      type: "receipt",
      itemKind: "ingredient",
      ingredientId: I[o.ing]!,
      rawLotId: lot!.id,
      locationId: L[o.loc]!,
      qty: o.qty,
      refTable: "raw_lots",
      refId: lot!.id,
      createdById: r.users.af,
    });
  }

  // --- Producciones -------------------------------------------------------------------------
  async function production(input: {
    date: string;
    consumption: Record<string, number>;
    weighings: [shape: "tapita" | "arito" | "lenguita", kg: number][];
    packs: [productKey: string, units: number, loc: "f3" | "f4"][];
    lotCode: string;
    expiry: string;
    withRawLots: boolean;
  }) {
    const at = new Date(`${input.date}T14:00:00-03:00`);
    const [run] = await tx
      .insert(s.productionRuns)
      .values({
        date: input.date,
        runNumber: 1,
        recipeId: r.recipeId,
        starchKg: 75,
        batches: 2,
        status: "packed",
        responsibleId: r.users.af,
        supervisorId: r.users.nr,
        freezerCodes: ["F1", "F2"],
        frozenAt: at,
      })
      .returning();
    for (const w of ["af", "jt", "sg", "ea", "sr"]) {
      await tx.insert(s.productionRunWorkers).values({ runId: run!.id, userId: r.users[w]! });
    }
    const theoretical: Record<string, number> = {
      fecula: 75,
      queso_barra: 22.5,
      reggianito: 15,
      manteca: 15,
      huevo: 18,
      leche: 30,
      sal: 2.25,
    };
    for (const [ing, actual] of Object.entries(input.consumption)) {
      await tx.insert(s.productionConsumptions).values({
        runId: run!.id,
        ingredientId: I[ing]!,
        rawLotId: input.withRawLots ? rawLotIds[ing] : null,
        qtyTheoretical: theoretical[ing]!,
        qtyActual: actual,
        outOfRange: false,
      });
      if (input.withRawLots) {
        await tx.insert(s.stockMovements).values({
          occurredAt: at,
          type: "production_consumption",
          itemKind: "ingredient",
          ingredientId: I[ing]!,
          rawLotId: rawLotIds[ing],
          locationId: ing === "fecula" || ing === "sal" ? L.seco! : L.heladera!,
          qty: -actual,
          refTable: "production_runs",
          refId: run!.id,
          createdById: r.users.af,
        });
      }
    }
    for (const [shape, kg] of input.weighings) {
      await tx
        .insert(s.productionWeighings)
        .values({ runId: run!.id, shape, kg, weighedById: r.users.sg, weighedAt: at });
    }
    const [lot] = await tx
      .insert(s.finishedLots)
      .values({ code: input.lotCode, runId: run!.id, productionDate: input.date, expiryDate: input.expiry })
      .returning();
    for (const [pk, units, loc] of input.packs) {
      const product = (await tx.query.products.findFirst({ where: (p, { eq }) => eq(p.id, P[pk]!) }))!;
      const [packing] = await tx
        .insert(s.packings)
        .values({
          finishedLotId: lot!.id,
          productId: P[pk]!,
          units,
          kg: units * product.netWeightKg,
          locationId: L[loc]!,
          packedById: r.users.af,
          packedAt: new Date(`${input.date}T09:00:00-03:00`),
        })
        .returning();
      await tx.insert(s.stockMovements).values({
        occurredAt: packing!.packedAt,
        type: "production_output",
        itemKind: "product",
        productId: P[pk]!,
        finishedLotId: lot!.id,
        locationId: L[loc]!,
        qty: units,
        refTable: "packings",
        refId: packing!.id,
        createdById: r.users.af,
      });
    }
    return { runId: run!.id, lotId: lot!.id };
  }

  // Registro de elaboración real del 01/09 (pesadas 70,6 + 10,1 + 68,6 = 149,3 kg).
  const sep = await production({
    date: "2026-09-01",
    consumption: { fecula: 75, queso_barra: 22, reggianito: 15, manteca: 15, huevo: 18, leche: 18, sal: 1.9 },
    weighings: [
      ["tapita", 70.6],
      ["arito", 10.1],
      ["lenguita", 68.6],
    ],
    packs: [
      ["tap500", 60, "f3"],
      ["ari500", 12, "f3"],
      ["len500", 40, "f4"],
      ["tap5k", 2, "f4"],
    ],
    lotCode: "260901-1",
    expiry: "2027-03-01",
    withRawLots: false,
  });
  const oct = await production({
    date: "2026-10-01",
    consumption: { fecula: 75, queso_barra: 22, reggianito: 15, manteca: 15, huevo: 18, leche: 24, sal: 1.9 },
    weighings: [
      ["tapita", 72.4],
      ["arito", 9.8],
      ["lenguita", 67.1],
    ],
    packs: [
      ["tap500", 100, "f3"],
      ["ari500", 19, "f3"],
      ["len500", 94, "f4"],
      ["tap5k", 4, "f4"],
      ["len5k", 4, "f4"],
    ],
    lotCode: "261001-1",
    expiry: "2027-04-01",
    withRawLots: true,
  });

  // --- Pedidos con historial (frecuencia de compra) ----------------------------------------
  async function order(input: {
    customer: string;
    priceList: string;
    received: string;
    promised: string;
    status: (typeof s.orderStatusEnum.enumValues)[number];
    items: [productKey: string, units: number, price: number][];
  }) {
    const total = input.items.reduce((a, [, u, p]) => a + u * p, 0);
    const [o] = await tx
      .insert(s.orders)
      .values({
        customerId: r.customers[input.customer]!,
        priceListId: r.priceLists[input.priceList],
        source: "whatsapp",
        receivedAt: new Date(`${input.received}T09:30:00-03:00`),
        promisedDate: input.promised,
        status: input.status,
        deliveredAt: ["delivered", "invoiced", "paid"].includes(input.status)
          ? new Date(`${input.promised}T11:00:00-03:00`)
          : null,
        total,
        createdById: r.users.af,
      })
      .returning();
    await tx.insert(s.orderItems).values(
      input.items.map(([pk, units, price]) => ({
        orderId: o!.id,
        productId: P[pk]!,
        qtyUnits: units,
        unitPrice: price,
      })),
    );
    await tx.insert(s.orderEvents).values({
      orderId: o!.id,
      status: input.status,
      at: new Date(`${input.received}T09:30:00-03:00`),
      byId: r.users.af,
    });
    return { id: o!.id, total };
  }

  for (const d of ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]) {
    await order({
      customer: "viadolce",
      priceList: "mayorista",
      received: d,
      promised: d,
      status: "paid",
      items: [
        ["tap500", 20, 4200],
        ["len500", 10, 4200],
      ],
    });
  }
  for (const d of ["2026-09-02", "2026-09-16"]) {
    await order({
      customer: "esperanza",
      priceList: "mayorista",
      received: d,
      promised: d,
      status: "paid",
      items: [["sur500", 15, 4200]],
    });
  }
  const reina = await order({
    customer: "lareina",
    priceList: "super",
    received: "2026-09-08",
    promised: "2026-09-10",
    status: "invoiced",
    items: [
      ["tap500", 60, 3900],
      ["len500", 60, 3900],
    ],
  });
  await order({
    customer: "nautico",
    priceList: "mayorista",
    received: "2026-10-01",
    promised: "2026-10-05",
    status: "confirmed",
    items: [
      ["len5k", 2, 40000],
      ["tap5k", 1, 40000],
    ],
  });
  // Pedido grande típico: 850 bolsas = 425 kg (casi 3 días de capacidad plena).
  await order({
    customer: "lareina",
    priceList: "super",
    received: "2026-10-02",
    promised: "2026-10-09",
    status: "received",
    items: [
      ["tap500", 425, 3900],
      ["len500", 425, 3900],
    ],
  });

  // --- Cuenta corriente: factura a La Reina pagada con cheque a 30 días -------------------
  await tx.insert(s.salesInvoices).values({
    customerId: r.customers.lareina!,
    orderId: reina.id,
    invoiceType: "A",
    pointOfSale: "0002",
    number: "00001234",
    issueDate: "2026-09-10",
    dueDate: "2026-10-10",
    netTotal: Math.round((reina.total / 1.21) * 100) / 100,
    vatTotal: Math.round((reina.total - reina.total / 1.21) * 100) / 100,
    total: reina.total,
  });
  const [pay] = await tx
    .insert(s.customerPayments)
    .values({
      customerId: r.customers.lareina!,
      date: "2026-09-10",
      amount: 200000,
      method: "check",
      receivedById: r.users.padre,
    })
    .returning();
  await tx.insert(s.checks).values({
    paymentId: pay!.id,
    bank: "Banco Macro",
    number: "45879632",
    issuer: "Supermercado La Reina",
    amount: 200000,
    issueDate: "2026-09-10",
    cashDate: "2026-10-10",
  });

  // --- BPM: temperaturas y limpieza de ayer ------------------------------------------------
  for (const [eq, v] of [
    ["f3", -21],
    ["f4", -20],
    ["heladera", 4],
    ["f1", -24],
    ["f2", -23],
  ] as const) {
    await tx.insert(s.temperatureLogs).values({
      equipmentId: r.equipment[eq]!,
      date: "2026-10-01",
      measuredAt: new Date("2026-10-01T08:00:00-03:00"),
      valueC: v,
      userId: r.users.jt,
    });
  }

  await seedDemoQuality(tx, r, { sepLotId: sep.lotId });

  return { sep, oct };
}
