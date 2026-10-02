import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DateText } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { CountEntry } from "@/features/stock/components/count-entry";
import { CountReport } from "@/features/stock/components/count-report";
import { getInventoryCount } from "@/features/stock/inventory";
import { COUNT_STATUS, ITEM_KIND } from "@/features/stock/labels";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Stock · Inventario físico" };

export default async function InventoryCountPage(props: PageProps<"/stock/inventario/[id]">) {
  const user = await requirePermission("stock:read");
  const { id } = await props.params;
  const detail = await getInventoryCount(db, id);
  if (!detail) notFound();
  const { count } = detail;
  const st = COUNT_STATUS[count.status] ?? { label: count.status, tone: "neutral" as const };
  const editable = count.status === "draft" && can(user.role, "stock:write");

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/stock/inventario"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Inventarios
        </Link>
        <h2 className="mt-2 flex flex-wrap items-center gap-3 text-xl font-semibold">
          Inventario de {ITEM_KIND[count.itemKind].toLowerCase()} del <DateText value={count.date} />
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        </h2>
        <p className="text-muted-foreground text-sm">
          {count.countedBy ? `Responsable: ${count.countedBy.name}. ` : ""}
          {editable
            ? "Cargá lo que contás en cada posición; podés guardar el avance y seguir después."
            : count.status === "confirmed"
              ? "Las diferencias quedaron ajustadas en el libro mayor."
              : null}
        </p>
      </div>

      {editable ? <CountEntry countId={count.id} items={detail.items} /> : null}
      {count.status !== "voided" && (!editable || detail.summary.withDiff > 0) ? (
        <CountReport detail={detail} />
      ) : null}
    </div>
  );
}
