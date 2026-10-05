"use client";

import { registerOfflineAction } from "@/lib/offline-queue";
import { deliverDispatchAction, finishRouteAction, startRouteAction } from "@/features/dispatch/actions";
import { createOrderAction } from "@/features/orders/actions";
import {
  recordConsumptionsAction,
  recordPackingAction,
  setRunStatusAction,
  recordWeighingsAction,
} from "@/features/production/actions";
import { recordCleaningAction, recordTemperatureAction } from "@/features/quality/actions";
import { saveInventoryCountAction } from "@/features/stock/actions";

/**
 * Acciones que se pueden cargar sin señal, por nombre. Se registran todas acá (y no solo cuando la pantalla
 * está abierta) para que `OfflineQueueIndicator`, que vive en los layouts de planta y de celular, envíe la
 * cola al volver la conexión aunque el usuario ya haya cambiado de pantalla.
 * Todas son idempotentes por `clientId` (ver `src/lib/idempotency.ts` y `src/lib/offline-queue.ts`).
 */
export const OFFLINE_ACTION = {
  cleaning: "quality.cleaning",
  temperature: "quality.temperature",
  consumptions: "production.consumptions",
  weighings: "production.weighings",
  packing: "production.packing",
  runStatus: "production.runStatus",
  inventoryCountSave: "stock.inventoryCountSave",
  orderCreate: "orders.create",
  routeStart: "dispatch.routeStart",
  routeFinish: "dispatch.routeFinish",
  deliver: "dispatch.deliver",
} as const;

registerOfflineAction(OFFLINE_ACTION.cleaning, recordCleaningAction as never);
registerOfflineAction(OFFLINE_ACTION.temperature, recordTemperatureAction as never);
registerOfflineAction(OFFLINE_ACTION.consumptions, recordConsumptionsAction as never);
registerOfflineAction(OFFLINE_ACTION.weighings, recordWeighingsAction as never);
registerOfflineAction(OFFLINE_ACTION.packing, recordPackingAction as never);
registerOfflineAction(OFFLINE_ACTION.runStatus, setRunStatusAction as never);
registerOfflineAction(OFFLINE_ACTION.inventoryCountSave, saveInventoryCountAction as never);
registerOfflineAction(OFFLINE_ACTION.orderCreate, createOrderAction as never);
registerOfflineAction(OFFLINE_ACTION.routeStart, startRouteAction as never);
registerOfflineAction(OFFLINE_ACTION.routeFinish, finishRouteAction as never);
registerOfflineAction(OFFLINE_ACTION.deliver, deliverDispatchAction as never);
