import type { CostLine } from "./costing";
import type { RecipeLine } from "./recipe";

/**
 * Receta real del relevamiento (pestaña 29/09/2026), por kg de fécula.
 * Ojo: la suma de estas 7 líneas × 75 kg da 177,75 kg; el relevamiento declara 163,5 kg
 * como total de ingredientes (inconsistencia del documento, ver recipe.test.ts).
 */
export const RECIPE: RecipeLine[] = [
  { ingredientId: "queso_barra", qtyPerKgStarch: 0.3 },
  { ingredientId: "reggianito", qtyPerKgStarch: 0.2 },
  { ingredientId: "manteca", qtyPerKgStarch: 0.2 },
  { ingredientId: "fecula", qtyPerKgStarch: 1 },
  { ingredientId: "huevo", qtyPerKgStarch: 0.24 },
  { ingredientId: "leche", qtyPerKgStarch: 0.4, minPerKgStarch: 0.24, maxPerKgStarch: 0.373 },
  { ingredientId: "sal", qtyPerKgStarch: 0.03 },
];

/** Costo por producción publicado en el relevamiento (precios del 29/09). */
const PUBLISHED: { id: string; qty: number; cost: number }[] = [
  { id: "queso_barra", qty: 22.5, cost: 222292 },
  { id: "reggianito", qty: 15, cost: 201465 },
  { id: "manteca", qty: 15, cost: 147000 },
  { id: "fecula", qty: 75, cost: 129597 },
  { id: "huevo", qty: 18, cost: 58000 },
  { id: "leche", qty: 30, cost: 31983 },
  { id: "sal", qty: 2.25, cost: 1593 },
];

/** Las 7 líneas de costo; unitPriceNet = costo publicado ÷ cantidad, así Σ = $791.930. */
export const COST_LINES: CostLine[] = PUBLISHED.map((p) => ({
  ingredientId: p.id,
  qty: p.qty,
  unitPriceNet: p.cost / p.qty,
}));

/** Mismas líneas con los precios por kg redondeados que figuran en el relevamiento. */
export const COST_LINES_LIST_PRICES: CostLine[] = [
  { ingredientId: "queso_barra", qty: 22.5, unitPriceNet: 9880 },
  { ingredientId: "reggianito", qty: 15, unitPriceNet: 13431 },
  { ingredientId: "manteca", qty: 15, unitPriceNet: 9800 },
  { ingredientId: "fecula", qty: 75, unitPriceNet: 1728 },
  { ingredientId: "huevo", qty: 18, unitPriceNet: 3222 },
  { ingredientId: "leche", qty: 30, unitPriceNet: 1066 },
  { ingredientId: "sal", qty: 2.25, unitPriceNet: 708 },
];
