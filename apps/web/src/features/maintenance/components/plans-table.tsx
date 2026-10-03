import Link from "next/link";
import type { Route } from "next";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { daysLeftLabel, frequencyLabel, PLAN_STATUS } from "../labels";
import type { MaintenanceFormOptions, PlanRow } from "../service";
import { PlanForm } from "./plan-form";
import { PreventiveDialog } from "./preventive-dialog";

/** Planes preventivos con próximo vencimiento y estado (ok / por vencer / vencido). */
export function PlansTable({
  plans,
  today,
  options,
  showEquipment = true,
}: {
  plans: PlanRow[];
  today: string;
  options?: MaintenanceFormOptions | null;
  showEquipment?: boolean;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {showEquipment ? <TableHead>Equipo</TableHead> : null}
            <TableHead>Tarea</TableHead>
            <TableHead>Frecuencia</TableHead>
            <TableHead>Último hecho</TableHead>
            <TableHead>Próximo vencimiento</TableHead>
            <TableHead>Estado</TableHead>
            {options ? <TableHead className="text-right">Acciones</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((p) => (
            <TableRow key={p.id} data-testid={`plan-${p.id}`} className={p.active ? "" : "opacity-60"}>
              {showEquipment ? (
                <TableCell className="font-medium">
                  <Link href={`/mantenimiento/equipos/${p.equipmentId}` as Route} className="hover:underline">
                    {p.equipmentName}
                  </Link>
                  <div className="text-muted-foreground text-xs font-normal">{p.area}</div>
                </TableCell>
              ) : null}
              <TableCell>{p.task}</TableCell>
              <TableCell>{frequencyLabel(p.frequencyDays)}</TableCell>
              <TableCell>
                <DateText value={p.lastDoneAt} />
              </TableCell>
              <TableCell>
                <DateText value={p.nextDue} />
                <span className="text-muted-foreground ml-1 text-xs">({daysLeftLabel(p.daysLeft)})</span>
              </TableCell>
              <TableCell>
                {p.active ? (
                  <StatusBadge tone={PLAN_STATUS[p.status].tone}>{PLAN_STATUS[p.status].label}</StatusBadge>
                ) : (
                  <StatusBadge>Dado de baja</StatusBadge>
                )}
              </TableCell>
              {options ? (
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {p.active ? (
                      <PreventiveDialog
                        planId={p.id}
                        task={p.task}
                        equipmentName={p.equipmentName}
                        today={today}
                        people={options.people}
                      />
                    ) : null}
                    <PlanForm
                      options={options}
                      today={today}
                      initial={{
                        id: p.id,
                        equipmentId: p.equipmentId,
                        task: p.task,
                        frequencyDays: p.frequencyDays,
                        startDate: p.startDate,
                        active: p.active,
                      }}
                    />
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
