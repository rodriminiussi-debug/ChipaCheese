import { describe, expect, it } from "vitest";
import {
  bestNameMatch,
  cuitDigits,
  deliveryTiming,
  formatInvoiceNumber,
  formatPoNumber,
  invoiceDueDate,
  isTemperatureAlert,
  matchSupplier,
  monthlyPriceSeries,
  nextPoNumber,
  normalizeInvoiceNumber,
  normalizeText,
  poStatusAfterReception,
  purchaseVariations,
  textSimilarity,
  whatsappNumber,
  whatsappUrl,
} from "./purchasing";

describe("temperatura de recepción (RF-11)", () => {
  it("alerta solo por encima de 5 °C", () => {
    expect(isTemperatureAlert(5)).toBe(false);
    expect(isTemperatureAlert(5.1)).toBe(true);
    expect(isTemperatureAlert(8, 10)).toBe(false);
  });
});

describe("similitud de textos", () => {
  it("normaliza tildes, mayúsculas y signos", () => {
    expect(normalizeText("  FÉCULA (de Mandioca) x kg ")).toBe("fecula de mandioca x kg");
  });

  it("describe la factura contra el insumo", () => {
    expect(textSimilarity("QUESO TYBO BARRA X KG", "Queso barra (Tybo/Maki)")).toBeGreaterThan(0.8);
    expect(textSimilarity("FECULA DE MANDIOCA X KG", "Fécula de mandioca")).toBe(1);
    expect(textSimilarity("Huevos blancos maple", "Huevo")).toBeGreaterThanOrEqual(0.7);
    expect(textSimilarity("Sal fina", "Manteca")).toBe(0);
    expect(textSimilarity("x kg", "Manteca")).toBe(0);
  });

  it("elige el mejor candidato y descarta empates y bajos", () => {
    const cands = [
      { id: "barra", names: ["Queso barra (Tybo/Maki)"] },
      { id: "reggianito", names: ["Queso reggianito"] },
      { id: "fecula", names: ["Fécula de mandioca"] },
    ];
    expect(bestNameMatch("QUESO REGGIANITO X KG", cands)?.id).toBe("reggianito");
    expect(bestNameMatch("Flete", cands)).toBeNull();
    // "queso" solo es ambiguo entre barra y reggianito
    expect(bestNameMatch("Queso", cands)).toBeNull();
    // un solo candidato válido, sin segundo
    expect(bestNameMatch("fecula mandioca", cands)?.id).toBe("fecula");
  });
});

describe("proveedor de una factura", () => {
  const suppliers = [
    { id: "a", cuit: "30712345674", legalName: "Leo Pelle", tradeName: null },
    { id: "b", cuit: null, legalName: "Cotar S.A.", tradeName: "Cotar" },
  ];
  it("prioriza el CUIT y cae al nombre", () => {
    expect(matchSupplier({ name: "Otro nombre", cuit: "30-71234567-4" }, suppliers)).toBe("a");
    expect(matchSupplier({ name: "COTAR SA", cuit: "30-99999999-1" }, suppliers)).toBe("b");
    expect(matchSupplier({ name: "LEO PELLE", cuit: null }, suppliers)).toBe("a");
    expect(matchSupplier({ name: "Desconocido SRL" }, suppliers)).toBeNull();
    expect(matchSupplier({ cuit: null }, suppliers)).toBeNull();
  });
  it("cuitDigits", () => {
    expect(cuitDigits("30-71234567-4")).toBe("30712345674");
    expect(cuitDigits(null)).toBe("");
  });
});

describe("número y vencimiento de factura", () => {
  it("rellena punto de venta (4) y número (8)", () => {
    expect(normalizeInvoiceNumber("3", 4)).toBe("0003");
    expect(normalizeInvoiceNumber("A-4567", 8)).toBe("00004567");
    expect(normalizeInvoiceNumber("000012345678", 8)).toBe("12345678");
    expect(normalizeInvoiceNumber("", 4)).toBeNull();
    expect(normalizeInvoiceNumber(null, 8)).toBeNull();
  });
  it("formatea el número completo", () => {
    expect(formatInvoiceNumber("0003", "00004567")).toBe("0003-00004567");
    expect(formatInvoiceNumber(null, null)).toBe("s/n");
    expect(formatInvoiceNumber(null, "00000001")).toBe("-----00000001");
  });
  it("vencimiento: el de la factura o emisión + plazo", () => {
    expect(invoiceDueDate({ issueDate: "2026-10-01", dueDate: "2026-10-20", paymentTermsDays: 30 })).toBe(
      "2026-10-20",
    );
    expect(invoiceDueDate({ issueDate: "2026-10-01", paymentTermsDays: 30 })).toBe("2026-10-31");
    expect(invoiceDueDate({ issueDate: "2026-10-01", dueDate: null, paymentTermsDays: 0 })).toBe("2026-10-01");
  });
});

