import type { Route } from "next";
import { FileSpreadsheet, FileText } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/server/auth/session";
import { can, type Permission } from "@/lib/rbac";
import { formatDateTimeAR, todayAR } from "@/lib/dates";
import { db } from "@/server/db";
import { listExportLog } from "@/features/admin/logs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REPORT_KINDS, REPORT_LABELS, type ReportKind } from "@/features/quality/export";

export const metadata = { title: "Calidad · Exportar" };

const DESCRIPTION: Record<ReportKind, string> = {
  limpieza: "Planilla mensual sector/elemento × día. Usa el mes elegido.",
  temperaturas: "Lecturas por equipo con rango, fuera de rango y acción correctiva.",
  reclamos: "Fecha, cliente, cantidad, lote, vencimiento, motivo, acciones y supervisor.",
  mantenimiento: "Área, equipo, preventivo o correctivo, actividad, fecha y responsables.",
  elaboracion: "Por producción: lote, turno, responsables, materia prima con lote y pesadas por forma.",
  despacho: "Por lote despachado: producto, fecha, cantidad, destino, transporte y patente.",
};

const READ: Record<ReportKind, Permission> = {
  limpieza: "quality:read",
  temperaturas: "quality:read",
  reclamos: "quality:read",
  mantenimiento: "maintenance:read",
  elaboracion: "production:read",
  despacho: "dispatch:read",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ExportPage(props: PageProps<"/calidad/exportar">) {
  const user = await requirePermission(["quality:read", "export"]);
  const sp = await props.searchParams;
  const today = todayAR();
  const pick = (v: string | string[] | undefined, fallback: string) =>
    typeof v === "string" && ISO.test(v) ? v : fallback;
  const from = pick(sp.desde, `${today.slice(0, 7)}-01`);
  const to = pick(sp.hasta, today);
  const month = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : from.slice(0, 7);

  const href = (kind: ReportKind, formato: "pdf" | "xlsx") => {
    const qs = new URLSearchParams({ desde: from, hasta: to, formato });
    if (kind === "limpieza") qs.set("mes", month);
    return `/api/calidad/export/${kind}?${qs}` as Route;
  };
  const allowed = REPORT_KINDS.filter((k) => can(user.role, "export") && can(user.role, READ[k]));
  // RF-36: quién exportó qué y cuándo (las exportaciones de esta pantalla).
  const recent = await listExportLog(db, {
    kinds: REPORT_KINDS.flatMap((k) => [`${k}_pdf`, `${k}_xlsx`]),
    limit: 15,
  });

  return (
    <>
      <PageHeader
        title="Exportar registros para ASSAL"
        description="PDF con el mismo formato que las planillas en papel (encabezado, código, firmas) y Excel para trabajar los datos (RF-36)."
      />
      <form className="mb-6 flex flex-wrap items-end gap-4" action="/calidad/exportar">
        <Field className="w-44">
          <FieldLabel htmlFor="desde">Desde</FieldLabel>
          <Input id="desde" name="desde" type="date" defaultValue={from} />
        </Field>
        <Field className="w-44">
          <FieldLabel htmlFor="hasta">Hasta</FieldLabel>
          <Input id="hasta" name="hasta" type="date" defaultValue={to} />
        </Field>
        <Field className="w-44">
          <FieldLabel htmlFor="mes">Mes (limpieza)</FieldLabel>
          <Input id="mes" name="mes" type="month" defaultValue={month} />
        </Field>
        <Button type="submit" variant="secondary">
          Aplicar período
        </Button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {allowed.map((k) => (
          <Card key={k} data-testid={`export-${k}`}>
            <CardHeader>
              <CardTitle className="text-base">{REPORT_LABELS[k]}</CardTitle>
              <CardDescription>{DESCRIPTION[k]}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={href(k, "pdf")}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${REPORT_LABELS[k]} en PDF`}
                >
                  <FileText /> PDF
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={href(k, "xlsx")} aria-label={`${REPORT_LABELS[k]} en Excel`}>
                  <FileSpreadsheet /> Excel
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="mt-8 grid gap-3" aria-labelledby="ultimas-exportaciones">
        <h2 id="ultimas-exportaciones" className="text-lg font-semibold">
          Últimas exportaciones
        </h2>
        <p className="text-muted-foreground text-sm">
          Queda registrado quién generó cada PDF o Excel, de qué registro y con qué período.
        </p>
        <div className="rounded-lg border">
          <Table aria-label="Últimas exportaciones">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha y hora</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>Formato</TableHead>
                <TableHead>Período</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Todavía no se exportó ningún registro.
                  </TableCell>
                </TableRow>
              ) : null}
              {recent.map((e) => {
                const [kind, format] = e.kind.split("_") as [ReportKind, string];
                const p = (e.params ?? {}) as { desde?: string; hasta?: string; mes?: string };
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTimeAR(e.createdAt)}
                    </TableCell>
                    <TableCell>{e.user ?? "—"}</TableCell>
                    <TableCell>{REPORT_LABELS[kind] ?? kind}</TableCell>
                    <TableCell>{format === "xlsx" ? "Excel" : "PDF"}</TableCell>
                    <TableCell className="tabular-nums">
                      {kind === "limpieza" && p.mes ? p.mes : `${p.desde ?? ""} a ${p.hasta ?? ""}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}
