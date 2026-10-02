import Anthropic from "@anthropic-ai/sdk";
import {
  EXTRACTION_JSON_SCHEMA,
  ExtractionError,
  normalizeExtraction,
  type ExtractedInvoice,
  type InvoiceExtractor,
} from "./extraction";

/** Sonnet más reciente (visión + salida estructurada). Se cambia con la variable AI_MODEL. */
export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

const SYSTEM_PROMPT = `Sos un asistente de carga de comprobantes para una fábrica de chipá congelado de Argentina (Pacon SRL, marca Chipa Cheese). Recibís la foto o el PDF de una factura de COMPRA y devolvés sus datos.

Reglas:
- El proveedor es quien EMITE el comprobante (supplierName, supplierCuit). Nunca uses los datos del receptor (Pacon SRL / Chipa Cheese) como proveedor.
- invoiceType: letra del comprobante (A, B, C, X). Para notas de crédito usá NC_A, NC_B o NC_C.
- pointOfSale es el punto de venta (4 dígitos) y number el número de comprobante (8 dígitos), de "Comp. Nro".
- Fechas en formato AAAA-MM-DD. Los comprobantes argentinos usan DD/MM/AAAA: interpretalos así.
- Importes en pesos, con punto decimal y sin separador de miles (1234.5). No confundas la coma decimal argentina con miles.
- items: una entrada por renglón del comprobante, con la descripción tal como figura. unitPriceNet es el precio unitario SIN IVA (si el comprobante muestra precios con IVA incluido, como en facturas B o C, dividilo por 1 + alícuota). Si hay bonificación en el renglón, usá el precio neto ya bonificado.
- vatRate es la alícuota del renglón en % (21, 10.5, 27, 0). vatAmount es el IVA del renglón si figura; si el comprobante solo discrimina IVA por alícuota, calculalo como neto del renglón por la alícuota; si no podés, null.
- netTotal es el importe neto gravado, vatTotal el IVA total, otherTaxes la suma de percepciones y otros tributos que no son IVA (IIBB, percepción de IVA, impuestos internos), y total el importe total del comprobante. Si un dato no figura, null (otherTaxes: 0 si no hay).
- unit: kg, l o unit según la unidad del renglón (kilos, litros, unidades/bultos).
- No inventes ni corrijas datos: si algo es ilegible o no figura, usá null. Copiá los números tal como se leen aunque los totales no cierren; el usuario los revisa.`;

type Client = Pick<Anthropic, "messages">;

/** Imagen o PDF en base64 como bloque de contenido para la API de mensajes. */
function mediaBlock(file: { bytes: Buffer; contentType: string }): Anthropic.ContentBlockParam {
  const data = file.bytes.toString("base64");
  if (file.contentType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (SUPPORTED_IMAGE_TYPES.includes(file.contentType as ImageType)) {
    return { type: "image", source: { type: "base64", media_type: file.contentType as ImageType, data } };
  }
  throw new ExtractionError(`Formato no soportado: ${file.contentType}`);
}

/** Lee facturas con visión de Claude: imagen o PDF en base64 → JSON estructurado. */
export class ClaudeInvoiceExtractor implements InvoiceExtractor {
  private readonly client: Client;
  private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string; client?: Client } = {}) {
    this.model = opts.model ?? DEFAULT_AI_MODEL;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async extract(file: { bytes: Buffer; contentType: string }): Promise<ExtractedInvoice> {
    const media = mediaBlock(file);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: { effort: "medium", format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [media, { type: "text", text: "Extraé los datos de esta factura de compra." }],
          },
        ],
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ExtractionError("El servicio de IA está saturado.");
      if (e instanceof Anthropic.AuthenticationError)
        throw new ExtractionError("La clave de la IA no es válida (ANTHROPIC_API_KEY).");
      if (e instanceof Anthropic.APIError) throw new ExtractionError(`Error del servicio de IA (${e.status}).`);
      throw new ExtractionError("No se pudo conectar con el servicio de IA.");
    }

    return parseClaudeResponse(response, this.model);
  }
}

/** Separado para testearlo sin red: toma la respuesta de la API y devuelve la factura normalizada. */
export function parseClaudeResponse(
  response: Pick<Anthropic.Message, "content" | "stop_reason">,
  model: string,
): ExtractedInvoice {
  if (response.stop_reason === "refusal") throw new ExtractionError("La IA no quiso leer este archivo.");
  if (response.stop_reason === "max_tokens")
    throw new ExtractionError("La factura es demasiado larga para leerla de una vez.");
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) throw new ExtractionError("La IA no devolvió datos.");
  let raw: unknown;
  try {
    raw = JSON.parse(block.text);
  } catch {
    throw new ExtractionError("La IA devolvió una respuesta que no se pudo interpretar.", block.text);
  }
  return normalizeExtraction(raw, { provider: "claude", model, raw });
}
