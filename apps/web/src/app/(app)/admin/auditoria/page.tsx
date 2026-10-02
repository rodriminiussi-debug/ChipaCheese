import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { diffFields, listAudit } from "@/features/admin/service";
import { formatDateTimeAR } from "@/lib/dates";

export const metadata = { title: "Auditoría" };

const ACTION = {
  I: { label: "Alta", tone: "good" },
  U: { label: "Edición", tone: "warn" },
  D: { label: "Baja", tone: "bad" },
} as const;
const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 40 ? s.slice(0, 40) + "…" : (s ?? "∅");
};

export default async function AuditPage(props: PageProps<"/admin/auditoria">) {
  await requirePermission("admin");
  const { tabla } = await props.searchParams;
  const table = typeof tabla === "string" && tabla ? tabla : undefined;
  const rows = await listAudit(db, { table, limit: 200 });
  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Cada alta, edición y baja con usuario, fecha y hora (requisito BPM). Solo lectura."
      />
      <form className="mb-4 max-w-xs">
        <Input
          name="tabla"
          placeholder="Filtrar por tabla (p. ej. orders)"
          defaultValue={table}
          aria-label="Filtrar por tabla"
        />
      </form>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Tabla</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Cambios</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const a = ACTION[r.action as keyof typeof ACTION];
              const changes = r.action === "U" ? diffFields(r.oldData, r.newData) : [];
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTimeAR(r.changedAt)}
                  </TableCell>
                  <TableCell>{r.user ?? <span className="text-muted-foreground">sistema</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{r.tableName}</TableCell>
                  <TableCell>
                    <StatusBadge tone={a.tone}>{a.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {changes.length
                      ? changes.slice(0, 4).map((c) => (
                          <div key={c.field}>
                            <span className="font-mono">{c.field}</span>: {short(c.from)} → {short(c.to)}
                          </div>
                        ))
                      : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
