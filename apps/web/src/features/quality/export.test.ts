import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { eq, schema } from "@chipa/db";
import { renderBpmPdf } from "@/server/export/pdf";
import { inRollback } from "../../../tests/helpers";
import { REPORT_KINDS, buildReport, sheetToXlsx } from "./export";

const TODAY = "2026-10-02";
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

describe("exportación de registros BPM (RF-36)", () => {
  it.each(REPORT_KINDS)("el informe %s genera un PDF válido", async (kind) => {
    await inRollback("rtecnico", async (tx) => {
      const sheet = await buildReport(tx, kind, { ...SEPTEMBER, month: "2026-08" }, TODAY);
      const pdf = await renderBpmPdf(sheet, "02/10/2026 10:00");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1500);
    });
  });

  it("control de limpieza: sector/elemento × día con las marcas de agosto", async () => {
    await inRollback("rtecnico", async (tx) => {
      const sheet = await buildReport(
        tx,
        "limpieza",
        { from: "2026-08-01", to: "2026-08-31", month: "2026-08" },
        TODAY,
      );
      expect(sheet.columns).toHaveLength(2 + 31);
      const pisos = sheet.rows.find((r) => r[1] === "Pisos")!;
      expect(pisos[2 + 2]).toBe("x"); // día 3
      expect(pisos[2 + 3]).toBe("P"); // día 4
      expect(pisos.slice(2).filter(Boolean)).toHaveLength(2);
    });
  });

  it("registro de elaboración: lote, vencimiento, responsables, pesadas y materia prima", async () => {
    await inRollback("rtecnico", async (tx) => {
      const sheet = await buildReport(tx, "elaboracion", SEPTEMBER, TODAY);
      expect(sheet.rows).toHaveLength(1);
      const row = sheet.rows[0]!.map(String);
      expect(row[0]).toBe("01/09/2026");
      expect(row[2]).toContain("260901-1");
      expect(row[2]).toContain("01/03/2027");
      expect(row[6]).toBe("149,3 kg");
      expect(row[7]).toContain("Fécula");
      expect(row[8]).toContain("Tapitas: 70,6 kg");
      // Octubre: la producción del 01/10 trae el lote de materia prima con su vencimiento.
      const oct = await buildReport(tx, "elaboracion", { from: "2026-10-01", to: "2026-10-31" }, TODAY);
      expect(String(oct.rows[0]![7])).toContain("TYBO-0925");
      expect(String(oct.rows[0]![7])).toContain("15/11/2026");
    });
  });

  it("registro de despacho: una fila por ítem con destino y responsable", async () => {
    await inRollback("rtecnico", async (tx) => {
      const lot = (await tx.query.finishedLots.findFirst({
        where: eq(schema.finishedLots.code, "261001-1"),
      }))!;
      const customer = (await tx.query.customers.findFirst())!;
      const order = (await tx.query.orders.findFirst())!;
      const packing = (await tx.query.packings.findFirst({
        where: eq(schema.packings.finishedLotId, lot.id),
      }))!;
      const route = (
        await tx
          .insert(schema.routes)
          .values({ date: TODAY, vehicleId: (await tx.query.vehicles.findFirst())!.id })
          .returning()
      )[0]!;
      const [d] = await tx
        .insert(schema.dispatches)
        .values({
          orderId: order.id,
          customerId: customer.id,
          routeId: route.id,
          dispatchedAt: new Date("2026-10-02T11:00:00-03:00"),
        })
        .returning();
      await tx
        .insert(schema.dispatchItems)
        .values({ dispatchId: d!.id, productId: packing.productId, finishedLotId: lot.id, qtyUnits: 12 });
      const sheet = await buildReport(tx, "despacho", { from: "2026-10-01", to: "2026-10-31" }, TODAY);
      expect(sheet.rows).toHaveLength(1);
      expect(sheet.rows[0]).toEqual(
        expect.arrayContaining(["261001-1", "02/10/2026", 12, customer.legalName]),
      );
      expect(String(sheet.rows[0]![5])).toContain("AA000AA");
    });
  });

  it("reclamos y mantenimiento traen las planillas históricas del demo", async () => {
    await inRollback("rtecnico", async (tx) => {
      const complaints = await buildReport(tx, "reclamos", { from: "2025-01-01", to: "2026-12-31" }, TODAY);
      expect(complaints.rows).toHaveLength(3);
      const maint = await buildReport(tx, "mantenimiento", { from: "2025-01-01", to: "2026-12-31" }, TODAY);
      expect(
        maint.rows.filter((r) => String(r[1]).includes("Biscomatic") && r[2] === "Correctivo"),
      ).toHaveLength(4);
    });
  });

  it("el Excel tiene los mismos encabezados que la planilla", async () => {
    await inRollback("rtecnico", async (tx) => {
      const sheet = await buildReport(tx, "temperaturas", { from: "2026-10-01", to: "2026-10-02" }, TODAY);
      expect(sheet.rows).toHaveLength(5);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await sheetToXlsx(sheet)) as unknown as ArrayBuffer);
      const ws = wb.worksheets[0]!;
      expect(ws.getRow(1).getCell(3).value).toBe("Equipo");
      expect(ws.rowCount).toBe(6);
    });
  });
});
