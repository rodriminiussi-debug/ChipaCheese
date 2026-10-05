"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import {
  copyPricesInput,
  deleteZoneInput,
  equipmentInput,
  ingredientInput,
  locationInput,
  priceListInput,
  productIdInput,
  productInput,
  setIngredientActiveInput,
  setProductActiveInput,
  updateEquipmentInput,
  updateIngredientInput,
  updateLocationInput,
  updatePriceListInput,
  updateProductInput,
  updateVehicleInput,
  updateZoneInput,
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
  setIngredientActive,
  setProductActive,
  updateEquipment,
  updateIngredient,
  updateLocation,
  updatePriceList,
  updateProduct,
  updateVehicle,
  updateZone,
} from "./service";

const PERMISSION = "catalog:write" as const;

/** Todo lo que lista productos, precios o stock cambia cuando cambia el catálogo de productos. */
function revalidateProducts(id?: string) {
  revalidatePath("/catalogo/productos");
  if (id) revalidatePath(`/catalogo/productos/${id}`);
  for (const p of [
    "/precios",
    "/costos",
    "/pedidos/nuevo",
    "/local",
    "/stock/producto-terminado",
    "/tablero",
  ])
    revalidatePath(p);
}

// --- Productos -----------------------------------------------------------------------------------

export const createProductAction = action(
  { permission: PERMISSION, schema: productInput },
  async (input, { tx }) => {
    const row = await createProduct(tx, input);
    revalidateProducts();
    return { id: row.id };
  },
);

export const updateProductAction = action(
  { permission: PERMISSION, schema: updateProductInput },
  async (input, { tx }) => {
    const row = await updateProduct(tx, input);
    revalidateProducts(row.id);
    return { id: row.id };
  },
);

export const setProductActiveAction = action(
  { permission: PERMISSION, schema: setProductActiveInput },
  async ({ id, active }, { tx }) => {
    await setProductActive(tx, id, active);
    revalidateProducts(id);
    return { id, active };
  },
);

export const deleteProductAction = action(
  { permission: PERMISSION, schema: productIdInput },
  async ({ id }, { tx }) => {
    await deleteProduct(tx, id);
    revalidateProducts();
    return { id };
  },
);

// --- Insumos -----------------------------------------------------------------------------------

function revalidateIngredients() {
  for (const p of ["/catalogo/insumos", "/compras", "/stock", "/costos", "/precios"]) revalidatePath(p);
}

export const createIngredientAction = action(
  { permission: PERMISSION, schema: ingredientInput },
  async (input, { tx }) => {
    const row = await createIngredient(tx, input);
    revalidateIngredients();
    return { id: row.id };
  },
);

export const updateIngredientAction = action(
  { permission: PERMISSION, schema: updateIngredientInput },
  async ({ id, ...input }, { tx }) => {
    await updateIngredient(tx, id, input);
    revalidateIngredients();
    return { id };
  },
);

export const setIngredientActiveAction = action(
  { permission: PERMISSION, schema: setIngredientActiveInput },
  async ({ id, active }, { tx }) => {
    await setIngredientActive(tx, id, active);
    revalidateIngredients();
    return { id, active };
  },
);

// --- Zonas -------------------------------------------------------------------------------------

export const createZoneAction = action(
  { permission: PERMISSION, schema: zoneInput },
  async (input, { tx }) => {
    const row = await createZone(tx, input);
    revalidatePath("/catalogo/zonas");
    revalidatePath("/clientes");
    return { id: row.id };
  },
);

export const updateZoneAction = action(
  { permission: PERMISSION, schema: updateZoneInput },
  async ({ id, ...input }, { tx }) => {
    await updateZone(tx, id, input);
    revalidatePath("/catalogo/zonas");
    revalidatePath("/clientes");
    return { id };
  },
);

export const deleteZoneAction = action(
  { permission: PERMISSION, schema: deleteZoneInput },
  async ({ id }, { tx }) => {
    await deleteZone(tx, id);
    revalidatePath("/catalogo/zonas");
    return { id };
  },
);

// --- Listas de precios ---------------------------------------------------------------------------

export const createPriceListAction = action(
  { permission: PERMISSION, schema: priceListInput },
  async (input, { tx }) => {
    const row = await createPriceList(tx, input);
    revalidatePath("/catalogo/listas");
    revalidatePath("/precios");
    revalidatePath("/clientes");
    return { id: row.id, copied: row.copied };
  },
);

export const updatePriceListAction = action(
  { permission: PERMISSION, schema: updatePriceListInput },
  async ({ id, ...input }, { tx }) => {
    await updatePriceList(tx, id, input);
    revalidatePath("/catalogo/listas");
    revalidatePath("/precios");
    return { id };
  },
);

export const copyPricesAction = action(
  { permission: PERMISSION, schema: copyPricesInput },
  async (input, { tx }) => {
    const res = await copyPrices(tx, input);
    revalidatePath("/catalogo/listas");
    revalidatePath("/precios");
    return res;
  },
);

// --- Vehículos -----------------------------------------------------------------------------------

function revalidateVehicles() {
  for (const p of ["/catalogo/vehiculos", "/despacho", "/planta/temperaturas", "/calidad", "/mantenimiento"])
    revalidatePath(p);
}

export const createVehicleAction = action(
  { permission: PERMISSION, schema: vehicleInput },
  async (input, { tx }) => {
    const row = await createVehicle(tx, input);
    revalidateVehicles();
    return { id: row.id };
  },
);

export const updateVehicleAction = action(
  { permission: PERMISSION, schema: updateVehicleInput },
  async ({ id, ...input }, { tx }) => {
    await updateVehicle(tx, id, input);
    revalidateVehicles();
    return { id };
  },
);

// --- Equipos -------------------------------------------------------------------------------------

function revalidateEquipment() {
  for (const p of ["/catalogo/equipos", "/planta/temperaturas", "/calidad", "/mantenimiento"])
    revalidatePath(p);
}

export const createEquipmentAction = action(
  { permission: PERMISSION, schema: equipmentInput },
  async (input, { tx }) => {
    const row = await createEquipment(tx, input);
    revalidateEquipment();
    return { id: row.id };
  },
);

export const updateEquipmentAction = action(
  { permission: PERMISSION, schema: updateEquipmentInput },
  async ({ id, ...input }, { tx }) => {
    await updateEquipment(tx, id, input);
    revalidateEquipment();
    return { id };
  },
);

// --- Ubicaciones ---------------------------------------------------------------------------------

function revalidateLocations() {
  for (const p of [
    "/catalogo/ubicaciones",
    "/catalogo/equipos",
    "/stock",
    "/planta/temperaturas",
    "/mantenimiento",
  ])
    revalidatePath(p);
}

export const createLocationAction = action(
  { permission: PERMISSION, schema: locationInput },
  async (input, { tx }) => {
    const row = await createLocation(tx, input);
    revalidateLocations();
    return { id: row.id };
  },
);

export const updateLocationAction = action(
  { permission: PERMISSION, schema: updateLocationInput },
  async ({ id, ...input }, { tx }) => {
    await updateLocation(tx, id, input);
    revalidateLocations();
    return { id };
  },
);
