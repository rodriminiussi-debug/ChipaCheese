import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { addMonths } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { ResultChart } from "@/components/app/charts";
import { Button } from "@/components/ui/button";
import { MonthForm } from "@/features/finance/components/month-form";
import { ResultHeadline, ResultNotices, ResultTable } from "@/features/finance/components/result-sections";
import { monthLabel, monthShort } from "@/features/finance/format";
import { getMonthlyResult, getPartnerWithdrawals, getResultHistory } from "@/features/finance/service";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Resultado mensual" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function MonthlyResultPage(props: PageProps<"/costos/resultado">) {
  const user = await requirePermission("finance:read");
  const sp = await props.searchParams;
  const today = todayAR();
  const month = typeof sp.mes === "string" && MONTH.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const [result, history, withdrawals] = await Promise.all([
    getMonthlyResult(db, month, { today }),
    getResultHistory(db, month, 6, { today }),
    getPartnerWithdrawals(db),
  ]);
  const prev = addMonths(`${month}-01`, -1).slice(0, 7);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  const href = (m: string) => `/costos/resultado?mes=${m}` as Route;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Resultado · ${monthLabel(month)}`}
        description="¿Cuánto ganamos? Ventas por canal, costo de ventas, mano de obra, gastos fijos y reparto (RF-40)."
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Mes anterior">
              <Link href={href(prev)}>
                <ChevronLeft />
              </Link>
            </Button>
            <MonthForm action="/costos/resultado" month={month} />
            <Button asChild variant="outline" size="icon" aria-label="Mes siguiente">
              <Link href={href(next)}>
                <ChevronRight />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/costos/resultado/export?mes=${month}`}>
                <Download /> Exportar a Excel
              </a>
            </Button>
          </>
        }
      />

      <ResultHeadline r={result} canWrite={can(user.role, "finance:write")} />
      <ResultTable r={result} />
      <ResultNotices r={result} />

      <section aria-labelledby="evolution-title" className="grid gap-2">
        <h2 id="evolution-title" className="text-lg font-semibold">
          Últimos 6 meses
        </h2>
        <p className="text-muted-foreground text-sm">
          Los meses sin ventas, producciones ni gastos cargados no se dibujan.
        </p>
        <ResultChart
          withdrawals={withdrawals.amount}
          data={history.map((h) => ({
            month: h.month,
            label: monthShort(h.month),
            result: h.hasData ? h.result : null,
          }))}
        />
      </section>
    </div>
  );
}
