import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm, ChangePinForm } from "@/features/account/components/account-forms";
import { permissionsInWords } from "@/features/account/permission-labels";
import { ROLE_LABELS } from "@/lib/rbac";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Mi cuenta" };

/** Mi cuenta (todos los roles): mi rol y lo que puedo hacer, y cambiar mi contraseña y mi PIN. */
export default async function AccountPage() {
  const user = await requireUser();
  const row = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, user.id),
    columns: { passwordHash: true },
  });
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title="Mi cuenta" description={`${user.name} · usuario ${user.username}`} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mi rol: <span data-testid="account-role">{ROLE_LABELS[user.role]}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-2 text-sm">Con este rol podés:</p>
          <ul className="grid list-disc gap-1 pl-5 text-sm" aria-label="Mis permisos">
            {permissionsInWords(user.role).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <ChangePasswordForm hasPassword={!!row?.passwordHash} />
      <ChangePinForm />
    </div>
  );
}
