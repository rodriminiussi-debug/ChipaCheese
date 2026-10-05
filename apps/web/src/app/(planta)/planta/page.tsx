import Link from "next/link";
import type { Route } from "next";
import {
  ClipboardList,
  GraduationCap,
  Package,
  Scale,
  SprayCan,
  Thermometer,
  Truck,
  Wrench,
} from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can, type Permission } from "@/lib/rbac";

/**
 * Inicio del modo planta. Cada módulo agrega acá su acceso directo (tarjeta grande).
 * Requisito no funcional: cargar un registro de planta en menos de 30 segundos.
 */
const TILES: { title: string; href: Route; icon: typeof Scale; permission: Permission; testId: string }[] = [
  {
    title: "Tareas de hoy",
    href: "/planta/tareas" as Route,
    icon: ClipboardList,
    permission: "production:record",
    testId: "tile-tareas",
  },
  {
    title: "Producción y pesadas",
    href: "/planta/produccion" as Route,
    icon: Scale,
    permission: "production:record",
    testId: "tile-produccion",
  },
  {
    title: "Envasado y etiquetas",
    href: "/planta/envasado" as Route,
    icon: Package,
    permission: "production:record",
    testId: "tile-envasado",
  },
  {
    title: "Limpieza",
    href: "/planta/limpieza" as Route,
    icon: SprayCan,
    permission: "quality:record",
    testId: "tile-limpieza",
  },
  {
    title: "Temperaturas",
    href: "/planta/temperaturas" as Route,
    icon: Thermometer,
    permission: "quality:record",
    testId: "tile-temperaturas",
  },
  {
    title: "Recibir mercadería",
    href: "/planta/recepcion" as Route,
    icon: Truck,
    permission: "purchases:receive",
    testId: "tile-recepcion",
  },
  {
    title: "Avisar una falla",
    href: "/planta/falla" as Route,
    icon: Wrench,
    permission: "maintenance:report",
    testId: "tile-falla",
  },
  {
    title: "Capacitación",
    href: "/capacitacion" as Route,
    icon: GraduationCap,
    permission: "training:read",
    testId: "tile-capacitacion",
  },
];

export default async function PlantHome() {
  const user = await requireUser();
  const tiles = TILES.filter((t) => can(user.role, t.permission));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tiles.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          data-testid={t.testId}
          className="bg-card hover:bg-accent flex h-36 items-center gap-4 rounded-xl border p-6 text-2xl font-semibold shadow-sm transition-colors"
        >
          <t.icon className="text-primary size-12" />
          {t.title}
        </Link>
      ))}
    </div>
  );
}
