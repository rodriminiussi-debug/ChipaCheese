import Link from "next/link";
import { History, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listSettings, listUsers } from "@/features/admin/service";
import { SettingRow } from "@/features/admin/components/settings-editor";
import { ROLE_LABELS } from "@/lib/rbac";

export const metadata = { title: "Configuración" };

export default async function AdminPage() {
  await requirePermission("admin");
  const [users, settings] = await Promise.all([listUsers(db), listSettings(db)]);
  return (
    <>
      <PageHeader
        title="Configuración"
        description="Usuarios, roles y parámetros del negocio."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/admin/auditoria">
                <History /> Auditoría
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/usuarios/nuevo">
                <Plus /> Nuevo usuario
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Usuarios</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link href={`/admin/usuarios/${u.id}`} className="font-medium hover:underline">
                        {u.name}
                      </Link>
                      <span className="text-muted-foreground ml-2 text-xs">{u.initials}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{u.username}</TableCell>
                    <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell>{u.hasPin ? "Sí" : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge tone={u.active ? "good" : "neutral"}>
                        {u.active ? "Activo" : "Inactivo"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Parámetros del negocio</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {settings.map((s) => (
                  <SettingRow key={s.key} settingKey={s.key} value={s.value} description={s.description} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
