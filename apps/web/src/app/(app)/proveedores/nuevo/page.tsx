import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { SupplierForm } from "@/features/suppliers/components/supplier-form";

export const metadata = { title: "Nuevo proveedor" };

export default async function NewSupplierPage() {
  await requirePermission("suppliers:write");
  return (
    <>
      <PageHeader title="Nuevo proveedor" />
      <SupplierForm />
    </>
  );
}
