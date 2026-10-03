"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { flushQueue, onQueueChange, pendingItems } from "@/lib/offline-queue";
import "./offline-actions"; // registra todas las acciones encolables (la cola se envía desde cualquier pantalla)

/** Registra el service worker (solo producción). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

/** Indicador de registros pendientes de sincronizar + reintento automático al volver la señal. */
export function OfflineQueueIndicator() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const refresh = () => void pendingItems().then((i) => setPending(i.length));
    const sync = async () => {
      setOnline(navigator.onLine);
      const { sent, failed } = await flushQueue();
      if (sent) toast.success(`${sent} registro(s) sincronizado(s)`);
      for (const f of failed) toast.error(`No se pudo sincronizar un registro: ${f.lastError}`);
    };
    const off = () => setOnline(false);
    refresh();
    void sync();
    const unsub = onQueueChange(refresh);
    window.addEventListener("online", sync);
    window.addEventListener("offline", off);
    const timer = setInterval(sync, 30_000);
    return () => {
      unsub();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", off);
      clearInterval(timer);
    };
  }, []);

  if (online && !pending) return null;
  return (
    <span
      className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900"
      data-testid="offline-indicator"
    >
      {online ? <RefreshCw className="size-4 animate-spin" /> : <CloudOff className="size-4" />}
      {online ? `Sincronizando ${pending}` : `Sin señal${pending ? ` · ${pending} pendiente(s)` : ""}`}
    </span>
  );
}
