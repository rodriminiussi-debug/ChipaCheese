import { formatDateAR, formatKg, formatNumber } from "@chipa/domain";
import type { BpmSheet } from "@/server/export/pdf";
import { formatDateTimeAR, formatTimeAR } from "@/lib/dates";
import type { FinishedLotTrace, RawLotTrace } from "./service";

const SHIFT: Record<string, string> = { morning: "Mañana", afternoon: "Tarde" };

type Row = (string | number | null)[];

const dt = (d: Date | null) => (d ? formatDateTimeAR(d) : "");
const qtyUnit = (n: number, unit: string) =>
  unit === "kg" ? formatKg(n) : `${formatNumber(n, 2)} ${unit === "l" ? "L" : "u."}`;

/** Informe de trazabilidad (RF-35) con el formato de planilla BPM, para imprimir o guardar como PDF. */
export function traceSheet(
  trace: { finished: FinishedLotTrace | null; raw: RawLotTrace[] },
  generatedAt: string,
): BpmSheet {
  const rows: Row[] = [];
  let title = "Informe de trazabilidad";
  let period = generatedAt;

  const f = trace.finished;
  if (f) {
    title = `Informe de trazabilidad · lote ${f.lot.code}`;
    period = `Elaborado ${formatDateAR(f.lot.productionDate)}`;
    const p = f.production;
    rows.push(
      [
        "Producción",
        `Lote ${f.lot.code}`,
        `Elaborado ${formatDateAR(f.lot.productionDate)} · vence ${formatDateAR(f.lot.expiryDate)}${f.lot.onHold ? " · RETENIDO" : ""}`,
        "",
        "",
      ],
      [
        "Producción",
        `Producción N° ${p.runNumber}`,
        `Turno ${SHIFT[p.shift] ?? p.shift} · receta ${p.recipe} v${p.recipeVersion} · ${p.batches} tandas`,
        formatKg(p.starchKg),
        formatDateAR(p.date),
      ],
      ["Producción", "Responsable / supervisor", `${p.responsible ?? "—"} / ${p.supervisor ?? "—"}`, "", ""],
      ["Producción", "Operarios", p.workers.join(", ") || "—", "", ""],
      [
        "Producción",
        "Congelado",
        `${p.freezerCodes.join(", ") || "—"}${p.frozenAt ? ` · ingreso ${formatTimeAR(p.frozenAt)}` : ""}`,
        "",
        "",
      ],
    );
    for (const c of f.consumptions) {
      const lot = c.rawLot;
      rows.push([
        "Materia prima",
        c.ingredient,
        lot
          ? `Lote ${lot.supplierLotCode ?? "s/d"} · ${lot.supplier ?? "sin proveedor"} · vence ${lot.expiryDate ? formatDateAR(lot.expiryDate) : "s/d"} · recepción ${dt(lot.receivedAt)}${lot.temperatureC != null ? ` a ${lot.temperatureC} °C` : ""}`
          : "Lote de materia prima no registrado",
        qtyUnit(c.qtyActual, c.unit),
        "",
      ]);
    }
    for (const k of f.packings) {
      rows.push([
        "Envasado",
        k.product,
        `Ubicación: ${k.location}`,
        `${k.units} u. (${formatKg(k.kg)})`,
        dt(k.packedAt),
      ]);
    }
    for (const s of f.stock) rows.push(["Stock", s.product, `Ubicación: ${s.location}`, `${s.qty} u.`, ""]);
    for (const d of f.dispatches)
      rows.push([
        "Despachos",
        d.customer,
        `Remito ${String(d.number).padStart(4, "0")} · ${d.product}`,
        `${d.units} u.`,
        dt(d.date),
      ]);
    for (const s of f.storeSales)
      rows.push([
        "Ventas del local",
        s.product,
        s.voided ? "Anulada (volvió al stock)" : "",
        `${s.units} u.`,
        dt(s.soldAt),
      ]);
    for (const c of f.complaints)
      rows.push([
        "Reclamos",
        c.customer ?? "—",
        `${c.reason} (${c.status === "open" ? "abierto" : "cerrado"})`,
        "",
        formatDateAR(c.date),
      ]);
  }

  for (const r of trace.raw) {
    const l = r.rawLot;
    title = `Informe de trazabilidad · lote de proveedor ${l.supplierLotCode ?? ""}`;
    rows.push([
      "Lote de materia prima",
      l.ingredient,
      `Lote ${l.supplierLotCode ?? "s/d"} · ${l.supplier ?? "sin proveedor"} · vence ${l.expiryDate ? formatDateAR(l.expiryDate) : "s/d"}`,
      qtyUnit(l.receivedQty, l.unit),
      dt(l.receivedAt),
    ]);
    for (const k of r.finishedLots)
      rows.push([
        "Lotes terminados",
        k.code,
        `Elaborado ${formatDateAR(k.productionDate)} · vence ${formatDateAR(k.expiryDate)}${k.onHold ? " · RETENIDO" : ""} · despachado ${k.dispatchedUnits} u. · en stock ${k.stockUnits} u.`,
        qtyUnit(k.qtyUsed, l.unit),
        "",
      ]);
    for (const c of r.customers)
      rows.push(["Clientes", c.customer, `Lotes: ${c.lots.join(", ")}`, `${c.units} u.`, dt(c.lastDate)]);
    for (const u of r.unlinkedRuns)
      rows.push([
        "Sin lote registrado",
        `Producción ${formatDateAR(u.runDate)}`,
        `Consumió el insumo sin registrar lote. Lotes: ${u.lotCodes.join(", ")}`,
        "",
        "",
      ]);
  }

  return {
    title,
    code: "BPM-TRAZ",
    period,
    columns: [
      { header: "Sección", width: 1.4 },
      { header: "Concepto", width: 2 },
      { header: "Detalle", width: 5 },
      { header: "Cantidad", width: 1.4, align: "right" },
      { header: "Fecha", width: 1.6 },
    ],
    rows,
    signatures: ["Responsable técnico", "Jefa de producción"],
  };
}
