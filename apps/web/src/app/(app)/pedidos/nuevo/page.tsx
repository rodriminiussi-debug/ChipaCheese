import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { can } from "@/lib/rbac";
import { orderFormData } from "@/features/orders/service";
import { getReceivables } from "@/features/billing/service";
import { OrderForm } from "@/features/orders/components/order-form";

export const metadata = { title: "Nuevo pedido" };

export default async function NewOrderPage(props: PageProps<"/pedidos/nuevo">) {
  const user = await requirePermission("orders:write");
  const { cliente } = await props.searchParams;
  const [data, receivables] = await Promise.all([orderFormData(db), getReceivables(db)]);
  // Aviso de deuda vencida al cargar el pedido: con importe solo para quien ve finanzas.
  const seesMoney = can(user.role, "billing:read");
  const overdueByCustomer = Object.fromEntries(
    receivables.rows
      .filter((r) => r.overdue > 0.5)
      .map((r) => [r.customerId, seesMoney ? r.overdue : (true as const)]),
  );
  return (
    <>
      <PageHeader title="Nuevo pedido" />
      <OrderForm
        data={data}
        defaultCustomerId={typeof cliente === "string" ? cliente : undefined}
        overdueByCustomer={overdueByCustomer}
      />
    </>
  );
}
