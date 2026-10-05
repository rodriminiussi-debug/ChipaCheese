import { permissionsOf, type Permission, type Role } from "@/lib/rbac";

/** Cada permiso, dicho en palabras para la pantalla "Mi cuenta". */
export const PERMISSION_TEXT: Record<Permission, string> = {
  "dashboard:read": "Ver el tablero",
  "finance:read": "Ver resultados, costos y márgenes",
  "finance:write": "Cargar gastos fijos y parámetros de costo",
  "customers:read": "Ver clientes",
  "customers:write": "Crear y editar clientes",
  "orders:read": "Ver pedidos",
  "orders:write": "Cargar y modificar pedidos",
  "suppliers:read": "Ver proveedores",
  "suppliers:write": "Crear y editar proveedores",
  "purchases:read": "Ver compras, órdenes y facturas",
  "purchases:write": "Cargar facturas, armar órdenes de compra y pagar a proveedores",
  "stock:read": "Ver el stock",
  "stock:write": "Ajustar stock, transferir y confirmar inventarios",
  "production:read": "Ver la producción",
  "production:write": "Armar el plan y las producciones",
  "production:record": "Cargar consumos, pesadas y envasado desde la planta",
  "recipes:write": "Cambiar la receta maestra",
  "dispatch:read": "Ver rutas y remitos",
  "dispatch:write": "Armar rutas, remitos y entregas",
  "dispatch:settle": "Recibir la rendición de lo cobrado por el chofer",
  "billing:read": "Ver cuentas corrientes, facturas y cheques",
  "billing:write": "Facturar y gestionar cheques",
  "collections:write": "Cobrar en ruta y rendir lo cobrado",
  "prices:write": "Cambiar precios",
  "store:read": "Ver las ventas y el stock del local",
  "store:write": "Vender y cerrar la caja del local",
  "quality:read": "Ver los registros de calidad (BPM)",
  "quality:write": "Gestionar calidad y reclamos",
  "quality:record": "Registrar limpieza y temperaturas",
  "maintenance:read": "Ver el mantenimiento",
  "maintenance:write": "Gestionar planes y órdenes de mantenimiento",
  "maintenance:report": "Avisar la falla de un equipo",
  "people:read": "Ver personas y tareas",
  "people:write": "Asignar tareas y personas",
  export: "Exportar a Excel o PDF",
  "training:read": "Ver la capacitación",
  "purchases:receive": "Recibir mercadería de los proveedores",
  "stock:count": "Contar el inventario",
  "catalog:write": "Dar de alta y editar productos, insumos, zonas, listas, vehículos y equipos",
  admin: "Administrar usuarios y configuración",
};

/** Lo que puede hacer un rol, en palabras. */
export const permissionsInWords = (role: Role): string[] =>
  permissionsOf(role).map((p) => PERMISSION_TEXT[p]);
