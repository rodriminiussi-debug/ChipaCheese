import { BillingTabs } from "@/features/billing/components/billing-tabs";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";

export const metadata = { title: "Cobranzas" };

export default async function BillingLayout({ children }: LayoutProps<"/cobranzas">) {
  // Cada página vuelve a validar su permiso: los layouts no se re-ejecutan al navegar entre subrutas.
  const user = await requirePermission(["billing:read", "collections:write"]);
  return (
    <>
      <BillingTabs showImport={can(user.role, "billing:write")} />
      {children}
    </>
  );
}
