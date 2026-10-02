import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { homeFor } from "@/lib/rbac";

export default async function Home() {
  const user = await requireUser();
  redirect(homeFor(user.role) as never);
}
