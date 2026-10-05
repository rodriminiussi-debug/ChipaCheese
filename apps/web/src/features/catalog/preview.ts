import { costPerBag, roundMoney } from "@chipa/domain";

/**
 * Costo estimado de un producto mientras se carga (formulario de alta), con la misma cuenta que el costeo:
 *  - fabricado: costo por kg × kg de masa + componentes (envase, etiqueta, relleno);
 *  - reventa: costo de compra inicial;
 *  - elaborado: costo del producto base × unidades que consume + componentes.
 * Si falta un dato devuelve `cost: null` y el detalle de lo que falta (nunca asume $0).
 */
export interface CostReference {
  /** Costo directo por kg de masa (receta activa + mano de obra); null si falta algún precio. */
  costPerKg: number | null;
  /** Último precio sin IVA por insumo. */
  ingredientPrices: Record<string, number>;
  /** Costo unitario actual de cada producto fabricado (null si no se puede costear). */
  baseCosts: Record<string, number | null>;
  /** Nombres de insumo por id (para el detalle de faltantes). */
  ingredientNames?: Record<string, string>;
}

export interface CostPreviewInput {
  kind: "manufactured" | "resale" | "prepared";
  netWeightKg: number | null;
  baseProductId: string | null;
  baseQty: number | null;
  initialCost: number | null;
  components: { ingredientId: string; qtyPerUnit: number }[];
}

export function previewProductCost(
  input: CostPreviewInput,
  ref: CostReference,
): { cost: number | null; missing: string[] } {
  const missing: string[] = [];
  let components = 0;
  if (input.kind !== "resale") {
    for (const c of input.components) {
      const price = ref.ingredientPrices[c.ingredientId];
      if (price == null) missing.push(ref.ingredientNames?.[c.ingredientId] ?? "insumo sin precio");
      else components += c.qtyPerUnit * price;
    }
  }
  if (input.kind === "resale") {
    return input.initialCost != null
      ? { cost: roundMoney(input.initialCost), missing: [] }
      : { cost: null, missing: ["costo de compra"] };
  }
  if (input.kind === "manufactured") {
    if (!(input.netWeightKg != null && input.netWeightKg > 0)) missing.push("kg de masa");
    if (ref.costPerKg == null) missing.push("costo por kg de la receta");
    if (missing.length) return { cost: null, missing };
    return {
      cost: costPerBag({
        costPerKg: ref.costPerKg!,
        bagKg: input.netWeightKg!,
        packagingCostPerBag: roundMoney(components),
      }),
      missing,
    };
  }
  // elaborado
  const baseCost = input.baseProductId ? ref.baseCosts[input.baseProductId] : undefined;
  if (!input.baseProductId) missing.push("producto base");
  else if (baseCost == null) missing.push("costo del producto base");
  if (!(input.baseQty != null && input.baseQty > 0)) missing.push("unidades del producto base");
  if (missing.length) return { cost: null, missing };
  return { cost: roundMoney(baseCost! * input.baseQty! + components), missing };
}
