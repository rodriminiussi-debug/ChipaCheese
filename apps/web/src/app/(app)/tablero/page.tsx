import { formatDateAR } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import {
  FinancialChartSections,
  OperationalChartSections,
} from "@/features/dashboard/components/dashboard-chart-sections";
import {
  AlertsPanel,
  FinancialKpis,
  OperationalKpis,
  ResultSummary,
} from "@/features/dashboard/components/dashboard-sections";
import { getDashboard } from "@/features/dashboard/service";
import { MonthForm } from "@/features/finance/components/month-form";
import { todayAR } from "@/lib/dates";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Tablero" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function DashboardPage(props: PageProps<"/tablero">) {
  const user = await requirePermission(["dashboard:read", "finance:read"]);
  const sp = await props.searchParams;
  const today = todayAR();
  const month = typeof sp.mes === "string" && MONTH.test(sp.mes) ? sp.mes : today.slice(0, 7);
  // Sin finance:read (jefa de producción) el servicio ni consulta lo financiero.
  const includeFinance = can(user.role, "finance:read");
  // El aviso de aumentos de precio sólo lleva porcentajes: lo ven finanzas y compras.
  const includePrices = can(user.role, ["finance:read", "purchases:read"]);
  const d = await getDashboard(db, { today, month, includeFinance, includePrices });
  const op = d.operational;
  const fin = d.financial;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Tablero"
        description={
          <>
            {fin
              ? "¿Cuánto ganamos, qué tenemos y qué hay que atender?"
              : "Planta, stock y calidad de un vistazo."}{" "}
            Hoy es {formatDateAR(today)}.
          </>
        }
        actions={<MonthForm action="/tablero" month={month} label="Mes de los indicadores" />}
      />

      {fin ? <ResultSummary fin={fin} /> : null}
      <AlertsPanel alerts={d.alerts} />
      <OperationalKpis op={op} />
      {fin ? <FinancialKpis fin={fin} /> : null}

      {fin ? <FinancialChartSections fin={fin} /> : null}
      <OperationalChartSections op={op} />
    </div>
  );
}