describe("historial de precios (RF-09)", () => {
  const points = [
    { date: "2026-08-10", price: 9000 },
    { date: "2026-08-25", price: 9500 },
    { date: "2026-09-29", price: 9880 },
    { date: "2026-10-01", price: 10150 },
  ];
  it("serie mensual con el último precio de cada mes", () => {
    expect(monthlyPriceSeries(points)).toEqual([
      { month: "2026-08", price: 9500, variationPct: null },
      { month: "2026-09", price: 9880, variationPct: 4 },
      { month: "2026-10", price: 10150, variationPct: 2.73 },
    ]);
    expect(monthlyPriceSeries([])).toEqual([]);
  });
  it("variación contra la compra anterior", () => {
    expect(purchaseVariations(points)).toEqual([null, 5.56, 4, 2.73]);
  });
});

describe("órdenes de compra (RF-10)", () => {
  it("numera correlativamente", () => {
    expect(formatPoNumber(1)).toBe("OC-0001");
    expect(nextPoNumber([])).toBe("OC-0001");
    expect(nextPoNumber(["OC-0001", "OC-0009", "otro", "OC-0003"])).toBe("OC-0010");
  });

  it("estado según lo recibido", () => {
    const ordered = [
      { ingredientId: "q", qty: 40 },
      { ingredientId: "f", qty: 150 },
    ];
    expect(poStatusAfterReception(ordered, {}, "sent")).toBe("sent");
    expect(poStatusAfterReception(ordered, { q: 40 }, "sent")).toBe("partially_received");
    expect(poStatusAfterReception(ordered, { q: 40, f: 100 }, "partially_received")).toBe("partially_received");
    expect(poStatusAfterReception(ordered, { q: 40, f: 150 }, "partially_received")).toBe("received");
    expect(poStatusAfterReception(ordered, { q: 45, f: 150 }, "sent")).toBe("received");
    expect(poStatusAfterReception(ordered, { q: 40, f: 150 }, "cancelled")).toBe("cancelled");
    // dos líneas del mismo insumo se suman
    expect(
      poStatusAfterReception(
        [
          { ingredientId: "q", qty: 20 },
          { ingredientId: "q", qty: 20 },
        ],
        { q: 40 },
        "sent",
      ),
    ).toBe("received");
  });

  it("entregas atrasadas, de hoy y próximas", () => {
    expect(deliveryTiming(null, "2026-10-02")).toEqual({ state: "unscheduled", days: 0 });
    expect(deliveryTiming("2026-09-30", "2026-10-02")).toEqual({ state: "overdue", days: 2 });
    expect(deliveryTiming("2026-10-02", "2026-10-02")).toEqual({ state: "today", days: 0 });
    expect(deliveryTiming("2026-10-05", "2026-10-02")).toEqual({ state: "upcoming", days: 3 });
  });
});

describe("WhatsApp", () => {
  it("normaliza números argentinos", () => {
    expect(whatsappNumber("+54 9 341 555-1234")).toBe("5493415551234");
    expect(whatsappNumber("54 341 5551234")).toBe("5493415551234");
    expect(whatsappNumber("0341 15 555 1234")).toBe("5493415551234");
    expect(whatsappNumber("341 5551234")).toBe("5493415551234");
    expect(whatsappNumber("0054 9 341 5551234")).toBe("5493415551234");
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber("54 1")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
  it("arma el link con el texto codificado", () => {
    expect(whatsappUrl("341 5551234", "Hola Leo\nOC-0001")).toBe(
      "https://wa.me/5493415551234?text=Hola%20Leo%0AOC-0001",
    );
    expect(whatsappUrl(null, "x")).toBeNull();
  });
});
