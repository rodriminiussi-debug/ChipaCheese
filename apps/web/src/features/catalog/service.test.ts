import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { getProductCosts } from "@/features/costing/service";
import { getPriceMatrix } from "@/features/pricing/service";
import { temperatureEquipment } from "@/features/quality/service";
import { maintenanceFormOptions } from "@/features/maintenance/service";
import { dispatchFormOptions } from "@/features/dispatch/service";
import { previewProductCost } from "./preview";
import {
  copyPricesInput,
  equipmentInput,
  ingredientInput,
  locationInput,
  priceListInput,
  productInput,
  updateProductInput,
  vehicleInput,
  zoneInput,
} from "./schemas";
import {
  copyPrices,
  createEquipment,
  createIngredient,
  createLocation,
  createPriceList,
  createProduct,
  createVehicle,
  createZone,
  deleteProduct,
  deleteZone,
  listIngredients,
  listLocations,
  listProducts,
  listZones,
  productFormOptions,
  setIngredientActive,
  setProductActive,
  updateIngredient,
  updatePriceList,
  updateProduct,
  updateVehicle,
  updateZone,
} from "./service";

const TODAY = "2026-10-02";

const byCode = async (tx: Tx, code: string) =>
  (await tx.query.products.findFirst({ where: eq(schema.products.code, code) }))!;
const listByName = async (tx: Tx, name: string) =>
  (await tx.query.priceLists.findFirst({ where: eq(schema.priceLists.name, name) }))!;
const ingredient = async (tx: Tx, name: string) =>
  (await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.name, name) }))!;

const resale = (over: Record<string, unknown> = {}) =>
  productInput.parse({
    kind: "resale",
    code: "RV-COLA-1L",
    name: "Gaseosa cola 1 L",
    unitLabel: "botella",
    barcode: "7791234567890",
    ...over,
  });

describe("alta de productos de reventa", () => {
  it("crea el producto con costo inicial y precio inicial en la lista del local, y calcula el margen", async () => {
    await inRollback("nahuel", async (tx) => {
      const local = await listByName(tx, "Local (minorista)");
      const p = await createProduct(
        tx,
        resale({
          initialCost: "1.250,50",
          minStockUnits: 12,
          initialPrices: [{ priceListId: local.id, unitPrice: "2200" }],
        }),
        TODAY,
      );
      expect(p).toMatchObject({ kind: "resale", shape: "other", presentation: "unit", netWeightKg: 0 });
      expect(p.availableForOrders).toBe(false);
      expect(p.availableInStore).toBe(true);

      const cost = await tx.query.productCosts.findFirst({ where: eq(schema.productCosts.productId, p.id) });
      expect(cost).toMatchObject({ unitCostNet: 1250.5, date: TODAY });

      const costs = await getProductCosts(tx, TODAY);
      expect(costs.byProductId[p.id]!.unitCost).toBe(1250.5);
      const { lists } = await getPriceMatrix(tx, TODAY);
      const row = lists.find((l) => l.id === local.id)!.rows.find((r) => r.productId === p.id)!;
      expect(row.price).toBe(2200);
      expect(row.cost).toBe(1250.5);
      expect(row.marginPct).toBeCloseTo(((2200 - 1250.5) / 2200) * 100, 1);
    });
  });

  it("sin costo inicial no se inventa uno: el costo queda faltante", async () => {
    await inRollback("nahuel", async (tx) => {
      const p = await createProduct(tx, resale(), TODAY);
      expect(
        await tx.query.productCosts.findFirst({ where: eq(schema.productCosts.productId, p.id) }),
      ).toBeUndefined();
      const row = (await getProductCosts(tx, TODAY)).byProductId[p.id]!;
      expect(row.unitCost).toBeNull();
      expect(row.missingPrices).toEqual(["Gaseosa cola 1 L (costo de compra)"]);
    });
  });

  it("ignora componentes, forma y 'disponible en pedidos' que no le corresponden a la reventa", async () => {
    await inRollback("nahuel", async (tx) => {
      const caja = await ingredient(tx, "Sal");
      const p = await createProduct(
        tx,
        resale({
          shape: "tapita",
          availableForOrders: true,
          boardCode: "XX",
          components: [{ ingredientId: caja.id, qtyPerUnit: 1 }],
        }),
        TODAY,
      );
      expect(p).toMatchObject({ shape: "other", availableForOrders: false, boardCode: null });
      expect(
        await tx.query.productComponents.findMany({ where: eq(schema.productComponents.productId, p.id) }),
      ).toEqual([]);
    });
  });
});

