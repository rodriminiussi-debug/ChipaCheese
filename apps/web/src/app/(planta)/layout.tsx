import Link from "next/link";
import { LogOut } from "lucide-react";
import { requirePermission } from "@/server/auth/session";
import { logoutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/brand";
import { OfflineQueueIndicator } from "@/components/pwa/pwa";

/** Layout de tablet de planta: pantalla completa, botones grandes, sin menú lateral. */
export default async function PlantLayout({ children }: LayoutProps<"/">) {
  const user = await requirePermission(["production:record", "quality:record"]);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-primary text-primary-foreground flex h-16 items-center justify-between px-4">
        <Link href="/planta" className="flex items-center gap-2 text-xl font-bold">
          <span className="grid size-11 place-items-center rounded-full bg-white">
            <BrandMark className="size-9" />
          </span>
          Planta
        </Link>
        <div className="flex items-center gap-3">
          <OfflineQueueIndicator />
          <span className="text-lg font-semibold" data-testid="current-user">
            {user.initials}
          </span>
          <form action={logoutAction}>
            <Button type="submit" variant="secondary" size="lg" className="h-12">
              <LogOut /> Salir
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 text-lg">{children}</main>
    </div>
  );
}
