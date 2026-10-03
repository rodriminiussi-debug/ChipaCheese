import { formatDateAR, isoWeekday } from "@chipa/domain";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTimeAR } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { rangeLabel, tempLabel } from "../labels";
import type { TemperatureMonth } from "../service";

/** Vista por equipo y día: última lectura de cada día (rojo si hubo alguna fuera de rango) + detalle. */
export function TemperatureMonthView({
  data,
  today,
  names,
}: {
  data: TemperatureMonth;
  today: string;
  names: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border" data-testid="temperature-grid">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="bg-muted sticky left-0 z-10 min-w-36 border-r px-2 py-1 text-left">Equipo</th>
              <th className="border-r px-2 py-1 text-left">Hoy</th>
              {data.days.map((d) => (
                <th
                  key={d}
                  className={cn(
                    "min-w-9 border-r px-0.5 py-1 text-center font-medium",
                    isoWeekday(d) >= 6 && "bg-muted text-muted-foreground",
                    d === today && "bg-primary/10",
                  )}
                >
                  {Number(d.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ equipment: e, cells }) => (
              <tr key={e.id} className="border-t">
                <th scope="row" className="bg-background sticky left-0 z-10 border-r px-2 py-1 text-left">
                  <div className="font-medium">{e.code}</div>
                  <div className="text-muted-foreground text-[10px] font-normal">
                    {rangeLabel(e.min, e.max)}
                  </div>
                </th>
                <td className="border-r px-2 py-1" data-testid={`today-${e.code}`}>
                  {e.missingToday ? (
                    <StatusBadge tone="warn">Falta</StatusBadge>
                  ) : e.todayCount > 0 ? (
                    <StatusBadge tone="good">Hecha</StatusBadge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {data.days.map((d) => {
                  const c = cells[d];
                  return (
                    <td
                      key={d}
                      title={
                        c
                          ? `${formatDateAR(d)}: ${c.count} lectura(s), última ${tempLabel(c.last.valueC)}`
                          : undefined
                      }
                      className={cn(
                        "border-r px-0.5 py-1 text-center tabular-nums",
                        isoWeekday(d) >= 6 && "bg-muted/60",
                        c?.anyOut && "bg-red-100 font-semibold text-red-700 dark:bg-red-950/60",
                      )}
                    >
                      {c ? c.last.valueC.toLocaleString("es-AR").replace("-", "−") : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead className="text-right">°C</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Acción correctiva</TableHead>
              <TableHead>Usuario</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Sin lecturas en el mes.
                </TableCell>
              </TableRow>
            ) : (
              data.list.map((r) => (
                <TableRow key={r.id} className={cn(r.outOfRange && "bg-red-50 dark:bg-red-950/30")}>
                  <TableCell className="tabular-nums">{formatDateTimeAR(r.measuredAt)}</TableCell>
                  <TableCell>{names[r.equipmentId] ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{tempLabel(r.valueC)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {r.outOfRange ? (
                        <StatusBadge tone="bad">Fuera de rango</StatusBadge>
                      ) : (
                        <StatusBadge tone="good">OK</StatusBadge>
                      )}
                      {r.lateEntry ? <StatusBadge tone="warn">Carga tardía</StatusBadge> : null}
                    </span>
                  </TableCell>
                  <TableCell>{r.correctiveAction ?? "—"}</TableCell>
                  <TableCell>{r.userInitials ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
