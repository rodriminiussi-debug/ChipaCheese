"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import {
  cashClosingInput,
  replenishmentIdInput,
  replenishmentRequestInput,
  replenishmentSendInput,
  resaleReceiptInput,
  storeSaleInput,
  voidSaleInput,
} from "./schemas";
import { closeCash, createStoreSale, receiveStoreMerchandise, voidStoreSale } from "./service";
import {
  cancelReplenishment,
  createReplenishment,
  receiveReplenishment,
  sendReplenishment,
} from "./replenishment";

function revalidateStore() {
  revalidatePath("/local");
  revalidatePath("/stock", "layout");
}

export const createStoreSaleAction = action(
  { permission: "store:write", schema: storeSaleInput },
  async (input, { tx, user }) => {
    const res = await createStoreSale(tx, user.id, input);
    revalidateStore();
    return { id: res.sale.id, total: res.total, units: res.units };
  },
);

/** Anular una venta: la empleada, las del día con la caja abierta; Dirección, siempre. */
export const voidStoreSaleAction = action(
  { permission: "store:write", schema: voidSaleInput },
  async (input, { tx, user }) => {
    const res = await voidStoreSale(tx, user.id, input, { anyDay: user.role === "admin" });
    revalidateStore();
    return { id: res.sale.id, returnedUnits: res.returnedUnits };
  },
);

export const closeCashAction = action(
  { permission: "store:write", schema: cashClosingInput },
  async (input, { tx, user }) => {
    const res = await closeCash(tx, user.id, input);
    revalidatePath("/local");
    return { id: res.closing.id, difference: res.difference };
  },
);

/** Ingreso de mercadería de reventa que trae el proveedor al local. */
export const receiveMerchandiseAction = action(
  { permission: "store:write", schema: resaleReceiptInput },
  async (input, { tx, user }) => {
    const res = await receiveStoreMerchandise(tx, user.id, input);
    revalidateStore();
    return res;
  },
);

/** El local pide reposición a la planta. */
export const requestReplenishmentAction = action(
  { permission: "store:write", schema: replenishmentRequestInput },
  async (input, { tx, user }) => {
    const rep = await createReplenishment(tx, user.id, input);
    revalidateStore();
    return { id: rep.id, number: rep.number };
  },
);

/** La planta envía el pedido (transfiere F3/F4 → LOCAL por FEFO). */
export const sendReplenishmentAction = action(
  { permission: "stock:write", schema: replenishmentSendInput },
  async (input, { tx, user }) => {
    const res = await sendReplenishment(tx, user.id, input);
    revalidateStore();
    return { id: res.replenishment.id, number: res.replenishment.number, sentUnits: res.sentUnits };
  },
);

/** El local confirma que recibió el pedido. */
export const receiveReplenishmentAction = action(
  { permission: "store:write", schema: replenishmentIdInput },
  async (input, { tx, user }) => {
    const rep = await receiveReplenishment(tx, user.id, input.id);
    revalidateStore();
    return { id: rep.id, number: rep.number };
  },
);

/** Cancela un pedido sin enviar (lo puede hacer el local o la planta). */
export const cancelReplenishmentAction = action(
  { permission: ["store:write", "stock:write"], schema: replenishmentIdInput },
  async (input, { tx }) => {
    const rep = await cancelReplenishment(tx, input.id);
    revalidateStore();
    return { id: rep.id, number: rep.number };
  },
);
