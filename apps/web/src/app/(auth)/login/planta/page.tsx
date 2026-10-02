import Link from "next/link";
import { and, eq, inArray, schema } from "@chipa/db";
import { db } from "@/server/db";
import { PinLogin } from "@/features/auth/pin-login";

export const dynamic = "force-dynamic";

export default async function PlantLoginPage() {
  const people = await db
    .select({ id: schema.users.id, name: schema.users.name, initials: schema.users.initials })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.active, true),
        inArray(schema.users.role, ["operator", "production_manager", "logistics"]),
      ),
    )
    .orderBy(schema.users.initials);
  return (
    <main className="mx-auto grid min-h-dvh max-w-3xl content-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Planta — ¿Quién sos?</h1>
        <p className="text-muted-foreground">Tocá tu nombre e ingresá tu PIN</p>
      </div>
      <PinLogin people={people} />
      <Link href="/login" className="text-muted-foreground text-center text-sm underline">
        Ingresar con usuario y contraseña
      </Link>
    </main>
  );
}
