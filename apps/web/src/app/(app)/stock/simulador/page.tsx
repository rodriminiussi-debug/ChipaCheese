import { CheckCircle2, XCircle } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { DateText, Kg, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { simulateProductionFromStock, type SimulationMode } from "@/features/stock/service";
import { UNIT } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Simulador" };

const SELECT =
  "border-input bg-background h-8 w-full min-w-0 rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** RF-17: "¿alcanza la materia prima para producir X?" (servidor + URL: se puede compartir). */
export default async function SimulatorPage(props: PageProps<"/stock/simulador">) {
  await requirePermission("stock:read");
  const sp = await props.searchParams;
  const mode: SimulationMode = one(sp.mode) === "starch_kg" ? "starch_kg" : "product_kg";
  const raw = one(sp.kg);
  const parsed = raw ? Number(raw) : NaN;
  const kg = Number.isFinite(parsed) ? parsed : null;
  const sim = kg && kg > 0 ? await simulateProductionFromStock(db, { mode, kg }) : null;

  return (
    <div className="grid gap-6">
      <form
        className="grid items-end gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto]"
        aria-label="Simulador de producción"
      >
        <label className="grid gap-1 text-sm">
          Quiero producir
          <select name="mode" defaultValue={mode} className={SELECT}>
            <option value="product_kg">Kg de producto terminado</option>
            <option value="starch_kg">Kg de fécula</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Cantidad (kg)
          <Input
            name="kg"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            defaultValue={kg ?? ""}
            placeholder="Ej.: 425"
            required
          />
        </label>
        <Button type="submit">Simular</Button>
      </form>

      {!kg || kg <= 0 ? (
        <EmptyState
          title="¿Alcanza la materia prima?"
          description="Ingresá los kg de producto (o de fécula) que querés producir y comparamos con el stock actual usando la receta activa."
        />
      ) : !sim ? (
        <EmptyState
          title="No hay una receta activa"
          description="Activá una receta maestra para poder simular."
        />
      ) : (
        <>
          <div
            role="status"
            className={`flex items-center gap-3 rounded-lg border p-4 ${sim.ok ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"}`}
          >
            {sim.ok ? (
              <CheckCircle2 className="size-5 text-emerald-600" />
            ) : (
              <XCircle className="text-destructive size-5" />
            )}
            <div>
              <p className="font-medium">
                {sim.ok
                  ? "Alcanza la materia prima"
                  : sim.okWithIncoming
                    ? "No alcanza hoy, pero alcanzaría con las compras en camino"
                    : "No alcanza la materia prima"}
              </p>
              <p className="text-muted-foreground text-sm">
                Para {mode === "product_kg" ? <Kg value={sim.inputKg} /> : <>{sim.inputKg} kg de fécula</>}
                {mode === "product_kg" ? (
                  <>
                    {" "}
                    hacen falta <Kg value={sim.starchKg} /> de fécula
                  </>
                ) : null}{" "}
                (receta {sim.recipe.name} v{sim.recipe.version}, rendimiento{" "}
                {sim.recipe.expectedYieldPerKgStarch} kg de producto por kg de fécula).
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              title="Recetas completas que alcanzan"
              value={<Num value={sim.completeRecipes} decimals={0} />}
              hint="1 receta = 75 kg de fécula"
              testId="stat-recipes"
            />
            <StatCard title="Fécula máxima con el stock" value={<Kg value={sim.maxStarchKg} />} />
            <StatCard title="Producto estimado" value={<Kg value={sim.maxProductKg} />} />
          </div>

          <div className="rounded-lg border">
            <Table aria-label="Necesidad contra disponible">
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Necesario</TableHead>
                  <TableHead className="text-right">Disponible hoy</TableHead>
                  <TableHead className="text-right">En camino</TableHead>
                  <TableHead className="text-right">Faltante hoy</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sim.rows.map((r) => (
                  <TableRow key={r.ingredientId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">
                      <Num value={r.needed} suffix={UNIT[r.unit]} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Num value={r.available} suffix={UNIT[r.unit]} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.incoming > 0 ? (
                        <div>
                          <Num value={r.incoming} suffix={UNIT[r.unit]} />
                          <div className="text-muted-foreground text-xs">
                            {r.incomingOrders.map((o, i) => (
                              <span key={o.orderId} className="block">
                                {i === 0 ? "" : "+ "}
                                {o.number} · {o.expectedAt ? <DateText value={o.expectedAt} /> : "sin fecha"}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.shortfall > 0 ? (
                        <Num
                          value={r.shortfall}
                          suffix={UNIT[r.unit]}
                          className="text-destructive font-medium"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.ok ? (
                        <StatusBadge tone="good">Alcanza</StatusBadge>
                      ) : r.shortfallAfterIncoming === 0 ? (
                        <StatusBadge tone="warn">Llega en camino</StatusBadge>
                      ) : (
                        <StatusBadge tone="bad">Falta</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-xs">
            Solo considera los insumos de la receta (no envases). "Disponible hoy" es el saldo actual de todas
            las ubicaciones; "En camino" es lo que falta recibir de las órdenes de compra enviadas y no cuenta
            como stock hasta la recepción.
          </p>
        </>
      )}
    </div>
  );
}
