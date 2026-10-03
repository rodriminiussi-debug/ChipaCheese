"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateText, Money } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { useAction } from "@/hooks/use-action";
import { setCheckStatusAction } from "../actions";
import { CHECK_ACTIONS, CHECK_STATUS } from "../labels";
import type { CheckRow } from "../service";

/** RF-31: cartera de cheques ordenada por fecha de cobro, con alertas y cambio de estado. */
export function ChecksTable({ rows, canEdit }: { rows: CheckRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [reject, setReject] = useState<CheckRow | null>(null);
  const move = useAction(setCheckStatusAction, {
    success: (r) => `Cheque ${CHECK_STATUS[r.status]?.label.toLowerCase()}`,
    onSuccess: () => router.refresh(),
  });

  return (
    <>
      <div className="rounded-lg border">
        <Table aria-label="Cartera de cheques">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha de cobro</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Banco · N°</TableHead>
              <TableHead className="hidden md:table-cell">Librador</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead>Estado</TableHead>
              {canEdit ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const status = CHECK_STATUS[c.status]!;
              const actions = CHECK_ACTIONS[c.status] ?? [];
              return (
                <TableRow key={c.id} data-check={c.number}>
                  <TableCell>
                    <DateText value={c.cashDate} />
                    {c.dueSoon ? (
                      <div className="mt-1">
                        <StatusBadge tone="warn">
                          {c.daysToCash === 0 ? "Se cobra hoy" : `Se cobra en ${c.daysToCash} d`}
                        </StatusBadge>
                      </div>
                    ) : null}
                    {c.readyToDeposit ? (
                      <div className="mt-1">
                        <StatusBadge tone="info">Para depositar</StatusBadge>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Link href={`/cobranzas/clientes/${c.customerId}` as never} className="hover:underline">
                      {c.customerName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{c.bank}</div>
                    <div className="text-muted-foreground text-xs">N° {c.number}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.issuer ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Money value={c.amount} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      {actions.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Acciones del cheque ${c.number}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {actions.map((a) => (
                              <DropdownMenuItem
                                key={a.to}
                                variant={a.destructive ? "destructive" : "default"}
                                onSelect={() =>
                                  a.to === "rejected"
                                    ? setReject(c)
                                    : move.run({ checkId: c.id, status: a.to as never })
                                }
                              >
                                {a.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 7 : 6} className="text-muted-foreground text-center">
                  No hay cheques en esta vista.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Marcar el cheque como rechazado?</AlertDialogTitle>
            <AlertDialogDescription>
              {reject ? (
                <>
                  El cheque N° {reject.number} de {reject.customerName} deja de contar como cobro y la deuda
                  vuelve a la cuenta corriente. No se puede deshacer.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (reject) move.run({ checkId: reject.id, status: "rejected" });
                setReject(null);
              }}
            >
              Sí, rechazado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
