"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/format";
import { NativeSelect } from "@/components/app/native-select";
import { StatusBadge } from "@/components/app/status-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import {
  copyFixedExpensesAction,
  createFixedExpenseAction,
  deleteFixedExpenseAction,
  updateFixedExpenseAction,
} from "../actions";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY } from "../labels";
import { fixedExpenseInput, type FixedExpenseData, type FixedExpenseInput } from "../schemas";
import type { FixedExpenseRow } from "../service";
import { monthLabel } from "../format";

type Editing = { mode: "create" } | { mode: "edit"; row: FixedExpenseRow } | null;

/** RF-42 · Tabla de gastos fijos del mes con alta, edición, baja y "copiar del mes anterior". */
export function ExpenseManager({
  month,
  rows,
  total,
  canWrite,
}: {
  month: string;
  rows: FixedExpenseRow[];
  total: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<FixedExpenseRow | null>(null);

  const copy = useAction(copyFixedExpensesAction, {
    success: (r) =>
      r.copied > 0
        ? `Se copiaron ${r.copied} gasto(s) de ${monthLabel(r.from)}`
        : "Ya estaban todos los gastos del mes anterior",
    onSuccess: () => router.refresh(),
  });
  const remove = useAction(deleteFixedExpenseAction, {
    success: "Gasto eliminado",
    onSuccess: () => {
      setDeleting(null);
      router.refresh();
    },
  });

  return (
    <section aria-label="Gastos del mes" className="grid gap-3">
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing({ mode: "create" })}>
            <Plus /> Agregar gasto
          </Button>
          <Button variant="outline" disabled={copy.pending} onClick={() => copy.run({ month })}>
            <CopyPlus /> Copiar del mes anterior
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={`Todavía no hay gastos cargados en ${monthLabel(month)}`}
          description={
            canWrite
              ? "Copiá los del mes anterior y ajustá lo que cambió, o agregalos uno por uno."
              : "Dirección los carga una vez por mes."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label={`Gastos fijos de ${monthLabel(month)}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="hidden md:table-cell">Notas</TableHead>
                {canWrite ? <TableHead className="w-24 text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.concept}</TableCell>
                  <TableCell>
                    <StatusBadge>{EXPENSE_CATEGORY[r.category] ?? r.category}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.amount} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">{r.notes}</TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${r.concept}`}
                        onClick={() => setEditing({ mode: "edit", row: r })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Eliminar ${r.concept}`}
                        onClick={() => setDeleting(r)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total del mes</TableCell>
                <TableCell />
                <TableCell className="text-right font-medium" data-testid="expenses-total">
                  <Money value={total} />
                </TableCell>
                <TableCell className="hidden md:table-cell" />
                {canWrite ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {editing ? (
        <ExpenseDialog
          key={editing.mode === "edit" ? editing.row.id : "new"}
          month={month}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {deleting?.concept}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quita de {monthLabel(month)} y el resultado del mes se recalcula. Los otros meses no cambian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.pending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.run({ id: deleting.id });
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ExpenseDialog({
  month,
  editing,
  onClose,
}: {
  month: string;
  editing: NonNullable<Editing>;
  onClose: () => void;
}) {
  const router = useRouter();
  const row = editing.mode === "edit" ? editing.row : null;
  const form = useForm<FixedExpenseInput, unknown, FixedExpenseData>({
    resolver: zodResolver(fixedExpenseInput),
    defaultValues: {
      month,
      concept: row?.concept ?? "",
      category: (row?.category as FixedExpenseInput["category"]) ?? "services",
      amount: row ? String(row.amount).replace(".", ",") : "",
      notes: row?.notes ?? "",
    },
  });
  const done = () => {
    onClose();
    router.refresh();
  };
  const create = useAction(createFixedExpenseAction, { success: "Gasto agregado", onSuccess: done });
  const update = useAction(updateFixedExpenseAction, { success: "Gasto actualizado", onSuccess: done });
  const pending = create.pending || update.pending;
  const serverErrors = row ? update.fieldErrors : create.fieldErrors;
  const err = (name: keyof FixedExpenseInput) =>
    form.formState.errors[name]?.message ?? serverErrors[name]?.[0];

  const submit = form.handleSubmit((data) =>
    row
      ? update.run({
          id: row.id,
          concept: data.concept,
          category: data.category,
          amount: data.amount,
          notes: data.notes,
        })
      : create.run(data),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? `Editar ${row.concept}` : "Agregar gasto"}</DialogTitle>
          <DialogDescription>{monthLabel(month)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <FieldGroup>
            <Field data-invalid={!!err("concept")}>
              <FieldLabel htmlFor="expense-concept">Concepto</FieldLabel>
              <Input id="expense-concept" {...form.register("concept")} />
              <FieldError>{err("concept")}</FieldError>
            </Field>
            <Field data-invalid={!!err("category")}>
              <FieldLabel htmlFor="expense-category">Categoría</FieldLabel>
              <NativeSelect id="expense-category" {...form.register("category")}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY[c]}
                  </option>
                ))}
              </NativeSelect>
              <FieldError>{err("category")}</FieldError>
            </Field>
            <Field data-invalid={!!err("amount")}>
              <FieldLabel htmlFor="expense-amount">Importe del mes</FieldLabel>
              <Input id="expense-amount" inputMode="decimal" placeholder="0" {...form.register("amount")} />
              <FieldError>{err("amount")}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="expense-notes">Notas</FieldLabel>
              <Input id="expense-notes" {...form.register("notes")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Guardar gasto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
