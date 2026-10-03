import { bagsEquivalent, formatNumber, parseDecimalAR } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { estimateOrderDate } from "@/features/orders/service";
import { EstimateCard } from "@/features/orders/components/estimate-card";

export const metadata = { title: "¿Para cuándo?" };

/** Calculadora independiente (RF-05): "¿para cuándo puedo entregar X kg?". */
export default async function EstimatePage(props: PageProps<"/pedidos/fecha-posible">) {
  await requirePermission("orders:read");
  const { kg: kgParam, fecha } = await props.searchParams;
  const raw = typeof kgParam === "string" ? kgParam : "";
  const kg = raw ? parseDecimalAR(raw) : null;
  const valid = kg != null && kg > 0 && kg <= 100_000;
  const estimate = valid ? await estimateOrderDate(db, { kg }) : null;
  const promised = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;

  return (
    <>
      <PageHeader
        title="¿Para cuándo puedo entregar?"
        description="Según el stock de producto terminado libre, la producción ya comprometida y la capacidad diaria."
      />
      <div className="grid max-w-2xl gap-4">
        <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="kg">Kilos a entregar</FieldLabel>
            <Input
              id="kg"
              name="kg"
              inputMode="decimal"
              placeholder="425"
              defaultValue={raw}
              className="h-11"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="fecha">Fecha pedida (opcional)</FieldLabel>
            <Input id="fecha" name="fecha" type="date" defaultValue={promised ?? ""} className="h-11" />
          </Field>
          <Button type="submit" className="h-11">
            Calcular
          </Button>
        </form>
        {raw && !valid ? (
          <p className="text-destructive text-sm">Ingresá una cantidad de kilos válida.</p>
        ) : null}
        {estimate && kg ? (
          <>
            <p className="text-muted-foreground text-sm">
              {formatNumber(kg, kg % 1 ? 1 : 0)} kg equivalen a {formatNumber(bagsEquivalent(kg), 0)} bolsas
              de 0,5 kg. Se considera el stock libre de todos los productos.
            </p>
            <EstimateCard estimate={estimate} promisedDate={promised} />
          </>
        ) : null}
      </div>
    </>
  );
}
