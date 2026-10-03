import { describe, expect, it } from "vitest";
import { criticalDependencies } from "./skills";

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
