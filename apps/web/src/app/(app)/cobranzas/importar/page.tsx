import { PageHeader } from "@/components/app/page-header";
import { ArcaImport } from "@/features/billing/components/arca-import";
import { requirePermission } from "@/server/auth/session";

export const metadata = { title: "Importar comprobantes de ARCA" };

export default async function ArcaImportPage() {
  await requirePermission("billing:write");
  return (
    <>
      <PageHeader
        title="Importar «Mis Comprobantes» de ARCA"
        description="Subí el CSV de comprobantes emitidos para cargarlos como facturas, o el de recibidos para conciliarlos con las compras (RF-32)."
      />
      <ArcaImport />
    </>
  );
}
