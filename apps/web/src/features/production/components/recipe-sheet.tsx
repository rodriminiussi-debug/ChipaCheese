import { formatDateAR, theoreticalConsumption } from "@chipa/domain";
import { fmtQty, fmtRange, UNIT_SHORT } from "../format";
import type { RecipeWithItems } from "../service";
import { recipeLines } from "../service";

/**
 * Ficha imprimible de la receta (RF-18) escalada a `starchKg` de fécula. Incluye columnas en blanco
 * (lote y cantidad real) para el registro de elaboración en papel y firmas del responsable y supervisor.
 */
export function RecipeSheet({ recipe, starchKg }: { recipe: RecipeWithItems; starchKg: number }) {
  const scaled = theoreticalConsumption(recipeLines(recipe), starchKg);
  return (
    <article className="print-area bg-white p-6 text-black print:p-0" aria-label="Ficha de receta">
      <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">Chipa Cheese · Pacon SRL</p>
          <h2 className="text-2xl font-bold">
            {recipe.name} — versión {recipe.version}
          </h2>
          <p className="text-sm">
            {recipe.effectiveFrom
              ? `Vigente desde ${formatDateAR(recipe.effectiveFrom)}`
              : "Sin fecha de vigencia"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm">Cantidades para</p>
          <p className="text-3xl font-bold">{fmtQty(starchKg)} kg de fécula</p>
        </div>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2">Insumo</th>
            <th className="py-1 pr-2 text-right">Cantidad</th>
            <th className="py-1 pr-2 text-right">Rango aceptable</th>
            <th className="py-1 pr-2">Cómo se hace</th>
            <th className="w-24 py-1 pr-2">Lote MP</th>
            <th className="w-20 py-1">Real</th>
          </tr>
        </thead>
        <tbody>
          {recipe.items.map((item) => {
            const s = scaled.find((x) => x.ingredientId === item.ingredientId)!;
            const unit = UNIT_SHORT[item.ingredient.unit] ?? "";
            return (
              <tr key={item.id} className="border-b border-neutral-400 align-top">
                <td className="py-2 pr-2 font-medium">{item.ingredient.name}</td>
                <td className="py-2 pr-2 text-right font-semibold whitespace-nowrap tabular-nums">
                  {fmtQty(s.qty)} {unit}
                </td>
                <td className="py-2 pr-2 text-right whitespace-nowrap tabular-nums">
                  {fmtRange(s.min, s.max, unit)}
                </td>
                <td className="py-2 pr-2">{item.instructions ?? ""}</td>
                <td className="py-2 pr-2">
                  <div className="h-6 border-b border-neutral-500" />
                </td>
                <td className="py-2">
                  <div className="h-6 border-b border-neutral-500" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="font-semibold">Rendimiento esperado</dt>
          <dd>
            {fmtQty(recipe.expectedYieldPerKgStarch)} kg por kg de fécula ≈{" "}
            {fmtQty(recipe.expectedYieldPerKgStarch * starchKg, 1)} kg de producto
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Umbral de desvío</dt>
          <dd>Avisar si el real se desvía más de {fmtQty(recipe.deviationThresholdPct)} %</dd>
        </div>
        <div>
          <dt className="font-semibold">Tandas</dt>
          <dd>
            {starchKg > 37.5 ? `2 tandas de ${fmtQty(starchKg / 2)} kg` : `1 tanda de ${fmtQty(starchKg)} kg`}
          </dd>
        </div>
      </dl>
      {recipe.notes ? <p className="mt-3 text-xs">Notas de la versión: {recipe.notes}</p> : null}

      <footer className="mt-10 grid grid-cols-3 gap-8 text-xs">
        {["Fecha", "Responsable", "Supervisor"].map((l) => (
          <div key={l} className="border-t border-black pt-1">
            {l}
          </div>
        ))}
      </footer>
    </article>
  );
}
