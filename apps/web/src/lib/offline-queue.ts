"use client";

import { createStore, del, entries, set } from "idb-keyval";
import type { ActionResult } from "@/lib/action-result";

/**
 * Cola offline para registros de planta (requisito no funcional: "si se corta la señal, guarda y
 * sincroniza después"). Las acciones encolables se registran por nombre con `registerOfflineAction`;
 * la cola guarda { name, payload } en IndexedDB y reintenta al volver la conexión.
 *
 * Contrato para el payload: incluir `clientId` (uuid generado en el cliente, para idempotencia) y
 * `recordedAt` (ISO del momento real de la carga), así la demora de sincronización no marca carga tardía.
 */
export interface QueuedItem {
  id: string;
  name: string;
  payload: unknown;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

type Runner = (payload: never) => Promise<ActionResult<unknown>>;
const registry = new Map<string, Runner>();
const store = typeof indexedDB !== "undefined" ? createStore("chipa-offline", "queue") : undefined;
const listeners = new Set<() => void>();

export function registerOfflineAction(name: string, fn: Runner) {
  registry.set(name, fn);
}

export function onQueueChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const notify = () => listeners.forEach((l) => l());

export async function pendingItems(): Promise<QueuedItem[]> {
  if (!store) return [];
  return (await entries<string, QueuedItem>(store))
    .map(([, v]) => v)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function enqueue(name: string, payload: unknown) {
  if (!store) throw new Error("IndexedDB no disponible");
  const item: QueuedItem = {
    id: crypto.randomUUID(),
    name,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await set(item.id, item, store);
  notify();
  return item;
}

let flushing = false;
/** Envía la cola en orden. Los errores de negocio (ok:false) se descartan y se informan; los de red se reintentan. */
export async function flushQueue(): Promise<{ sent: number; failed: QueuedItem[] }> {
  if (!store || flushing || (typeof navigator !== "undefined" && !navigator.onLine))
    return { sent: 0, failed: [] };
  flushing = true;
  let sent = 0;
  const failed: QueuedItem[] = [];
  try {
    for (const item of await pendingItems()) {
      const fn = registry.get(item.name);
      if (!fn) continue; // la pantalla que la registra todavía no se cargó
      try {
        const res = await fn(item.payload as never);
        await del(item.id, store);
        if (res.ok) sent++;
        else failed.push({ ...item, lastError: res.error });
      } catch (e) {
        await set(item.id, { ...item, attempts: item.attempts + 1, lastError: String(e) }, store);
        break; // sigue sin red: reintentar más tarde
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return { sent, failed };
}

/** true si el error es de red (no llegó al servidor). */
export function isNetworkError(e: unknown) {
  return e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
}
