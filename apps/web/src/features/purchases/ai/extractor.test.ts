import { describe, expect, it, vi } from "vitest";
import { invoiceTotals, validateInvoiceTotals } from "@chipa/domain";
import { ClaudeInvoiceExtractor, DEFAULT_AI_MODEL, parseClaudeResponse } from "./claude-extractor";
import { ExtractionError, normalizeDate, normalizeExtraction, normalizeInvoiceKind } from "./extraction";
import { getInvoiceExtractor } from "./extractor";
import { MockInvoiceExtractor } from "./mock-extractor";

/** Respuesta "sucia" como podría devolverla Claude: números y fechas con formato argentino. */
const SAMPLE_RESPONSE = {
  supplierName: "  Mancinelli Hnos. S.R.L. ",
  supplierCuit: "30-70123456-8",
  invoiceType: "Factura A",
  pointOfSale: "12",
  number: "345",
  issueDate: "05/10/2026",
  dueDate: "",
  items: [
    {
      description: "HUEVO BLANCO X KG",
      qty: "18,000",
      unit: "Kgs",
      unitPriceNet: "3.222,00",
      vatRate: 10.5,
      vatAmount: "6.088,95",
    },
    {
      description: "JAMON COCIDO FETEADO",
      qty: 5,
      unit: "kg",
      unitPriceNet: 9100,
      vatRate: "21",
      vatAmount: null,
    },
    { description: "", qty: 1, unit: "kg", unitPriceNet: 1, vatRate: 21, vatAmount: 0 },
  ],
  netTotal: "103.496,00",
  vatTotal: null,
  otherTaxes: null,
  total: 120_000,
  notes: null,
};

describe("normalización de la respuesta de Claude (RF-08)", () => {
  const meta = { provider: "claude" as const, model: "x", raw: SAMPLE_RESPONSE };

  it("limpia textos, fechas, números, CUIT, unidades y alícuotas", () => {
    const e = normalizeExtraction(SAMPLE_RESPONSE, meta);
    expect(e.supplierName).toBe("Mancinelli Hnos. S.R.L.");
    expect(e.supplierCuit).toBe("30701234568");
    expect(e.invoiceType).toBe("A");
    expect(e.pointOfSale).toBe("0012");
    expect(e.number).toBe("00000345");
    expect(e.issueDate).toBe("2026-10-05");
    expect(e.dueDate).toBeNull();
    expect(e.items).toHaveLength(2); // la línea sin descripción se descarta
    expect(e.items[0]).toEqual({
      description: "HUEVO BLANCO X KG",
      qty: 18,
      unit: "kg",
      unitPriceNet: 3222,
      vatRate: 10.5,
      vatAmount: 6088.95,
    });
    expect(e.items[1]).toMatchObject({ vatRate: 21, vatAmount: null });
    expect(e.netTotal).toBe(103496);
    expect(e.vatTotal).toBeNull();
    expect(e.otherTaxes).toBe(0);
    expect(e.total).toBe(120000);
  });

  it("tolera datos faltantes sin lanzar", () => {
    const e = normalizeExtraction({ items: [{ description: "Algo", vatRate: 999 }] }, meta);
    expect(e.supplierName).toBeNull();
    expect(e.items[0]).toMatchObject({ qty: 0, unitPriceNet: 0, vatRate: 21 });
    expect(normalizeExtraction({}, meta).items).toEqual([]);
    expect(() => normalizeExtraction("texto", meta)).toThrow(ExtractionError);
    expect(() => normalizeExtraction(null, meta)).toThrow(ExtractionError);
  });

  it("fechas, tipos y CUIT inválidos quedan en null", () => {
    expect(normalizeDate("31/02/2026")).toBeNull();
    expect(normalizeDate("ayer")).toBeNull();
    expect(normalizeDate(20261001)).toBeNull();
    expect(normalizeDate("2026-10-01T00:00:00Z")).toBe("2026-10-01");
    expect(normalizeDate("1-10-26")).toBe("2026-10-01");
    expect(normalizeInvoiceKind("nota de credito a")).toBe("NC_A");
    expect(normalizeInvoiceKind("Nota-de-crédito")).toBeNull();
    expect(normalizeInvoiceKind("nc a")).toBe("NC_A");
    expect(normalizeInvoiceKind("b")).toBe("B");
    expect(normalizeInvoiceKind(null)).toBeNull();
    expect(normalizeExtraction({ supplierCuit: "123" }, meta).supplierCuit).toBeNull();
  });
});

