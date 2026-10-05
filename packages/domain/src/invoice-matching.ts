import type { IsoDate } from "./dates";
import { diffDays } from "./dates";

export interface MatchableInvoice {
  id: string;
  customerId: string;
  issueDate: IsoDate;
  total: number;
}
export interface MatchableOrder {
  id: string;
  customerId: string;
  /** Día de entrega (fecha de negocio). */
  deliveredOn: IsoDate;
  total: number;
}

/**
 * Empareja facturas (p. ej. importadas de ARCA) con pedidos entregados sin facturar: mismo cliente,
 * mismo importe (± `tolerance`) y entregado hasta `maxDaysBefore` días antes de la emisión (o el mismo día).
 * Solo vincula cuando la coincidencia es ÚNICA en ambos sentidos; lo ambiguo queda para vincular a mano.
 * Un pedido se usa una sola vez.
 */
export function matchInvoicesToOrders(
  invoices: MatchableInvoice[],
  orders: MatchableOrder[],
  opts: { tolerance?: number; maxDaysBefore?: number } = {},
): { links: { invoiceId: string; orderId: string }[]; ambiguous: string[]; unmatched: string[] } {
  const tolerance = opts.tolerance ?? 1;
  const maxDays = opts.maxDaysBefore ?? 45;
  const fits = (inv: MatchableInvoice, o: MatchableOrder) => {
    if (inv.customerId !== o.customerId) return false;
    if (Math.abs(inv.total - o.total) > tolerance) return false;
    const days = diffDays(inv.issueDate, o.deliveredOn);
    return days >= 0 && days <= maxDays;
  };
  const candidates = new Map(invoices.map((inv) => [inv.id, orders.filter((o) => fits(inv, o))]));
  const usedBy = new Map<string, number>();
  for (const list of candidates.values()) for (const o of list) usedBy.set(o.id, (usedBy.get(o.id) ?? 0) + 1);

  const links: { invoiceId: string; orderId: string }[] = [];
  const ambiguous: string[] = [];
  const unmatched: string[] = [];
  for (const inv of invoices) {
    const list = candidates.get(inv.id)!;
    if (list.length === 0) unmatched.push(inv.id);
    else if (list.length === 1 && usedBy.get(list[0]!.id) === 1)
      links.push({ invoiceId: inv.id, orderId: list[0]!.id });
    else ambiguous.push(inv.id);
  }
  return { links, ambiguous, unmatched };
}
