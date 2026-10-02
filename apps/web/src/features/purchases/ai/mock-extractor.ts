import { normalizeExtraction, type ExtractedInvoice, type InvoiceExtractor } from "./extraction";

/**
 * Respuesta fija que simula lo que devolvería la IA: factura A de Leo Pelle con queso barra,
 * reggianito y fécula (IVA 21 % y 10,5 %). Los totales cierran exacto:
 *   neto 950.500 + IVA 171.412,50 + percepciones 9.505 = 1.131.417,50
 */
export const MOCK_INVOICE_RAW = {
  supplierName: "LEO PELLE",
  supplierCuit: "30-71234567-1",
  invoiceType: "A",
  pointOfSale: "0003",
  number: "00004567",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  items: [
    {
      description: "QUESO TYBO BARRA X KG",
      qty: 40,
      unit: "kg",
      unitPriceNet: 10150,
      vatRate: 21,
      vatAmount: 85260,
    },
    {
      description: "QUESO REGGIANITO X KG",
      qty: 20,
      unit: "kg",
      unitPriceNet: 13800,
      vatRate: 21,
      vatAmount: 57960,
    },
    {
      description: "FECULA DE MANDIOCA X KG",
      qty: 150,
      unit: "kg",
      unitPriceNet: 1790,
      vatRate: 10.5,
      vatAmount: 28192.5,
    },
  ],
  netTotal: 950500,
  vatTotal: 171412.5,
  otherTaxes: 9505,
  total: 1131417.5,
  notes: "Percepción IIBB Santa Fe",
};

/** Extractor determinístico para tests, E2E y entornos sin API key. */
export class MockInvoiceExtractor implements InvoiceExtractor {
  async extract(): Promise<ExtractedInvoice> {
    return normalizeExtraction(structuredClone(MOCK_INVOICE_RAW), {
      provider: "mock",
      model: "mock",
      raw: MOCK_INVOICE_RAW,
    });
  }
}
