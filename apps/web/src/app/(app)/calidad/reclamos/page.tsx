import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { complaintFormOptions, listComplaints } from "@/features/quality/service";
import { COMPLAINT_STATUS } from "@/features/quality/labels";
import { ComplaintForm } from "@/features/quality/components/complaint-form";
import { ComplaintStatusButton } from "@/features/quality/components/complaint-status-button";
import { HoldButton } from "@/features/quality/components/hold-button";

export const metadata = { title: "Calidad · Reclamos y devoluciones" };

export default async function ComplaintsPage(props: PageProps<"/calidad/reclamos">) {
  const user = await requirePermission("quality:read");
  const sp = await props.searchParams;
  const estado = sp.estado === "open" || sp.estado === "closed" ? sp.estado : undefined;
  const canWrite = can(user.role, "quality:write");
  const today = todayAR();
  const [rows, options] = await Promise.all([
    listComplaints(db, { status: estado }),
    canWrite ? complaintFormOptions(db) : null,
  ]);

  const filters = [
    [undefined, "Todos"],
    ["open", "Abiertos"],
    ["closed", "Cerrados"],
  ] as const;

  return (
    <>
      <PageHeader
        title="Reclamos y devoluciones"
        description="Planilla de reclamos: cliente, lote, motivo y acciones. Retener un lote lo saca del despacho hasta liberarlo."
        actions={options ? <ComplaintForm options={options} today={today} /> : null}
      />
      <div className="bg-muted mb-4 inline-flex rounded-lg p-1 text-sm">
        {filters.map(([v, label]) => (
          <Link
            key={label}
            href={(v ? `/calidad/reclamos?estado=${v}` : "/calidad/reclamos") as Route}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium",
              estado === v ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay reclamos" description="Cuando llegue uno, registralo acá." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Cant.</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Vto. lote</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="hidden xl:table-cell">Acción cliente</TableHead>
                <TableHead className="hidden xl:table-cell">Acción producto</TableHead>
                <TableHead className="hidden lg:table-cell">Supervisor</TableHead>
                <TableHead>Estado</TableHead>
                {canWrite ? <TableHead className="text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} data-testid={`complaint-${c.id}`}>
                  <TableCell>
                    <DateText value={c.date} />
                  </TableCell>
                  <TableCell>{c.customer?.legalName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.qtyUnits ?? "—"}</TableCell>
                  <TableCell>
                    {c.lot ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <Link
                          href={`/calidad/trazabilidad?lote=${c.lot.code}` as Route}
                          className="font-medium hover:underline"
                        >
                          {c.lot.code}
                        </Link>
                        {c.lot.onHold ? <StatusBadge tone="bad">Retenido</StatusBadge> : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <DateText value={c.lot?.expiryDate} />
                  </TableCell>
                  <TableCell className="max-w-56">{c.reason}</TableCell>
                  <TableCell className="hidden xl:table-cell">{c.customerAction ?? "—"}</TableCell>
                  <TableCell className="hidden xl:table-cell">{c.productAction ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.supervisor?.initials ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={COMPLAINT_STATUS[c.status]!.tone}>
                      {COMPLAINT_STATUS[c.status]!.label}
                    </StatusBadge>
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {c.lot ? <HoldButton finishedLotId={c.lot.id} onHold={c.lot.onHold} /> : null}
                        <ComplaintStatusButton id={c.id} status={c.status} />
                        {options ? (
                          <ComplaintForm
                            options={options}
                            today={today}
                            initial={{
                              id: c.id,
                              date: c.date,
                              customerId: c.customerId,
                              finishedLotId: c.finishedLotId,
                              qtyUnits: c.qtyUnits,
                              reason: c.reason,
                              customerAction: c.customerAction,
                              productAction: c.productAction,
                              supervisorId: c.supervisorId,
                              holdLot: false,
                            }}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
