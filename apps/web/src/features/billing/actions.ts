"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { arcaFileInput, checkStatusInput, invoiceInput, paymentInput } from "./schemas";
import { importArcaFile, previewArcaFile } from "./arca-service";
import { createInvoice, registerPayment, setCheckStatus } from "./service";

function revalidateBilling(customerId?: string, routeId?: string | null) {
  revalidatePath("/cobranzas");
  revalidatePath("/cobranzas/cheques");
  if (customerId) {
    revalidatePath(`/cobranzas/clientes/${customerId}`);
    revalidatePath(`/clientes/${customerId}`);
  }
  if (routeId) revalidatePath(`/cobranzas/ruta/${routeId}`);
  revalidatePath("/pedidos");
}

export const createInvoiceAction = action(
  { permission: "billing:write", schema: invoiceInput },
  async (input, { tx, user }) => {
    const res = await createInvoice(tx, user.id, input);
    revalidateBilling(input.customerId);
    return { id: res.invoice.id, settledOrders: res.settledOrders };
  },
);

/** Logística cobra en ruta (collections:write); Dirección también carga cobros desde la ficha. */
export const registerPaymentAction = action(
  { permission: ["collections:write", "billing:write"], schema: paymentInput },
  async (input, { tx, user }) => {
    const res = await registerPayment(tx, user.id, input);
    revalidateBilling(input.customerId, input.routeId);
    return { id: res.payment.id, amount: res.payment.amount, settledOrders: res.settledOrders };
  },
);

export const setCheckStatusAction = action(
  { permission: "billing:write", schema: checkStatusInput },
  async (input, { tx }) => {
    const check = await setCheckStatus(tx, input);
    revalidatePath("/cobranzas");
    revalidatePath("/cobranzas/cheques");
    return { id: check.id, status: check.status };
  },
);

/** Vista previa del CSV de Mis Comprobantes: no escribe nada. */
export const previewArcaAction = action(
  { permission: "billing:write", schema: arcaFileInput },
  async (input, { tx }) => previewArcaFile(tx, input.kind, input.file),
);

/** Importa los emitidos nuevos (idempotente) o concilia los recibidos; reporta lo que no pudo matchear. */
export const importArcaAction = action(
  { permission: "billing:write", schema: arcaFileInput },
  async (input, { tx }) => {
    const res = await importArcaFile(tx, input.kind, input.file);
    revalidateBilling();
    return res;
  },
);
