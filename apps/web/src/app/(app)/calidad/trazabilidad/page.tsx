import Link from "next/link";
import type { Route } from "next";
import { FileText, Search, Timer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { PrintButton } from "@/features/orders/components/print-button";
import { recentFinishedLots, timedSearchTrace } from "@/features/traceability/service";
import { FinishedLotReport, RawLotReport } from "@/features/traceability/components/trace-report";

export const metadata = { title: "Calidad · Trazabilidad" };

function elapsedLabel(ms: number) {
  return `${(ms / 1000).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
}

export default async function TraceabilityPage(props: PageProps<"/calidad/trazabilidad">) {
  const user = await requirePermission(["quality:read", "dispatch:read"]);
  const sp = await props.searchParams;
  const term = typeof sp.lote === "string" ? sp.lote.trim() : "";
  const canHold = can(user.role, "quality:write");

  const timed = term ? await timedSearchTrace(db, term) : null;
  const result = timed?.result ?? null;
  const elapsed = timed?.elapsedMs ?? 0;
  const recents = term ? [] : await recentFinishedLots(db);
  const found = result && (result.finished || result.raw.length > 0);

  return (
    <>
      <PageHeader
        title="Trazabilidad de lotes"
        description="Del lote terminado a los lotes de materia prima y proveedores, y a los clientes que lo recibieron. También desde un lote de materia prima, para un retiro (RF-35)."
        actions={
          found ? (
            <>
              <Button asChild variant="outline" className="print:hidden">
                <Link
                  href={`/api/calidad/trazabilidad/pdf?lote=${encodeURIComponent(term)}` as Route}
                  prefetch={false}
                >
                  <FileText /> PDF
                </Link>
              </Button>
              <PrintButton />
            </>
          ) : null
        }
      />

      <form className="mb-4 flex max-w-xl gap-2 print:hidden" action="/calidad/trazabilidad">
        <Input
          name="lote"
          defaultValue={term}
          placeholder="Código de lote (260901-1) o lote del proveedor (TYBO-0925)"
          aria-label="Código de lote"
          autoFocus={!term}
        />
        <Button type="submit">
          <Search /> Buscar
        </Button>
      </form>

      {!term ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">Lotes recientes:</p>
          <div className="flex flex-wrap gap-2">
            {recents.map((r) => (
              <Button key={r.code} asChild variant="outline" size="sm">
                <Link href={`/calidad/trazabilidad?lote=${r.code}` as Route}>{r.code}</Link>
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {result && found ? (
        <>
          <p
            className="text-muted-foreground mb-4 flex items-center gap-1.5 text-sm"
            data-testid="trace-elapsed"
          >
            <Timer className="size-4" /> Resuelto en {elapsedLabel(elapsed)}
          </p>
          {result.finished ? <FinishedLotReport trace={result.finished} canHold={canHold} /> : null}
          {result.raw.map((r) => (
            <RawLotReport key={r.rawLot.id} trace={r} canHold={canHold} />
          ))}
        </>
      ) : null}

      {result && !found ? (
        <EmptyState
          title={`No encontramos el lote "${result.term}"`}
          description="Revisá el código. Probá con el de la etiqueta (AAMMDD-N) o con el lote del proveedor."
          action={
            result.suggestions.length ? (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {result.suggestions.map((s) => (
                  <Button key={s.code} asChild variant="outline" size="sm">
                    <Link href={`/calidad/trazabilidad?lote=${encodeURIComponent(s.code)}` as Route}>
                      {s.code}
                    </Link>
                  </Button>
                ))}
              </div>
            ) : null
          }
        />
      ) : null}
    </>
  );
}
