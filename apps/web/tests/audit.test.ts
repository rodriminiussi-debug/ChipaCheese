import { describe, expect, it } from "vitest";
import { eq, schema, sql } from "@chipa/db";
import { inRollback } from "./helpers";

describe("auditoría por triggers", () => {
  it("registra usuario, acción y datos anteriores en cada edición", async () => {
    await inRollback("af", async (tx, userId) => {
      const [zone] = await tx
        .insert(schema.zones)
        .values({ name: "Zona test", deliveryWeekdays: [1] })
        .returning();
      await tx.update(schema.zones).set({ name: "Zona test 2" }).where(eq(schema.zones.id, zone!.id));
      const rows = await tx.execute<{ action: string; changed_by: string; old_name: string | null }>(
        sql`select action, changed_by, old_data->>'name' as old_name from audit_log where table_name = 'zones' and record_id = ${zone!.id} order by id`,
      );
      expect(rows.map((r) => r.action)).toEqual(["I", "U"]);
      expect(rows.every((r) => r.changed_by === userId)).toBe(true);
      expect(rows[1]!.old_name).toBe("Zona test");
    });
  });

  it("el historial es inmutable", async () => {
    const err = await inRollback("nahuel", async (tx) => {
      await tx.execute(sql`delete from audit_log where id = (select min(id) from audit_log)`);
    }).catch((e: Error & { cause?: Error }) => e);
    expect(String((err as { cause?: Error })?.cause?.message)).toMatch(/solo lectura/);
  });
});
