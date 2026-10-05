import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/lib/rbac";
import { DispatchTabsNav } from "./dispatch-tabs";

/** Pestañas del módulo de despacho. "Rendiciones" solo aparece para quien las recibe (`dispatch:settle`). */
export async function DispatchTabs() {
  const user = await getCurrentUser();
  return <DispatchTabsNav canSettle={!!user && can(user.role, "dispatch:settle")} />;
}
