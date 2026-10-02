import { formatDateAR, formatNumber, whatsappUrl } from "@chipa/domain";

const UNIT_LABEL = { kg: "kg", l: "L", unit: "u." } as const;

export interface OrderMessageInput {
  number: string;
  supplierName: string;
  expectedAt: string | null;
  items: { name: string; qty: number; unit: keyof typeof UNIT_LABEL }[];
}

/** Texto del pedido para mandar por WhatsApp al proveedor (un solo canal, RF-10). */
export function buildOrderMessage(o: OrderMessageInput): string {
  const lines = o.items.map((i) => `• ${formatNumber(i.qty, Number.isInteger(i.qty) ? 0 : 2)} ${UNIT_LABEL[i.unit]} ${i.name}`);
  return [
    `Hola ${o.supplierName}! Te paso el pedido ${o.number} de Chipa Cheese:`,
    ...lines,
    o.expectedAt ? `Lo necesitamos para el ${formatDateAR(o.expectedAt)}.` : "",
    "Por favor confirmame que lo recibiste. ¡Gracias!",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Link `https://wa.me/<numero>?text=<detalle>`, o null si el proveedor no tiene un WhatsApp válido. */
export function orderWhatsappUrl(o: OrderMessageInput, whatsapp: string | null): string | null {
  return whatsappUrl(whatsapp, buildOrderMessage(o));
}
