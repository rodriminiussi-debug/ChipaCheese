import Link from "next/link";
import { ClearPageCache } from "@/components/pwa/clear-page-cache";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/login-form";
import { getCurrentUser } from "@/server/auth/session";
import { homeFor } from "@/lib/rbac";

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role) as never);
  const { next } = await props.searchParams;
  return (
    <main className="bg-muted/40 grid min-h-dvh place-items-center p-4">
      <ClearPageCache />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Chipa Cheese</CardTitle>
          <CardDescription>Sistema de gestión — Pacon SRL</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <LoginForm next={typeof next === "string" ? next : undefined} />
          <Link href="/login/planta" className="text-muted-foreground text-center text-sm underline">
            Ingreso con PIN (tablet de planta)
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
