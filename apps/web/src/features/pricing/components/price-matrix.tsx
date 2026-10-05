"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, History, Pencil, Wand2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatARS, marginPct as calcMargin, parseDecimalAR } from "@chipa/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateText, Money, Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { CHANNEL, PRODUCT_KIND } from "@/lib/labels";
import { applySuggestedPricesAction, setPriceAction, updateTargetMarginAction } from "../actions";
import { PRICE_STATUS } from "../labels";
import { setPriceInput, targetMarginInput, type SetPriceData, type SetPriceInput } from "../schemas";
import type { PriceListView, PriceRow } from "../service";

/** RF-29: precios por lista (canal) con costo, margen y precio sugerido. */
export function PriceMatrix({
  lists,
  today,
  canEdit,
}: {
  lists: PriceListView[];
  today: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<{ list: PriceListView; row: PriceRow } | null>(null);
  const [history, setHistory] = useState<PriceRow | null>(null);
  if (lists.length === 0)
    return <p className="text-muted-foreground text-sm">No hay listas de precios activas.</p>;

  return (
    <>
      <Tabs defaultValue={lists[0]!.id} className="min-w-0">
        <TabsList className="h-auto flex-wrap">
          {lists.map((l) => (
            <TabsTrigger key={l.id} value={l.id}>
              {l.name}
              {l.belowCost + l.belowTarget > 0 ? (
                <span className="bg-destructive ml-1 inline-block size-2 rounded-full" aria-hidden />
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {lists.map((l) => (
          <TabsContent key={l.id} value={l.id} className="mt-4 grid min-w-0 gap-4 [&>*]:min-w-0">
            <ListPanel
              list={l}
              canEdit={canEdit}
              onEdit={(row) => setEditing({ list: l, row })}
              onHistory={setHistory}
            />
          </TabsContent>
        ))}
      </Tabs>
      {editing ? (
        <EditPriceDialog
          key={`${editing.list.id}-${editing.row.productId}`}
          list={editing.list}
          row={editing.row}
          today={today}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <HistoryDialog row={history} onClose={() => setHistory(null)} />
    </>
  );
}

function ListPanel({
  list,
  canEdit,
  onEdit,
  onHistory,
}: {
  list: PriceListView;
  canEdit: boolean;
  onEdit: (row: PriceRow) => void;
  onHistory: (row: PriceRow) => void;
}) {
  const belowCost = list.rows.filter((r) => r.status === "below_cost");
  const suggestable = list.rows.filter(
    (r) =>
      (r.status === "below_target" || r.status === "below_cost") &&
      r.suggestedPrice != null &&
      r.price != null &&
      r.suggestedPrice > r.price,
  );
  return (
    <>
      {belowCost.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Precio por debajo del costo</AlertTitle>
          <AlertDescription>
            En esta lista se vende a pérdida: {belowCost.map((r) => r.name).join(", ")}.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-muted-foreground text-sm">
          Canal: {CHANNEL[list.channel] ?? list.channel}
          {list.belowTarget + list.belowCost > 0 ? (
            <>
              {" · "}
              <span className="text-destructive font-medium">
                {list.belowTarget + list.belowCost} producto(s) bajo el margen objetivo
              </span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {canEdit ? (
            <TargetMarginForm list={list} />
          ) : (
            <div className="text-sm">
              Margen objetivo:{" "}
              <strong>
                <Num value={list.targetMarginPct} decimals={1} suffix="%" />
              </strong>
            </div>
          )}
          {canEdit && suggestable.length > 0 ? <ApplySuggested list={list} rows={suggestable} /> : null}
        </div>
      </div>

      <div className="rounded-lg border">
        <Table aria-label={`Precios de ${list.name}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Precio vigente</TableHead>
              <TableHead className="hidden text-right md:table-cell">Costo directo</TableHead>
              <TableHead className="text-right">Margen</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Margen por unidad</TableHead>
              <TableHead className="hidden text-right md:table-cell">Sugerido</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.rows.map((r) => (
              <PriceRowView key={r.productId} r={r} canEdit={canEdit} onEdit={onEdit} onHistory={onHistory} />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function PriceRowView({
  r,
  canEdit,
  onEdit,
  onHistory,
}: {
  r: PriceRow;
  canEdit: boolean;
  onEdit: (row: PriceRow) => void;
  onHistory: (row: PriceRow) => void;
}) {
  const status = PRICE_STATUS[r.status];
  const bad = r.status === "below_target" || r.status === "below_cost";
  return (
    <TableRow data-status={r.status}>
      <TableCell>
        <div className="font-medium">{r.name}</div>
        <div className="text-muted-foreground text-xs">
          {r.code}
          {r.kind !== "manufactured" ? ` · ${PRODUCT_KIND[r.kind]?.label ?? r.kind}` : ""}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Money value={r.price} />
        {r.validFrom ? (
          <div className="text-muted-foreground text-xs">
            desde <DateText value={r.validFrom} />
          </div>
        ) : null}
        {r.upcoming ? (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            <DateText value={r.upcoming.validFrom} />: <Money value={r.upcoming.unitPrice} />
          </div>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-right md:table-cell">
        {r.cost != null ? (
          <Money value={r.cost} />
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-400" title={r.missingPrices.join(", ")}>
            Precio faltante
          </span>
        )}
      </TableCell>
      <TableCell className={bad ? "text-destructive text-right font-semibold" : "text-right"}>
        <Num value={r.marginPct} decimals={1} suffix="%" />
      </TableCell>
      <TableCell className="hidden text-right lg:table-cell">
        <Money value={r.marginPerUnit} />
      </TableCell>
      <TableCell className="hidden text-right md:table-cell">
        <Money value={r.suggestedPrice} />
      </TableCell>
      <TableCell>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Historial de precios de ${r.name}`}
            onClick={() => onHistory(r)}
          >
            <History />
          </Button>
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Editar precio de ${r.name}`}
              onClick={() => onEdit(r)}
            >
              <Pencil />
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function TargetMarginForm({ list }: { list: PriceListView }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(targetMarginInput),
    defaultValues: { priceListId: list.id, targetMarginPct: String(list.targetMarginPct).replace(".", ",") },
  });
  const act = useAction(updateTargetMarginAction, {
    success: "Margen objetivo actualizado",
    onSuccess: () => router.refresh(),
  });
  const err = form.formState.errors.targetMarginPct?.message ?? act.fieldErrors.targetMarginPct?.[0];
  return (
    <form onSubmit={form.handleSubmit((d) => act.run(d))} className="flex items-end gap-2" noValidate>
      <Field data-invalid={!!err} className="w-40">
        <FieldLabel htmlFor={`target-${list.id}`}>Margen objetivo (%)</FieldLabel>
        <Input id={`target-${list.id}`} inputMode="decimal" {...form.register("targetMarginPct")} />
        <FieldError>{err}</FieldError>
      </Field>
      <Button type="submit" variant="outline" disabled={act.pending}>
        Guardar margen
      </Button>
    </form>
  );
}

function ApplySuggested({ list, rows }: { list: PriceListView; rows: PriceRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const act = useAction(applySuggestedPricesAction, {
    success: (r) => `${r.changes.length} precio(s) actualizado(s) al sugerido`,
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Wand2 /> Aplicar precios sugeridos ({rows.length})
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aplicar los precios sugeridos?</AlertDialogTitle>
            <AlertDialogDescription>
              Se carga un precio nuevo desde hoy en «{list.name}» para llevar cada producto a su margen
              objetivo ({list.targetMarginPct}%). El historial de precios se conserva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-1 text-sm" aria-label="Cambios de precio">
            {rows.map((r) => (
              <li key={r.productId} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="tabular-nums">
                  {formatARS(r.price!)} → <strong>{formatARS(r.suggestedPrice!)}</strong>
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={act.pending}
              onClick={(e) => {
                e.preventDefault();
                act.run({ priceListId: list.id, productIds: rows.map((r) => r.productId), validFrom: null });
              }}
            >
              Aplicar precios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditPriceDialog({
  list,
  row,
  today,
  onClose,
}: {
  list: PriceListView;
  row: PriceRow;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const form = useForm<SetPriceInput, unknown, SetPriceData>({
    resolver: zodResolver(setPriceInput),
    defaultValues: {
      priceListId: list.id,
      productId: row.productId,
      unitPrice: row.price != null ? String(row.price).replace(".", ",") : "",
      validFrom: today,
    },
  });
  const act = useAction(setPriceAction, {
    success: "Precio actualizado",
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const err = (n: keyof SetPriceInput) => form.formState.errors[n]?.message ?? act.fieldErrors[n]?.[0];
  const raw = useWatch({ control: form.control, name: "unitPrice" });
  const price = typeof raw === "number" ? raw : parseDecimalAR(String(raw ?? ""));
  const margin = price != null && price > 0 && row.cost != null ? calcMargin(price, row.cost) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar precio</DialogTitle>
          <DialogDescription>
            {row.name} · {list.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((d) => act.run(d))} className="grid gap-4" noValidate>
          <FieldGroup className="grid gap-4">
            <Field data-invalid={!!err("unitPrice")}>
              <FieldLabel htmlFor="edit-price">Precio de venta</FieldLabel>
              <Input id="edit-price" inputMode="decimal" autoFocus {...form.register("unitPrice")} />
              <FieldError>{err("unitPrice")}</FieldError>
            </Field>
            <Field data-invalid={!!err("validFrom")}>
              <FieldLabel htmlFor="edit-valid-from">Vigente desde</FieldLabel>
              <Input id="edit-valid-from" type="date" min={today} {...form.register("validFrom")} />
              <FieldError>{err("validFrom")}</FieldError>
            </Field>
          </FieldGroup>
          <div role="status" className="bg-muted rounded-md p-3 text-sm" data-testid="price-preview">
            {row.cost == null ? (
              <>Costo directo no disponible: falta el precio de {row.missingPrices.join(", ")}.</>
            ) : margin == null ? (
              <>Costo directo: {formatARS(row.cost)}.</>
            ) : (
              <>
                Costo directo {formatARS(row.cost)} · margen{" "}
                <strong className={margin < list.targetMarginPct ? "text-destructive" : undefined}>
                  {margin.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                </strong>{" "}
                (objetivo {list.targetMarginPct}%)
                {price != null && price < row.cost ? " — por debajo del costo" : ""}
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={act.pending}>
              Guardar precio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: PriceRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Historial de precios</DialogTitle>
          <DialogDescription>{row?.name}</DialogDescription>
        </DialogHeader>
        {row && row.history.length > 0 ? (
          <Table aria-label="Historial de precios">
            <TableHeader>
              <TableRow>
                <TableHead>Vigente desde</TableHead>
                <TableHead className="text-right">Precio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.history.map((h) => (
                <TableRow key={h.validFrom}>
                  <TableCell>
                    <DateText value={h.validFrom} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={h.unitPrice} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">Todavía no tiene precios cargados.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
