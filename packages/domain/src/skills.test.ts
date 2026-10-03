import { describe, expect, it } from "vitest";
import { criticalDependencies, suggestReplacements } from "./skills";

const task = (id: string, critical: boolean) => ({ id, name: `Tarea ${id}`, stage: "machines", critical });

describe("alerta de dependencia crítica (RF-23)", () => {
  it("alerta las tareas críticas con menos de 2 personas que puedan hacerlas", () => {
    const tasks = [task("a", true), task("b", true), task("c", false), task("d", true)];
    const skills = [
      { userId: "u1", taskId: "a", level: "expert" },
      { userId: "u2", taskId: "a", level: "able" },
      { userId: "u1", taskId: "b", level: "expert" },
      { userId: "u2", taskId: "b", level: "learning" }, // aprendiendo no cuenta
      { userId: "u1", taskId: "c", level: "expert" },
    ];
    const alerts = criticalDependencies(tasks, skills);
    expect(alerts.map((a) => [a.task.id, a.holders])).toEqual([
      ["b", ["u1"]],
      ["d", []],
    ]);
  });

  it("permite cambiar el mínimo de reemplazos", () => {
    const skills = [
      { userId: "u1", taskId: "a", level: "expert" },
      { userId: "u2", taskId: "a", level: "able" },
    ];
    expect(criticalDependencies([task("a", true)], skills)).toEqual([]);
    expect(criticalDependencies([task("a", true)], skills, 3)).toHaveLength(1);
  });
});

describe("reemplazos ante una ausencia (RF-23)", () => {
  const skills = [
    { userId: "u1", taskId: "a", level: "expert" },
    { userId: "u2", taskId: "a", level: "able" },
    { userId: "u3", taskId: "a", level: "learning" }, // aprendiendo no habilita
    { userId: "u4", taskId: "a", level: "expert" },
    { userId: "u5", taskId: "a", level: "able" },
    { userId: "u1", taskId: "b", level: "expert" },
  ];
  const base = { taskId: "a", skills, absentUserIds: [], assignedUserIds: [], busyUserIds: [] };

  it("propone solo a quienes pueden o son expertos, expertos primero", () => {
    expect(suggestReplacements(base).map((r) => [r.userId, r.level])).toEqual([
      ["u1", "expert"],
      ["u4", "expert"],
      ["u2", "able"],
      ["u5", "able"],
    ]);
  });
  it("excluye a los ausentes y a los ya asignados a la tarea", () => {
    const r = suggestReplacements({ ...base, absentUserIds: ["u1"], assignedUserIds: ["u2"] });
    expect(r.map((x) => x.userId)).toEqual(["u4", "u5"]);
  });
  it("a igual nivel pone primero a quien no tiene otra tarea ese día y lo marca", () => {
    const r = suggestReplacements({ ...base, busyUserIds: ["u1", "u2"] });
    expect(r.map((x) => [x.userId, x.busy])).toEqual([
      ["u4", false],
      ["u1", true],
      ["u5", false],
      ["u2", true],
    ]);
  });
  it("sin habilitados disponibles devuelve vacío", () => {
    expect(suggestReplacements({ ...base, taskId: "b", absentUserIds: ["u1"] })).toEqual([]);
    expect(suggestReplacements({ ...base, taskId: "zzz" })).toEqual([]);
  });
});
