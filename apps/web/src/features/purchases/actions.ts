"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { putFile } from "@/server/storage";
import { UserError } from "@/server/errors";
import { ExtractionError, getInvoiceExtractor } from "./ai/extractor";
import {
  confirmInvoiceInput,
  idInput,
  invoiceInput,
  orderStatusInput,
  purchaseOrderInput,
  receptionInput,
  supplierFromDraftInput,
  supplierPaymentInput,
  updatePurchaseOrderInput,
  uploadInvoiceInput,
} from "./schemas";
import {
  changeOrderStatus,
  confirmInvoice,
  createDraftFromExtraction,
  createDraftWithFileOnly,
  createManualDraft,
  createOrder,
  createReception,
  createSupplierFromDraft,
  deleteDraftInvoice,
  registerSupplierPayment,
  saveInvoice,
  updateOrder,
} from "./service";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "application/pdf": "application/pdf",
};
const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // límite de la API de visión por imagen

function detectContentType(file: File): string | null {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  return ALLOWED_TYPES[file.type] ?? BY_EXTENSION[ext] ?? null;
}

const revalidateInvoices = (id?: string) => {
  revalidatePath("/compras");
  revalidatePath("/compras/facturas");
  if (id) revalidatePath(`/compras/facturas/${id}`);
};

/**
 * RF-08: sube la foto/PDF, la lee la IA y deja un borrador para revisar. Si la IA falla, igual
 * queda un borrador con la foto para cargarlo a mano (`warning` explica por qué).
 */
export const uploadInvoiceAction = action(
  { permission: "purchases:write", schema: uploadInvoiceInput },
  async ({ file }, { tx }) => {
    const contentType = detectContentType(file);
    if (!contentType)
      throw new UserError("Formato no soportado. Subí una foto JPG/PNG/WebP o un PDF.", {
        file: ["Formato no soportado"],
      });
    if (contentType.startsWith("image/") && file.size > MAX_IMAGE_BYTES)
      throw new UserError("La foto pesa más de 5 MB. Sacala de nuevo con menor resolución.", {
        file: ["Demasiado pesada"],
      });

    const stored = await putFile("invoices", file, file.name);
    let invoice;
    let warning: string | null = null;
    try {
      const extraction = await getInvoiceExtractor().extract({
        bytes: Buffer.from(await file.arrayBuffer()),
        contentType,
      });
      invoice = await createDraftFromExtraction(tx, { extraction, fileKey: stored.key });
    } catch (e) {
      if (!(e instanceof ExtractionError)) throw e;
      console.error("[invoice-extraction]", e.message);
      warning = `No pude leer la factura automáticamente: ${e.message} Cargala a mano mirando la foto.`;
      invoice = await createDraftWithFileOnly(tx, stored.key, e.message);
    }
    revalidateInvoices();
    return { id: invoice.id, warning };
  },
);

export const createManualInvoiceAction = action(
  { permission: "purchases:write", schema: idInput.partial() },
  async (_input, { tx }) => {
    const invoice = await createManualDraft(tx);
    revalidateInvoices();
    return { id: invoice.id };
  },
);

export const saveInvoiceAction = action(
  { permission: "purchases:write", schema: invoiceInput },
  async (input, { tx }) => {
    await saveInvoice(tx, input);
    revalidateInvoices(input.id);
    return { id: input.id };
  },
);

export const confirmInvoiceAction = action(
  { permission: "purchases:write", schema: confirmInvoiceInput },
  async (input, { tx }) => {
    const result = await confirmInvoice(tx, input);
    revalidateInvoices(input.id);
    revalidatePath("/compras/precios");
    return result;
  },
);

export const deleteInvoiceDraftAction = action(
  { permission: "purchases:write", schema: idInput },
  async ({ id }, { tx }) => {
    await deleteDraftInvoice(tx, id);
    revalidateInvoices();
    return { id };
  },
);

export const createSupplierFromInvoiceAction = action(
  { permission: "purchases:write", schema: supplierFromDraftInput },
  async ({ invoiceId }, { tx }) => {
    const supplier = await createSupplierFromDraft(tx, invoiceId);
    revalidatePath("/proveedores");
    revalidateInvoices(invoiceId);
    return { supplierId: supplier.id, name: supplier.legalName };
  },
);

// --- Órdenes de compra ---

export const createOrderAction = action(
  { permission: "purchases:write", schema: purchaseOrderInput },
  async (input, { tx, user }) => {
    const order = await createOrder(tx, user.id, input);
    revalidatePath("/compras/ordenes");
    return { id: order.id, number: order.number };
  },
);

export const updateOrderAction = action(
  { permission: "purchases:write", schema: updatePurchaseOrderInput },
  async ({ id, ...input }, { tx }) => {
    await updateOrder(tx, id, input);
    revalidatePath("/compras/ordenes");
    revalidatePath(`/compras/ordenes/${id}`);
    return { id };
  },
);

export const changeOrderStatusAction = action(
  { permission: "purchases:write", schema: orderStatusInput },
  async ({ id, status }, { tx }) => {
    const order = await changeOrderStatus(tx, id, status);
    revalidatePath("/compras/ordenes");
    revalidatePath(`/compras/ordenes/${id}`);
    return { id, status: order.status };
  },
);

// --- Recepción ---

export const createReceptionAction = action(
  { permission: "purchases:write", schema: receptionInput },
  async (input, { tx, user }) => {
    const result = await createReception(tx, user.id, input);
    revalidatePath("/compras/recepciones");
    revalidatePath("/compras/ordenes");
    revalidatePath("/stock");
    if (input.purchaseOrderId) revalidatePath(`/compras/ordenes/${input.purchaseOrderId}`);
    return result;
  },
);

// --- Cuenta corriente ---

export const registerPaymentAction = action(
  { permission: "purchases:write", schema: supplierPaymentInput },
  async (input, { tx }) => {
    const payment = await registerSupplierPayment(tx, input);
    revalidatePath(`/proveedores/${input.supplierId}`);
    revalidatePath("/compras/cuentas");
    return { id: payment.id };
  },
);
