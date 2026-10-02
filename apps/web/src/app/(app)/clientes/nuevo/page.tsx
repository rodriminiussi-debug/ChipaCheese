import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { customerFormOptions } from "@/features/customers/service";
import { CustomerForm } from "@/features/customers/components/customer-form";

export const metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  await requirePermission("customers:write");
  const options = await customerFormOptions(db);
  return (
    <>
      <PageHeader title="Nuevo cliente" />
      <CustomerForm options={options} />
    </>
  );
}
