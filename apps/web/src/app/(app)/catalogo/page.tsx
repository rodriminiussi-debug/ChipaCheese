import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/session";

export default async function CatalogoPage() {
  await requirePermission("catalog:write");
  redirect("/catalogo/productos");
}
