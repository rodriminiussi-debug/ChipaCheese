"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, HandCoins, Scale } from "lucide-react";
import { formatARS, parseDecimalAR, settlementDifference } from "@chipa/domain";
import { Money } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { formatDateTimeAR } from "@/lib/dates";
import { receiveSettlementAction, registerSettlementAction } from "../actions";

export interface SettlementPanelData {
  expected: {
    cashExpected: number;
    transfersExpected: number;
    checksExpected: number;
    checksAmount: number;
    checks: { id: string; bank: string; number: string; amount: number; customerName: string }[];
  };
  settlement: {
    cashDelivered: number;
    checksDelivered: number;
    notes: string | null;
    settledAt: string;
    receivedByName: string | null;
  } | null;
}

export const SETTLEMENT_STATUS = {
  ok: { label: "Sin diferencia", tone: "good" },
  short: { label: "Falta", tone: "bad" },
  over: { label: "Sobra", tone: "warn" },
} as const;

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatARS(Math.abs(n))}`;

/**
 * Rendición del chofer al volver: el sistema muestra lo cobrado en la ruta (efectivo, cheques, transferencias);
 * el chofer carga lo que entrega y ve la diferencia. Dirección o la jefa la reciben.
 */
export function SettlementPanel({
  routeId,
  data,
  canRegister,
  canReceive,
}: {
  routeId: string;
  data: SettlementPanelData;
  canRegister: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const { expected, settlement } = data;
  const received = !!settlement?.receivedByName;
  const [cash, setCash] = useState(settlement ? String(settlement.cashDelivered).replace(".", ",") : "");
  const [checks, setChecks] = useState(settlement ? String(settlement.checksDelivered) : "");
  const [notes, setNotes] = useState(settlement?.notes ?? "");
  const [editing, setEditing] = useState(!settlement);
  const [receiveNote, setReceiveNote] = useState("");

  const register = useAction(registerSettlementAction, {
    success: (r) =>
      r.status === "ok" ? "Rendición registrada sin diferencias" : "Rendición registrada con diferencia",
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
  });
  const receive = useAction(receiveSettlementAction, {
    success: "Rendición recibida",
    onSuccess: () => router.refresh(),
  });

  const cashN = cash.trim() === "" ? null : parseDecimalAR(cash);
  const checksN = checks.trim() === "" || !/^\d+$/.test(checks.trim()) ? null : Number(checks.trim());
  const live =
    cashN != null && checksN != null
      ? settlementDifference({
          cashExpected: expected.cashExpected,
          cashDelivered: cashN,
          checksExpected: expected.checksExpected,
          checksDelivered: checksN,
        })
      : null;
  const saved = settlement
    ? settlementDifference({
        cashExpected: expected.cashExpected,
        cashDelivered: settlement.cashDelivered,
        checksExpected: expected.checksExpected,
        checksDelivered: settlement.checksDelivered,
      })
    : null;
  const err = (k: string) => register.fieldErrors[k]?.[0];

  return (
    <Card data-testid="settlement-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HandCoins className="size-4" /> Rendición de lo cobrado
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3" aria-label="Lo cobrado en la ruta">
          <div>
            <dt className="text-muted-foreground text-xs">Efectivo cobrado</dt>
            <dd className="text-lg font-semibold tabular-nums" data-testid="expected-cash">
              <Money value={expected.cashExpected} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Cheques cobrados</dt>
            <dd className="text-lg font-semibold tabular-nums" data-testid="expected-checks">
              {expected.checksExpected}
              {expected.checksExpected ? (
                <span className="text-muted-foreground text-sm font-normal">
                  {" "}
                  (<Money value={expected.checksAmount} />)
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Transferencias (ya en el banco)</dt>
            <dd className="text-lg font-semibold tabular-nums">
              <Money value={expected.transfersExpected} />
            </dd>
          </div>
        </dl>
        {expected.checks.length ? (
          <ul className="text-muted-foreground grid gap-0.5 text-sm" aria-label="Cheques de la ruta">
            {expected.checks.map((c) => (
              <li key={c.id}>
                {c.bank} N° {c.number} · {c.customerName} · <Money value={c.amount} />
              </li>
            ))}
          </ul>
        ) : null}

        {settlement && !editing ? (
          <div className="grid gap-2 rounded-lg border p-3" data-testid="settlement-summary">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={SETTLEMENT_STATUS[saved!.status].tone}>
                {SETTLEMENT_STATUS[saved!.status].label}
              </StatusBadge>
              <span className="text-sm">
                Entregó{" "}
                <strong>
                  <Money value={settlement.cashDelivered} />
                </strong>{" "}
                y <strong>{settlement.checksDelivered}</strong>{" "}
                {settlement.checksDelivered === 1 ? "cheque" : "cheques"}
              </span>
            </div>
            {saved!.status !== "ok" ? (
              <p className="text-sm font-medium" data-testid="settlement-diff">
                Diferencia: efectivo {signed(saved!.cash)}
                {saved!.checks !== 0
                  ? ` · cheques ${saved!.checks > 0 ? "+" : "−"}${Math.abs(saved!.checks)}`
                  : ""}
              </p>
            ) : null}
            {settlement.notes ? <p className="text-sm">“{settlement.notes}”</p> : null}
            <p className="text-muted-foreground text-xs">
              Rendida el {formatDateTimeAR(settlement.settledAt)} ·{" "}
              {received ? (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> Recibida por {settlement.receivedByName}
                </span>
              ) : (
                "Pendiente de que la reciba Dirección o la jefa"
              )}
            </p>
            {canRegister && !received ? (
              <Button variant="outline" className="h-11 w-fit" onClick={() => setEditing(true)}>
                Corregir rendición
              </Button>
            ) : null}
            {canReceive && !received ? (
              <div className="grid gap-2 sm:max-w-md">
                <Label htmlFor="receive-note">Observaciones de la recepción (opcional)</Label>
                <Input
                  id="receive-note"
                  className="h-11"
                  value={receiveNote}
                  onChange={(e) => setReceiveNote(e.target.value)}
                />
                <Button
                  className="h-11 w-fit"
                  disabled={receive.pending}
                  onClick={() => receive.run({ routeId, notes: receiveNote || null })}
                >
                  <Scale /> Confirmar recepción
                </Button>
              </div>
            ) : null}
          </div>
        ) : canRegister ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:max-w-md">
            <p className="text-sm font-medium">¿Qué entregás?</p>
            <div className="grid gap-1.5">
              <Label htmlFor="settle-cash">Efectivo que entrego ($)</Label>
              <Input
                id="settle-cash"
                inputMode="decimal"
                className="h-11 text-base"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                aria-invalid={!!err("cashDelivered")}
              />
              {err("cashDelivered") ? (
                <p className="text-destructive text-sm">{err("cashDelivered")}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="settle-checks">Cheques que entrego (cantidad)</Label>
              <Input
                id="settle-checks"
                inputMode="numeric"
                className="h-11 text-base"
                value={checks}
                onChange={(e) => setChecks(e.target.value)}
                aria-invalid={!!err("checksDelivered")}
              />
              {err("checksDelivered") ? (
                <p className="text-destructive text-sm">{err("checksDelivered")}</p>
              ) : null}
            </div>
            {live ? (
              <p
                role="status"
                className={
                  live.status === "ok"
                    ? "text-sm font-medium text-emerald-700 dark:text-emerald-400"
                    : "text-destructive text-sm font-medium"
                }
                data-testid="live-diff"
              >
                {live.status === "ok"
                  ? "Coincide con lo cobrado."
                  : `Diferencia: efectivo ${signed(live.cash)}${live.checks !== 0 ? ` · cheques ${live.checks > 0 ? "+" : "−"}${Math.abs(live.checks)}` : ""} (${live.status === "short" ? "falta" : "sobra"}).`}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="settle-notes">
                Observaciones{live && live.status !== "ok" ? " (contá a qué se debe la diferencia)" : ""}
              </Label>
              <Textarea
                id="settle-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-invalid={!!err("notes")}
              />
              {err("notes") ? <p className="text-destructive text-sm">{err("notes")}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11 text-base"
                disabled={register.pending || cashN == null || checksN == null}
                onClick={() => register.run({ routeId, cashDelivered: cash, checksDelivered: checks, notes })}
              >
                {settlement ? "Guardar la corrección" : "Registrar rendición"}
              </Button>
              {settlement ? (
                <Button variant="outline" className="h-11" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">El chofer todavía no rindió esta ruta.</p>
        )}
      </CardContent>
    </Card>
  );
}
