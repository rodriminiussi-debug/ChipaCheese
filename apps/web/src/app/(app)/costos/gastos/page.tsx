import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ExpenseManager } from "@/features/finance/components/expense-manager";
import { MonthForm } from "@/features/finance/components/month-form";
import { monthLabel } from "@/features/finance/format";
import { listFixedExpenses } from "@/features/finance/service";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Gastos fijos" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function FixedExpensesPage(props: PageProps<"/costos/gastos">) {
  const user = await requirePermission("finance:read");
  const sp = await props.searchParams;
  const month = typeof sp.mes === "string" && MONTH.test(sp.mes) ? sp.mes : todayAR().slice(0, 7);
  const expenses = await listFixedExpenses(db, month);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title={`Gastos fijos · ${monthLabel(month)}`}
        description="Alquiler, servicios, sueldos, impuestos y todo lo que se paga haya o no producción (RF-42). Alimentan el resultado mensual."
        actions={<MonthForm action="/costos/gastos" month={month} />}
      />

      {expenses.missingCategories.length > 0 ? (
        <Alert className="border-amber-500/50">
          <AlertTriangle />
          <AlertTitle>Faltan categorías que el Excel de costos tampoco tenía</AlertTitle>
          <AlertDescription>
            <p>Sin estos gastos el resultado del mes puede salir más alto de lo real:</p>
            <ul className="mt-1 list-disc pl-5">
              {expenses.missingCategories.map((m) => (
                <li key={m.category}>
                  <strong>{m.label}</strong>: {m.hint}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total del mes" value={<Money value={expenses.total} />} />
        {expenses.byCategory.slice(0, 3).map((c) => (
          <StatCard key={c.category} title={c.label} value={<Money value={c.amount} />} />
        ))}
      </div>

      <ExpenseManager
        month={month}
        rows={expenses.rows}
        total={expenses.total}
        canWrite={can(user.role, "finance:write")}
      />
    </div>
  );
}