describe("alta de productos fabricados", () => {
  it("guarda la forma, los kg de masa, los componentes y el código de pizarrón", async () => {
    await inRollback("nahuel", async (tx) => {
      const bolsa = await ingredient(tx, "Bolsa 0,5 kg con etiqueta");
      const p = await createProduct(
        tx,
        productInput.parse({
          kind: "manufactured",
          code: "CH-MIX-250",
          name: "Chipá surtido 0,25 kg",
          shape: "mixed",
          presentation: "pack",
          netWeightKg: "0,25",
          unitLabel: "pack",
          boardCode: "S250",
          minStockUnits: 20,
          availableForOrders: true,
          components: [{ ingredientId: bolsa.id, qtyPerUnit: 1 }],
        }),
        TODAY,
      );
      expect(p).toMatchObject({
        kind: "manufactured",
        shape: "mixed",
        netWeightKg: 0.25,
        boardCode: "S250",
        availableForOrders: true,
      });
      const costs = await getProductCosts(tx, TODAY);
      const row = costs.byProductId[p.id]!;
      expect(row.source).toBe("recipe");
      expect(row.components.map((c) => c.name)).toEqual(["Bolsa 0,5 kg con etiqueta"]);
      expect(row.unitCost).toBeCloseTo(costs.costPerKg! * 0.25 + row.componentsCost, 2);
    });
  });

  it("exige forma y kg de masa", () => {
    const r = productInput.safeParse({ kind: "manufactured", code: "X-1", name: "Algo", shape: "other" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("Elegí la forma");
    expect(JSON.stringify(r.error?.issues)).toContain("kg de masa");
  });
});

describe("alta de productos elaborados en el local", () => {
  it("consume unidades del producto base: costo = base × cantidad + componentes; equivalente en masa por defecto", async () => {
    await inRollback("nahuel", async (tx) => {
      const tap = await byCode(tx, "CH-TAP-500");
      const p = await createProduct(
        tx,
        productInput.parse({
          kind: "prepared",
          code: "EL-HOR-500",
          name: "Chipá horneado 500 g",
          unitLabel: "porción",
          baseProductId: tap.id,
          baseQty: "1",
          availableForOrders: true,
        }),
        TODAY,
      );
      expect(p).toMatchObject({
        kind: "prepared",
        baseProductId: tap.id,
        baseQty: 1,
        netWeightKg: 0.5,
        availableForOrders: false,
      });
      const costs = await getProductCosts(tx, TODAY);
      expect(costs.byProductId[p.id]!.unitCost).toBeCloseTo(costs.byProductId[tap.id]!.unitCost!, 2);
    });
  });

  it("sin base es un error; el base debe ser un fabricado activo y no puede ser el mismo ni otro elaborado", async () => {
    await inRollback("nahuel", async (tx) => {
      expect(
        productInput.safeParse({ kind: "prepared", code: "EL-X", name: "Elaborado", baseQty: 1 }).success,
      ).toBe(false);

      const tap = await byCode(tx, "CH-TAP-500");
      const hor = await byCode(tx, "EL-HOR-250");
      const gas = await byCode(tx, "RV-GAS-500");
      const base = { kind: "prepared", code: "EL-NEW", name: "Nuevo elaborado", baseQty: 1 };

      await expect(
        createProduct(tx, productInput.parse({ ...base, baseProductId: hor.id }), TODAY),
      ).rejects.toThrow(/tiene que ser un producto fabricado/);
      await expect(
        createProduct(tx, productInput.parse({ ...base, baseProductId: gas.id }), TODAY),
      ).rejects.toThrow(/tiene que ser un producto fabricado/);
      await tx.update(schema.products).set({ active: false }).where(eq(schema.products.id, tap.id));
      await expect(
        createProduct(tx, productInput.parse({ ...base, baseProductId: tap.id }), TODAY),
      ).rejects.toThrow(/inactivo/);
    });
  });

  it("al editar, el producto no puede ser su propio base", async () => {
    await inRollback("nahuel", async (tx) => {
      const hor = await byCode(tx, "EL-HOR-250");
      await expect(
        updateProduct(
          tx,
          updateProductInput.parse({
            id: hor.id,
            kind: "prepared",
            code: hor.code,
            name: hor.name,
            baseProductId: hor.id,
            baseQty: 1,
          }),
        ),
      ).rejects.toThrow(/propio producto base/);
    });
  });

  it("los productos base se ofrecen solo si son fabricados activos", async () => {
    await inRollback("nahuel", async (tx) => {
      const opts = await productFormOptions(tx, TODAY);
      const codes = opts.baseProducts.map((b) => b.code);
      expect(codes).toContain("CH-TAP-500");
      expect(codes).not.toContain("RV-GAS-500");
      expect(codes).not.toContain("EL-HOR-250");
      expect(opts.reference.costPerKg).toBeGreaterThan(0);
      expect(opts.reference.baseCosts[(await byCode(tx, "CH-TAP-500")).id]).toBeGreaterThan(0);
    });
  });
});

describe("validaciones del catálogo de productos", () => {
  it("rechaza código repetido (sin distinguir mayúsculas) y código de barras repetido", async () => {
    await inRollback("nahuel", async (tx) => {
      await expect(createProduct(tx, resale({ code: "rv-gas-500" }), TODAY)).rejects.toThrow(
        /Ya existe un producto con el código/,
      );
      await expect(createProduct(tx, resale({ barcode: "7790895000997" }), TODAY)).rejects.toThrow(
        /código de barras/,
      );
    });
  });

  it("permite editar sin chocar consigo mismo y no deja cambiar el tipo", async () => {
    await inRollback("nahuel", async (tx) => {
      const gas = await byCode(tx, "RV-GAS-500");
      const base = {
        id: gas.id,
        kind: "resale",
        code: gas.code,
        name: "Gaseosa 500 ml cola",
        barcode: gas.barcode,
        unitLabel: "botella",
      };
      const up = await updateProduct(tx, updateProductInput.parse(base));
      expect(up.name).toBe("Gaseosa 500 ml cola");
      await expect(
        updateProduct(
          tx,
          updateProductInput.parse({ ...base, kind: "manufactured", shape: "tapita", netWeightKg: 1 }),
        ),
      ).rejects.toThrow(/no se puede cambiar/);
    });
  });

  it("no se desactiva un fabricado que es base de un elaborado activo", async () => {
    await inRollback("nahuel", async (tx) => {
      const tap = await byCode(tx, "CH-TAP-500");
      await expect(setProductActive(tx, tap.id, false)).rejects.toThrow(
        /es el producto base de Chipá horneado/,
      );
      await setProductActive(tx, (await byCode(tx, "EL-HOR-250")).id, false);
      expect((await setProductActive(tx, tap.id, false)).active).toBe(false);
    });
  });

  it("lista con filtro por tipo, búsqueda y activos/inactivos", async () => {
    await inRollback("nahuel", async (tx) => {
      const resaleRows = await listProducts(tx, { kind: "resale" });
      expect(resaleRows.map((r) => r.code).sort()).toEqual(["RV-AGU-500", "RV-GAS-500"]);
      expect((await listProducts(tx, { q: "horneado" })).map((r) => r.code)).toEqual(["EL-HOR-250"]);
      expect((await listProducts(tx, { q: "7790895000997" })).map((r) => r.code)).toEqual(["RV-GAS-500"]);
      const gas = await byCode(tx, "RV-GAS-500");
      await setProductActive(tx, gas.id, false);
      expect((await listProducts(tx, { kind: "resale" })).map((r) => r.code)).toEqual(["RV-AGU-500"]);
      expect((await listProducts(tx, { kind: "resale", status: "inactive" })).map((r) => r.code)).toEqual([
        "RV-GAS-500",
      ]);
      expect((await listProducts(tx, { kind: "resale", status: "all" })).length).toBe(2);
    });
  });

  it("borra un producto recién creado con sus precios y costo, pero no uno con movimientos (se desactiva)", async () => {
    await inRollback("nahuel", async (tx) => {
      const local = await listByName(tx, "Local (minorista)");
      const p = await createProduct(
        tx,
        resale({ initialCost: 1000, initialPrices: [{ priceListId: local.id, unitPrice: 1500 }] }),
        TODAY,
      );
      await deleteProduct(tx, p.id);
      expect(await tx.query.products.findFirst({ where: eq(schema.products.id, p.id) })).toBeUndefined();

      const gas = await byCode(tx, "RV-GAS-500"); // tiene stock inicial en el local
      await expect(deleteProduct(tx, gas.id)).rejects.toThrow(/ya tiene movimientos/);
      expect(await tx.query.products.findFirst({ where: eq(schema.products.id, gas.id) })).toBeDefined();
      // Y el rechazo no dejó a medias el borrado de sus precios y costos.
      expect(
        await tx.query.productCosts.findFirst({ where: eq(schema.productCosts.productId, gas.id) }),
      ).toBeDefined();
    });
  });
});

describe("vista previa de costo del formulario", () => {
  const ref = {
    costPerKg: 6000,
    ingredientPrices: { a: 100 },
    baseCosts: { base: 3000, sinCosto: null },
    ingredientNames: { a: "Envase", b: "Etiqueta" },
  };
  it("fabricado: costo por kg × masa + componentes; faltante si algún insumo no tiene precio", () => {
    const input = {
      kind: "manufactured",
      netWeightKg: 0.5,
      baseProductId: null,
      baseQty: null,
      initialCost: null,
    } as const;
    expect(
      previewProductCost({ ...input, components: [{ ingredientId: "a", qtyPerUnit: 2 }] }, ref).cost,
    ).toBe(3200);
    const r = previewProductCost({ ...input, components: [{ ingredientId: "b", qtyPerUnit: 1 }] }, ref);
    expect(r).toEqual({ cost: null, missing: ["Etiqueta"] });
  });
  it("reventa: el costo inicial; sin él, faltante", () => {
    const input = {
      kind: "resale",
      netWeightKg: null,
      baseProductId: null,
      baseQty: null,
      components: [],
    } as const;
    expect(previewProductCost({ ...input, initialCost: 1100 }, ref).cost).toBe(1100);
    expect(previewProductCost({ ...input, initialCost: null }, ref).missing).toEqual(["costo de compra"]);
  });
  it("elaborado: costo del base × cantidad; sin costo del base, faltante", () => {
    const input = { kind: "prepared", netWeightKg: null, initialCost: null, components: [] } as const;
    expect(previewProductCost({ ...input, baseProductId: "base", baseQty: 0.5 }, ref).cost).toBe(1500);
    expect(previewProductCost({ ...input, baseProductId: "sinCosto", baseQty: 0.5 }, ref).missing).toEqual([
      "costo del producto base",
    ]);
  });
});

describe("insumos", () => {
  it("crea con precio inicial (historial de precios) y proveedor habitual, y se lista con su último precio", async () => {
    await inRollback("nahuel", async (tx) => {
      const prov = (await tx.query.suppliers.findFirst())!;
      const ing = await createIngredient(
        tx,
        ingredientInput.parse({
          name: "Orégano",
          category: "seasoning",
          unit: "kg",
          minStock: "2",
          safetyStock: "1",
          defaultSupplierId: prov.id,
          initialPrice: "8.500",
        }),
        TODAY,
      );
      const rows = await listIngredients(tx, { q: "oréga" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: ing.id,
        lastPrice: 8500,
        lastPriceDate: TODAY,
        minStock: 2,
        safetyStock: 1,
      });
      const sold = await tx.query.supplierIngredients.findMany({
        where: eq(schema.supplierIngredients.ingredientId, ing.id),
      });
      expect(sold.map((s) => s.supplierId)).toEqual([prov.id]);
    });
  });

  it("rechaza el nombre repetido, no cambia la unidad con historial y no desactiva lo que está en la receta activa", async () => {
    await inRollback("nahuel", async (tx) => {
      const base = { category: "dairy", unit: "kg" };
      await expect(
        createIngredient(tx, ingredientInput.parse({ ...base, name: "sal" }), TODAY),
      ).rejects.toThrow(/Ya existe un insumo/);
      const sal = await ingredient(tx, "Sal");
      await expect(
        updateIngredient(
          tx,
          sal.id,
          ingredientInput.parse({ name: "Sal", category: sal.category, unit: "l" }),
        ),
      ).rejects.toThrow(/No se puede cambiar la unidad/);
      await expect(setIngredientActive(tx, sal.id, false)).rejects.toThrow(/receta maestra activa/);

      const nuevo = await createIngredient(tx, ingredientInput.parse({ ...base, name: "Aditivo" }), TODAY);
      expect((await setIngredientActive(tx, nuevo.id, false)).active).toBe(false);
      expect((await listIngredients(tx, { q: "aditivo" })).length).toBe(0);
      expect((await listIngredients(tx, { q: "aditivo", status: "inactive" })).length).toBe(1);
    });
  });
});

describe("zonas, listas de precios, vehículos, equipos y ubicaciones", () => {
  it("zonas: alta con días, nombre único y no se borra una zona con clientes", async () => {
    await inRollback("nahuel", async (tx) => {
      const z = await createZone(
        tx,
        zoneInput.parse({ name: "Granadero Baigorria", deliveryWeekdays: [2, 4] }),
      );
      expect(z.deliveryWeekdays).toEqual([2, 4]);
      await expect(createZone(tx, zoneInput.parse({ name: "granadero baigorria" }))).rejects.toThrow(
        /Ya existe la zona/,
      );
      await updateZone(tx, z.id, zoneInput.parse({ name: "Baigorria", deliveryWeekdays: [3] }));
      expect((await listZones(tx)).find((r) => r.id === z.id)).toMatchObject({
        name: "Baigorria",
        customers: 0,
      });
      await deleteZone(tx, z.id);

      const rosario = (await tx.query.zones.findFirst({ where: eq(schema.zones.name, "Rosario") }))!;
      await expect(deleteZone(tx, rosario.id)).rejects.toThrow(/tiene \d+ cliente/);
    });
  });

  it("lista de precios nueva para un canal, copiando los precios de otra con +15 %", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const tap = await byCode(tx, "CH-TAP-500");
      const list = await createPriceList(
        tx,
        priceListInput.parse({
          name: "Distribuidores",
          channel: "distributor",
          targetMarginPct: "18",
          copyFromListId: mayorista.id,
          adjustPct: "15",
        }),
        TODAY,
      );
      expect(list.copied).toBeGreaterThan(5);
      const { lists } = await getPriceMatrix(tx, TODAY);
      const row = lists.find((l) => l.id === list.id)!.rows.find((r) => r.productId === tap.id)!;
      expect(row.price).toBe(Math.round(4200 * 1.15));
      expect(lists.find((l) => l.id === list.id)!.targetMarginPct).toBe(18);
      // No se copian precios de productos que la lista de origen no tiene.
      const gas = lists.find((l) => l.id === list.id)!.rows.find((r) => r.code === "RV-GAS-500")!;
      expect(gas.price).toBeNull();
    });
  });

  it("copiar precios sobre una lista existente, y errores de lista repetida / mismas listas / en uso", async () => {
    await inRollback("nahuel", async (tx) => {
      const mayorista = await listByName(tx, "Revendedores (mayorista)");
      const local = await listByName(tx, "Local (minorista)");
      await expect(
        createPriceList(tx, priceListInput.parse({ name: "local (minorista)", channel: "store" }), TODAY),
      ).rejects.toThrow(/Ya existe la lista/);
      await expect(
        copyPrices(tx, copyPricesInput.parse({ fromListId: local.id, toListId: local.id }), TODAY),
      ).rejects.toThrow(/dos listas distintas/);
      const nueva = await createPriceList(
        tx,
        priceListInput.parse({ name: "Eventos", channel: "other" }),
        TODAY,
      );
      const res = await copyPrices(
        tx,
        copyPricesInput.parse({ fromListId: mayorista.id, toListId: nueva.id, adjustPct: "-10" }),
        TODAY,
      );
      expect(res.copied).toBeGreaterThan(0);
      await expect(
        copyPrices(tx, copyPricesInput.parse({ fromListId: nueva.id, toListId: mayorista.id }), "2026-10-03"),
      ).resolves.toMatchObject({ copied: res.copied });

      // La lista del local la usan clientes: no se desactiva.
      const used = await tx.query.customers.findFirst({
        where: eq(schema.customers.priceListId, mayorista.id),
      });
      if (used)
        await expect(
          updatePriceList(
            tx,
            mayorista.id,
            priceListInput.parse({
              name: mayorista.name,
              channel: mayorista.channel,
              targetMarginPct: 25,
              active: false,
            }),
          ),
        ).rejects.toThrow(/la usan/);
    });
  });

  it("vehículo con equipo de frío: aparece para las rutas, en temperaturas y en el mantenimiento; patente única", async () => {
    await inRollback("nahuel", async (tx) => {
      const v = await createVehicle(
        tx,
        vehicleInput.parse({ plate: "ab 123 cd", name: "Furgón nuevo", costPerKm: "310,5" }),
      );
      expect(v).toMatchObject({ plate: "AB123CD", costPerKm: 310.5, hasColdUnit: true });
      expect(v.equipmentId).not.toBeNull();
      const eq1 = (await tx.query.equipment.findFirst({ where: eq(schema.equipment.id, v.equipmentId!) }))!;
      expect(eq1).toMatchObject({ code: "VEH-AB123CD", kind: "vehicle", tempMaxC: -18 });

      expect((await dispatchFormOptions(tx)).vehicles.map((x) => x.plate)).toContain("AB123CD");
      expect((await temperatureEquipment(tx)).map((e) => e.code)).toContain("VEH-AB123CD");
      expect((await maintenanceFormOptions(tx)).equipment.map((e) => e.code)).toContain("VEH-AB123CD");

      await expect(
        createVehicle(tx, vehicleInput.parse({ plate: "AB-123-CD", name: "Otro" })),
      ).rejects.toThrow(/Ya existe un vehículo/);
      const up = await updateVehicle(
        tx,
        v.id,
        vehicleInput.parse({ plate: "AB123CD", name: "Furgón nuevo", costPerKm: 400, active: false }),
      );
      expect(up).toMatchObject({ costPerKm: 400, active: false });
    });
  });

  it("equipo freezer nuevo: aparece en temperaturas (con su rango) y se puede elegir en mantenimiento; código único", async () => {
    await inRollback("nahuel", async (tx) => {
      const e = await createEquipment(
        tx,
        equipmentInput.parse({
          code: "F5",
          name: "Freezer F5",
          area: "Congelado",
          kind: "freezer",
          tempMinC: "-25",
          tempMaxC: "-18",
        }),
      );
      expect(e).toMatchObject({ tempMinC: -25, tempMaxC: -18 });
      const temp = (await temperatureEquipment(tx)).find((x) => x.code === "F5");
      expect(temp).toMatchObject({ min: -25, max: -18 });
      expect((await maintenanceFormOptions(tx)).equipment.map((x) => x.code)).toContain("F5");
      await expect(
        createEquipment(tx, equipmentInput.parse({ code: "f5", name: "Otro", area: "X1", kind: "other" })),
      ).rejects.toThrow(/Ya existe el equipo/);
      expect(
        equipmentInput.safeParse({
          code: "F6",
          name: "Freezer F6",
          area: "Congelado",
          kind: "freezer",
          tempMinC: -10,
          tempMaxC: -20,
        }).success,
      ).toBe(false);
    });
  });

  it("ubicación de producto terminado nueva: sale en el stock; con equipo, también en temperaturas", async () => {
    await inRollback("nahuel", async (tx) => {
      const l = await createLocation(
        tx,
        locationInput.parse({
          code: "F5",
          name: "Freezer horizontal F5",
          kind: "finished",
          createEquipment: "freezer",
        }),
      );
      const { productLocations } = await import("@/features/stock/service");
      expect((await productLocations(tx)).map((x) => x.code)).toContain("F5");
      const eq1 = (await temperatureEquipment(tx)).find((x) => x.code === "F5");
      expect(eq1).toMatchObject({ kind: "freezer", max: -18 });
      expect((await listLocations(tx)).find((x) => x.id === l.id)).toMatchObject({
        hasStock: false,
        active: true,
      });
      await expect(
        createLocation(tx, locationInput.parse({ code: "f5", name: "Repetida", kind: "raw" })),
      ).rejects.toThrow(/Ya existe la ubicación/);
    });
  });

  it("no se desactiva una ubicación con stock", async () => {
    await inRollback("nahuel", async (tx) => {
      const { updateLocation } = await import("./masters");
      const f3 = (await tx.query.locations.findFirst({ where: eq(schema.locations.code, "LOCAL") }))!;
      await expect(
        updateLocation(
          tx,
          f3.id,
          locationInput.parse({ code: f3.code, name: f3.name, kind: f3.kind, active: false }),
        ),
      ).rejects.toThrow(/todavía tiene stock/);
    });
  });
});
