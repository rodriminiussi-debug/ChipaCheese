"use client";

import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import { enqueue, isNetworkError, registerOfflineAction } from "@/lib/offline-queue";

/**
 * Como useAction, pero si no hay señal encola el registro y lo envía después (modo planta).
 * `name` debe ser único y estable (p. ej. "quality.temperature").
 */
export function useOfflineAction<I, R>(
  name: string,
  fn: (input: I) => Promise<ActionResult<R>>,
  opts: { success?: string; onSuccess?: (data: R | null, queued: boolean) => void } = {},
) {
  const [pending, startTransition] = useTransition();
  useEffect(() => registerOfflineAction(name, fn as never), [name, fn]);

  function run(input: I) {
    startTransition(async () => {
      const queue = async () => {
        await enqueue(name, input);
        toast.info("Sin señal: quedó guardado en la tablet y se envía al volver la conexión.");
        opts.onSuccess?.(null, true);
      };
      if (typeof navigator !== "undefined" && !navigator.onLine) return queue();
      try {
        const res = await fn(input);
        if (res.ok) {
          if (opts.success) toast.success(opts.success);
          opts.onSuccess?.(res.data, false);
        } else toast.error(res.error);
      } catch (e) {
        if (isNetworkError(e)) return queue();
        throw e;
      }
    });
  }
  return { run, pending };
}
