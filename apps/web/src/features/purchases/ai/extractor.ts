import { env } from "@/env";
import { ClaudeInvoiceExtractor } from "./claude-extractor";
import { MockInvoiceExtractor } from "./mock-extractor";
import type { InvoiceExtractor } from "./extraction";

export type { ExtractedInvoice, ExtractedItem, InvoiceExtractor } from "./extraction";
export { ExtractionError } from "./extraction";

/**
 * Extractor activo: simulado si `AI_MOCK=1` o no hay `ANTHROPIC_API_KEY`; si no, Claude.
 * La clave nunca se guarda en el repo: vive solo en el entorno.
 */
export function getInvoiceExtractor(): InvoiceExtractor {
  if (env.AI_MOCK === "1" || !env.ANTHROPIC_API_KEY) return new MockInvoiceExtractor();
  return new ClaudeInvoiceExtractor({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL });
}
