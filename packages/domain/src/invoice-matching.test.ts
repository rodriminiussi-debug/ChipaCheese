import { describe, expect, it } from "vitest";
import { matchInvoicesToOrders } from "./invoice-matching";

const inv = (id: string, total: number, issueDate = "2026-09-20", customerId = "c1") => ({
  id,
  total,
  issueDate,
  customerId,
});
const ord = (id: string, total: number, deliveredOn = "2026-09-18", customerId = "c1") => ({
  id,
  total,
  deliveredOn,
  customerId,
});

describe("emparejar facturas con pedidos entregados", () => {
  it("vincula la coincidencia única por cliente, importe y fecha", () => {
    expect(matchInvoicesToOrders([inv("f1", 126000)], [ord("p1", 126000), ord("p2", 50000)]).links).toEqual([
      { invoiceId: "f1", orderId: "p1" },
    ]);
  });
  it("tolera diferencias de redondeo de hasta $1", () => {
    expect(matchInvoicesToOrders([inv("f1", 126000.6)], [ord("p1", 126000)]).links).toHaveLength(1);
    expect(matchInvoicesToOrders([inv("f1", 126002)], [ord("p1", 126000)]).unmatched).toEqual(["f1"]);
  });
  it("no vincula pedidos de otro cliente, entregados después de la factura o muy viejos", () => {
    const r = matchInvoicesToOrders(
      [inv("f1", 100), inv("f2", 200), inv("f3", 300)],
      [ord("p1", 100, "2026-09-18", "c2"), ord("p2", 200, "2026-09-25"), ord("p3", 300, "2026-07-01")],
    );
    expect(r.links).toEqual([]);
    expect(r.unmatched).toEqual(["f1", "f2", "f3"]);
  });
  it("deja ambiguo si dos pedidos o dos facturas compiten", () => {
    expect(matchInvoicesToOrders([inv("f1", 100)], [ord("p1", 100), ord("p2", 100)]).ambiguous).toEqual([
      "f1",
    ]);
    expect(matchInvoicesToOrders([inv("f1", 100), inv("f2", 100)], [ord("p1", 100)]).ambiguous).toEqual([
      "f1",
      "f2",
    ]);
  });
});
