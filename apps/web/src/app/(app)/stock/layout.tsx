import { Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { StockTabs } from "@/features/stock/components/stock-tabs";
import { requirePermission } from "@/server/auth/session";

export const metadata = { title: "Stock" };

export default async function StockLayout({ children }: LayoutProps<"/stock">) {
  await requirePermission("stock:read");
  return (
    <>
      <PageHeader
        title="Stock y cobertura"
        description="Materia prima, producto terminado, movimientos, inventario físico y simulador (RF-13 a RF-17)."
        actions={
          <Button asChild variant="outline">
            <a href="/api/stock/export" download>
              <Download /> Descargar Excel
            </a>
          </Button>
        }
      />
      <StockTabs />
      {children}
    </>
  );
}
