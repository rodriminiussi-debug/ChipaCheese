import { describe, expect, it } from "vitest";
import { eq, schema, type Tx } from "@chipa/db";
import { verifySecret } from "@/server/auth/password";
import { inRollback } from "../../../tests/helpers";
import { changePasswordInput, changePinInput } from "./schemas";
import { PERMISSION_TEXT, permissionsInWords } from "./permission-labels";
import { PERMISSIONS, ROLES } from "@/lib/rbac";
import { changePassword, changePin } from "./service";

async function sessions(tx: Tx, userId: string, ids: string[]) {
  const exp = new Date(Date.now() + 3600_000);
  await tx.insert(schema.sessions).values(ids.map((id) => ({ id, userId, expiresAt: exp })));
}
const left = async (tx: Tx, userId: string) =>
  (await tx.query.sessions.findMany({ where: eq(schema.sessions.userId, userId) })).map((s) => s.id).sort();

describe("mi cuenta: contraseña", () => {
  it("pide la actual, guarda la nueva y cierra las otras sesiones menos la actual", async () => {
    await inRollback("nahuel", async (tx, id) => {
      await sessions(tx, id, ["s-actual", "s-otra-1", "s-otra-2"]);
      await expect(
        changePassword(tx, id, "s-actual", { current: "equivocada", password: "NuevaClave123" }),
      ).rejects.toThrow(/no es correcta/);
      expect(await left(tx, id)).toHaveLength(3);
      const res = await changePassword(tx, id, "s-actual", {
        current: "chipa1234",
        password: "NuevaClave123",
      });
      expect(res.closedSessions).toBe(2);
      expect(await left(tx, id)).toEqual(["s-actual"]);
      const u = (await tx.query.users.findFirst({ where: eq(schema.users.id, id) }))!;
      expect(await verifySecret(u.passwordHash, "NuevaClave123")).toBe(true);
      expect(await verifySecret(u.passwordHash, "chipa1234")).toBe(false);
    });
  });

  it("quien solo tiene PIN (operario) crea su contraseña con el PIN actual", async () => {
    await inRollback("jt", async (tx, id) => {
      await tx.update(schema.users).set({ passwordHash: null }).where(eq(schema.users.id, id));
      await expect(
        changePassword(tx, id, null, { current: "9999", password: "ClaveLarga99" }),
      ).rejects.toThrow(/PIN actual/);
      await changePassword(tx, id, null, { current: "1234", password: "ClaveLarga99" });
      const u = (await tx.query.users.findFirst({ where: eq(schema.users.id, id) }))!;
      expect(await verifySecret(u.passwordHash, "ClaveLarga99")).toBe(true);
    });
  });

  it("validaciones: mínimo 8, confirmación y distinta de la actual", () => {
    const ok = { current: "abc", password: "12345678", confirm: "12345678" };
    expect(changePasswordInput.safeParse(ok).success).toBe(true);
    expect(changePasswordInput.safeParse({ ...ok, password: "1234567", confirm: "1234567" }).success).toBe(
      false,
    );
    expect(changePasswordInput.safeParse({ ...ok, confirm: "otra" }).success).toBe(false);
    expect(changePasswordInput.safeParse({ ...ok, current: "12345678" }).success).toBe(false);
  });
});

describe("mi cuenta: PIN", () => {
  it("cambia el PIN con la contraseña o con el PIN actual", async () => {
    await inRollback("af", async (tx, id) => {
      await expect(changePin(tx, id, { current: "nope", pin: "4321" })).rejects.toThrow(/no es correcto/);
      await changePin(tx, id, { current: "1111", pin: "4321" }); // con el PIN actual
      let u = (await tx.query.users.findFirst({ where: eq(schema.users.id, id) }))!;
      expect(await verifySecret(u.pinHash, "4321")).toBe(true);
      await changePin(tx, id, { current: "chipa1234", pin: "654321" }); // con la contraseña
      u = (await tx.query.users.findFirst({ where: eq(schema.users.id, id) }))!;
      expect(await verifySecret(u.pinHash, "654321")).toBe(true);
    });
  });

  it("el PIN son 4 a 6 dígitos y se repite", () => {
    const ok = { current: "x", pin: "1234", confirm: "1234" };
    expect(changePinInput.safeParse(ok).success).toBe(true);
    expect(changePinInput.safeParse({ ...ok, pin: "123", confirm: "123" }).success).toBe(false);
    expect(changePinInput.safeParse({ ...ok, pin: "1234567", confirm: "1234567" }).success).toBe(false);
    expect(changePinInput.safeParse({ ...ok, pin: "12a4", confirm: "12a4" }).success).toBe(false);
    expect(changePinInput.safeParse({ ...ok, confirm: "4321" }).success).toBe(false);
  });
});

describe("mi cuenta: permisos en palabras", () => {
  it("todo permiso tiene su frase y cada rol lista las suyas", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_TEXT[p].length).toBeGreaterThan(5);
    for (const r of ROLES) expect(permissionsInWords(r).length).toBeGreaterThan(0);
    expect(permissionsInWords("operator")).toContain("Contar el inventario");
    expect(permissionsInWords("operator")).not.toContain(PERMISSION_TEXT.admin);
  });
});
