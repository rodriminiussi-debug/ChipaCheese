import { formatDateAR } from "@chipa/domain";
import { ChannelSalesChart, ProductionChart } from "@/components/app/charts";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertsPanel,
  FinancialKpis,
  MarginByChannel,
  OperationalKpis,
  ResultSummary,
  TopCustomers,
} from "@/features/dashboard/components/dashboard-sections";
import { getDashboard } from "@/features/dashboard/service";
import { MonthForm } from "@/features/finance/components/month-form";
import { monthLabel } from "@/features/finance/format";
import { todayAR } from "@/lib/dates";
import { CHANNEL } from "@/lib/labels";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata = { title: "Tablero" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "lun 28" para el eje del gráfico de producción (hora de Argentina: la fecha ya es de negocio). */
function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return `${wd} ${Number(date.slice(8, 10))}`;
}

export default async function DashboardPage(props: PageProps<"/tablero">) {
  const user = await requirePermission(["dashboard:read", "finance:read"]);
  const sp = await props.searchParams;
  const today = todayAR();
  const month = typeof sp.mes === "string" && MONTH.test(sp.mes) ? sp.mes : today.slice(0, 7);
  // Sin finance:read (jefa de producción) el servicio ni consulta lo financiero.
  const includeFinance = can(user.role, "finance:read");
  const d = await getDashboard(db, { today, month, includeFinance });
  const op = d.operational;
  const fin = d.financial;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Tablero"
        description={
          <>
            {fin ? "¿Cuánto ganamos, qué tenemos y qué hay que atender?" : "Planta, stock y calidad de un vistazo."} Hoy es{" "}
            {formatDateAR(today)}.
          </>
        }
        actions={<MonthForm action="/tablero" month={month} label="Mes de los indicadores" />}
      />

      {fin ? <ResultSummary fin={fin} /> : null}
      <AlertsPanel alerts={d.alerts} />
      <OperationalKpis op={op} />
      {fin ? <FinancialKpis fin={fin} /> : null}

      <section aria-label="Gráficos" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Producción de las últimas 2 semanas</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductionChart
              capacityKg={op.capacity.capacityKg}
              data={op.dailyProduction.map((p) => ({ ...p, label: dayLabel(p.date) }))}
            />
          </CardContent>
        </Card>
        {fin ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ventas netas por canal · {monthLabel(month)}</CardTitle>
            </CardHeader>
            <CardContent>
              {fin.salesByChannel.length === 0 ? (
                <p className="text-muted-foreground text-sm">No hay ventas facturadas en el mes.</p>
              ) : (
                <ChannelSalesChart
                  data={fin.salesByChannel.map((c) => ({
                    channel: c.channel,
                    label: CHANNEL[c.channel] ?? c.channel,
                    net: c.net,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        ) : null}
      </section>

      {fin ? (
        <section aria-label="Margen y clientes" className="grid gap-4 lg:grid-cols-2">
          <MarginByChannel fin={fin} />
          <TopCustomers fin={fin} />
        </section>
      ) : null}
    </div>
  );
}
