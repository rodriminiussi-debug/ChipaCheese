import { z } from "zod";
import { decimal, int, optDecimal, optText, optUuid } from "@/lib/zod";

/** Esquemas compartidos cliente/servidor del catálogo. Idempotentes: aceptan su propia salida. */

const uuid = z.string().uuid();

export const PRODUCT_KINDS = ["manufactured", "resale", "prepared"] as const;
export const PRODUCT_SHAPES = [
  "tapita",
  "arito",
  "lenguita",
  "mixed",
  "sandwich",
  "pizzeta",
  "other",
] as const;
export const PRESENTATIONS = ["bag_500g", "bulk_5kg", "pack", "unit"] as const;
export const CHANNELS = ["supermarket", "reseller", "store", "distributor", "other"] as const;
export const INGREDIENT_CATEGORIES = [
  "dairy",
  "starch",
  "egg",
  "fat",
  "seasoning",
  "filling",
  "packaging",
  "other",
] as const;
export const INGREDIENT_UNITS = ["kg", "l", "unit"] as const;
export const EQUIPMENT_KINDS = ["freezer", "fridge", "machine", "vehicle", "other"] as const;
export const LOCATION_KINDS = ["raw", "finished", "store", "vehicle"] as const;

// --- Productos ---------------------------------------------------------------------------------

export const productComponentInput = z.object({
  ingredientId: z.string().uuid("Elegí el insumo"),
  qtyPerUnit: decimal({ min: 0.001, message: "Ingresá la cantidad" }),
});

export const initialPriceInput = z.object({
  priceListId: uuid,
  unitPrice: optDecimal({ min: 0 }),
});

const productBase = z.object({
  kind: z.enum(PRODUCT_KINDS),
  code: z.string().trim().min(2, "Ingresá el código").max(40, "Máximo 40 caracteres"),
  name: z.string().trim().min(2, "Ingresá el nombre").max(120),
  shape: z.enum(PRODUCT_SHAPES).default("other"),
  presentation: z.enum(PRESENTATIONS).default("unit"),
  /** Fabricado: kg de masa por unidad. Elaborado: equivalente en masa (vacío = base × cantidad). Reventa: 0. */
  netWeightKg: optDecimal({ min: 0, max: 1000 }),
  unitLabel: z.string().trim().min(1, "Ingresá cómo se cuenta (bolsa, botella…)").max(30).default("unidad"),
  barcode: optText(),
  defaultSupplierId: optUuid(),
  description: optText(),
  boardCode: optText(),
  minStockUnits: int({ min: 0, max: 100000 }).default(0),
  baseProductId: optUuid(),
  baseQty: optDecimal({ min: 0, max: 1000 }),
  components: z.array(productComponentInput).default([]),
  availableInStore: z.boolean().default(true),
  availableForOrders: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Solo al crear: costo de compra inicial sin IVA (reventa). */
  initialCost: optDecimal({ min: 0 }),
  /** Solo al crear: precio inicial en cada lista de precios (vacío = sin precio). */
  initialPrices: z.array(initialPriceInput).default([]),
});

function refineProduct(v: z.output<typeof productBase>, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.kind === "manufactured") {
    if (v.shape === "other") issue("shape", "Elegí la forma");
    if (!(v.netWeightKg != null && v.netWeightKg > 0))
      issue("netWeightKg", "Ingresá los kg de masa por unidad");
  }
  if (v.kind === "prepared") {
    if (!v.baseProductId) issue("baseProductId", "Elegí el producto base del que se elabora");
    if (!(v.baseQty != null && v.baseQty > 0))
      issue("baseQty", "Ingresá cuántas unidades del producto base consume");
  }
  const seen = new Set<string>();
  for (const [i, c] of v.components.entries()) {
    if (seen.has(c.ingredientId))
      ctx.addIssue({ code: "custom", path: ["components", i, "ingredientId"], message: "Insumo repetido" });
    seen.add(c.ingredientId);
  }
  const lists = new Set<string>();
  for (const [i, p] of v.initialPrices.entries()) {
    if (lists.has(p.priceListId))
      ctx.addIssue({ code: "custom", path: ["initialPrices", i, "priceListId"], message: "Lista repetida" });
    lists.add(p.priceListId);
  }
}

export const productInput = productBase.superRefine(refineProduct);
export type ProductFormInput = z.input<typeof productInput>;
export type ProductData = z.output<typeof productInput>;

export const updateProductInput = productBase.extend({ id: uuid }).superRefine(refineProduct);
export type UpdateProductData = z.output<typeof updateProductInput>;

export const productIdInput = z.object({ id: uuid });
export const setProductActiveInput = z.object({ id: uuid, active: z.boolean() });

// --- Insumos -----------------------------------------------------------------------------------

