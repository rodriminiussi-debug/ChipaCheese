/**
 * Permisos por rol, según la tabla "Usuarios y permisos" del relevamiento.
 * Puro (sin imports de servidor): se usa en server y en client para mostrar/ocultar UI.
 * La autorización real SIEMPRE se valida en el servidor (requirePermission / action()).
 */
export const ROLES = [
  "admin",
  "production_manager",
  "logistics",
  "operator",
  "store",
  "technical_lead",
  "accountant",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Dirección",
  production_manager: "Jefa de producción",
  logistics: "Logística",
  operator: "Operario",
  store: "Local",
  technical_lead: "Responsable técnico",
  accountant: "Contadora",
};

export const PERMISSIONS = [
  "dashboard:read", // tablero operativo
  "finance:read", // resultado, costeo, márgenes
  "finance:write", // gastos fijos, parámetros de costo
  "customers:read",
  "customers:write",
  "orders:read",
  "orders:write",
  "suppliers:read",
  "suppliers:write",
  "purchases:read",
  "purchases:write",
  "stock:read",
  "stock:write",
  "production:read",
  "production:write", // plan, producciones, recetas
  "production:record", // carga de planta: pesadas, envasado, consumos
  "recipes:write",
  "dispatch:read",
  "dispatch:write",
  "billing:read", // cuentas corrientes, facturas, cheques
  "billing:write",
  "collections:write", // cobros en ruta
  "prices:write",
  "store:read",
  "store:write",
  "quality:read",
  "quality:write",
  "quality:record", // limpieza y temperaturas desde la tablet
  "maintenance:read",
  "maintenance:write",
  "people:read",
  "people:write",
  "export", // Excel / PDF
  "training:read", // capacitación (todos los roles)
  "purchases:receive", // recibir mercadería (también desde la tablet de planta)
  "maintenance:report", // avisar una falla de un equipo o del vehículo
  "stock:count", // contar el inventario físico
  "admin", // usuarios y configuración
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

const MATRIX: Record<Role, readonly Permission[]> = {
  admin: ALL,
  // "Todo menos finanzas"
  production_manager: ALL.filter(
    (p) =>
      ![
        "finance:read",
        "finance:write",
        "billing:read",
        "billing:write",
        "collections:write",
        "prices:write",
        "admin",
      ].includes(p),
  ),
  // "Despacho y cobros"
  // Cobra desde la pantalla de la ruta: no necesita el listado general de cobranzas ni el stock.
  logistics: [
    "training:read",
    "dispatch:read",
    "dispatch:write",
    "collections:write",
    "orders:read",
    "customers:read",
    "quality:record",
    "maintenance:report",
  ],
  // "Solo carga de su tarea"
  operator: [
    "training:read",
    "production:record",
    "quality:record",
    "production:read",
    "purchases:receive",
    "maintenance:report",
    "stock:count",
  ],
  // "Local"
  // Ve el stock del local y elige clientes desde su pantalla; no el listado de clientes, pedidos ni el stock de planta.
  store: ["training:read", "store:read", "store:write", "maintenance:report"],
  // "Consulta y exportación de registros BPM"
  technical_lead: [
    "training:read",
    "quality:read",
    "maintenance:read",
    "production:read",
    "dispatch:read",
    "stock:read",
    "export",
  ],
  // "Exportación de compras y ventas"
  accountant: [
    "training:read",
    "purchases:read",
    "suppliers:read",
    "billing:read",
    "customers:read",
    "store:read",
    "export",
  ],
};

export function can(role: Role, permission: Permission | readonly Permission[]): boolean {
  const granted = MATRIX[role];
  const needed = Array.isArray(permission) ? permission : [permission as Permission];
  return needed.some((p) => granted.includes(p));
}

export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}

/** Página de inicio según rol (operarios van al modo planta). */
export function homeFor(role: Role): string {
  switch (role) {
    case "operator":
      return "/planta";
    case "logistics":
      return "/despacho";
    case "store":
      return "/local";
    case "technical_lead":
      return "/calidad";
    case "accountant":
      return "/compras";
    default:
      return "/tablero";
  }
}
