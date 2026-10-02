import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import { customerInput } from "./schemas";
import { createCustomer, listCustomers, updateCustomer } from "./service";

const base = customerInput.parse({ legalName: "Kiosco Test", channel: "reseller", cuit: "20-12345678-6" });

describe("servicio de clientes (RF-01)", () => {
  it("crea y lista un cliente, normalizando el CUIT", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await createCustomer(tx, base);
      expect(c.cuit).toBe("20123456786");
      const found = await listCustomers(tx, { q: "kiosco test" });
      expect(found.map((x) => x.id)).toContain(c.id);
    });
  });

  it("rechaza CUIT duplicado", async () => {
    await inRollback("nahuel", async (tx) => {
      await createCustomer(tx, base);
      await expect(createCustomer(tx, { ...base, legalName: "Otro" })).rejects.toThrow(
        /Ya existe un cliente con ese CUIT/,
      );
    });
  });

  it("permite editar sin chocar consigo mismo", async () => {
    await inRollback("nahuel", async (tx) => {
      const c = await createCustomer(tx, base);
      const u = await updateCustomer(tx, c.id, { ...base, paymentTermsDays: 30 });
      expect(u.paymentTermsDays).toBe(30);
    });
  });

  it("valida el CUIT con el dígito verificador", () => {
    expect(
      customerInput.safeParse({ legalName: "X S.A.", channel: "reseller", cuit: "20-12345678-0" }).success,
    ).toBe(false);
  });
});
