import { diffDays, type IsoDate } from "./dates";
import { roundMoney } from "./units";

export interface Charge {
  id: string;
  date: IsoDate;
  dueDate: IsoDate;
  amount: number;
}

export interface Credit {
  id: string;
  date: IsoDate;
  amount: number;
}

/** RF-30: saldo de la cuenta corriente = Σ cargos − Σ créditos (positivo = el cliente debe). */
export function accountBalance(charges: Charge[], credits: Credit[]): number {
  const c = charges.reduce((a, x) => a + x.amount, 0);
  const p = credits.reduce((a, x) => a + x.amount, 0);
  return roundMoney(c - p);
}

export interface AppliedCharge {
  chargeId: string;
  dueDate: IsoDate;
  amount: number;
  paid: number;
  open: number;
}

/**
 * RF-30: aplica los créditos (cobros) a los cargos por vencimiento ascendente (FIFO).
 * Desempata por fecha de emisión y luego por id. Un crédito sobrante (a favor del
 * cliente) no se refleja en las filas: el saldo a favor surge de {@link accountBalance}.
 */
export function applyFifo(charges: Charge[], credits: Credit[]): AppliedCharge[] {
  let pool = credits.reduce((a, x) => a + x.amount, 0);
  const sorted = [...charges].sort(
    (a, b) =>
      (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0) ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return sorted.map((c) => {
    const paid = roundMoney(Math.max(0, Math.min(c.amount, pool)));
    pool = roundMoney(pool - paid);
    return {
      chargeId: c.id,
      dueDate: c.dueDate,
      amount: c.amount,
      paid,
      open: roundMoney(c.amount - paid),
    };
  });
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

/**
 * RF-30: antigüedad de la deuda según días de mora (today − vencimiento):
 * `current` = aún no vencido (≤ 0), luego 1–30, 31–60, 61–90 y más de 90 días.
 */
export function agingBuckets(openItems: { dueDate: IsoDate; open: number }[], today: IsoDate): AgingBuckets {
  const b: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
  for (const item of openItems) {
    if (item.open <= 0) continue;
    const late = diffDays(today, item.dueDate);
    if (late <= 0) b.current += item.open;
    else if (late <= 30) b.d1_30 += item.open;
    else if (late <= 60) b.d31_60 += item.open;
    else if (late <= 90) b.d61_90 += item.open;
    else b.d90_plus += item.open;
    b.total += item.open;
  }
  return {
    current: roundMoney(b.current),
    d1_30: roundMoney(b.d1_30),
    d31_60: roundMoney(b.d31_60),
    d61_90: roundMoney(b.d61_90),
    d90_plus: roundMoney(b.d90_plus),
    total: roundMoney(b.total),
  };
}

export interface StatementRow {
  date: IsoDate;
  kind: "charge" | "credit";
  id: string;
  amount: number;
  balance: number;
}

/**
 * RF-30: estado de cuenta con saldo acumulado. Ordena por fecha; el mismo día los
 * cargos van antes que los créditos (y luego por id). Saldo positivo = el cliente debe.
 */
export function statementWithRunningBalance(charges: Charge[], credits: Credit[]): StatementRow[] {
  const rows: Omit<StatementRow, "balance">[] = [
    ...charges.map((c) => ({ date: c.date, kind: "charge" as const, id: c.id, amount: c.amount })),
    ...credits.map((c) => ({ date: c.date, kind: "credit" as const, id: c.id, amount: c.amount })),
  ];
  rows.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (a.kind === b.kind ? 0 : a.kind === "charge" ? -1 : 1) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let balance = 0;
  return rows.map((r) => {
    balance = roundMoney(balance + (r.kind === "charge" ? r.amount : -r.amount));
    return { ...r, balance };
  });
}
