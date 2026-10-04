import type { Route } from "next";
import {
  Boxes,
  Building2,
  ChefHat,
  ClipboardList,
  Factory,
  PackageSearch,
  GraduationCap,
  LayoutDashboard,
  Receipt,
  ScanSearch,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tablet,
  Tags,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/rbac";

export interface NavItem {
  title: string;
  href: Route;
  icon: LucideIcon;
  permission: Permission | Permission[];
  /** Módulo del relevamiento (M1..M8) para trazabilidad con el backlog. */
  module?: string;
}
export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Navegación principal. Cada módulo agrega acá sus pantallas de primer nivel. */
export const NAV: NavSection[] = [
  {
    title: "General",
    items: [
      {
        title: "Tablero",
        href: "/tablero",
        icon: LayoutDashboard,
        permission: ["dashboard:read", "finance:read"],
        module: "M8",
      },
      {
        title: "Modo planta",
        href: "/planta",
        icon: Tablet,
        permission: ["production:record", "quality:record"],
      },
      {
        title: "Capacitación",
        href: "/capacitacion" as Route,
        icon: GraduationCap,
        permission: "training:read",
      },
    ],
  },
  {
    title: "Comercial",
    items: [
      { title: "Pedidos", href: "/pedidos", icon: ClipboardList, permission: "orders:read", module: "M1" },
      { title: "Clientes", href: "/clientes", icon: Users, permission: "customers:read", module: "M1" },
      { title: "Cobranzas", href: "/cobranzas", icon: Wallet, permission: "billing:read", module: "M6" },
      {
        title: "Precios",
        href: "/precios",
        icon: Tags,
        permission: ["finance:read", "prices:write"],
        module: "M6",
      },
      { title: "Local", href: "/local", icon: Store, permission: "store:read", module: "M6" },
    ],
  },
  {
    title: "Operaciones",
    items: [
      {
        title: "Producción",
        href: "/produccion",
        icon: Factory,
        permission: "production:read",
        module: "M4",
      },
      {
        title: "Receta maestra",
        href: "/produccion/receta",
        icon: ChefHat,
        permission: "production:read",
        module: "M4",
      },
      { title: "Stock", href: "/stock", icon: Boxes, permission: "stock:read", module: "M3" },
      { title: "Compras", href: "/compras", icon: ShoppingCart, permission: "purchases:read", module: "M2" },
      {
        title: "Proveedores",
        href: "/proveedores",
        icon: Building2,
        permission: "suppliers:read",
        module: "M2",
      },
      { title: "Despacho", href: "/despacho", icon: Truck, permission: "dispatch:read", module: "M5" },
    ],
  },
  {
    title: "Calidad",
    items: [
      {
        title: "Registros BPM",
        href: "/calidad",
        icon: ShieldCheck,
        permission: "quality:read",
        module: "M7",
      },
      {
        title: "Trazabilidad",
        href: "/calidad/trazabilidad",
        icon: ScanSearch,
        permission: ["quality:read", "dispatch:read"],
        module: "M7",
      },
      {
        title: "Mantenimiento",
        href: "/mantenimiento",
        icon: Wrench,
        permission: "maintenance:read",
        module: "M7",
      },
    ],
  },
  {
    title: "Administración",
    items: [
      {
        title: "Personas y tareas",
        href: "/personas",
        icon: UserCog,
        permission: "people:read",
        module: "M4",
      },
      { title: "Catálogo", href: "/catalogo" as Route, icon: PackageSearch, permission: "catalog:write" },
      { title: "Gastos y costeo", href: "/costos", icon: Receipt, permission: "finance:read", module: "M8" },
      { title: "Configuración", href: "/admin", icon: Settings, permission: "admin" },
    ],
  },
];
