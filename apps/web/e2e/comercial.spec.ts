import { test, expect, asRole } from "./fixtures";

/** Aviso de deuda vencida al cargar un pedido (revisión del día a día comercial). */
async function makeOverdue(sql: import("postgres").Sql) {
  await sql`insert into sales_invoices (customer_id, invoice_type, point_of_sale, number, issue_date, due_date, total, source)
    values ((select id from customers where legal_name = 'Vía Dolce'), 'A', '0009', '00007777', '2026-08-01', '2026-08-31', 150000, 'manual')
    on conflict do nothing`;
}
async function pickCustomer(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("combobox", { name: "Cliente" }).click();
  await page.getByPlaceholder("Escribí el nombre…").fill(name.slice(0, 4).toLowerCase());
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

test.describe("Aviso de deuda vencida al cargar un pedido", () => {
  test.describe("Dirección", () => {
    test.use({ storageState: asRole("admin") });
    test("ve el aviso con el importe vencido", async ({ page, sql }) => {
      await makeOverdue(sql);
      await page.goto("/pedidos/nuevo");
      await pickCustomer(page, "Vía Dolce");
      await expect(page.getByTestId("overdue-warning")).toContainText("deuda vencida");
      await expect(page.getByTestId("overdue-warning")).toContainText("$");
      await pickCustomer(page, "Club Náutico");
      await expect(page.getByTestId("overdue-warning")).toHaveCount(0);
    });
  });
  test.describe("jefa de producción", () => {
    test.use({ storageState: asRole("production_manager") });
    test("ve el aviso sin montos", async ({ page, sql }) => {
      await makeOverdue(sql);
      await page.goto("/pedidos/nuevo");
      await pickCustomer(page, "Vía Dolce");
      await expect(page.getByTestId("overdue-warning")).toContainText("deuda vencida");
      await expect(page.getByTestId("overdue-warning")).not.toContainText("$");
    });
  });
});
