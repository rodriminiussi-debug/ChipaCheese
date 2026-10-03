import { theoreticalConsumption } from "@chipa/domain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty, fmtRange, UNIT_SHORT } from "../format";
import { recipeLines, type RecipeWithItems } from "../service";

/** Receta maestra: cantidades por kg de fécula, rangos, cantidades para `starchKg` e instrucciones. */
export function RecipeTable({ recipe, starchKg }: { recipe: RecipeWithItems; starchKg: number }) {
  const scaled = theoreticalConsumption(recipeLines(recipe), starchKg);
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Insumo</TableHead>
            <TableHead className="text-right">Por kg de fécula</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Rango por kg</TableHead>
            <TableHead className="text-right">Para {fmtQty(starchKg)} kg</TableHead>
            <TableHead className="hidden lg:table-cell">Instrucciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipe.items.map((item) => {
            const s = scaled.find((x) => x.ingredientId === item.ingredientId)!;
            const unit = UNIT_SHORT[item.ingredient.unit] ?? "";
            return (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.ingredient.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtQty(item.qtyPerKgStarch)} {unit}
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                  {fmtRange(item.minPerKgStarch, item.maxPerKgStarch)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtQty(s.qty)} {unit}
                  {s.min != null || s.max != null ? (
                    <div className="text-muted-foreground text-xs font-normal">
                      {fmtRange(s.min, s.max, unit)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-xs text-sm lg:table-cell">
                  {item.instructions ?? "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