export const ingredientInput = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre").max(120),
  category: z.enum(INGREDIENT_CATEGORIES),
  unit: z.enum(INGREDIENT_UNITS),
  refrigerated: z.boolean().default(false),
  minStock: decimal({ min: 0 }).default(0),
  safetyStock: decimal({ min: 0 }).default(0),
  defaultSupplierId: optUuid(),
  active: z.boolean().default(true),
  /** Solo al crear: último precio sin IVA conocido (por la unidad del insumo). */
  initialPrice: optDecimal({ min: 0 }),
});
export type IngredientFormInput = z.input<typeof ingredientInput>;
export type IngredientData = z.output<typeof ingredientInput>;
export const updateIngredientInput = ingredientInput.extend({ id: uuid });
export const setIngredientActiveInput = z.object({ id: uuid, active: z.boolean() });

// --- Zonas, listas, vehículos, equipos, ubicaciones ----------------------------------------------

export const zoneInput = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de la zona").max(80),
  deliveryWeekdays: z.array(z.coerce.number().int().min(1).max(7)).default([]),
});
export type ZoneFormInput = z.input<typeof zoneInput>;
export type ZoneData = z.output<typeof zoneInput>;
export const updateZoneInput = zoneInput.extend({ id: uuid });
export const deleteZoneInput = z.object({ id: uuid });

export const priceListInput = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de la lista").max(80),
  channel: z.enum(CHANNELS),
  targetMarginPct: decimal({ min: 0, max: 95 }).default(25),
  active: z.boolean().default(true),
  /** Solo al crear: copiar los precios vigentes de otra lista, con un ajuste en %. */
  copyFromListId: optUuid(),
  adjustPct: optDecimal({ min: -90, max: 500 }),
});
export type PriceListFormInput = z.input<typeof priceListInput>;
export type PriceListData = z.output<typeof priceListInput>;
export const updatePriceListInput = priceListInput.extend({ id: uuid });
export const copyPricesInput = z.object({
  fromListId: uuid,
  toListId: uuid,
  adjustPct: optDecimal({ min: -90, max: 500 }),
});
export type CopyPricesData = z.output<typeof copyPricesInput>;

export const vehicleInput = z.object({
  plate: z.string().trim().min(5, "Ingresá la patente").max(10),
  name: z.string().trim().min(2, "Ingresá el nombre del vehículo").max(80),
  hasColdUnit: z.boolean().default(true),
  costPerKm: decimal({ min: 0 }).default(0),
  /** Solo al crear: dar de alta el equipo de frío para controlar su temperatura y mantenimiento. */
  createColdEquipment: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type VehicleFormInput = z.input<typeof vehicleInput>;
export type VehicleData = z.output<typeof vehicleInput>;
export const updateVehicleInput = vehicleInput.extend({ id: uuid });

export const equipmentInput = z
  .object({
    code: z.string().trim().min(2, "Ingresá el código").max(30),
    name: z.string().trim().min(2, "Ingresá el nombre").max(100),
    area: z.string().trim().min(2, "Ingresá el área").max(60),
    kind: z.enum(EQUIPMENT_KINDS),
    tempMinC: optDecimal({ min: -80, max: 100 }),
    tempMaxC: optDecimal({ min: -80, max: 100 }),
    locationId: optUuid(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.tempMinC == null || v.tempMaxC == null || v.tempMinC <= v.tempMaxC, {
    path: ["tempMaxC"],
    message: "El máximo no puede ser menor al mínimo",
  });
export type EquipmentFormInput = z.input<typeof equipmentInput>;
export type EquipmentData = z.output<typeof equipmentInput>;
export const updateEquipmentInput = z
  .object({
    id: uuid,
    code: z.string().trim().min(2).max(30),
    name: z.string().trim().min(2).max(100),
    area: z.string().trim().min(2).max(60),
    kind: z.enum(EQUIPMENT_KINDS),
    tempMinC: optDecimal({ min: -80, max: 100 }),
    tempMaxC: optDecimal({ min: -80, max: 100 }),
    locationId: optUuid(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.tempMinC == null || v.tempMaxC == null || v.tempMinC <= v.tempMaxC, {
    path: ["tempMaxC"],
    message: "El máximo no puede ser menor al mínimo",
  });

export const locationInput = z.object({
  code: z.string().trim().min(2, "Ingresá el código").max(30),
  name: z.string().trim().min(2, "Ingresá el nombre").max(100),
  kind: z.enum(LOCATION_KINDS),
  capacityKg: optDecimal({ min: 0 }),
  /** Solo al crear: dar de alta también el equipo (freezer / heladera) para controlar su temperatura. */
  createEquipment: z.enum(["none", "freezer", "fridge"]).default("none"),
  active: z.boolean().default(true),
});
export type LocationFormInput = z.input<typeof locationInput>;
export type LocationData = z.output<typeof locationInput>;
export const updateLocationInput = locationInput.extend({ id: uuid });
