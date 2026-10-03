"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { recordBackdatedTemperatureAction } from "../actions";

/** Carga de una lectura de un día pasado (jefa/dirección): queda como carga tardía. */
export function BackdatedTemperature({
  equipment,
  today,
}: {
  equipment: { id: string; code: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [equipmentId, setEquipmentId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [value, setValue] = useState("");
  const [action, setAction] = useState("");
  const save = useAction(recordBackdatedTemperatureAction, {
    success: "Lectura cargada (carga tardía)",
    onSuccess: () => {
      setOpen(false);
      setValue("");
      setAction("");
      router.refresh();
    },
  });
  const fe = save.fieldErrors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <History /> Cargar lectura de un día pasado
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cargar temperatura de un día pasado</DialogTitle>
          <DialogDescription>
            Queda marcada como carga tardía, con tu usuario. Si está fuera de rango, la acción correctiva es
            obligatoria.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2" data-invalid={!!fe.equipmentId}>
            <FieldLabel htmlFor="bt-equipment">Equipo</FieldLabel>
            <Select value={equipmentId} onValueChange={setEquipmentId}>
              <SelectTrigger id="bt-equipment" className="w-full">
                <SelectValue placeholder="Elegí el equipo" />
              </SelectTrigger>
              <SelectContent>
                {equipment.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{fe.equipmentId?.[0]}</FieldError>
          </Field>
          <Field data-invalid={!!fe.date}>
            <FieldLabel htmlFor="bt-date">Día</FieldLabel>
            <Input
              id="bt-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <FieldError>{fe.date?.[0]}</FieldError>
          </Field>
          <Field data-invalid={!!fe.time}>
            <FieldLabel htmlFor="bt-time">Hora</FieldLabel>
            <Input id="bt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <FieldError>{fe.time?.[0]}</FieldError>
          </Field>
          <Field data-invalid={!!fe.valueC}>
            <FieldLabel htmlFor="bt-value">Temperatura (°C)</FieldLabel>
            <Input
              id="bt-value"
              inputMode="decimal"
              placeholder="-20,5"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <FieldError>{fe.valueC?.[0]}</FieldError>
          </Field>
          <Field data-invalid={!!fe.correctiveAction}>
            <FieldLabel htmlFor="bt-action">Acción correctiva</FieldLabel>
            <Input id="bt-action" value={action} onChange={(e) => setAction(e.target.value)} />
            <FieldError>{fe.correctiveAction?.[0]}</FieldError>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={save.pending}
            onClick={() =>
              void save.run({
                clientId: crypto.randomUUID(),
                equipmentId,
                date,
                time,
                valueC: value,
                correctiveAction: action.trim() || null,
              })
            }
          >
            Guardar lectura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
