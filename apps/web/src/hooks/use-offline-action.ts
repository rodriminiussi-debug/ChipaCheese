"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import {
  enqueue,
  isNetworkError,
  onQueueChange,
  pendingItems,
  registerOfflineAction,
  type QueuedItem,
} from "@/lib/offline-queue";

/**
 * Como useAction, pero si no hay señal encola el registro y lo envía después (modo planta y celular).
 * `name` debe ser único y estable (p. ej. "quality.temperature") y estar registrado en
 * `src/components/pwa/offline-actions.ts`, así la cola se envía aunque la pantalla ya no esté abierta.
 * El payload debe incluir `clientId` (uuid) y `recordedAt` (ISO): ver `src/lib/offline-queue.ts`.
 */
export function useOfflineAction<I, R>(
  name: string,
  fn: (input: I) => Promise<ActionResult<R>>,
  opts: {
    success?: string | ((data: R) => string);
    onSuccess?: (data: R | null, queued: boolean) => void;
  } = {},
) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  useEffect(() => registerOfflineAction(name, fn as never), [name, fn]);

  function run(input: I) {
    startTransition(async () => {
      const queue = async () => {
        await enqueue(name, input);
        setFieldErrors({});
        toast.info("Sin señal: quedó guardado en este equipo y se envía al volver la conexión.");
        opts.onSuccess?.(null, true);
      };
      if (typeof navigator !== "undefined" && !navigator.onLine) return queue();
      try {
        const res = await fn(input);
        if (res.ok) {
          setFieldErrors({});
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data, false);
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          toast.error(res.error);
        }
      } catch (e) {
        if (isNetworkError(e)) return queue();
        throw e;
      }
    });
  }
  return { run, pending, fieldErrors };
}

/**
 * Registros de la cola offline con ese nombre (los "pendientes de enviar"), actualizados en vivo.
 * Sirve para mostrar en la pantalla lo que todavía no llegó al servidor.
 */
export function useQueuedItems<P = unknown>(name: string) {
  const [items, setItems] = useState<(QueuedItem & { payload: P })[]>([]);
  useEffect(() => {
    const refresh = () =>
      void pendingItems().then((all) =>
        setItems(all.filter((i) => i.name === name) as (QueuedItem & { payload: P })[]),
      );
    refresh();
    const off = onQueueChange(refresh);
    return () => void off();
  }, [name]);
  return items;
}
