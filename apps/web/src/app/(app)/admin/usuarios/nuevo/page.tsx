import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { UserForm } from "@/features/admin/components/user-form";

export default async function NewUserPage() {
  await requirePermission("admin");
  return (
    <>
      <PageHeader title="Nuevo usuario" />
      <UserForm />
    </>
  );
}
