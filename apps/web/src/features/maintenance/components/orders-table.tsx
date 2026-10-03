import Link from "next/link";
import type { Route } from "next";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Money } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downtimeLabel, ORDER_STATUS, ORDER_TYPE } from "../labels";
import type { MaintenanceFormOptions, OrderRow } from "../service";
import { CloseCorrectiveDialog } from "./close-corrective-dialog";
import { CorrectiveForm } from "./corrective-form";

/** Órdenes de trabajo (correctivas y preventivas) con los campos de la planilla de mantenimiento. */
export function OrdersTable({
  orders,
  today,
  options,
  showEquipment = true,
}: {
  orders: OrderRow[];
  today: string;
  /** Si viene, se muestran las acciones de edición/cierre (permiso maintenance:write). */
  options?: MaintenanceFormOptions | null;
  showEquipment?: boolean;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            {showEquipment ? <TableHead>Equipo</TableHead> : null}
            <TableHead>Tipo</TableHead>
            <TableHead>Actividad</TableHead>
            <TableHead>Causa</TableHead>
            <TableHead className="hidden lg:table-cell">Repuesto</TableHead>
            <TableHead className="hidden text-right md:table-cell">Costo</TableHead>
            <TableHead className="hidden text-right md:table-cell">Parada</TableHead>
            <TableHead className="hidden lg:table-cell">Responsable / supervisor</TableHead>
            <TableHead>Estado</TableHead>
            {options ? <TableHead className="text-right">Acciones</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id} data-testid={`order-${o.id}`}>
              <TableCell>
                <DateText value={o.date} />
              </TableCell>
              {showEquipment ? (
                <TableCell className="font-medium">
                  <Link href={`/mantenimiento/equipos/${o.equipmentId}` as Route} className="hover:underline">
                    {o.equipment.name}
                  </Link>
                </TableCell>
              ) : null}
              <TableCell>
                <StatusBadge tone={o.type === "corrective" ? "warn" : "info"}>
                  {ORDER_TYPE[o.type]}
                </StatusBadge>
              </TableCell>
              <TableCell className="max-w-64">{o.activity}</TableCell>
              <TableCell>{o.cause ?? "—"}</TableCell>
              <TableCell className="hidden lg:table-cell">{o.spareParts ?? "—"}</TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <Money value={o.cost} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                {downtimeLabel(o.downtimeMinutes)}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {o.responsible?.initials ?? "—"} / {o.supervisor?.initials ?? "—"}
              </TableCell>
              <TableCell>
                <StatusBadge tone={ORDER_STATUS[o.status]!.tone}>{ORDER_STATUS[o.status]!.label}</StatusBadge>
              </TableCell>
              {options ? (
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {o.type === "corrective" && o.status === "open" ? (
                      <CloseCorrectiveDialog
                        id={o.id}
                        equipmentName={o.equipment.name}
                        activity={o.activity}
                        today={today}
                      />
                    ) : null}
                    {o.type === "corrective" ? (
                      <CorrectiveForm
                        options={options}
                        today={today}
                        initial={{
                          id: o.id,
                          equipmentId: o.equipmentId,
                          date: o.date,
                          cause: o.cause ?? "",
                          activity: o.activity,
                          spareParts: o.spareParts,
                          cost: o.cost,
                          downtimeMinutes: o.downtimeMinutes,
                          responsibleId: o.responsibleId,
                          supervisorId: o.supervisorId,
                          closed: o.status === "done",
                        }}
                      />
                    ) : null}
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
