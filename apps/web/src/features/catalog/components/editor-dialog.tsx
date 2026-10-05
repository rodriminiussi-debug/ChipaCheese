"use client";

import type { ReactNode } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/** Diálogo de alta/edición de los maestros chicos del catálogo. */
export function EditorDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Interruptor con su etiqueta (activo, refrigerado, con equipo de frío…). */
export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  hint?: string;
}) {
  const id = `sw-${name}`;
  return (
    <Field orientation="horizontal">
      <Controller
        control={control}
        name={name}
        render={({ field }) => <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />}
      />
      <div>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
    </Field>
  );
}
