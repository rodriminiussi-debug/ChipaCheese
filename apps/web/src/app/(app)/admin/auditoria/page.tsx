import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import Link from "next/link";
import { diffFields, listAudit } from "@/features/admin/service";
import { listExportLog, traceTimeIndicator } from "@/features/admin/logs";
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

const EXPORT_KIND: Record<string, string> = {
  precios_xlsx: "Historial de precios (Excel)",
  traza_xlsx: "Informe de trazabilidad (Excel)",
  traza_pdf: "Informe de trazabilidad (PDF)",
  limpieza_pdf: "Registro de limpieza (PDF)",
  limpieza_xlsx: "Registro de limpieza (Excel)",
  temperaturas_pdf: "Registro de temperaturas (PDF)",
  temperaturas_xlsx: "Registro de temperaturas (Excel)",
  reclamos_pdf: "Reclamos y devoluciones (PDF)",
  reclamos_xlsx: "Reclamos y devoluciones (Excel)",
  mantenimiento_pdf: "Mantenimiento (PDF)",
  mantenimiento_xlsx: "Mantenimiento (Excel)",
  elaboracion_pdf: "Registro de elaboración (PDF)",
  elaboracion_xlsx: "Registro de elaboración (Excel)",
  despacho_pdf: "Registro de despacho (PDF)",
  despacho_xlsx: "Registro de despacho (Excel)",
};
const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
const paramsText = (p: unknown) =>
  Object.entries((p ?? {}) as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");

export default async function AuditPage(props: PageProps<"/admin/auditoria">) {
  await requirePermission("admin");
  const { tabla, vista } = await props.searchParams;
  const view = vista === "exportaciones" || vista === "trazabilidad" ? vista : "cambios";
  const table = typeof tabla === "string" && tabla ? tabla : undefined;
  const [rows, exports, trace] = await Promise.all([
    view === "cambios" ? listAudit(db, { table, limit: 200 }) : [],
    view === "exportaciones" ? listExportLog(db, { limit: 200 }) : [],
    view === "trazabilidad" ? traceTimeIndicator(db) : null,
  ]);
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;
  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Cada alta, edición y baja con usuario, fecha y hora (requisito BPM), quién exportó qué y los tiempos de trazabilidad. Solo lectura."
      />
      <nav className="mb-4 flex gap-1" aria-label="Vista">
        {(
          [
            ["cambios", "Cambios"],
            ["exportaciones", "Exportaciones"],
            ["trazabilidad", "Tiempo de trazabilidad"],
          ] as const
        ).map(([v, label]) => (
          <Link
            key={v}
            href={v === "cambios" ? "/admin/auditoria" : `/admin/auditoria?vista=${v}`}
            className={tab(view === v)}
            aria-current={view === v ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {view === "exportaciones" ? (
        <div className="rounded-lg border">
          <Table aria-label="Exportaciones">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha y hora</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Exportación</TableHead>
                <TableHead>Parámetros</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Todavía no se exportó nada.
                  </TableCell>
                </TableRow>
              ) : null}
              {exports.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTimeAR(e.createdAt)}
                  </TableCell>
                  <TableCell>{e.user ?? <span className="text-muted-foreground">sistema</span>}</TableCell>
                  <TableCell>{EXPORT_KIND[e.kind] ?? e.kind}</TableCell>
                  <TableCell className="text-xs">{paramsText(e.params)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {view === "trazabilidad" && trace ? (
        <section className="grid max-w-xl gap-3" aria-label="Indicador de trazabilidad">
          <p className="text-muted-foreground text-sm">
            Últimos 3 meses. Objetivo (RF-35): del lote terminado a proveedores y clientes en menos de 1
            minuto.
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3" data-testid="trace-indicator">
            <div>
              <dt className="text-muted-foreground">Consultas</dt>
              <dd className="text-lg font-semibold">{trace.all.count}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tiempo promedio</dt>
              <dd className="text-lg font-semibold">{seconds(trace.all.avgMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Percentil 90</dt>
              <dd className="text-lg font-semibold">{seconds(trace.all.p90Ms)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Más lenta</dt>
              <dd className="text-lg font-semibold">{seconds(trace.all.maxMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dentro del minuto</dt>
              <dd className="text-lg font-semibold">{trace.all.withinTargetPct} %</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Con lote encontrado</dt>
              <dd className="text-lg font-semibold">{trace.found.count}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      {view === "cambios" ? (
        <>
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
                      <TableCell>
                        {r.user ?? <span className="text-muted-foreground">sistema</span>}
                      </TableCell>
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
      ) : null}
    </>
  );
}
