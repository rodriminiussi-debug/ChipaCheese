import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getUser } from "@/features/admin/service";
import { UserForm } from "@/features/admin/components/user-form";

export default async function EditUserPage(props: PageProps<"/admin/usuarios/[id]">) {
  await requirePermission("admin");
  const { id } = await props.params;
  const u = await getUser(db, id);
  if (!u) notFound();
  return (
    <>
      <PageHeader title={u.name} />
      <UserForm
        initial={{
          id: u.id,
          name: u.name,
          initials: u.initials,
          username: u.username,
          email: u.email ?? "",
          role: u.role,
          active: u.active,
          password: "",
          pin: "",
        }}
      />
    </>
  );
}
