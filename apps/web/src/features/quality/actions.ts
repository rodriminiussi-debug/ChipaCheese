"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import {
  backdatedCleaningInput,
  backdatedTemperatureInput,
  cleaningRecordInput,
  complaintInput,
  complaintStatusInput,
  lotHoldInput,
  temperatureInput,
  updateComplaintInput,
} from "./schemas";
import {
  clampRecordedAt,
  createComplaint,
  recordCleaning,
  recordTemperature,
  setComplaintStatus,
  setLotHold,
  updateComplaint,
} from "./service";

function revalidateQuality() {
  revalidatePath("/calidad");
  revalidatePath("/planta/limpieza");
  revalidatePath("/planta/temperaturas");
}

/** Limpieza desde la tablet de planta (encolable offline: nombre "quality.cleaning"). */
export const recordCleaningAction = action(
  { permission: "quality:record", schema: cleaningRecordInput },
  async (input, { tx, user }) => {
    const { record, duplicate } = await recordCleaning(tx, user.id, {
      pointId: input.pointId,
      result: input.result,
      notes: input.notes,
      clientId: input.clientId,
      recordedAt: clampRecordedAt(new Date(input.recordedAt)),
    });
    revalidateQuality();
    return { id: record.id, duplicate };
  },
);

/** Limpieza de un día pasado (jefa/dirección): queda marcada como carga tardía. */
export const recordBackdatedCleaningAction = action(
  { permission: "quality:write", schema: backdatedCleaningInput },
  async (input, { tx, user }) => {
    const { record } = await recordCleaning(tx, user.id, {
      pointId: input.pointId,
      result: input.result,
      notes: input.notes,
      clientId: input.clientId,
      date: input.date,
      recordedAt: new Date(),
    });
    revalidateQuality();
    return { id: record.id, lateEntry: record.lateEntry };
  },
);

/** Temperatura desde la tablet de planta (encolable offline: nombre "quality.temperature"). */
export const recordTemperatureAction = action(
  { permission: "quality:record", schema: temperatureInput },
  async (input, { tx, user }) => {
    const { log, duplicate } = await recordTemperature(tx, user.id, {
      equipmentId: input.equipmentId,
      valueC: input.valueC,
      correctiveAction: input.correctiveAction,
      clientId: input.clientId,
      measuredAt: clampRecordedAt(new Date(input.recordedAt)),
    });
    revalidateQuality();
    return { id: log.id, outOfRange: log.outOfRange, duplicate };
  },
);

export const recordBackdatedTemperatureAction = action(
  { permission: "quality:write", schema: backdatedTemperatureInput },
  async (input, { tx, user }) => {
    const { log } = await recordTemperature(tx, user.id, {
      equipmentId: input.equipmentId,
      valueC: input.valueC,
      correctiveAction: input.correctiveAction,
      clientId: input.clientId,
      date: input.date,
      // Argentina no tiene horario de verano: -03:00 fijo.
      measuredAt: new Date(`${input.date}T${input.time}:00-03:00`),
    });
    revalidateQuality();
    return { id: log.id, outOfRange: log.outOfRange, lateEntry: log.lateEntry };
  },
);

export const createComplaintAction = action(
  { permission: "quality:write", schema: complaintInput },
  async (input, { tx, user }) => {
    const row = await createComplaint(tx, user.id, input);
    revalidatePath("/calidad/reclamos");
    revalidatePath("/calidad");
    return { id: row.id };
  },
);

export const updateComplaintAction = action(
  { permission: "quality:write", schema: updateComplaintInput },
  async ({ id, ...input }, { tx }) => {
    await updateComplaint(tx, id, input);
    revalidatePath("/calidad/reclamos");
    return { id };
  },
);

export const setComplaintStatusAction = action(
  { permission: "quality:write", schema: complaintStatusInput },
  async ({ id, status }, { tx }) => {
    await setComplaintStatus(tx, id, status);
    revalidatePath("/calidad/reclamos");
    revalidatePath("/calidad");
    return { id, status };
  },
);

/** Retener / liberar un lote terminado (un lote retenido no sale en despacho). */
export const setLotHoldAction = action(
  { permission: "quality:write", schema: lotHoldInput },
  async ({ finishedLotId, onHold }, { tx }) => {
    const lot = await setLotHold(tx, finishedLotId, onHold);
    revalidatePath("/calidad/reclamos");
    revalidatePath("/calidad/trazabilidad");
    revalidatePath("/calidad");
    revalidatePath("/stock/producto-terminado");
    return { id: lot.id, onHold: lot.onHold };
  },
);
