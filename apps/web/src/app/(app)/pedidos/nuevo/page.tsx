import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { orderFormData } from "@/features/orders/service";
import { OrderForm } from "@/features/orders/components/order-form";

export const metadata = { title: "Nuevo pedido" };

export default async function NewOrderPage(props: PageProps<"/pedidos/nuevo">) {
  await requirePermission("orders:write");
  const { cliente } = await props.searchParams;
  const data = await orderFormData(db);
  return (
    <>
      <PageHeader title="Nuevo pedido" />
      <OrderForm data={data} defaultCustomerId={typeof cliente === "string" ? cliente : undefined} />
    </>
  );
}
