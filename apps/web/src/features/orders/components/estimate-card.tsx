import { CalendarClock, PackageCheck, TriangleAlert } from "lucide-react";
import { formatDateAR, isoWeekday } from "@chipa/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Kg } from "@/components/app/format";
import { WEEKDAY_LABELS } from "@/lib/dates";
import type { OrderDateEstimate } from "../service";

/** "Lun 05/10/2026" */
export const weekdayDate = (d: string) => `${WEEKDAY_LABELS[isoWeekday(d)]} ${formatDateAR(d)}`;

/**
 * RF-05: fecha posible de un pedido (o de X kg), con el cronograma de producción sugerido y la
 * advertencia si la fecha comprometida es anterior. Presentacional: sirve en server y en client.
 */
export function EstimateCard({
  estimate,
  promisedDate,
}: {
  estimate: OrderDateEstimate;
  promisedDate?: string | null;
}) {
  const late = !!(promisedDate && estimate.date && promisedDate < estimate.date);
  const unreachable = estimate.needsProduction && estimate.date === null;

  if (!estimate.needsProduction) {
    return (
      <Alert data-testid="estimate-card">
        <PackageCheck />
        <AlertTitle>Alcanza con el stock terminado</AlertTitle>
        <AlertDescription>
          Los <Kg value={estimate.orderKg} /> están en stock libre: se puede entregar desde hoy sin producir.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-2" data-testid="estimate-card">
      <Alert variant={late || unreachable ? "destructive" : "default"}>
        <CalendarClock />
        <AlertTitle>
          {estimate.date ? (
            <>
              Fecha posible: <span data-testid="estimate-date">{weekdayDate(estimate.date)}</span>
            </>
          ) : (
            "No hay capacidad en los próximos 60 días"
          )}
        </AlertTitle>
        <AlertDescription>
          <p>
            El pedido pesa <Kg value={estimate.orderKg} />; hay <Kg value={estimate.finishedStockKg} /> en
            stock terminado libre y faltan producir <Kg value={estimate.shortfallKg} /> (capacidad{" "}
            {estimate.capacityKg} kg por día hábil).
          </p>
          {estimate.plannedKg > 0 || estimate.backlogKg > 0 ? (
            <p className="text-muted-foreground">
              Ya hay <Kg value={estimate.plannedKg + estimate.backlogKg} /> de producción comprometida (planes
              guardados y otros pedidos abiertos).
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
      {late ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>La fecha comprometida es anterior a la posible</AlertTitle>
          <AlertDescription>
            Se prometió para el {weekdayDate(promisedDate!)} y el pedido no estaría completo hasta el{" "}
            {weekdayDate(estimate.date!)}. Renegociá la fecha con el cliente o ampliá la producción.
          </AlertDescription>
        </Alert>
      ) : null}
      {estimate.schedule.length > 0 ? (
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium">Cronograma de producción sugerido</p>
          <ul className="grid gap-0.5">
            {estimate.schedule.map((s) => (
              <li key={s.date} className="flex justify-between gap-4">
                <span>{weekdayDate(s.date)}</span>
                <Kg value={s.kg} />
              </li>
            ))}
          </ul>
          {estimate.date ? (
            <p className="text-muted-foreground mt-2 text-xs">
              El producto queda congelado esa noche y está disponible el {weekdayDate(estimate.date)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
