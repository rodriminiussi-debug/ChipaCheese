import { describe, expect, it } from "vitest";
import {
  formatCuit,
  invoiceTotals,
  isValidCuit,
  lineNet,
  lineVat,
  priceVariationPct,
  validateInvoiceTotals,
  type InvoiceLine,
} from "./invoices";

const lines: InvoiceLine[] = [
  { qty: 10, unitPriceNet: 9880, vatRate: 21 }, // neto 98.800, IVA 20.748
  { qty: 4, unitPriceNet: 3222, vatRate: 10.5 }, // neto 12.888, IVA 1.353,24 (huevo)
];

describe("lineNet / lineVat (Regla 11)", () => {
  it("neto = qty × precio; IVA = neto × alícuota si no viene en la factura", () => {
    expect(lineNet(lines[0] as InvoiceLine)).toBe(98800);
    expect(lineVat(lines[0] as InvoiceLine)).toBe(20748);
    expect(lineVat(lines[1] as InvoiceLine)).toBe(1353.24);
  });
  it("usa el IVA declarado en la factura cuando viene (nunca recalcula)", () => {
    expect(lineVat({ qty: 10, unitPriceNet: 9880, vatRate: 21, vatAmount: 20750.5 })).toBe(20750.5);
    expect(lineVat({ qty: 1, unitPriceNet: 100, vatRate: 21, vatAmount: 0 })).toBe(0);
    expect(lineVat({ qty: 1, unitPriceNet: 100, vatRate: 21, vatAmount: null })).toBe(21);
  });
});

describe("invoiceTotals", () => {
  it("totales con IVA discriminado por alícuota", () => {
    expect(invoiceTotals(lines)).toEqual({
      net: 111688,
      vat: 22101.24,
      vatByRate: { "21": 20748, "10.5": 1353.24 },
      otherTaxes: 0,
      total: 133789.24,
    });
  });
  it("suma otros tributos (percepciones) y agrupa la misma alícuota", () => {
    const t = invoiceTotals([...lines, { qty: 1, unitPriceNet: 1000, vatRate: 21 }], 500);
    expect(t.vatByRate["21"]).toBe(20958);
    expect(t.otherTaxes).toBe(500);
    expect(t.total).toBe(112688 + 22311.24 + 500);
  });
  it("sin líneas", () => {
    expect(invoiceTotals([])).toEqual({ net: 0, vat: 0, vatByRate: {}, otherTaxes: 0, total: 0 });
  });
});

describe("validateInvoiceTotals", () => {
  it("ok si coincide dentro de la tolerancia ($1 por defecto)", () => {
    expect(
      validateInvoiceTotals({
        lines,
        declared: { net: 111688, vat: 22101.5, total: 133789 },
      }),
    ).toEqual({ ok: true, diffs: [] });
  });
  it("informa cada campo que difiere", () => {
    const r = validateInvoiceTotals({
      lines,
      declared: { net: 111000, vat: 22101.24, total: 140000 },
    });
    expect(r.ok).toBe(false);
    expect(r.diffs).toEqual([
      { field: "net", computed: 111688, declared: 111000 },
      { field: "total", computed: 133789.24, declared: 140000 },
    ]);
  });
  it("net y vat son opcionales; tolerancia y otros tributos configurables", () => {
    expect(validateInvoiceTotals({ lines, declared: { total: 134289.24 }, otherTaxes: 500 }).ok).toBe(true);
    expect(validateInvoiceTotals({ lines, declared: { net: null, vat: null, total: 133790 } }).ok).toBe(true);
    const strict = validateInvoiceTotals({ lines, declared: { total: 133789 }, tolerance: 0.1 });
    expect(strict.diffs).toEqual([{ field: "total", computed: 133789.24, declared: 133789 }]);
  });
  it("detecta un IVA mal leído", () => {
    const r = validateInvoiceTotals({ lines, declared: { vat: 23000, total: 133789.24 } });
    expect(r.diffs.map((d) => d.field)).toEqual(["vat"]);
  });
});

describe("CUIT", () => {
  it("acepta CUITs válidos con y sin guiones", () => {
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("20123456786")).toBe(true);
    expect(isValidCuit("30-12345678-1")).toBe(true);
    expect(isValidCuit("33-69345023-9")).toBe(true); // AFIP
    expect(isValidCuit("27-12345678-0")).toBe(true); // resto 11 → dígito 0
    expect(isValidCuit("20-20000009-9")).toBe(true); // resto 10 → dígito 9
  });
  it("rechaza dígito verificador incorrecto", () => {
    expect(isValidCuit("20-12345678-5")).toBe(false);
    expect(isValidCuit("30-12345678-9")).toBe(false);
    expect(isValidCuit("27-12345678-1")).toBe(false);
    expect(isValidCuit("20-20000009-0")).toBe(false);
  });
  it("rechaza formatos inválidos", () => {
    expect(isValidCuit("")).toBe(false);
    expect(isValidCuit("2012345678")).toBe(false);
    expect(isValidCuit("201234567866")).toBe(false);
    expect(isValidCuit("20-1234567-86")).toBe(false);
    expect(isValidCuit("AB-12345678-6")).toBe(false);
    expect(isValidCuit("20 12345678 6")).toBe(false);
  });
  it("formatCuit", () => {
    expect(formatCuit("30123456781")).toBe("30-12345678-1");
    expect(formatCuit("30-12345678-1")).toBe("30-12345678-1");
    expect(() => formatCuit("123")).toThrow(RangeError);
  });
});

describe("priceVariationPct (RF-09)", () => {
  it("variación porcentual entre compras", () => {
    expect(priceVariationPct(9000, 9880)).toBe(9.78);
    expect(priceVariationPct(10000, 9000)).toBe(-10);
    expect(priceVariationPct(100, 100)).toBe(0);
  });
  it("sin precio anterior válido → null", () => {
    expect(priceVariationPct(0, 100)).toBeNull();
    expect(priceVariationPct(-5, 100)).toBeNull();
  });
});
