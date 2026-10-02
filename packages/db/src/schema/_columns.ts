import { date, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** PK uuid generada en la base (también se puede generar en el cliente para la cola offline). */
export const id = () => uuid().primaryKey().defaultRandom();
/** Importes en ARS. */
export const money = () => numeric({ precision: 14, scale: 2, mode: "number" });
/** Cantidades físicas (kg, L, unidades) con 3 decimales. */
export const qty = () => numeric({ precision: 14, scale: 3, mode: "number" });
/** Porcentajes (márgenes, alícuotas). */
export const pct = () => numeric({ precision: 6, scale: 2, mode: "number" });
/** Fecha de negocio sin hora, como string ISO YYYY-MM-DD. */
export const day = () => date({ mode: "string" });
export const tstz = () => timestamp({ withTimezone: true, mode: "date" });

export const timestamps = () => ({
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
