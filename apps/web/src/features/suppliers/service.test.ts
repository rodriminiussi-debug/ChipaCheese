import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import { supplierIngredientsInput, supplierInput } from "./schemas";
import {
  createSupplier,
  listSuppliers,
  setSupplierIngredients,
  supplierIngredientRows,
  updateSupplier,
} from "./service";

const base = supplierInput.parse({
  legalName: "Lácteos del Litoral SA",
  cuit: "30-71234567-1",
  leadTimeDays: 3,
  paymentTermsDays: "30",
  whatsapp: "+54 9 341 555-0000",
});

describe("servicio de proveedores (RF-07)", () => {
  it("crea y busca por nombre o CUIT, normalizando el CUIT", async () => {
    await inRollback("nahuel", async (tx) => {
      const s = await createSupplier(tx, base);
      expect(s).toMatchObject({ cuit: "30712345671", leadTimeDays: 3, paymentTermsDays: 30, active: true });
      expect((await listSuppliers(tx, { q: "litoral" })).map((x) => x.id)).toEqual([s.id]);
      expect((await listSuppliers(tx, { q: "30-71234567" })).map((x) => x.id)).toEqual([s.id]);
      // los del seed siguen ahí, ordenados por nombre
      const all = await listSuppliers(tx);
      expect(all.map((x) => x.legalName)).toContain("Leo Pelle");
    });
  });

  it("rechaza CUIT duplicado y permite editar sin chocar consigo mismo", async () => {
    await inRollback("nahuel", async (tx) => {
      const s = await createSupplier(tx, base);
      await expect(createSupplier(tx, { ...base, legalName: "Otro" })).rejects.toThrow(
        /Ya existe un proveedor con ese CUIT/,
      );
      const u = await updateSupplier(tx, s.id, { ...base, paymentTermsDays: 15, active: false });
      expect(u).toMatchObject({ paymentTermsDays: 15, active: false });
      expect((await listSuppliers(tx, { q: "litoral" })).length).toBe(0); // inactivos ocultos
      expect((await listSuppliers(tx, { q: "litoral", includeInactive: true })).length).toBe(1);
      await expect(
        updateSupplier(tx, "00000000-0000-0000-0000-000000000000", { ...base, cuit: null }),
      ).rejects.toThrow(/no existe/);
    });
  });

  it("valida el CUIT con el dígito verificador", () => {
    expect(supplierInput.safeParse({ legalName: "X SA", cuit: "30-71234567-0" }).success).toBe(false);
  });

  it("administra los insumos que vende y muestra el último precio con su variación", async () => {
    await inRollback("nahuel", async (tx) => {
      const leo = (await listSuppliers(tx, { q: "Leo Pelle" }))[0]!;
      const rows = await supplierIngredientRows(tx, leo.id);
      const fecula = rows.find((r) => r.name === "Fécula de mandioca")!;
      expect(fecula).toMatchObject({
        sold: true,
        lastPrice: 1728,
        lastPriceDate: "2026-09-29",
        variationPct: null,
      });
      expect(rows.find((r) => r.name === "Leche")!.sold).toBe(false);

      const leche = rows.find((r) => r.name === "Leche")!;
      const input = supplierIngredientsInput.parse({
        supplierId: leo.id,
        items: [
          { ingredientId: fecula.ingredientId, supplierCode: "FEC-01" },
          { ingredientId: leche.ingredientId },
        ],
      });
      expect(await setSupplierIngredients(tx, leo.id, input.items)).toBe(2);
      const after = await supplierIngredientRows(tx, leo.id);
      expect(
        after
          .filter((r) => r.sold)
          .map((r) => r.name)
          .sort(),
      ).toEqual(["Fécula de mandioca", "Leche"]);
      expect(after.find((r) => r.name === "Fécula de mandioca")!.supplierCode).toBe("FEC-01");
      await expect(setSupplierIngredients(tx, "00000000-0000-0000-0000-000000000000", [])).rejects.toThrow(
        /no existe/,
      );
    });
  });
});
