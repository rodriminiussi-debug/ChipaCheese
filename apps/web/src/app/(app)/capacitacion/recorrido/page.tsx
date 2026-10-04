import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { journeyShots } from "@/features/training/content";
import { JourneyAnimation } from "@/features/training/components/journey-animation";
import { TraceAnimation } from "@/features/training/components/trace-animation";

export const metadata = { title: "Cómo circula la información" };

export default async function JourneyPage() {
  await requirePermission("training:read");
  return (
    <div className="grid gap-12">
      <PageHeader
        title="Cómo circula la información"
        description="Un pedido entra por Pedidos, se produce consumiendo el stock que alimentan las compras, sale por Despacho con su lote y se cobra en Cobranzas. Calidad registra y traza cada lote, y el Tablero lee todo."
      />
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Del pedido al tablero</h2>
        <JourneyAnimation shots={journeyShots()} />
      </section>
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Trazabilidad de un lote</h2>
        <TraceAnimation />
      </section>
    </div>
  );
}
