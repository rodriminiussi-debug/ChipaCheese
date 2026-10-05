"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateText, Money } from "@/components/app/format";
import { StatusBadge, type Tone } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { importArcaAction, previewArcaAction } from "../actions";
import type { ArcaPreview, ArcaRowStatus } from "../arca-service";

const STATUS: Record<ArcaRowStatus, { label: string; tone: Tone }> = {
  new: { label: "Nueva", tone: "good" },
  duplicate: { label: "Ya cargada", tone: "neutral" },
  no_customer: { label: "Sin cliente", tone: "bad" },
  unsupported: { label: "No soportada", tone: "warn" },
  found: { label: "Encontrada", tone: "good" },
  missing: { label: "Falta cargar", tone: "bad" },
  difference: { label: "Diferencia de importe", tone: "warn" },
};

/** RF-32: subir el CSV de "Mis Comprobantes", ver la vista previa e importar (emitidos) o conciliar (recibidos). */
export function ArcaImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"issued" | "received">("issued");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ArcaPreview | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [link, setLink] = useState<{ linked: number; ambiguous: number } | null>(null);

  const previewAct = useAction(previewArcaAction, { onSuccess: (p) => setPreview(p) });
  const importAct = useAction(importArcaAction, {
    success: (r) =>
      r.kind === "issued" ? `${r.imported} comprobante(s) importado(s)` : "Conciliación lista",
    onSuccess: (r) => {
      setPreview(r);
      setImported(r.imported);
      setLink({ linked: r.linked, ambiguous: r.ambiguous });
      router.refresh();
    },
  });

  function formData() {
    const fd = new FormData();
    fd.set("kind", kind);
    if (file) fd.set("file", file);
    return fd;
  }

  const s = preview?.summary;
  return (
    <div className="grid gap-6">
      <div className="grid max-w-2xl gap-4 sm:grid-cols-[200px_1fr]">
        <Field>
          <FieldLabel htmlFor="arca-kind">Tipo de archivo</FieldLabel>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as "issued" | "received");
              setPreview(null);
              setImported(null);
            }}
          >
            <SelectTrigger id="arca-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="issued">Comprobantes emitidos</SelectItem>
              <SelectItem value="received">Comprobantes recibidos</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="arca-file">Archivo CSV de «Mis Comprobantes»</FieldLabel>
          <Input
            id="arca-file"
            ref={input}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setImported(null);
            }}
          />
        </Field>
      </div>
      <p className="text-muted-foreground -mt-3 max-w-2xl text-sm">
        {kind === "issued"
          ? "Los emitidos se cargan como facturas (origen ARCA, con CAE) y se asignan al cliente por CUIT. Lo que ya está cargado no se duplica."
          : "Los recibidos solo se concilian contra las facturas de compra cargadas: no se crea ninguna compra."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!file || previewAct.pending} onClick={() => file && previewAct.run(formData())}>
          <FileUp /> Vista previa
        </Button>
        {preview && kind === "issued" && s && s.new > 0 && imported == null ? (
          <Button variant="secondary" disabled={importAct.pending} onClick={() => importAct.run(formData())}>
            Importar {s.new} comprobante(s)
          </Button>
        ) : null}
      </div>

      {preview && s ? (
        <section className="grid gap-4" aria-label="Resultado">
          {imported != null && preview.kind === "issued" ? (
            <Alert>
              <AlertTitle>Importación terminada</AlertTitle>
              <AlertDescription>
                Se importaron {imported} comprobante(s). Importar de nuevo el mismo archivo no duplica nada.
                {link?.linked
                  ? ` ${link.linked} se vincularon solos a su pedido entregado (pasaron a "Facturado").`
                  : ""}
                {link?.ambiguous
                  ? ` ${link.ambiguous} tienen más de un pedido posible: vinculalos desde la cuenta del cliente.`
                  : ""}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2" data-testid="arca-summary">
            {(Object.keys(STATUS) as ArcaRowStatus[])
              .filter((k) => s[k] > 0)
              .map((k) => (
                <StatusBadge key={k} tone={STATUS[k].tone}>
                  {STATUS[k].label}: {s[k]}
                </StatusBadge>
              ))}
            {s.invalid > 0 ? <StatusBadge tone="bad">Filas con errores: {s.invalid}</StatusBadge> : null}
          </div>

          {preview.unmatched.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>
                {preview.kind === "issued"
                  ? "Comprobantes sin cliente"
                  : "Facturas de proveedores no registrados"}
              </AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-5">
                  {preview.unmatched.map((u) => (
                    <li key={u.docNumber}>
                      {u.name || "Sin nombre"} (CUIT {u.docNumber}): {u.count} comprobante(s),{" "}
                      <Money value={u.total} />
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  {preview.kind === "issued"
                    ? "Cargá el CUIT en la ficha del cliente (o creá el cliente) y volvé a importar."
                    : "Cargá el CUIT del proveedor en su ficha para poder conciliar."}
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          {preview.errors.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Filas que no se pudieron leer</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-5">
                  {preview.errors.slice(0, 10).map((e) => (
                    <li key={e.line}>
                      Línea {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-lg border">
            <Table aria-label="Comprobantes del archivo">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Comprobante</TableHead>
                  <TableHead>{preview.kind === "issued" ? "Cliente" : "Proveedor"}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.line}>
                    <TableCell>
                      <DateText value={r.date} />
                    </TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell>
                      <div>{r.partyName ?? r.name}</div>
                      <div className="text-muted-foreground text-xs">CUIT {r.docNumber || "—"}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={r.total} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusBadge>
                      {r.detail ? <div className="text-muted-foreground mt-1 text-xs">{r.detail}</div> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
