import type { Tone } from "@/components/app/status-badge";
import type { PriceStatus } from "./service";

export const PRICE_STATUS: Record<PriceStatus, { label: string; tone: Tone }> = {
  ok: { label: "En margen", tone: "good" },
  below_target: { label: "Bajo el margen objetivo", tone: "bad" },
  below_cost: { label: "Bajo el costo", tone: "bad" },
  no_price: { label: "Sin precio", tone: "neutral" },
  no_cost: { label: "Precio faltante", tone: "warn" },
};
