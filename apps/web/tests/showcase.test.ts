import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, sql, type Db } from "@chipa/db";
import { resetAndSeedShowcase } from "@chipa/db/showcase";
import { getReceivables } from "@/features/billing/service";
import { getDashboard } from "@/features/dashboard/service";
import { getMonthlyResult } from "@/features/finance/service";

/**
 * Seed de presentación (`pnpm db:showcase`): corre el showcase completo sobre una base temporal, la borra al
 * terminar y verifica las invariantes que importan para mostrarlo (stock coherente, documentos completos y un
 * resultado mensual creíble). No toca chipa_test ni el seed demo.
 */

const TODAY = "2026-10-02";
const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://chipa:chipa@localhost:5433/chipa_test";
const baseName = new URL(BASE_URL).pathname.slice(1);
const DB_NAME = baseName.endsWith("_test")
  ? `${baseName.slice(0, -"_test".length)}_showcase_test`
  : `${baseName}_showcase_test`;
const SHOWCASE_URL = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();

async function adminExec(statement: string) {
  const admin = postgres(BASE_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end();
  }
}

let db: Db;
let close: () => Promise<void>;
let first: Awaited<ReturnType<typeof resetAndSeedShowcase>>;
let fingerprint: string;

async function fingerprintOf(d: Db) {
  const [row] = await d.execute<{ f: string }>(sql`
    select concat_ws('|',
      (select count(*) from orders), (select round(sum(total)) from orders),
      (select round(sum(total)) from sales_invoices), (select count(*) from stock_movements),
      (select id from customers where legal_name = 'Kiosco El Trébol'),
      (select round(sum(kg)) from production_weighings)
    ) as f`);
  return row!.f;
}

