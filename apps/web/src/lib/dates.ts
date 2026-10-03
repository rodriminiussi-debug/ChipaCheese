import type { IsoDate } from "@chipa/domain";

export const TZ = "America/Argentina/Buenos_Aires";

/**
 * Fecha de hoy en Argentina como YYYY-MM-DD (el servidor puede estar en UTC).
 * En tests se congela con APP_TODAY (los datos demo están armados alrededor del 02/10/2026).
 */
export function todayAR(now?: Date): IsoDate {
  if (!now) {
    const frozen = typeof process !== "undefined" ? process.env.APP_TODAY : undefined;
    // En producción solo se respeta con ALLOW_FROZEN_CLOCK=1 (E2E contra el build de producción en CI).
    if (frozen && (process.env.NODE_ENV !== "production" || process.env.ALLOW_FROZEN_CLOCK === "1"))
      return frozen;
    now = new Date();
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Convierte un instante a fecha de negocio argentina. */
export const toIsoDateAR = (d: Date): IsoDate => todayAR(d);

export function formatDateTimeAR(d: Date | string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function formatTimeAR(d: Date | string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
    typeof d === "string" ? new Date(d) : d,
  );
}

export const WEEKDAY_LABELS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
