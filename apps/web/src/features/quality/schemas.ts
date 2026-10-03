import { z } from "zod";
import { decimal, int, isoDate, optText, optUuid } from "@/lib/zod";

/**
 * Esquemas compartidos cliente/servidor de M7 (RF-34, RF-38).
 * Los registros de planta llevan `clientId` (uuid generado en la tablet, idempotencia al reenviar desde
 * la cola offline) y `recordedAt` (momento real de la carga, para que la demora de sincronización no
 * se confunda con una carga tardía).
 */

const clientId = () => z.string().uuid();
const recordedAt = () => z.iso.datetime({ offset: true, message: "Fecha y hora inválidas" });
const result = () => z.enum(["ok", "deepen"], { message: "Elegí el resultado" });

// --- Limpieza -------------------------------------------------------------------------------
/** Carga desde la tablet de planta (permiso quality:record): siempre el día en curso. */
export const cleaningRecordInput = z.object({
  clientId: clientId(),
  recordedAt: recordedAt(),
  pointId: z.string().uuid(),
  result: result(),
  notes: optText(),
});
export type CleaningRecordInput = z.input<typeof cleaningRecordInput>;

/** Carga de un día pasado desde /calidad (solo jefa/dirección, permiso quality:write). */
export const backdatedCleaningInput = z.object({
  clientId: optUuid(),
  date: isoDate(),
  pointId: z.string().uuid(),
  result: result(),
  notes: optText(),
});
export type BackdatedCleaningInput = z.input<typeof backdatedCleaningInput>;

// --- Temperaturas ---------------------------------------------------------------------------
export const temperatureInput = z.object({
  clientId: clientId(),
  recordedAt: recordedAt(),
  equipmentId: z.string().uuid("Elegí el equipo"),
  valueC: decimal({ min: -90, max: 90, message: "Ingresá la temperatura" }),
  correctiveAction: optText(),
});
export type TemperatureInput = z.input<typeof temperatureInput>;

export const backdatedTemperatureInput = z.object({
  clientId: optUuid(),
  equipmentId: z.string().uuid("Elegí el equipo"),
  date: isoDate(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida")
    .default("08:00"),
  valueC: decimal({ min: -90, max: 90, message: "Ingresá la temperatura" }),
  correctiveAction: optText(),
});
export type BackdatedTemperatureInput = z.input<typeof backdatedTemperatureInput>;

// --- Reclamos y devoluciones ----------------------------------------------------------------
const optQty = () =>
  z
    .union([z.literal(""), int({ min: 1, max: 100000 })])
    .nullish()
    .transform((v) => (v === "" || v == null ? null : v));

export const complaintInput = z.object({
  date: isoDate(),
  customerId: optUuid(),
  finishedLotId: optUuid(),
  qtyUnits: optQty(),
  reason: z.string().trim().min(3, "Indicá el motivo"),
  customerAction: optText(),
  productAction: optText(),
  supervisorId: optUuid(),
  /** Retener el lote al registrar el reclamo. */
  holdLot: z.boolean().default(false),
});
export type ComplaintInput = z.input<typeof complaintInput>;
export type ComplaintData = z.output<typeof complaintInput>;

export const updateComplaintInput = complaintInput.extend({ id: z.string().uuid() });

export const complaintStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "closed"]),
});

export const lotHoldInput = z.object({
  finishedLotId: z.string().uuid(),
  onHold: z.boolean(),
});
