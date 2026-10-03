import { z } from "zod";
import { todayAR } from "@/lib/dates";
import { clientIdField, decimal, isoDate, optDecimal, optText, optUuid, recordedAtField } from "@/lib/zod";

/** Estados de pedido que se pueden poner en una ruta (los no listos se marcan en la propuesta). */
export const ROUTE_ORDER_STATUSES = ["ready", "confirmed", "in_production"] as const;

const uuid = (message?: string) => z.string().uuid(message);

/** RF-24: parada de retiro en un proveedor, agregada a mano. */
export const supplierStopInput = z.object({
  supplierId: uuid("Elegí el proveedor"),
  notes: optText(),
});
export type SupplierStopInput = z.input<typeof supplierStopInput>;

/** RF-24: crear la hoja de ruta del día. */
export const createRouteInput = z
  .object({
    date: isoDate(),
    driverId: optUuid(),
    vehicleId: optUuid(),
    orderIds: z.array(uuid()).default([]),
    supplierStops: z.array(supplierStopInput).default([]),
    notes: optText(),
  })
  .refine((v) => v.orderIds.length + v.supplierStops.length > 0, {
    message: "Elegí al menos un pedido o un retiro en proveedor.",
    path: ["orderIds"],
  });
export type CreateRouteInput = z.input<typeof createRouteInput>;
export type CreateRouteData = z.output<typeof createRouteInput>;

export const updateRouteInput = z.object({
  id: uuid(),
  driverId: optUuid(),
  vehicleId: optUuid(),
  notes: optText(),
});
export type UpdateRouteData = z.output<typeof updateRouteInput>;

export const addOrdersInput = z.object({ routeId: uuid(), orderIds: z.array(uuid()).min(1) });
export const addSupplierStopInput = supplierStopInput.extend({ routeId: uuid() });
export const moveStopInput = z.object({ stopId: uuid(), direction: z.enum(["up", "down"]) });
export const removeStopInput = z.object({ stopId: uuid() });
export const setStopDoneInput = z.object({ stopId: uuid(), done: z.boolean() });

/** RF-26: inicio de la salida. */
export const startRouteInput = z.object({
  id: uuid(),
  kmStart: decimal({ min: 0, max: 5_000_000, message: "Ingresá el km del tablero" }),
});

/** RF-26: cierre de la salida. */
export const finishRouteInput = z.object({
  id: uuid(),
  kmEnd: decimal({ min: 0, max: 5_000_000, message: "Ingresá el km del tablero" }),
  fuelLiters: optDecimal({ min: 0, max: 1000 }).default(null),
  fuelCost: optDecimal({ min: 0 }).default(null),
  otherCosts: optDecimal({ min: 0 }).default(null),
  coldUnitTempC: optDecimal({ min: -60, max: 40 }).default(null),
  notes: optText(),
});
export type FinishRouteInput = z.input<typeof finishRouteInput>;
export type FinishRouteData = z.output<typeof finishRouteInput>;

/**
 * RF-26 sin señal: el chofer inicia y cierra la salida desde el celular y el registro se encola. `clientId`
 * (uuid del celular; idempotencia al reenviar) y `recordedAt` (la hora real de salida o regreso).
 */
const offlineStamp = { clientId: clientIdField(), recordedAt: recordedAtField() };
export const startRoutePayload = startRouteInput.extend(offlineStamp);
export type StartRoutePayload = z.input<typeof startRoutePayload>;
export const finishRoutePayload = finishRouteInput.extend(offlineStamp);
export type FinishRoutePayload = z.input<typeof finishRoutePayload>;

/** RF-25: remito de un pedido de la ruta, o de todos los pedidos listos de la ruta. */
export const generateDispatchInput = z.object({ routeId: uuid(), orderId: uuid() });
export const generateRouteDispatchesInput = z.object({ routeId: uuid() });

/** RF-25: entrega con conformidad. `proof` es la foto o la firma dibujada (PNG). */
export const deliveredQuantityInput = z.object({
  dispatchItemId: uuid(),
  qty: z.coerce.number().int("Cantidad entera").min(0, "No puede ser negativa"),
});
export const deliverDispatchInput = z.object({
  dispatchId: uuid(),
  receivedByName: z.string().trim().min(2, "Ingresá el nombre de quien recibe"),
  proof: z.custom<File>((v) => typeof File !== "undefined" && v instanceof File).optional(),
  /** Entrega parcial: cantidad real por línea del remito, como JSON (viaja en FormData). */
  quantities: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return [];
      try {
        return z.array(deliveredQuantityInput).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: "custom", message: "Cantidades entregadas inválidas" });
        return z.NEVER;
      }
    }),
});
export type DeliverDispatchData = z.output<typeof deliverDispatchInput>;

/** RF-25: cambio manual del lote de una línea del remito, con motivo obligatorio. */
export const changeDispatchLotInput = z.object({
  dispatchItemId: uuid(),
  finishedLotId: uuid("Elegí el lote"),
  reason: z.string().trim().min(3, "Contá por qué se cambia el lote"),
});
export type ChangeDispatchLotInput = z.input<typeof changeDispatchLotInput>;

/** RF-25: rechazo total en la entrega (el stock vuelve al lote). */
export const rejectDispatchInput = z.object({
  dispatchId: uuid(),
  reason: z.string().trim().min(3, "Contá por qué se rechazó"),
  receivedByName: optText(),
});
export type RejectDispatchData = z.output<typeof rejectDispatchInput>;

/** Filtros del registro de despacho BPM (vienen de la URL). */
export interface RegistryFilters {
  from: string;
  to: string;
  productId?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lee `desde`, `hasta` y `producto` de la URL; por defecto, del 1.º del mes a hoy. */
export function registryFiltersFromParams(
  p: Record<string, string | string[] | undefined>,
  today: string = todayAR(),
): RegistryFilters {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const desde = one(p.desde);
  const hasta = one(p.hasta);
  const producto = one(p.producto);
  const from = desde && ISO.test(desde) ? desde : `${today.slice(0, 7)}-01`;
  const to = hasta && ISO.test(hasta) ? hasta : today;
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    ...(producto && UUID.test(producto) ? { productId: producto } : {}),
  };
}
