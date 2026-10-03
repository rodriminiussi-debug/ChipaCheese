import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayAR } from "@/lib/dates";
import { RouteForm } from "@/features/dispatch/components/route-form";
import { dispatchFormOptions, routeProposal } from "@/features/dispatch/service";
import { weekdayDate } from "@/features/dispatch/labels";

export const metadata = { title: "Nueva ruta" };

/** RF-24: armar la ruta del día desde los pedidos, agrupados por zona. */
export default async function NewRoutePage(props: PageProps<"/despacho/nueva">) {
  await requirePermission("dispatch:write");
  const { fecha } = await props.searchParams;
  const date = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : todayAR();
  const [proposal, options] = await Promise.all([routeProposal(db, date), dispatchFormOptions(db)]);

  return (
    <>
      <PageHeader
        title="Nueva ruta"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/despacho?fecha=${date}`} className="inline-flex items-center hover:underline">
              <ChevronLeft className="size-4" /> Rutas
            </Link>
            · {weekdayDate(date)}
          </span>
        }
        actions={
          <form className="flex gap-2">
            <Input
              type="date"
              name="fecha"
              defaultValue={date}
              aria-label="Fecha de la ruta"
              className="w-40"
            />
            <Button type="submit" variant="outline">
              Cambiar fecha
            </Button>
          </form>
        }
      />
      {/* La key reinicia la selección al cambiar de fecha. */}
      <RouteForm key={date} proposal={proposal} options={options} />
    </>
  );
}
