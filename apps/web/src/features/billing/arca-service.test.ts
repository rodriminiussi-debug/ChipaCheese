import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { eq, schema, type Executor } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { importArca, importArcaFile, previewArca, readArcaText } from "./arca-service";
import { getCustomerAccount } from "./service";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../e2e/fixtures", name), "utf-8");
const EMITIDOS = fixture("mis-comprobantes-emitidos.csv");
const RECIBIDOS = fixture("mis-comprobantes-recibidos.csv");

const CUIT = {
  lareina: "30711111111",
  esperanza: "30712222227",
  dolce: "30713333332",
  leopelle: "30715555553",
  mancinelli: "30716666669",
};

async function setCustomerCuit(tx: Executor, legalName: string, cuit: string) {
  await tx.update(schema.customers).set({ cuit }).where(eq(schema.customers.legalName, legalName));
}
async function setSupplierCuit(tx: Executor, legalName: string, cuit: string) {
  await tx.update(schema.suppliers).set({ cuit }).where(eq(schema.suppliers.legalName, legalName));
}
async function withCustomers(tx: Executor) {
  await setCustomerCuit(tx, "Supermercado La Reina", CUIT.lareina);
  await setCustomerCuit(tx, "La Esperanza", CUIT.esperanza);
  await setCustomerCuit(tx, "Vía Dolce", CUIT.dolce);
}

describe("importación de comprobantes emitidos (RF-32)", () => {
  it("la vista previa clasifica nuevos, duplicados, sin cliente y no soportados sin escribir", async () => {
    await inRollback("nahuel", async (tx) => {
      await withCustomers(tx);
      const prev = await previewArca(tx, "issued", EMITIDOS);
      expect(prev.summary).toMatchObject({
        total: 6,
        new: 3,
        duplicate: 1,
        no_customer: 1,
        unsupported: 1,
        invalid: 0,
      });
      const by = Object.fromEntries(prev.rows.map((r) => [r.label, r]));
      expect(by["Factura A 0002-00001301"]).toMatchObject({
        status: "new",
        partyName: "La Esperanza",
        total: 121000,
      });
      expect(by["Factura A 0002-00001234"]).toMatchObject({
        status: "duplicate",
        partyName: "Supermercado La Reina",
      });
      expect(by["Factura A 0002-00001303"]).toMatchObject({
        status: "no_customer",
        docNumber: "30714444448",
      });
      expect(prev.unmatched).toEqual([
        { docNumber: "30714444448", name: "Kiosco Desconocido SRL", count: 1, total: 36300 },
      ]);
      // No escribió nada.
      const count = await tx.select().from(schema.salesInvoices);
      expect(count).toHaveLength(1);
    });
  });

  it("importa como sales_invoices con CAE y origen arca_import, con vencimiento por plazo del cliente", async () => {
    await inRollback("nahuel", async (tx) => {
      await withCustomers(tx);
      const res = await importArca(tx, "issued", EMITIDOS);
      expect(res.imported).toBe(3);
      const rows = await tx
        .select()
        .from(schema.salesInvoices)
        .where(eq(schema.salesInvoices.source, "arca_import"));
      expect(rows.map((r) => `${r.invoiceType} ${r.pointOfSale}-${r.number}`).sort()).toEqual([
        "A 0002-00001301",
        "A 0002-00001302",
        "NC_A 0002-00000077",
      ]);
      const first = rows.find((r) => r.number === "00001301")!;
      expect(first).toMatchObject({
        cae: "76123456789012",
        issueDate: "2026-09-15",
        dueDate: "2026-09-15", // La Esperanza paga contado
        netTotal: 100000,
        vatTotal: 21000,
        total: 121000,
        status: "confirmed",
      });
      // La nota de crédito resta en la cuenta corriente de La Esperanza.
      const esperanza = (await tx.query.customers.findFirst({
        where: eq(schema.customers.legalName, "La Esperanza"),
      }))!;
      expect((await getCustomerAccount(tx, esperanza.id, "2026-10-02"))!.balance).toBe(121000 - 12100);
    });
  });

  it("es idempotente: importar dos veces el mismo archivo no duplica", async () => {
    await inRollback("nahuel", async (tx) => {
      await withCustomers(tx);
      await importArca(tx, "issued", EMITIDOS);
      const again = await importArca(tx, "issued", EMITIDOS);
      expect(again.imported).toBe(0);
      expect(again.summary).toMatchObject({ new: 0, duplicate: 4, no_customer: 1, unsupported: 1 });
      expect(await tx.select().from(schema.salesInvoices)).toHaveLength(4);
    });
  });

  it("reconoce como duplicada una factura cargada a mano con otro relleno de ceros", async () => {
    await inRollback("nahuel", async (tx) => {
      await withCustomers(tx);
      const esperanza = (await tx.query.customers.findFirst({
        where: eq(schema.customers.legalName, "La Esperanza"),
      }))!;
      await tx.insert(schema.salesInvoices).values({
        customerId: esperanza.id,
        invoiceType: "A",
        pointOfSale: "2",
        number: "1301",
        issueDate: "2026-09-15",
        dueDate: "2026-09-15",
        total: 121000,
      });
      const res = await importArca(tx, "issued", EMITIDOS);
      expect(res.imported).toBe(2);
    });
  });

  it("reporta los sin cliente aunque no haya ningún cliente con CUIT cargado", async () => {
    await inRollback("nahuel", async (tx) => {
      const prev = await previewArca(tx, "issued", EMITIDOS);
      expect(prev.summary).toMatchObject({ new: 0, no_customer: 5, unsupported: 1 });
      expect(prev.unmatched.map((u) => u.docNumber).sort()).toEqual([
        "30711111111",
        "30712222227",
        "30713333332",
        "30714444448",
      ]);
    });
  });

  it("detecta duplicados dentro del mismo archivo", async () => {
    await inRollback("nahuel", async (tx) => {
      await withCustomers(tx);
      const [header, first] = EMITIDOS.split("\n");
      const res = await importArca(tx, "issued", [header, first, first].join("\n"));
      expect(res.imported).toBe(1);
      expect(res.summary).toMatchObject({ new: 1, duplicate: 1 });
    });
  });

  it("decodifica archivos en Windows-1252", async () => {
    const latin1 = new Uint8Array([...Buffer.from("Fecha;Tipo;Denominación", "latin1")]);
    const text = await readArcaText(new File([latin1], "x.csv"));
    expect(text).toContain("Denominación");
    await expect(readArcaText(new File([], "vacio.csv"))).rejects.toThrow(/vacío/);
  });

  it("importArcaFile lee un File", async () => {
    await inRollback("nahuel", async (tx) => {
      await withCustomers(tx);
      const res = await importArcaFile(tx, "issued", new File([EMITIDOS], "emitidos.csv"));
      expect(res.imported).toBe(3);
    });
  });
});

