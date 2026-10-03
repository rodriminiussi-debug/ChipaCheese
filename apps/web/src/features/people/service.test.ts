import { describe, expect, it } from "vitest";
import { inRollback } from "../../../tests/helpers";
import {
  copyPreviousAssignments,
  listPlantPeople,
  listTasks,
  myTasks,
  setSkill,
  skillMatrix,
  taskBoard,
  toggleAssignment,
} from "./service";

const TODAY = "2026-10-02";

async function refs(db: Parameters<typeof taskBoard>[0]) {
  const [people, tasks] = await Promise.all([listPlantPeople(db), listTasks(db)]);
  const person = (initials: string) => people.find((p) => p.initials === initials)!;
  const task = (name: string) => tasks.find((t) => t.name.startsWith(name))!;
  return { person, task };
}

describe("pizarrón digital (RF-23)", () => {
  it("lista al personal de planta y las 20 tareas por etapa", async () => {
    await inRollback("af", async (tx) => {
      const people = await listPlantPeople(tx);
      expect(people.map((p) => p.initials).sort()).toEqual(["A.F.", "E.A.", "J.T.", "N.R.", "S.G.", "S.R."]);
      expect(await listTasks(tx)).toHaveLength(20);
    });
  });

  it("asigna y desasigna sin duplicar, y 'mis tareas' agrupa por persona", async () => {
    await inRollback("af", async (tx) => {
      const { person, task } = await refs(tx);
      const jt = person("J.T.");
      const sg = person("S.G.");
      const huevos = task("Huevos");
      const assign = (userId: string, assigned: boolean) =>
        toggleAssignment(tx, { date: TODAY, taskId: huevos.id, userId, assigned });

      await assign(jt.id, true);
      await assign(jt.id, true); // idempotente
      await assign(sg.id, true);
      const board = await taskBoard(tx, TODAY);
      expect(board.assignments).toHaveLength(2);

      const mine = await myTasks(tx, jt.id, TODAY);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ name: "Huevos", with: ["S.G."] });

      await assign(jt.id, false);
      expect((await taskBoard(tx, TODAY)).assignments).toEqual([{ taskId: huevos.id, userId: sg.id }]);
      expect(await myTasks(tx, jt.id, TODAY)).toEqual([]);
    });
  });

  it("copia la asignación del último día anterior y no pisa lo ya asignado", async () => {
    await inRollback("af", async (tx) => {
      const { person, task } = await refs(tx);
      await expect(copyPreviousAssignments(tx, TODAY)).rejects.toThrow(/No hay una asignación anterior/);

      const monday = "2026-09-28";
      for (const [who, what] of [
        ["J.T.", "Mandioca"],
        ["E.A.", "Amasadora"],
        ["A.F.", "Batidora"],
      ] as const) {
        await toggleAssignment(tx, {
          date: monday,
          taskId: task(what).id,
          userId: person(who).id,
          assigned: true,
        });
      }
      // Ya hay una asignación en el día destino: no se duplica ni se pisa.
      await toggleAssignment(tx, {
        date: "2026-10-01",
        taskId: task("Amasadora").id,
        userId: person("E.A.").id,
        assigned: true,
      });

      const res = await copyPreviousAssignments(tx, "2026-10-01");
      expect(res).toEqual({ from: monday, copied: 2 });
      expect((await taskBoard(tx, "2026-10-01")).assignments).toHaveLength(3);
      // El viernes copia el último día con asignaciones (el 01/10), no el domingo vacío.
      expect(await copyPreviousAssignments(tx, "2026-10-04")).toEqual({ from: "2026-10-01", copied: 3 });
    });
  });
});

describe("matriz de polivalencia y dependencias críticas (RF-23)", () => {
  it("la demo alerta las 7 tareas críticas con una sola persona capacitada", async () => {
    await inRollback("af", async (tx) => {
      const { alerts } = await skillMatrix(tx);
      expect(alerts.map((a) => a.task.name)).toEqual([
        "Cortado y rallado de queso reggianito",
        "Leche (dosificación)",
        "Sal (dosificación)",
        "Batidora",
        "Amasadora",
        "Biscomatic: manejo",
        "Acopio en freezer",
      ]);
      expect(alerts.every((a) => a.holders.length === 1)).toBe(true);
    });
  });

  it("capacitar a un reemplazo ('puede') apaga la alerta; 'aprendiendo' no alcanza; quitar la reabre", async () => {
    await inRollback("af", async (tx) => {
      const { person, task } = await refs(tx);
      const batidora = task("Batidora");
      const ea = person("E.A.");
      const isAlerted = async () => (await skillMatrix(tx)).alerts.some((a) => a.task.id === batidora.id);

      expect(await isAlerted()).toBe(true);
      await setSkill(tx, { userId: ea.id, taskId: batidora.id, level: "learning" });
      expect(await isAlerted()).toBe(true);
      await setSkill(tx, { userId: ea.id, taskId: batidora.id, level: "able" });
      expect(await isAlerted()).toBe(false);
      await setSkill(tx, { userId: ea.id, taskId: batidora.id, level: "expert" }); // actualiza, no duplica
      expect((await skillMatrix(tx)).skills.filter((s) => s.taskId === batidora.id)).toHaveLength(2);
      await setSkill(tx, { userId: ea.id, taskId: batidora.id, level: null });
      expect(await isAlerted()).toBe(true);
    });
  });
});

describe("reemplazos ante una ausencia (RF-23)", () => {
  it("la tarea que queda sin nadie por una ausencia sugiere a los habilitados (puede/experto), no a los que aprenden", async () => {
    await inRollback("af", async (tx) => {
      const { person, task } = await refs(tx);
      const batidora = task("Batidora");
      const af = person("A.F.");
      const ea = person("E.A.");
      const jt = person("J.T.");
      await toggleAssignment(tx, { date: TODAY, taskId: batidora.id, userId: af.id, assigned: true });

      // Sin ausentes no hay huecos.
      expect((await taskBoard(tx, TODAY)).gaps).toEqual([]);

      // A.F. es el único capacitado en la Batidora: nadie lo reemplaza.
      let gaps = (await taskBoard(tx, TODAY, { absentIds: [af.id] })).gaps;
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toMatchObject({ task: { id: batidora.id }, absent: [af.id], replacements: [] });

      await setSkill(tx, { userId: jt.id, taskId: batidora.id, level: "learning" });
      await setSkill(tx, { userId: ea.id, taskId: batidora.id, level: "able" });
      gaps = (await taskBoard(tx, TODAY, { absentIds: [af.id] })).gaps;
      expect(gaps[0]!.replacements).toEqual([{ userId: ea.id, level: "able", busy: false }]);

      // Si E.A. ya tiene otra tarea ese día, se sugiere igual pero marcado como ocupado.
      await toggleAssignment(tx, { date: TODAY, taskId: task("Huevos").id, userId: ea.id, assigned: true });
      gaps = (await taskBoard(tx, TODAY, { absentIds: [af.id] })).gaps;
      expect(gaps[0]!.replacements).toEqual([{ userId: ea.id, level: "able", busy: true }]);

      // Cubierta la tarea con otra persona presente, deja de ser un hueco.
      await toggleAssignment(tx, { date: TODAY, taskId: batidora.id, userId: ea.id, assigned: true });
      expect((await taskBoard(tx, TODAY, { absentIds: [af.id] })).gaps).toEqual([]);
      // Ids que no son personal de planta se ignoran.
      expect(
        (await taskBoard(tx, TODAY, { absentIds: ["00000000-0000-4000-8000-000000000000"] })).absentIds,
      ).toEqual([]);
    });
  });
});