describe("parseClaudeResponse (sin red)", () => {
  const ok = (text: string) => ({
    stop_reason: "end_turn" as const,
    content: [{ type: "text" as const, text, citations: null }],
  });

  it("interpreta el JSON de la respuesta y conserva la respuesta cruda", () => {
    const e = parseClaudeResponse(ok(JSON.stringify(SAMPLE_RESPONSE)), "m");
    expect(e.meta).toMatchObject({ provider: "claude", model: "m" });
    expect(e.meta.raw).toEqual(SAMPLE_RESPONSE);
    expect(e.items).toHaveLength(2);
  });

  it("falla con mensajes claros", () => {
    expect(() => parseClaudeResponse(ok("no es json"), "m")).toThrow(/no se pudo interpretar/);
    expect(() => parseClaudeResponse({ stop_reason: "refusal", content: [] }, "m")).toThrow(/no quiso/);
    expect(() => parseClaudeResponse({ stop_reason: "max_tokens", content: [] }, "m")).toThrow(
      /demasiado larga/,
    );
    expect(() => parseClaudeResponse({ stop_reason: "end_turn", content: [] }, "m")).toThrow(
      /no devolvió datos/,
    );
  });
});

describe("ClaudeInvoiceExtractor (cliente simulado)", () => {
  function fakeClient(text: string) {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text }] });
    return { create, client: { messages: { create } } as never };
  }

  it("manda la imagen en base64 con el modelo por defecto y salida estructurada", async () => {
    const { create, client } = fakeClient(JSON.stringify(SAMPLE_RESPONSE));
    const extractor = new ClaudeInvoiceExtractor({ client });
    const e = await extractor.extract({ bytes: Buffer.from("fake-image"), contentType: "image/jpeg" });
    expect(e.items).toHaveLength(2);
    const req = create.mock.calls[0]![0];
    expect(req.model).toBe(DEFAULT_AI_MODEL);
    expect(req.output_config.format.type).toBe("json_schema");
    const [media] = req.messages[0].content;
    expect(media).toMatchObject({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: Buffer.from("fake-image").toString("base64"),
      },
    });
  });

  it("los PDF van como bloque document y el modelo es configurable", async () => {
    const { create, client } = fakeClient(JSON.stringify(SAMPLE_RESPONSE));
    await new ClaudeInvoiceExtractor({ client, model: "otro-modelo" }).extract({
      bytes: Buffer.from("%PDF"),
      contentType: "application/pdf",
    });
    const req = create.mock.calls[0]![0];
    expect(req.model).toBe("otro-modelo");
    expect(req.messages[0].content[0]).toMatchObject({ type: "document" });
  });

  it("rechaza formatos que la API no lee (p. ej. HEIC) y errores del servicio", async () => {
    const { client } = fakeClient("{}");
    await expect(
      new ClaudeInvoiceExtractor({ client }).extract({ bytes: Buffer.from("x"), contentType: "image/heic" }),
    ).rejects.toThrow(/Formato no soportado/);

    const failing = { messages: { create: vi.fn().mockRejectedValue(new Error("ECONNRESET")) } } as never;
    await expect(
      new ClaudeInvoiceExtractor({ client: failing }).extract({
        bytes: Buffer.from("x"),
        contentType: "image/png",
      }),
    ).rejects.toThrow(/No se pudo conectar/);
  });
});

describe("MockInvoiceExtractor", () => {
  it("es determinístico y la factura cierra (Regla 11)", async () => {
    const a = await new MockInvoiceExtractor().extract();
    const b = await new MockInvoiceExtractor().extract();
    expect(a).toEqual(b);
    expect(a.supplierName).toBe("LEO PELLE");
    expect(a.items.map((i) => i.vatRate)).toEqual([21, 21, 10.5]);
    const check = validateInvoiceTotals({
      lines: a.items,
      declared: { net: a.netTotal, vat: a.vatTotal, total: a.total! },
      otherTaxes: a.otherTaxes,
    });
    expect(check.ok).toBe(true);
    expect(invoiceTotals(a.items, a.otherTaxes).total).toBe(1131417.5);
  });

  it("getInvoiceExtractor usa el simulado con AI_MOCK=1 (tests y E2E)", () => {
    expect(getInvoiceExtractor()).toBeInstanceOf(MockInvoiceExtractor);
  });
});
