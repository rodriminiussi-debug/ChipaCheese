import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import { ROLE_TO_TRAINING, TRAINING, findModule, journeyShots } from "./content";
import { getTeamProgress, getUserProgress, roleCompletion, submitQuiz } from "./service";
import { ROLES } from "@/lib/rbac";

/** Primer módulo con autoevaluación del guion (las pruebas no dependen del contenido concreto). */
function firstQuizModule() {
  for (const r of TRAINING.roles)
    for (const m of r.modules) if (m.check.length) return { roleId: r.id, mod: m };
  throw new Error("el guion no tiene autoevaluaciones");
}

describe("capacitación", () => {
  it("el guion es coherente: respuestas dentro de las opciones y cada rol del sistema tiene su capacitación", () => {
    for (const r of TRAINING.roles)
      for (const m of r.modules) {
        expect(m.steps.length).toBeGreaterThan(0);
        // /capacitacion/[rol]/ficha es la ficha imprimible: ningún módulo puede llamarse así.
        expect(m.id).not.toBe("ficha");
        for (const q of m.check) expect(q.answer).toBeLessThan(q.options.length);
      }
    // Rutas estáticas de /capacitacion que no pueden ser ids de rol.
    for (const r of TRAINING.roles) expect(["recorrido", "glosario", "equipo"]).not.toContain(r.id);
    for (const role of ROLES) expect(TRAINING.roles.map((r) => r.id)).toContain(ROLE_TO_TRAINING[role]);
  });

  it("corrige en el servidor: aprueba solo con todo bien y no desaprueba con un repaso posterior", async () => {
    const { roleId, mod } = firstQuizModule();
    const right = mod.check.map((q) => q.answer);
    const wrong = mod.check.map((q) => (q.answer + 1) % q.options.length);
    await inRollback("jt", async (tx, userId) => {
      const fail = await submitQuiz(tx, userId, { roleId, moduleId: mod.id, answers: wrong });
      expect(fail.passed).toBe(false);
      expect(fail.score).toBe(0);
      let p = await getUserProgress(tx, userId);
      expect(p[`${roleId}/${mod.id}`]?.completedAt).toBeNull();

      const ok = await submitQuiz(tx, userId, { roleId, moduleId: mod.id, answers: right });
      expect(ok.passed).toBe(true);
      await submitQuiz(tx, userId, { roleId, moduleId: mod.id, answers: wrong });
      p = await getUserProgress(tx, userId);
      expect(p[`${roleId}/${mod.id}`]?.completedAt).not.toBeNull();
      expect(p[`${roleId}/${mod.id}`]?.attempts).toBe(3);
      expect(roleCompletion(p, roleId).done).toBe(1);
    });
  });

  it("rechaza respuestas incompletas o módulos inexistentes", async () => {
    const { roleId, mod } = firstQuizModule();
    await inRollback("jt", async (tx, userId) => {
      await expect(submitQuiz(tx, userId, { roleId, moduleId: mod.id, answers: [] })).rejects.toThrow(
        /Respondé todas/,
      );
      await expect(submitQuiz(tx, userId, { roleId, moduleId: "no-existe", answers: [0] })).rejects.toThrow(
        /no existe/,
      );
    });
  });

  it("el avance del equipo compara a cada persona con los módulos de su rol", async () => {
    await inRollback("nahuel", async (tx) => {
      const team = await getTeamProgress(tx);
      const jt = team.find((u) => u.initials === "J.T.")!;
      expect(jt.roleId).toBe("operario");
      expect(jt.total).toBe(TRAINING.roles.find((r) => r.id === "operario")!.modules.length);
    });
  });

  it("las capturas de la animación apuntan a archivos públicos", () => {
    for (const src of Object.values(journeyShots())) expect(src).toMatch(/^\/capacitacion\/capturas\//);
    expect(findModule("no-existe", "x")).toBeUndefined();
  });
});
