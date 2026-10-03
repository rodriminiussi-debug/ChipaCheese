import { notFound, redirect } from "next/navigation";
import { isOrderEditable } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getOrder, orderFormData } from "@/features/orders/service";
import { OrderForm } from "@/features/orders/components/order-form";

export const metadata = { title: "Editar pedido" };

export default async function EditOrderPage(props: PageProps<"/pedidos/[id]/editar">) {
  await requirePermission("orders:write");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const order = await getOrder(db, id);
  if (!order) notFound();
  // Solo recibido/confirmado son editables (el servidor también lo valida).
  if (!isOrderEditable(order.status)) redirect(`/pedidos/${id}`);
  const data = await orderFormData(db);
  return (
    <>
      <PageHeader title={`Editar pedido #${order.number}`} description={order.customer.legalName} />
      <OrderForm
        data={data}
        initial={{
          orderId: order.id,
          customerId: order.customerId,
          priceListId: order.priceListId,
          promisedDate: order.promisedDate,
          notes: order.notes,
          items: order.items.map((i) => ({ productId: i.productId, qtyUnits: i.qtyUnits })),
          frozenPrices: Object.fromEntries(order.items.map((i) => [i.productId, i.unitPrice])),
        }}
      />
    </>
  );
}
