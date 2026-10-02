"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ROLE_LABELS, ROLES } from "@/lib/rbac";
import { userInput, type UserData, type UserInput } from "../schemas";
import { createUserAction, updateUserAction } from "../actions";

export function UserForm({ initial }: { initial?: UserInput & { id: string } }) {
  const router = useRouter();
  const form = useForm<UserInput, unknown, UserData>({
    resolver: zodResolver(userInput),
    defaultValues: initial ?? { name: "", initials: "", username: "", role: "operator", active: true },
  });
  const create = useAction(createUserAction, {
    success: "Usuario creado",
    onSuccess: () => router.push("/admin"),
  });
  const update = useAction(updateUserAction, {
    success: "Cambios guardados",
    onSuccess: () => router.push("/admin"),
  });
  const serverErrors = initial ? update.fieldErrors : create.fieldErrors;
  const err = (n: keyof UserInput) => form.formState.errors[n]?.message ?? serverErrors[n]?.[0];

  return (
    <form
      noValidate
      className="grid max-w-2xl gap-6"
      onSubmit={form.handleSubmit((d) => (initial ? update.run({ ...d, id: initial.id }) : create.run(d)))}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!err("name")}>
          <FieldLabel htmlFor="name">Nombre *</FieldLabel>
          <Input id="name" {...form.register("name")} />
          <FieldError>{err("name")}</FieldError>
        </Field>
        <Field data-invalid={!!err("initials")}>
          <FieldLabel htmlFor="initials">Iniciales (planillas BPM) *</FieldLabel>
          <Input id="initials" placeholder="J.T." {...form.register("initials")} />
          <FieldError>{err("initials")}</FieldError>
        </Field>
        <Field data-invalid={!!err("username")}>
          <FieldLabel htmlFor="username">Usuario *</FieldLabel>
          <Input id="username" autoCapitalize="none" {...form.register("username")} />
          <FieldError>{err("username")}</FieldError>
        </Field>
        <Field data-invalid={!!err("email")}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" {...form.register("email")} />
          <FieldError>{err("email")}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="role">Rol *</FieldLabel>
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field orientation="horizontal" className="self-end">
          <Controller
            control={form.control}
            name="active"
            render={({ field }) => (
              <Switch id="active" checked={field.value ?? true} onCheckedChange={field.onChange} />
            )}
          />
          <FieldLabel htmlFor="active">Activo</FieldLabel>
        </Field>
        <Field data-invalid={!!err("password")}>
          <FieldLabel htmlFor="password">Contraseña</FieldLabel>
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
          <FieldDescription>
            {initial ? "Vacío = no se cambia." : "Para ingresar desde PC o celular."}
          </FieldDescription>
          <FieldError>{err("password")}</FieldError>
        </Field>
        <Field data-invalid={!!err("pin")}>
          <FieldLabel htmlFor="pin">PIN de tablet</FieldLabel>
          <Input id="pin" inputMode="numeric" autoComplete="off" maxLength={6} {...form.register("pin")} />
          <FieldDescription>
            {initial ? "Vacío = no se cambia." : "4 a 6 dígitos, para la tablet de planta."}
          </FieldDescription>
          <FieldError>{err("pin")}</FieldError>
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.pending || update.pending}>
          {initial ? "Guardar cambios" : "Crear usuario"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
