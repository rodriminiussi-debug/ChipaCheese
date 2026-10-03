import { describe, expect, it } from "vitest";
import { eq, schema } from "@chipa/db";
import { inRollback } from "../../../tests/helpers";
import { listExportLog, recordExport, recordTrace, traceTimeIndicator } from "./logs";

describe("registro de exportaciones (RF-36)", () => {
  it("guarda tipo, parámetros, usuario y fecha, y lo lista con el nombre de quien exportó", async () => {
    await inRollback("contadora", async (tx, userId) => {
      await recordExport(tx, userId, "precios_xlsx", { insumo: "Sal" });
      await recordExport(tx, userId, "limpieza_pdf", { desde: "2026-09-01", hasta: "2026-09-30" });
      const all = await listExportLog(tx);
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ kind: "limpieza_pdf", user: "Contadora" });
      expect(all[0]!.params).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" });
      expect(all[0]!.createdAt).toBeInstanceOf(Date);
      expect((await listExportLog(tx, { kind: "precios_xlsx" })).map((e) => e.params)).toEqual([
        { insumo: "Sal" },
      ]);
    });
  });

  it("la tabla queda auditada con el usuario de la transacción", async () => {
    await inRollback("contadora", async (tx, userId) => {
      const row = await recordExport(tx, userId, "despacho_xlsx");
      const audit = await tx.query.auditLog.findFirst({
        where: eq(schema.auditLog.recordId, row.id),
      });
      expect(audit).toMatchObject({ tableName: "export_log", action: "I", changedBy: userId });
    });
  });
});

describe("consultas de trazabilidad con su duración (RF-35)", () => {
  it("registra cada consulta y calcula el indicador del período", async () => {
    await inRollback("rtecnico", async (tx, userId) => {
      await recordTrace(tx, userId, { query: "260901-1", result: "finished", durationMs: 120.4 });
      await recordTrace(tx, userId, { query: "TYBO-0925", result: "raw", durationMs: 300 });
      await recordTrace(tx, userId, { query: "xxx", result: "none", durationMs: 40 });
      const rows = await tx.select().from(schema.traceLog);
      expect(rows.map((r) => [r.query, r.result, r.durationMs, r.userId])).toEqual(
        expect.arrayContaining([["260901-1", "finished", 120, userId]]),
      );

      const today = "2099-12-31";
      const ind = await traceTimeIndicator(tx, "2020-01-01", today);
      expect(ind.all).toMatchObject({ count: 3, maxMs: 300, withinTargetPct: 100 });
      expect(ind.found.count).toBe(2);
      expect(ind.found.avgMs).toBe(210);
      // Fuera del período no cuenta.
      expect((await traceTimeIndicator(tx, "2020-01-01", "2020-12-31")).all.count).toBe(0);
    });
  });
});
