/**
 * Servicio de compras (M2). Se divide por tema; este archivo reexporta todo para que otros
 * módulos importen desde un solo lugar (p. ej. costeo M8: `getLatestPrices`).
 */
export * from "./invoices";
export * from "./prices";
export * from "./orders";
export * from "./receptions";
export * from "./account";
export * from "./reports";
