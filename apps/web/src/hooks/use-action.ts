"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/**
 * Ejecuta una Server Action creada con `action()` desde un componente cliente.
 * Muestra toast de éxito/error y expone `fieldErrors` para pintar los campos.
 */
export function useAction<I, R>(
  fn: (input: I) => Promise<ActionResult<R>>,
  opts: { success?: string | ((data: R) => string); onSuccess?: (data: R) => void } = {},
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<R> | null>(null);

  function run(input: I): Promise<ActionResult<R>> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await fn(input);
        setResult(res);
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
        } else {
          toast.error(res.error);
        }
        resolve(res);
      });
    });
  }

  return { run, pending, result, fieldErrors: result && !result.ok ? (result.fieldErrors ?? {}) : {} };
}
