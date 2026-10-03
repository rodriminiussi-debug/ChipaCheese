"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { UserError } from "@/server/errors";
import { putFile } from "@/server/storage";
import {
  addOrdersInput,
  addSupplierStopInput,
  changeDispatchLotInput,
  createRouteInput,
  deliverDispatchInput,
  finishRouteInput,
  generateDispatchInput,
  generateRouteDispatchesInput,
  moveStopInput,
  rejectDispatchInput,
  removeStopInput,
  setStopDoneInput,
  startRouteInput,
  updateRouteInput,
} from "./schemas";
import {
  addOrdersToRoute,
  addSupplierStop,
  changeDispatchLot,
  createDispatch,
  createRoute,
  createRouteDispatches,
  deliverDispatch,
  finishRoute,
  moveStop,
  rejectDispatch,
  removeStop,
  setStopDone,
  startRoute,
  updateRoute,
} from "./service";

function revalidateRoute(routeId?: string | null) {
  revalidatePath("/despacho");
  revalidatePath("/despacho/costos");
  revalidatePath("/despacho/registro");
  if (routeId) {
    revalidatePath(`/despacho/rutas/${routeId}`);
    revalidatePath(`/despacho/rutas/${routeId}/hoja`);
  }
}
function revalidateOrders(orderId?: string) {
  revalidatePath("/pedidos");
  revalidatePath("/stock/producto-terminado");
  if (orderId) revalidatePath(`/pedidos/${orderId}`);
}

export const createRouteAction = action(
  { permission: "dispatch:write", schema: createRouteInput },
  async (input, { tx }) => {
    const route = await createRoute(tx, input);
    revalidateRoute();
    revalidateOrders();
    return { id: route.id };
  },
);

export const updateRouteAction = action(
  { permission: "dispatch:write", schema: updateRouteInput },
  async (input, { tx }) => {
    const res = await updateRoute(tx, input);
    revalidateRoute(res.id);
    return res;
  },
);

export const addOrdersToRouteAction = action(
  { permission: "dispatch:write", schema: addOrdersInput },
  async (input, { tx }) => {
    const res = await addOrdersToRoute(tx, input);
    revalidateRoute(res.id);
    return res;
  },
);

export const addSupplierStopAction = action(
  { permission: "dispatch:write", schema: addSupplierStopInput },
  async (input, { tx }) => {
    const stop = await addSupplierStop(tx, input);
    revalidateRoute(input.routeId);
    return { id: stop.id };
  },
);

export const moveStopAction = action(
  { permission: "dispatch:write", schema: moveStopInput },
  async (input, { tx }) => {
    const res = await moveStop(tx, input);
    revalidateRoute(res.id);
    return res;
  },
);

export const removeStopAction = action(
  { permission: "dispatch:write", schema: removeStopInput },
  async (input, { tx }) => {
    const res = await removeStop(tx, input);
    revalidateRoute(res.id);
    revalidateOrders();
    return res;
  },
);

export const setStopDoneAction = action(
  { permission: "dispatch:write", schema: setStopDoneInput },
  async (input, { tx }) => {
    const res = await setStopDone(tx, input);
    revalidateRoute(res.id);
    return res;
  },
);

export const startRouteAction = action(
  { permission: "dispatch:write", schema: startRouteInput },
  async (input, { tx }) => {
    const res = await startRoute(tx, input);
    revalidateRoute(res.id);
    return res;
  },
);

export const finishRouteAction = action(
  { permission: "dispatch:write", schema: finishRouteInput },
  async (input, { tx, user }) => {
    const res = await finishRoute(tx, user.id, input);
    revalidateRoute(res.id);
    revalidatePath("/calidad");
    return res;
  },
);

export const generateDispatchAction = action(
  { permission: "dispatch:write", schema: generateDispatchInput },
  async (input, { tx, user }) => {
    const res = await createDispatch(tx, user.id, input);
    revalidateRoute(input.routeId);
    revalidateOrders(input.orderId);
    return res;
  },
);

/** Remitos de toda la ruta. Si ninguno se pudo generar, el error explica por qué. */
export const generateRouteDispatchesAction = action(
  { permission: "dispatch:write", schema: generateRouteDispatchesInput },
  async (input, { tx, user }) => {
    const res = await createRouteDispatches(tx, user.id, input.routeId);
    if (!res.created.length && res.failed.length)
      throw new UserError(
        res.failed.map((f) => `#${f.orderNumber} ${f.customerName}: ${f.reason}`).join(" "),
      );
    if (!res.created.length && !res.skipped)
      throw new UserError("La ruta no tiene pedidos para armar remitos.");
    revalidateRoute(input.routeId);
    revalidateOrders();
    return res;
  },
);

const MAX_PROOF_BYTES = 8 * 1024 * 1024;

/** Entrega con conformidad: nombre de quien recibe + foto o firma (PNG/JPG). Acepta FormData. */
export const deliverDispatchAction = action(
  { permission: "dispatch:write", schema: deliverDispatchInput },
  async (input, { tx, user }) => {
    let proofFileKey: string | null = null;
    if (input.proof && input.proof.size > 0) {
      if (!input.proof.type.startsWith("image/"))
        throw new UserError("La conformidad tiene que ser una imagen (foto o firma).");
      if (input.proof.size > MAX_PROOF_BYTES) throw new UserError("La imagen pesa demasiado (máximo 8 MB).");
      proofFileKey = (await putFile("remitos", input.proof, input.proof.name || "conformidad.jpg")).key;
    }
    const res = await deliverDispatch(tx, user.id, {
      dispatchId: input.dispatchId,
      receivedByName: input.receivedByName,
      proofFileKey,
      quantities: input.quantities,
    });
    revalidateRoute();
    revalidatePath("/despacho/rutas/[id]", "page");
    revalidateOrders(res.orderId);
    return res;
  },
);

/** RF-25: cambia el lote asignado por FEFO a una línea del remito (motivo obligatorio). */
export const changeDispatchLotAction = action(
  { permission: "dispatch:write", schema: changeDispatchLotInput },
  async (input, { tx, user }) => {
    const res = await changeDispatchLot(tx, user.id, input);
    revalidateRoute();
    revalidatePath("/despacho/rutas/[id]", "page");
    revalidatePath(`/despacho/remitos/${res.dispatchId}`);
    revalidatePath("/stock/producto-terminado");
    return res;
  },
);

export const rejectDispatchAction = action(
  { permission: "dispatch:write", schema: rejectDispatchInput },
  async (input, { tx, user }) => {
    const res = await rejectDispatch(tx, user.id, input);
    revalidateRoute();
    revalidatePath("/despacho/rutas/[id]", "page");
    revalidateOrders(res.orderId);
    return res;
  },
);
