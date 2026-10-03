"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { UserError } from "@/server/errors";
import { can } from "@/lib/rbac";
import { createOrderInput, estimateOrderInput, transitionOrderInput, updateOrderInput } from "./schemas";
import { changeOrderStatus, createOrder, estimateOrderDate, updateOrder } from "./service";

function revalidateOrder(id?: string, customerId?: string) {
  revalidatePath("/pedidos");
  revalidatePath("/pedidos/envasado");
  if (id) revalidatePath(`/pedidos/${id}`);
  if (customerId) revalidatePath(`/clientes/${customerId}`);
}

export const createOrderAction = action(
  { permission: "orders:write", schema: createOrderInput },
  async (input, { tx, user }) => {
    const order = await createOrder(tx, user.id, input);
    revalidateOrder(order.id, input.customerId);
    return order;
  },
);

export const updateOrderAction = action(
  { permission: "orders:write", schema: updateOrderInput },
  async (input, { tx, user }) => {
    const order = await updateOrder(tx, user.id, input);
    revalidateOrder(order.id);
    return order;
  },
);

/** Logística puede registrar despacho y entrega aunque no cargue pedidos. */
const LOGISTICS_STATUSES = ["dispatched", "delivered"];

export const transitionOrderAction = action(
  { permission: ["orders:write", "dispatch:write"], schema: transitionOrderInput },
  async (input, { tx, user }) => {
    if (!can(user.role, "orders:write") && !LOGISTICS_STATUSES.includes(input.to))
      throw new UserError("Solo podés registrar el despacho y la entrega de los pedidos.");
    const res = await changeOrderStatus(tx, user.id, input);
    revalidateOrder(input.id);
    return res;
  },
);

/** Lectura (RF-05): fecha posible para un pedido a medio cargar; se expone como acción para usarla desde el formulario. */
export const estimateOrderDateAction = action(
  { permission: "orders:read", schema: estimateOrderInput },
  async (input, { tx }) =>
    estimateOrderDate(tx, { items: input.items, excludeOrderId: input.excludeOrderId }),
);
