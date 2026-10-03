import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChecksTable } from "@/features/billing/components/checks-table";
import { listChecks } from "@/features/billing/service";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Cheques" };

const SCOPES = [
  { value: "active", label: "En cartera y depositados" },
  { value: "all", label: "Todos" },
  { value: "cashed", label: "Cobrados" },
  { value: "rejected", label: "Rechazados" },
  { value: "endorsed", label: "Endosados" },
] as const;

export default async function ChecksPage(props: PageProps<"/cobranzas/cheques">) {
  const user = await requirePermission("billing:read");
  const { estado } = await props.searchParams;
  const scope = SCOPES.find((s) => s.value === estado)?.value ?? "active";
  const today = todayAR();
  const portfolio = await listChecks(db, { scope }, today);
  const { totals } = portfolio;

  return (
    <>
      <PageHeader
        title="Cartera de cheques"
        description="Ordenados por fecha de cobro. Los que vencen en los próximos 7 días se destacan (RF-31)."
      />
      {totals.dueSoonCount > 0 ? (
        <Alert className="mb-4">
          <AlertTriangle />
          <AlertTitle>Cheques a cobrar en los próximos 7 días</AlertTitle>
          <AlertDescription>
            {totals.dueSoonCount} cheque(s) por <Money value={totals.dueSoon} />.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard title="En cartera" value={<Money value={totals.inPortfolio} />} />
        <StatCard
          title="A cobrar en 7 días"
          value={<Money value={totals.dueSoon} />}
          tone={totals.dueSoonCount > 0 ? "warn" : "default"}
          hint={`${totals.dueSoonCount} cheque(s)`}
        />
        <StatCard
          title="Para depositar"
          value={<Money value={totals.readyToDeposit} />}
          hint={`${totals.readyToDepositCount} con fecha de cobro cumplida`}
        />
      </div>
      <nav aria-label="Filtrar cheques" className="mb-3 flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <Link
            key={s.value}
            href={
              (s.value === "active" ? "/cobranzas/cheques" : `/cobranzas/cheques?estado=${s.value}`) as Route
            }
            aria-current={scope === s.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              scope === s.value ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <ChecksTable rows={portfolio.rows} canEdit={can(user.role, "billing:write")} />
    </>
  );
}
