import { describe, expect, it } from "vitest";
import {
  accountBalance,
  agingBuckets,
  applyFifo,
  statementWithRunningBalance,
  type Charge,
  type Credit,
} from "./receivables";

const charges: Charge[] = [
  { id: "F-A", date: "2026-09-01", dueDate: "2026-09-30", amount: 1000 },
  { id: "F-B", date: "2026-09-10", dueDate: "2026-10-10", amount: 2000 },
  { id: "F-C", date: "2026-08-01", dueDate: "2026-08-31", amount: 500 },
];
const credits: Credit[] = [{ id: "R-1", date: "2026-09-20", amount: 1200 }];

describe("accountBalance", () => {
  it("cargos − créditos", () => {
    expect(accountBalance(charges, credits)).toBe(2300);
    expect(accountBalance([], [])).toBe(0);
    expect(accountBalance([], credits)).toBe(-1200); // saldo a favor
  });
});

describe("applyFifo", () => {
  it("aplica los cobros a los cargos de vencimiento más antiguo primero", () => {
    expect(applyFifo(charges, credits)).toEqual([
      { chargeId: "F-C", dueDate: "2026-08-31", amount: 500, paid: 500, open: 0 },
      { chargeId: "F-A", dueDate: "2026-09-30", amount: 1000, paid: 700, open: 300 },
      { chargeId: "F-B", dueDate: "2026-10-10", amount: 2000, paid: 0, open: 2000 },
    ]);
  });
  it("varios créditos suman; un exceso no genera pagos negativos", () => {
    const r = applyFifo(charges, [
      { id: "R-1", date: "2026-09-20", amount: 2000 },
      { id: "R-2", date: "2026-09-25", amount: 5000 },
    ]);
    expect(r.every((x) => x.open === 0)).toBe(true);
    expect(r.reduce((a, x) => a + x.paid, 0)).toBe(3500);
  });
  it("sin créditos todo queda abierto; la suma de abiertos = saldo", () => {
    const r = applyFifo(charges, []);
    expect(r.map((x) => x.open)).toEqual([500, 1000, 2000]);
    const open = applyFifo(charges, credits).reduce((a, x) => a + x.open, 0);
    expect(open).toBe(accountBalance(charges, credits));
  });
  it("desempata por fecha de emisión y luego por id; no muta la entrada", () => {
    const input: Charge[] = [
      { id: "Z", date: "2026-09-02", dueDate: "2026-09-30", amount: 10 },
      { id: "B", date: "2026-09-01", dueDate: "2026-09-30", amount: 10 },
      { id: "A", date: "2026-09-01", dueDate: "2026-09-30", amount: 10 },
    ];
    expect(applyFifo(input, []).map((x) => x.chargeId)).toEqual(["A", "B", "Z"]);
    expect(input.map((x) => x.id)).toEqual(["Z", "B", "A"]);
    // mismo id: orden estable
    const same: Charge[] = [
      { id: "A", date: "2026-09-01", dueDate: "2026-09-30", amount: 1 },
      { id: "A", date: "2026-09-01", dueDate: "2026-09-30", amount: 2 },
    ];
    expect(applyFifo(same, []).map((x) => x.amount)).toEqual([1, 2]);
  });
});

describe("agingBuckets", () => {
  const today = "2026-10-15";
  it("clasifica por días de mora", () => {
    const items = [
      { dueDate: "2026-10-20", open: 100 }, // no vencido
      { dueDate: "2026-10-15", open: 10 }, // vence hoy → current
      { dueDate: "2026-10-01", open: 200 }, // 14
      { dueDate: "2026-09-15", open: 300 }, // 30
      { dueDate: "2026-09-14", open: 400 }, // 31
      { dueDate: "2026-08-16", open: 500 }, // 60
      { dueDate: "2026-08-15", open: 600 }, // 61
      { dueDate: "2026-07-17", open: 700 }, // 90
      { dueDate: "2026-07-16", open: 800 }, // 91
      { dueDate: "2026-01-01", open: 0 }, // saldado: ignorado
    ];
    expect(agingBuckets(items, today)).toEqual({
      current: 110,
      d1_30: 500,
      d31_60: 900,
      d61_90: 1300,
      d90_plus: 800,
      total: 3610,
    });
  });
  it("sin ítems", () => {
    expect(agingBuckets([], today).total).toBe(0);
  });
});

describe("statementWithRunningBalance", () => {
  it("ordena por fecha, cargos antes que créditos el mismo día, con saldo acumulado", () => {
    const rows = statementWithRunningBalance(
      [
        { id: "F-2", date: "2026-09-10", dueDate: "2026-10-10", amount: 2000 },
        { id: "F-1", date: "2026-09-01", dueDate: "2026-09-30", amount: 1000 },
      ],
      [
        { id: "R-1", date: "2026-09-10", amount: 1500 },
        { id: "R-0", date: "2026-09-01", amount: 100 },
      ],
    );
    expect(rows).toEqual([
      { date: "2026-09-01", kind: "charge", id: "F-1", amount: 1000, balance: 1000 },
      { date: "2026-09-01", kind: "credit", id: "R-0", amount: 100, balance: 900 },
      { date: "2026-09-10", kind: "charge", id: "F-2", amount: 2000, balance: 2900 },
      { date: "2026-09-10", kind: "credit", id: "R-1", amount: 1500, balance: 1400 },
    ]);
  });
  it("desempata por id dentro del mismo tipo y día; el saldo final = accountBalance", () => {
    const rows = statementWithRunningBalance(charges, credits);
    expect(rows[rows.length - 1]?.balance).toBe(accountBalance(charges, credits));
    const same = statementWithRunningBalance(
      [
        { id: "B", date: "2026-09-01", dueDate: "2026-09-30", amount: 1 },
        { id: "A", date: "2026-09-01", dueDate: "2026-09-30", amount: 1 },
        { id: "A", date: "2026-09-01", dueDate: "2026-09-30", amount: 2 },
      ],
      [],
    );
    expect(same.map((r) => r.id)).toEqual(["A", "A", "B"]);
  });
});