beforeAll(async () => {
  await adminExec(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await adminExec(`CREATE DATABASE ${DB_NAME}`);
  first = await resetAndSeedShowcase(SHOWCASE_URL);
  const conn = createDb(SHOWCASE_URL, { max: 3 });
  db = conn.db;
  close = () => conn.client.end();
  fingerprint = await fingerprintOf(db);
}, 120_000);

afterAll(async () => {
  await close?.();
  await adminExec(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
}, 30_000);

const count = async (query: ReturnType<typeof sql>) => {
  const rows = await db.execute<{ n: number }>(query);
  return Number(rows[0]!.n);
};

describe("seed de presentación", () => {
  it("genera el volumen esperado del trimestre", () => {
    expect(first.productionDays).toBeGreaterThanOrEqual(58);
    expect(first.productionDays).toBeLessThanOrEqual(70);
    expect(first.producedKg / first.productionDays).toBeGreaterThan(90);
    expect(first.producedKg / first.productionDays).toBeLessThan(120);
    expect(first.rows.orders).toBeGreaterThan(200);
    expect(first.rows.salesInvoices).toBeGreaterThan(200);
    expect(first.rows.storeSales).toBeGreaterThan(300);
  });

  it("no deja saldos negativos de insumos ni de producto terminado", async () => {
    expect(await count(sql`select count(*)::int as n from v_ingredient_stock where qty < 0`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from v_product_stock where qty < 0`)).toBe(0);
  });

  it("todas las facturas tienen cliente y todos los remitos tienen lote", async () => {
    expect(
      await count(
        sql`select count(*)::int as n from sales_invoices s left join customers c on c.id = s.customer_id where c.id is null`,
      ),
    ).toBe(0);
    expect(await count(sql`select count(*)::int as n from sales_invoices`)).toBeGreaterThan(0);
    expect(
      await count(
        sql`select count(*)::int as n from dispatches d where not exists (select 1 from dispatch_items i where i.dispatch_id = d.id and i.finished_lot_id is not null)`,
      ),
    ).toBe(0);
    expect(
      await count(sql`select count(*)::int as n from dispatch_items where finished_lot_id is null`),
    ).toBe(0);
  });

  it("las rutas cerradas tienen km coherentes, combustible y temperatura", async () => {
    expect(await count(sql`select count(*)::int as n from routes where status = 'done'`)).toBeGreaterThan(30);
    expect(
      await count(
        sql`select count(*)::int as n from routes where status = 'done' and (km_start is null or km_end is null or km_end < km_start)`,
      ),
    ).toBe(0);
    expect(
      await count(
        sql`select count(*)::int as n from routes where status = 'done' and (fuel_cost is null or cold_unit_temp_c is null or started_at is null or ended_at is null)`,
      ),
    ).toBe(0);
  });

  it("no hay movimientos de stock en el futuro ni producciones después de hoy", async () => {
    expect(
      await count(
        sql`select count(*)::int as n from stock_movements where (occurred_at at time zone 'America/Argentina/Buenos_Aires')::date > ${TODAY}::date`,
      ),
    ).toBe(0);
    expect(await count(sql`select count(*)::int as n from production_runs where date > ${TODAY}`)).toBe(0);
  });

  it("septiembre da ventas y resultado creíbles", async () => {
    const sep = await getMonthlyResult(db, "2026-09", { today: TODAY });
    expect(sep.sales).toBeGreaterThan(15_000_000);
    expect(sep.sales).toBeLessThan(19_500_000);
    // Gastos fijos completos (sin el aviso de categorías que faltaban en el Excel).
    expect(sep.fixed.missingCategories).toHaveLength(0);
    expect(sep.costOfSales.underpriced).toEqual([]);
    expect(sep.labor.runs).toBeGreaterThanOrEqual(18);
    expect(sep.labor.runs).toBeLessThanOrEqual(22);
    expect(sep.delivery.routes).toBeGreaterThan(15);
    // Positivo pero lejos de los ~$9M que los socios creen retirar (tesis del relevamiento).
    expect(sep.result).toBeGreaterThan(0);
    expect(sep.result).toBeLessThan(3_500_000);
    expect(sep.withdrawals.covers).toBe(false);
    expect(sep.notices.deliveredWithoutInvoice.orders).toBe(0);
  });

  it("julio y agosto también tienen ventas y resultado en rango", async () => {
    for (const month of ["2026-07", "2026-08"]) {
      const r = await getMonthlyResult(db, month, { today: TODAY });
      expect(r.sales).toBeGreaterThan(15_000_000);
      expect(r.sales).toBeLessThan(19_500_000);
      expect(r.result).toBeGreaterThan(0);
      expect(r.result).toBeLessThan(3_500_000);
    }
  });

  it("el tablero y las cobranzas muestran datos y alertas creíbles", async () => {
    const d = await getDashboard(db, { today: TODAY, month: "2026-09", includeFinance: true });
    expect(d.financial?.missingPrices).toEqual([]);
    expect(d.financial?.costPerKg).toBeGreaterThan(5_000);
    const labels = d.alerts.map((a) => a.label);
    expect(labels).toContain("Pedidos atrasados");
    expect(labels).toContain("Clientes para llamar");
    expect(labels).toContain("Deuda vencida de clientes");
    expect(d.operational.otif.pct).toBeGreaterThan(85);
    expect(d.operational.yield.ratio).toBeGreaterThan(0.8);
    expect(d.operational.capacity.usagePct).toBeGreaterThan(50);
    const rec = await getReceivables(db, TODAY);
    expect(rec.overdue).toBeGreaterThan(0);
    expect(rec.total).toBeGreaterThan(rec.overdue);
    expect(rec.rows.length).toBeGreaterThanOrEqual(8);
  });

  it("incluye un cheque rechazado y dos reclamos", async () => {
    expect(await count(sql`select count(*)::int as n from checks where status = 'rejected'`)).toBe(1);
    expect(await count(sql`select count(*)::int as n from complaints`)).toBe(2);
  });

  it("es determinista: dos corridas dan exactamente los mismos datos", async () => {
    await resetAndSeedShowcase(SHOWCASE_URL);
    const again = createDb(SHOWCASE_URL, { max: 1 });
    try {
      expect(await fingerprintOf(again.db)).toBe(fingerprint);
    } finally {
      await again.client.end();
    }
  }, 60_000);
});
