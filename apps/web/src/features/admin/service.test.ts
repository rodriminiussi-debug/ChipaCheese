import { describe, expect, it } from "vitest";
import { eq, schema } from "@chipa/db";
import { verifySecret } from "@/server/auth/password";
import { inRollback } from "../../../tests/helpers";
import { userInput } from "./schemas";
import { createUser, diffFields, updateUser } from "./service";

describe("administración de usuarios", () => {
  it("crea un operario con PIN hasheado", async () => {
    await inRollback("nahuel", async (tx) => {
      const { id } = await createUser(
        tx,
        userInput.parse({
          name: "Nuevo Operario",
          initials: "N.O.",
          username: "nuevo",
          role: "operator",
          pin: "9876",
        }),
      );
      const u = await tx.query.users.findFirst({ where: eq(schema.users.id, id) });
      expect(u!.pinHash).not.toBe("9876");
      expect(await verifySecret(u!.pinHash, "9876")).toBe(true);
    });
  });

  it("exige contraseña o PIN y usuario único", async () => {
    await inRollback("nahuel", async (tx) => {
      await expect(
        createUser(
          tx,
          userInput.parse({ name: "Sin acceso", initials: "SA", username: "sinacceso", role: "store" }),
        ),
      ).rejects.toThrow(/contraseña o un PIN/);
      await expect(
        createUser(
          tx,
          userInput.parse({ name: "Dup", initials: "D", username: "jt", role: "operator", pin: "1111" }),
        ),
      ).rejects.toThrow(/ya existe/);
    });
  });

  it("desactivar un usuario cierra sus sesiones; no podés desactivarte a vos mismo", async () => {
    await inRollback("nahuel", async (tx, adminId) => {
      const jt = await tx.query.users.findFirst({ where: eq(schema.users.username, "jt") });
      await tx
        .insert(schema.sessions)
        .values({ id: "test-session", userId: jt!.id, expiresAt: new Date(Date.now() + 1e6) });
      await updateUser(
        tx,
        jt!.id,
        userInput.parse({
          name: jt!.name,
          initials: jt!.initials,
          username: "jt",
          role: "operator",
          active: false,
        }),
        adminId,
      );
      expect(
        await tx.query.sessions.findFirst({ where: eq(schema.sessions.id, "test-session") }),
      ).toBeUndefined();
      await expect(
        updateUser(
          tx,
          adminId,
          userInput.parse({
            name: "Nahuel",
            initials: "N.",
            username: "nahuel",
            role: "admin",
            active: false,
          }),
          adminId,
        ),
      ).rejects.toThrow(/No podés/);
    });
  });

  it("diffFields ignora timestamps", () => {
    expect(diffFields({ a: 1, b: 2, updated_at: "x" }, { a: 1, b: 3, updated_at: "y" })).toEqual([
      { field: "b", from: 2, to: 3 },
    ]);
  });
});
