import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Kg, Money, Num } from "@/components/app/format";
import { StatCard } from "@/components/app/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { CHANNEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { monthLabel } from "../format";
import type { MonthlyResultDetail } from "../service";
import { WithdrawalsForm } from "./withdrawals-form";

/** Resultado del mes y si alcanza para los retiros de los socios (la pregunta central del relevamiento). */
export function ResultHeadline({ r, canWrite }: { r: MonthlyResultDetail; canWrite: boolean }) {
  const w = r.withdrawals;
  return (
    <section aria-label="Resultado del mes" className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
      <StatCard
        title={`Resultado de ${monthLabel(r.month)}`}
        value={<Money value={r.result} decimals={0} />}
        tone={r.result < 0 ? "bad" : "good"}
        testId="stat-result"
        hint={
          r.resultPct != null ? (
            <>
              <Num value={r.resultPct} decimals={1} suffix="%" /> de las ventas netas (
              <Money value={r.sales} decimals={0} />)
            </>
          ) : (
            "Sin ventas en el mes"
          )
        }
      />
      <Card data-testid="withdrawals-card">
        <CardHeader className="pb-1">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            ¿El resultado cubre los retiros de los socios?
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <div className="flex items-center gap-2 text-2xl font-semibold">
            {w.covers ? (
              <CheckCircle2 className="size-6 text-emerald-600" aria-hidden />
            ) : (
              <XCircle className="text-destructive size-6" aria-hidden />
            )}
            <span data-testid="covers-verdict">
              {w.covers ? "Cubre los retiros" : "No cubre los retiros"}
            </span>
          </div>
          <p className="text-muted-foreground text-sm" data-testid="covers-detail">
            Retiros: <Money value={w.amount} decimals={0} className="text-foreground" />
            {w.isDefault ? " (valor del relevamiento, ~$9M entre los socios)" : ""}.{" "}
            {w.covers ? "Sobran " : "Faltan "}
            <Money value={Math.abs(w.difference)} decimals={0} className="text-foreground font-medium" />
            {w.coveragePct != null ? (
              <>
                {" "}
                · el resultado cubre el <Num value={w.coveragePct} decimals={1} suffix="%" />
              </>
            ) : null}
            .
          </p>
          {canWrite ? <WithdrawalsForm key={w.amount} amount={w.amount} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}

function Row({
  label,
  amount,
  sign,
  bold,
  indent,
  detail,
  testId,
}: {
  label: React.ReactNode;
  amount: number;
  sign?: "minus";
  bold?: boolean;
  indent?: boolean;
  detail?: React.ReactNode;
  testId?: string;
}) {
  return (
    <TableRow className={cn(bold && "bg-muted/50")}>
      <TableCell className={cn(indent && "pl-8", bold && "font-semibold")}>
        <div>
          {sign === "minus" ? <span className="text-muted-foreground mr-1">−</span> : null}
          {label}
        </div>
        {detail ? <div className="text-muted-foreground text-xs">{detail}</div> : null}
      </TableCell>
      <TableCell className={cn("text-right", bold && "font-semibold")} data-testid={testId}>
        <Money value={amount} />
      </TableCell>
    </TableRow>
  );
}

/** Estado de resultados del mes, línea por línea. */
export function ResultTable({ r }: { r: MonthlyResultDetail }) {
  const units = r.costOfSales.unitsFromInvoicedOrders + r.costOfSales.unitsFromStore;
  return (
    <section aria-labelledby="pnl-title" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h2 id="pnl-title" className="text-lg font-semibold">
        Cómo se llega al resultado
      </h2>
      <div className="rounded-lg border">
        <Table aria-label={`Resultado de ${monthLabel(r.month)}`}>
          <TableBody>
            {r.salesByChannel.length === 0 ? (
              <Row
                label="Ventas netas (sin IVA)"
                amount={0}
                detail="No hay facturas ni ventas del local en el mes"
              />
            ) : null}
            {r.salesByChannel.map((c) => (
              <Row
                key={c.channel}
                indent
                label={`Ventas · ${CHANNEL[c.channel] ?? c.channel}`}
                amount={c.net}
                detail={`${c.documents} comprobante(s), sin IVA`}
              />
            ))}
            <Row label="Ventas netas" amount={r.sales} bold testId="pnl-sales" />
            <Row
              sign="minus"
              label="Costo de ventas"
              amount={r.costOfSales.total}
              testId="pnl-cost-of-sales"
              detail={
                <>
                  {units} unidad(es) vendidas × costo de materiales a los últimos precios (aproximación, ver
                  abajo)
                </>
              }
            />
            <Row label="Margen bruto" amount={r.grossMargin} bold testId="pnl-gross" />
            <Row
              sign="minus"
              label="Mano de obra de planta"
              amount={r.labor.total}
              testId="pnl-labor"
              detail={
                <>
                  {r.labor.runs} producción(es) × <Money value={r.labor.perRun} decimals={0} />
                </>
              }
            />
            <Row
              sign="minus"
              label="Gastos fijos"
              amount={r.fixed.total}
              testId="pnl-fixed"
              detail={
                <Link href={`/costos/gastos?mes=${r.month}` as Route} className="underline">
                  Ver y editar los gastos del mes
                </Link>
              }
            />
            <Row
              sign="minus"
              label="Reparto"
              amount={r.delivery.cost}
              testId="pnl-delivery"
              detail={
                r.delivery.routes > 0 ? (
                  <>
                    {r.delivery.routes} ruta(s) · <Kg value={r.delivery.kg} /> entregados
                  </>
                ) : (
                  "No hay rutas cargadas en el mes"
                )
              }
            />
            <Row label="Resultado" amount={r.result} bold testId="pnl-result" />
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/** Aproximaciones y datos que no entran en la cuenta. */
export function ResultNotices({ r }: { r: MonthlyResultDetail }) {
  const n = r.notices;
  return (
    <section aria-label="Avisos del resultado" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {!r.hasData ? (
        <Alert>
          <Info />
          <AlertTitle>El mes no tiene datos</AlertTitle>
          <AlertDescription>
            No hay ventas, producciones ni gastos cargados en {monthLabel(r.month)}.
          </AlertDescription>
        </Alert>
      ) : null}
      {n.deliveredWithoutInvoice.orders > 0 ? (
        <Alert className="border-amber-500/50">
          <AlertTriangle />
          <AlertTitle>Hay pedidos entregados sin factura</AlertTitle>
          <AlertDescription>
            {n.deliveredWithoutInvoice.orders} pedido(s) entregados en el mes por{" "}
            <Money value={n.deliveredWithoutInvoice.amount} decimals={0} /> no tienen factura: no suman a las
            ventas ni al costo de ventas. Cargalos en{" "}
            <Link href={"/cobranzas" as Route} className="underline">
              Cobranzas
            </Link>{" "}
            para que el resultado los incluya.
          </AlertDescription>
        </Alert>
      ) : null}
      {n.invoicesWithoutOrder.count > 0 ? (
        <Alert className="border-amber-500/50">
          <AlertTriangle />
          <AlertTitle>Facturas sin pedido asociado</AlertTitle>
          <AlertDescription>
            {n.invoicesWithoutOrder.count} factura(s) por{" "}
            <Money value={n.invoicesWithoutOrder.net} decimals={0} /> netos suman ventas pero no tienen costo
            de ventas (el sistema no sabe qué productos llevaban).
          </AlertDescription>
        </Alert>
      ) : null}
      {r.costOfSales.underpriced.length > 0 ? (
        <Alert className="border-amber-500/50">
          <AlertTriangle />
          <AlertTitle>Costo subestimado por precios faltantes</AlertTitle>
          <AlertDescription>
            Se vendieron {r.costOfSales.underpriced.join(", ")} y falta el precio de algún componente: el
            costo real es mayor.
          </AlertDescription>
        </Alert>
      ) : null}
      {r.fixed.missingCategories.length > 0 ? (
        <Alert className="border-amber-500/50">
          <AlertTriangle />
          <AlertTitle>Gastos fijos que probablemente falten</AlertTitle>
          <AlertDescription>
            No hay nada cargado en {r.fixed.missingCategories.map((m) => m.label.toLowerCase()).join(", ")}.
            El Excel de costos tampoco los tenía, así que el resultado puede estar sobrestimado.{" "}
            <Link href={`/costos/gastos?mes=${r.month}` as Route} className="underline">
              Cargarlos
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="size-4" /> Cómo se calcula (y qué es aproximado)
          </CardTitle>
          <CardDescription>El resultado es una estimación de gestión, no un balance.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground grid gap-2 text-sm">
          <p>
            <strong className="text-foreground">Ventas:</strong> facturas emitidas en el mes por canal (netas,
            sin IVA; las notas de crédito restan) más las ventas del local, que se toman con 21 % de IVA
            incluido.
          </p>
          <p>
            <strong className="text-foreground">Costo de ventas:</strong> unidades de los pedidos con factura
            en el mes ({r.costOfSales.unitsFromInvoicedOrders}) y vendidas en el local (
            {r.costOfSales.unitsFromStore}) × costo de ingredientes y envase por unidad. Se usan los{" "}
            <em>últimos precios de compra</em> y el rendimiento real vigentes hoy, no los precios de la fecha
            de cada venta. La mano de obra no está acá: se resta aparte para no contarla dos veces.
          </p>
          <p>
            <strong className="text-foreground">Mano de obra:</strong> producciones realizadas en el mes × el
            costo de una producción (personas × horas × costo hora de la configuración). Se carga en el mes en
            que se produce, aunque se venda después.
          </p>
          <p>
            <strong className="text-foreground">Gastos fijos y reparto:</strong> lo cargado para el mes y el
            costo de las rutas del mes (kilometraje, combustible y horas del chofer).
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
