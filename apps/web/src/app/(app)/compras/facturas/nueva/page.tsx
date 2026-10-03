import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { InvoiceUpload } from "@/features/purchases/components/invoice-upload";

export const metadata = { title: "Nueva factura" };

export default async function NewInvoicePage() {
  await requirePermission("purchases:write");
  return (
    <>
      <PageHeader
        title="Nueva factura de compra"
        description="Sacale una foto a la factura (o subí el PDF): la IA lee proveedor, número, ítems e IVA y vos confirmás."
      />
      <InvoiceUpload />
    </>
  );
}
