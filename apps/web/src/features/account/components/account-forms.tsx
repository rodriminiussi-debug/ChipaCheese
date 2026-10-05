"use client";

import { useState } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { changePasswordAction, changePinAction } from "../actions";

function Field({
  id,
  label,
  value,
  onChange,
  error,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
} & Pick<React.ComponentProps<"input">, "type" | "inputMode" | "autoComplete" | "maxLength">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="h-11 text-base"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        {...rest}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [v, setV] = useState({ current: "", password: "", confirm: "" });
  const act = useAction(changePasswordAction, {
    success: (r) =>
      r.closedSessions
        ? `Contraseña cambiada. Se cerraron ${r.closedSessions} sesión(es) en otros equipos.`
        : "Contraseña cambiada",
    onSuccess: () => setV({ current: "", password: "", confirm: "" }),
  });
  const e = (k: string) => act.fieldErrors[k]?.[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LockKeyhole className="size-4" /> Cambiar mi contraseña
        </CardTitle>
        <CardDescription>
          Mínimo 8 caracteres. Se cierran tus sesiones en otros equipos.
          {hasPassword ? "" : " Todavía no tenés contraseña: para crearla ingresá tu PIN actual."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:max-w-md">
        <Field
          id="pw-current"
          label={hasPassword ? "Contraseña actual" : "PIN actual"}
          type="password"
          autoComplete="current-password"
          value={v.current}
          onChange={(x) => setV({ ...v, current: x })}
          error={e("current")}
        />
        <Field
          id="pw-new"
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          value={v.password}
          onChange={(x) => setV({ ...v, password: x })}
          error={e("password")}
        />
        <Field
          id="pw-confirm"
          label="Repetí la contraseña nueva"
          type="password"
          autoComplete="new-password"
          value={v.confirm}
          onChange={(x) => setV({ ...v, confirm: x })}
          error={e("confirm")}
        />
        <Button className="h-11 w-fit" disabled={act.pending} onClick={() => act.run(v)}>
          Cambiar contraseña
        </Button>
      </CardContent>
    </Card>
  );
}

export function ChangePinForm() {
  const [v, setV] = useState({ current: "", pin: "", confirm: "" });
  const act = useAction(changePinAction, {
    success: "PIN cambiado",
    onSuccess: () => setV({ current: "", pin: "", confirm: "" }),
  });
  const e = (k: string) => act.fieldErrors[k]?.[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> Cambiar mi PIN
        </CardTitle>
        <CardDescription>De 4 a 6 dígitos. Es el que usás para entrar rápido en la tablet.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:max-w-md">
        <Field
          id="pin-current"
          label="Contraseña o PIN actual"
          type="password"
          autoComplete="off"
          value={v.current}
          onChange={(x) => setV({ ...v, current: x })}
          error={e("current")}
        />
        <Field
          id="pin-new"
          label="PIN nuevo"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="off"
          value={v.pin}
          onChange={(x) => setV({ ...v, pin: x })}
          error={e("pin")}
        />
        <Field
          id="pin-confirm"
          label="Repetí el PIN nuevo"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="off"
          value={v.confirm}
          onChange={(x) => setV({ ...v, confirm: x })}
          error={e("confirm")}
        />
        <Button className="h-11 w-fit" disabled={act.pending} onClick={() => act.run(v)}>
          Cambiar PIN
        </Button>
      </CardContent>
    </Card>
  );
}
