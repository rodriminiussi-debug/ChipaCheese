import Link from "next/link";
import { roundQty } from "@chipa/domain";
import { DateText, Kg } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_STATUS, SHIFT } from "../labels";
import type { listRuns } from "../service";

export function LateBadge() {
  return <StatusBadge tone="warn">Carga tardía</StatusBadge>;
}

export function RunsTable({ runs }: { runs: Awaited<ReturnType<typeof listRuns>> }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producción</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="hidden sm:table-cell">Lote</TableHead>
            <TableHead className="text-right">Fécula</TableHead>
            <TableHead className="hidden text-right md:table-cell">Pesado</TableHead>
            <TableHead className="hidden lg:table-cell">Responsable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => {
            const status = RUN_STATUS[r.status]!;
            const weighed = roundQty(r.weighings.reduce((a, w) => a + w.kg, 0));
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/produccion/${r.id}`} className="font-medium hover:underline">
                    N° {r.runNumber} · <DateText value={r.date} />
                  </Link>
                  <div className="text-muted-foreground text-xs">{SHIFT[r.shift]}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    {r.lateEntry ? <LateBadge /> : null}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {r.lots[0] ? (
                    <Link href={`/produccion/lotes/${r.lots[0].code}`} className="hover:underline">
                      {r.lots[0].code}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Kg value={r.starchKg} />
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  {weighed > 0 ? <Kg value={weighed} /> : "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">{r.responsible?.name ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
