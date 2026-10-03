import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { orderFormOptions } from "@/features/purchases/service";
import { OrderForm } from "@/features/purchases/components/order-form";
import { todayAR } from "@/lib/dates";

export const metadata = { title: "Nueva orden de compra" };

export default async function NewOrderPage() {
  await requirePermission("purchases:write");
  const options = await orderFormOptions(db);
  return (
    <>
      <PageHeader title="Nueva orden de compra" description="Se numera sola (OC-0001, OC-0002…)." />
      <OrderForm options={options} today={todayAR()} />
    </>
  );
}
