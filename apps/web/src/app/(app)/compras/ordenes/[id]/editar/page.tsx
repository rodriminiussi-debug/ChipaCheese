import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getOrder, orderFormOptions } from "@/features/purchases/service";
import { OrderForm } from "@/features/purchases/components/order-form";
import { toInput } from "@/features/purchases/input";
import { todayAR } from "@/lib/dates";

export default async function EditOrderPage(props: PageProps<"/compras/ordenes/[id]/editar">) {
  await requirePermission("purchases:write");
  const { id } = await props.params;
  const [order, options] = await Promise.all([getOrder(db, id), orderFormOptions(db)]);
  if (!order) notFound();
  if (order.status !== "draft") redirect(`/compras/ordenes/${id}`);
  return (
    <>
      <PageHeader title={`Editar ${order.number}`} />
      <OrderForm
        options={options}
        orderId={order.id}
        today={todayAR()}
        initial={{
          supplierId: order.supplierId,
          orderedAt: order.orderedAt,
          expectedAt: order.expectedAt ?? "",
          responsibleId: order.responsibleId,
          notes: order.notes ?? "",
          items: order.items.map((i) => ({
            ingredientId: i.ingredientId,
            qty: toInput(i.qty),
            estimatedUnitPrice: toInput(i.estimatedUnitPrice),
          })),
        }}
      />
    </>
  );
}