describe("conciliación de comprobantes recibidos (RF-32)", () => {
  it("separa encontradas, faltantes y diferencias de importe sin crear compras", async () => {
    await inRollback("nahuel", async (tx) => {
      await setSupplierCuit(tx, "Leo Pelle", CUIT.leopelle);
      const leo = (await tx.query.suppliers.findFirst({
        where: eq(schema.suppliers.legalName, "Leo Pelle"),
      }))!;
      await tx.insert(schema.purchaseInvoices).values([
        // coincide (cargada sin ceros)
        {
          supplierId: leo.id,
          invoiceType: "A",
          pointOfSale: "5",
          number: "4521",
          issueDate: "2026-09-10",
          total: 605000,
          netTotal: 500000,
          vatTotal: 105000,
          status: "confirmed",
        },
        // el importe cargado difiere del de ARCA
        {
          supplierId: leo.id,
          invoiceType: "A",
          pointOfSale: "0005",
          number: "00004602",
          issueDate: "2026-09-15",
          total: 240000,
          netTotal: 200000,
          vatTotal: 40000,
          status: "confirmed",
        },
      ]);
      const before = await tx.select().from(schema.purchaseInvoices);
      const res = await importArca(tx, "received", RECIBIDOS);
      expect(res.imported).toBe(0);
      expect(res.summary).toMatchObject({ total: 3, found: 1, difference: 1, missing: 1 });
      const by = Object.fromEntries(res.rows.map((r) => [r.label, r]));
      expect(by["Factura A 0005-00004521"]!.status).toBe("found");
      expect(by["Factura A 0005-00004602"]).toMatchObject({
        status: "difference",
        detail: expect.stringContaining("242.000"),
      });
      // Mancinelli no tiene CUIT cargado: falta cargar y se reporta como proveedor sin match.
      expect(by["Factura A 0003-00000880"]).toMatchObject({ status: "missing", partyName: null });
      expect(res.unmatched).toEqual([
        { docNumber: CUIT.mancinelli, name: "Mancinelli SRL", count: 1, total: 121000 },
      ]);
      // No toca las compras ni las ventas.
      expect(await tx.select().from(schema.purchaseInvoices)).toHaveLength(before.length);
      expect(await tx.select().from(schema.salesInvoices)).toHaveLength(1);

      // Con el proveedor registrado, la tercera factura es una factura que falta cargar.
      await setSupplierCuit(tx, "Mancinelli", CUIT.mancinelli);
      const res2 = await previewArca(tx, "received", RECIBIDOS);
      expect(res2.rows.find((r) => r.label.endsWith("0003-00000880"))).toMatchObject({
        status: "missing",
        partyName: "Mancinelli",
        detail: expect.stringContaining("Falta cargar"),
      });
      expect(res2.unmatched).toEqual([]);
    });
  });
});
