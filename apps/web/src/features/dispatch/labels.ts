import { formatDateAR, isoWeekday } from "@chipa/domain";
import type { Tone } from "@/components/app/status-badge";
import { WEEKDAY_LABELS } from "@/lib/dates";

/** Etiquetas en español del módulo de despacho (M5). */

export const ROUTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "Planificada", tone: "info" },
  in_progress: { label: "En curso", tone: "warn" },
  done: { label: "Cerrada", tone: "good" },
  cancelled: { label: "Cancelada", tone: "bad" },
};

export const DISPATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  prepared: { label: "Remito preparado", tone: "warn" },
  delivered: { label: "Entregado", tone: "good" },
  rejected: { label: "Rechazado", tone: "bad" },
  cancelled: { label: "Anulado", tone: "neutral" },
};

export const STOP_KIND: Record<string, string> = {
  delivery: "Entrega",
  supplier_pickup: "Retiro en proveedor",
  other: "Otra parada",
};

/** Número de remito como se imprime: "N° 00000012". */
export function formatDispatchNumber(n: number): string {
  return `N° ${String(n).padStart(8, "0")}`;
}

/** Link de Google Maps que busca una dirección (se abre en la app del celular). */
export function mapsUrl(...parts: (string | null | undefined)[]): string {
  const query = parts.filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Link de WhatsApp a un número (solo dígitos). */
export function whatsappUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/** "AAAA-MM" de una fecha ISO. */
export const monthOf = (date: string) => date.slice(0, 7);

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
/** "2026-10" → "octubre de 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? month} de ${y}`;
}

/** "Vie 02/10/2026". */
export const weekdayDate = (d: string) => `${WEEKDAY_LABELS[isoWeekday(d)]} ${formatDateAR(d)}`;

/** "Lun · Mié · Vie" para los días de reparto de una zona. */
export const weekdaysText = (days: readonly number[]) =>
  days.length
    ? [...days]
        .sort()
        .map((d) => WEEKDAY_LABELS[d])
        .join(" · ")
    : "sin días fijados";

/** URL de una conformidad guardada (la sirve /api/files con control de sesión). */
export const proofUrl = (key: string) => `/api/files/${key}`;
