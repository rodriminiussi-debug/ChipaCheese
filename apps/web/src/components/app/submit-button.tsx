"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Botón de submit que se deshabilita mientras la Server Action corre. */
export function SubmitButton({
  children,
  pending: pendingProp,
  ...props
}: ComponentProps<typeof Button> & { pending?: boolean }) {
  const { pending } = useFormStatus();
  const busy = pendingProp ?? pending;
  return (
    <Button type="submit" disabled={busy || props.disabled} {...props}>
      {busy ? <Spinner /> : null}
      {children}
    </Button>
  );
}
