"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq, or, schema } from "@chipa/db";
import { db } from "@/server/db";
import { createSession, destroySession } from "@/server/auth/session";
import { verifySecret } from "@/server/auth/password";
import { homeFor } from "@/lib/rbac";

export type LoginState = { error?: string } | null;

// Freno simple contra fuerza bruta (por instancia). En prod detrás de un WAF/rate limit del proveedor.
const attempts = new Map<string, { n: number; until: number }>();
function tooManyAttempts(key: string) {
  const a = attempts.get(key);
  return !!a && a.n >= 5 && a.until > Date.now();
}
function registerFailure(key: string) {
  const a = attempts.get(key);
  const n = a && a.until > Date.now() ? a.n + 1 : 1;
  attempts.set(key, { n, until: Date.now() + 5 * 60 * 1000 });
}

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Ingresá usuario y contraseña." };
  const { username, password, next } = parsed.data;
  const key = username.toLowerCase();
  if (tooManyAttempts(key)) return { error: "Demasiados intentos. Esperá 5 minutos." };

  const user = await db.query.users.findFirst({
    where: or(eq(schema.users.username, key), eq(schema.users.email, key)),
  });
  if (!user || !user.active || !(await verifySecret(user.passwordHash, password))) {
    registerFailure(key);
    return { error: "Usuario o contraseña incorrectos." };
  }
  attempts.delete(key);
  await createSession(user, (await headers()).get("user-agent"));
  redirect((next && next.startsWith("/") && !next.startsWith("//") ? next : homeFor(user.role)) as never);
}

const pinSchema = z.object({ userId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) });

/** Ingreso rápido en la tablet de planta: elegir nombre + PIN. */
export async function pinLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = pinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "PIN inválido." };
  const { userId, pin } = parsed.data;
  if (tooManyAttempts(userId)) return { error: "Demasiados intentos. Esperá 5 minutos." };
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user || !user.active || !(await verifySecret(user.pinHash, pin))) {
    registerFailure(userId);
    return { error: "PIN incorrecto." };
  }
  attempts.delete(userId);
  await createSession(user, (await headers()).get("user-agent"));
  redirect("/planta");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
