import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { customerFormOptions, getCustomer } from "@/features/customers/service";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { can } from "@/lib/rbac";
import { CHANNEL } from "@/lib/labels";

export default async function CustomerPage(props: PageProps<"/clientes/[id]">) {
  const user = await requirePermission("customers:read");
  const { id } = await props.params;
  const [customer, options] = await Promise.all([getCustomer(db, id), customerFormOptions(db)]);
  if (!customer) notFound();
  const editable = can(user.role, "customers:write");

  return (
    <>
      <PageHeader
        title={customer.legalName}
        description={`${CHANNEL[customer.channel]} · ${customer.zone?.name ?? "sin zona"}`}
      />
      {/* El historial y la frecuencia de compra (RF-04) se agregan en el sprint de M1. */}
      {editable ? (
        <CustomerForm
          options={options}
          initial={{
            id: customer.id,
            legalName: customer.legalName,
            tradeName: customer.tradeName ?? "",
            cuit: customer.cuit ?? "",
            channel: customer.channel,
            priceListId: customer.priceListId,
            zoneId: customer.zoneId,
            deliveryWeekdays: customer.deliveryWeekdays,
            paymentTermsDays: customer.paymentTermsDays,
            paymentNotes: customer.paymentNotes ?? "",
            whatsapp: customer.whatsapp ?? "",
            address: customer.address ?? "",
            notes: customer.notes ?? "",
            active: customer.active,
          }}
        />
      ) : null}
    </>
  );
}
