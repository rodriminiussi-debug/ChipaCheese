import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { DateText, Kg, Num } from "@/components/app/format";
import { formatDateTimeAR, formatTimeAR } from "@/lib/dates";
import { COMPLAINT_STATUS, tempLabel } from "@/features/quality/labels";
import { HoldButton } from "@/features/quality/components/hold-button";
import type { FinishedLotTrace, RawLotTrace } from "../service";
import { HoldAllButton } from "./hold-all-button";

const SHIFT: Record<string, string> = { morning: "Mañana", afternoon: "Tarde" };
const UNIT: Record<string, string> = { kg: "kg", l: "L", unit: "u." };

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const lotLink = (code: string) => `/calidad/trazabilidad?lote=${encodeURIComponent(code)}` as Route;

/** Informe de un lote terminado: hacia atrás (de dónde viene) y hacia adelante (adónde fue). */
export function FinishedLotReport({ trace: t, canHold }: { trace: FinishedLotTrace; canHold: boolean }) {
  const p = t.production;
  return (
    <div className="space-y-4">
      <Section title="Lote terminado">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <Fact label="Código">
              <span className="text-lg font-semibold" data-testid="lot-code">
                {t.lot.code}
              </span>
            </Fact>
            <Fact label="Elaboración">
              <DateText value={t.lot.productionDate} />
            </Fact>
            <Fact label="Vencimiento">
              <DateText value={t.lot.expiryDate} />
            </Fact>
            <Fact label="Estado">
              {t.lot.onHold ? (
                <StatusBadge tone="bad">Retenido</StatusBadge>
              ) : (
                <StatusBadge tone="good">Liberado</StatusBadge>
              )}
            </Fact>
          </dl>
          {canHold ? <HoldButton finishedLotId={t.lot.id} onHold={t.lot.onHold} size="default" /> : null}
        </div>
      </Section>

      <h2 className="text-lg font-semibold">Hacia atrás: cómo se hizo</h2>
      <Section title="Producción" testId="trace-production">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Fecha">
            <DateText value={p.date} />
          </Fact>
          <Fact label="Producción del día">N.º {p.runNumber}</Fact>
          <Fact label="Turno">{SHIFT[p.shift] ?? p.shift}</Fact>
          <Fact label="Receta">
            {p.recipe} v{p.recipeVersion}
          </Fact>
          <Fact label="Responsable">{p.responsible ?? "—"}</Fact>
          <Fact label="Supervisor">{p.supervisor ?? "—"}</Fact>
          <Fact label="Operarios">{p.workers.join(", ") || "—"}</Fact>
          <Fact label="Fécula / tandas">
            <Kg value={p.starchKg} /> · {p.batches} tandas
          </Fact>
          <Fact label="Congelado">
            {p.freezerCodes.join(", ") || "—"}
            {p.frozenAt ? ` · ingreso ${formatTimeAR(p.frozenAt)}` : ""}
          </Fact>
        </dl>
      </Section>

      <Section title="Materia prima consumida" testId="trace-consumptions">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Insumo</TableHead>
                <TableHead className="text-right">Consumo real</TableHead>
                <TableHead>Lote del proveedor</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Recepción</TableHead>
                <TableHead>Vencimiento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.consumptions.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{c.ingredient}</TableCell>
                  <TableCell className="text-right">
                    <Num value={c.qtyActual} decimals={c.unit === "unit" ? 0 : 2} suffix={UNIT[c.unit]} />
                  </TableCell>
                  {c.rawLot ? (
                    <>
                      <TableCell>
                        <Link
                          href={lotLink(c.rawLot.supplierLotCode ?? "")}
                          className="font-medium hover:underline"
                        >
                          {c.rawLot.supplierLotCode ?? "s/d"}
                        </Link>
                      </TableCell>
                      <TableCell>{c.rawLot.supplier ?? "—"}</TableCell>
                      <TableCell>
                        {c.rawLot.receivedAt ? formatDateTimeAR(c.rawLot.receivedAt) : "—"}
                        {c.rawLot.temperatureC != null ? ` · ${tempLabel(c.rawLot.temperatureC)}` : ""}
                      </TableCell>
                      <TableCell>
                        <DateText value={c.rawLot.expiryDate} />
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={4} className="text-muted-foreground">
                      Lote de materia prima no registrado en esta producción
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <h2 className="text-lg font-semibold">Hacia adelante: adónde fue</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Envasado" testId="trace-packings">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead className="text-right">Bolsas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.packings.map((k, i) => (
                <TableRow key={i}>
                  <TableCell>{k.product}</TableCell>
                  <TableCell>{k.location}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.units}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Total envasado
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{t.totals.packedUnits}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>
        <Section title="Stock actual" testId="trace-stock">
          {t.stock.length === 0 ? (
            <p className="text-muted-foreground text-sm">No queda stock de este lote.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead className="text-right">Bolsas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.stock.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{s.product}</TableCell>
                    <TableCell>{s.location}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.qty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      <Section title="Remitos y clientes que lo recibieron" testId="trace-dispatches">
        {t.dispatches.length === 0 ? (
          <p className="text-muted-foreground text-sm">Todavía no se despachó este lote.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Remito</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.dispatches.map((d, i) => (
                <TableRow key={i}>
                  <TableCell className="tabular-nums">{String(d.number).padStart(4, "0")}</TableCell>
                  <TableCell className="tabular-nums">{formatDateTimeAR(d.date)}</TableCell>
                  <TableCell className="font-medium">{d.customer}</TableCell>
                  <TableCell>{d.product}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.units}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Ventas del local" testId="trace-store">
          {t.storeSales.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin ventas del local de este lote.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {t.storeSales.map((s) => (
                <li key={s.saleId + s.product}>
                  {formatDateTimeAR(s.soldAt)} · {s.product} · {s.units} u.
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Reclamos" testId="trace-complaints">
          {t.complaints.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin reclamos sobre este lote.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {t.complaints.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <DateText value={c.date} />
                  <span>{c.customer ?? "—"}:</span>
                  <span>{c.reason}</span>
                  <StatusBadge tone={COMPLAINT_STATUS[c.status]!.tone}>
                    {COMPLAINT_STATUS[c.status]!.label}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** Informe de un lote de materia prima: lotes terminados que lo usaron y sus clientes (retiro). */
export function RawLotReport({ trace: t, canHold }: { trace: RawLotTrace; canHold: boolean }) {
  const l = t.rawLot;
  return (
    <div className="space-y-4" data-testid="raw-lot-report">
      <Section title="Lote de materia prima">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Lote del proveedor">
            <span className="text-lg font-semibold">{l.supplierLotCode ?? "s/d"}</span>
          </Fact>
          <Fact label="Insumo">{l.ingredient}</Fact>
          <Fact label="Proveedor">{l.supplier ?? "—"}</Fact>
          <Fact label="Vencimiento">
            <DateText value={l.expiryDate} />
          </Fact>
          <Fact label="Recepción">{l.receivedAt ? formatDateTimeAR(l.receivedAt) : "—"}</Fact>
          <Fact label="Temperatura al recibir">
            {l.temperatureC != null ? tempLabel(l.temperatureC) : "—"}
          </Fact>
          <Fact label="Cantidad recibida">
            <Num value={l.receivedQty} decimals={2} suffix={UNIT[l.unit]} />
          </Fact>
          <Fact label="Remito del proveedor">{l.deliveryNote ?? "—"}</Fact>
        </dl>
      </Section>

      <Section title="Lotes terminados que lo usaron" testId="trace-raw-lots">
        <div className="mb-3 flex justify-end">
          {canHold ? (
            <HoldAllButton lotIds={t.finishedLots.filter((x) => !x.onHold).map((x) => x.id)} />
          ) : null}
        </div>
        {t.finishedLots.length === 0 ? (
          <p className="text-muted-foreground text-sm">Este lote todavía no se usó en ninguna producción.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lote</TableHead>
                <TableHead>Elaboración</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Usado</TableHead>
                <TableHead className="text-right">Despachado</TableHead>
                <TableHead className="text-right">En stock</TableHead>
                <TableHead>Estado</TableHead>
                {canHold ? <TableHead className="text-right">Acción</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.finishedLots.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>
                    <Link href={lotLink(k.code)} className="font-medium hover:underline">
                      {k.code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DateText value={k.productionDate} />
                  </TableCell>
                  <TableCell>
                    <DateText value={k.expiryDate} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={k.qtyUsed} decimals={2} suffix={UNIT[l.unit]} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{k.dispatchedUnits}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.stockUnits}</TableCell>
                  <TableCell>
                    {k.onHold ? (
                      <StatusBadge tone="bad">Retenido</StatusBadge>
                    ) : (
                      <StatusBadge tone="good">Liberado</StatusBadge>
                    )}
                  </TableCell>
                  {canHold ? (
                    <TableCell className="text-right">
                      <HoldButton finishedLotId={k.id} onHold={k.onHold} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Clientes que recibieron esos lotes" testId="trace-raw-customers">
        {t.customers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Ninguno de esos lotes salió todavía a un cliente.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Lotes</TableHead>
                <TableHead className="text-right">Bolsas</TableHead>
                <TableHead>Último remito</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.customers.map((c) => (
                <TableRow key={c.customerId}>
                  <TableCell className="font-medium">{c.customer}</TableCell>
                  <TableCell>{c.lots.join(", ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.units}</TableCell>
                  <TableCell className="tabular-nums">{formatDateTimeAR(c.lastDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {t.unlinkedRuns.length ? (
        <Section title="Atención: producciones sin lote registrado" testId="trace-unlinked">
          <p className="text-muted-foreground mb-2 text-sm">
            Estas producciones, posteriores a la recepción, consumieron el mismo insumo sin registrar el lote
            de origen: no se puede descartar que hayan usado este lote.
          </p>
          <ul className="space-y-1 text-sm">
            {t.unlinkedRuns.map((u) => (
              <li key={u.runDate}>
                <DateText value={u.runDate} /> ·{" "}
                {u.lotCodes.map((c, i) => (
                  <span key={c}>
                    {i ? ", " : ""}
                    <Link href={lotLink(c)} className="font-medium hover:underline">
                      {c}
                    </Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
