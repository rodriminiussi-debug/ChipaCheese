import { BrandLogo } from "@/components/brand/brand";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";
import { OfflineQueueIndicator } from "@/components/pwa/pwa";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <SidebarProvider>
      <AppSidebar user={{ name: user.name, role: user.role }} />
      <SidebarInset>
        {/* En pantallas grandes el encabezado desaparece (`contents`) y solo queda el aviso, flotando abajo a la derecha. */}
        <header className="flex h-12 items-center gap-2 border-b px-4 md:contents">
          <SidebarTrigger className="md:hidden" />
          <BrandLogo className="w-28 md:hidden" />
          {/* Celular (pedidos, ruta del chofer): registros pendientes de enviar y reintento al volver la señal. */}
          <div className="ml-auto md:fixed md:right-4 md:bottom-4 md:z-50">
            <OfflineQueueIndicator />
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
