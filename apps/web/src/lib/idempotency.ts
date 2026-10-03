import { createHash } from "node:crypto";

/**
 * Utilidades de idempotencia para los registros que se cargan sin señal (cola offline, ver
 * `src/lib/offline-queue.ts`). Solo servidor.
 */

/** Tolerancia por el reloj de la tablet/celular: un instante más de 5 min en el futuro se corrige a "ahora". */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Momento real de una carga hecha sin señal, acotado a "ahora": la demora de sincronización no marca
 * carga tardía y un reloj adelantado no puede registrar algo en el futuro.
 */
export function clampRecordedAt(recordedAt: Date, now = new Date()): Date {
  return recordedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS ? now : recordedAt;
}

/**
 * uuid determinístico (formato v5) derivado de `clientId` y una clave (p. ej. el índice de la línea).
 * Sirve cuando un envío crea varias filas y cada una necesita su propio `client_id` único: el reenvío
 * del mismo `clientId` produce los mismos ids y se detecta como duplicado.
 */
export function derivedClientId(clientId: string, key: string | number): string {
  const h = createHash("sha1").update(`${clientId}:${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
