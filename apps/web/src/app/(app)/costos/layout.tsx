import { FinanceTabs } from "@/features/finance/components/finance-tabs";
import { requirePermission } from "@/server/auth/session";

export const metadata = { title: "Gastos y costeo" };

export default async function FinanceLayout({ children }: LayoutProps<"/costos">) {
  // Cada página vuelve a validar su permiso: los layouts no se re-ejecutan al navegar entre subrutas.
  await requirePermission("finance:read");
  return (
    <>
      <FinanceTabs />
      {children}
    </>
  );
}
