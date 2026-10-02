import "server-only";
import { z } from "zod";
import { withUser, type Tx } from "@chipa/db";
import { db } from "@/server/db";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { can, type Permission } from "@/lib/rbac";
import { UserError } from "@/server/errors";
import type { ActionResult } from "@/lib/action-result";

export interface ActionContext {
  user: SessionUser;
  /** Transacción marcada con el usuario: los triggers de auditoría registran quién hizo el cambio. */
  tx: Tx;
}

/** Convierte FormData en objeto. Claves repetidas → array; "a.0.b" → anidado. */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const v = typeof value === "string" ? value : value;
    const path = key.split(".");
    let node: Record<string, unknown> = out;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i]!;
      const nextIsIndex = /^\d+$/.test(path[i + 1]!);
      node[k] ??= nextIsIndex ? [] : {};
      node = node[k] as Record<string, unknown>;
    }
    const last = path[path.length - 1]!;
    if (last in node) {
      const prev = node[last];
      node[last] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else node[last] = v;
  }
  return out;
}

/**
 * Define una Server Action con: sesión obligatoria, permiso, validación zod y transacción auditada.
 * Uso (en un archivo "use server"):
 *   export const createOrder = action({ permission: "orders:write", schema: orderSchema }, async (input, { tx, user }) => { ... });
 * Acepta un objeto o un FormData. Nunca lanza: devuelve ActionResult.
 */
export function action<S extends z.ZodType, R>(
  opts: { permission: Permission | Permission[]; schema: S },
  handler: (input: z.infer<S>, ctx: ActionContext) => Promise<R>,
) {
  return async (raw: z.input<S> | FormData): Promise<ActionResult<R>> => {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a ingresar." };
    if (!can(user.role, opts.permission)) return { ok: false, error: "No tenés permiso para esta acción." };

    const parsed = opts.schema.safeParse(raw instanceof FormData ? formDataToObject(raw) : raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path.join(".") || "_";
        (fieldErrors[k] ??= []).push(issue.message);
      }
      return { ok: false, error: "Revisá los datos marcados.", fieldErrors };
    }
    try {
      const data = await withUser(db, user.id, (tx) => handler(parsed.data, { user, tx }));
      return { ok: true, data };
    } catch (e) {
      if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
      // Errores de Next (redirect/notFound) deben propagarse.
      if (e && typeof e === "object" && "digest" in e) throw e;
      console.error("[action]", e);
      return { ok: false, error: "Ocurrió un error inesperado. Intentá de nuevo." };
    }
  };
}
