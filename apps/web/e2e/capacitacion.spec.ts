import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, asRole } from "./fixtures";

/** Capacitación dentro del sistema: animación, módulos con capturas, autoevaluación y avance del equipo. */
type Manifest = {
  roles: {
    id: string;
    title: string;
    modules: {
      id: string;
      title: string;
      steps: unknown[];
      check: { q: string; options: string[]; answer: number }[];
    }[];
  }[];
};
const manifest: Manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/features/training/content/manifest.json"), "utf8"),
);
const operario = manifest.roles.find((r) => r.id === "operario")!;
const quizModule = operario.modules.find((m) => m.check.length)!;

test.describe("Capacitación", () => {
  test.use({ storageState: asRole("admin") });

  test("la animación del recorrido avanza por etapas y la trazabilidad se dibuja", async ({ page }) => {
    await page.goto("/capacitacion");
    const journey = page.getByTestId("journey");
    await expect(journey.getByText("Etapa 1 de 8")).toBeVisible();
    await journey.getByRole("button", { name: "Etapa siguiente" }).click();
    await expect(journey.getByText("Etapa 2 de 8")).toBeVisible();
    await expect(journey.getByRole("heading", { name: "Plan del día" })).toBeVisible();
    await journey.getByRole("button", { name: "8. Tablero" }).click();
    await expect(journey.getByRole("heading", { name: "Tablero" })).toBeVisible();

    await page.getByRole("link", { name: /trazabilidad de un lote/ }).click();
    const trace = page.getByTestId("trace");
    await expect(trace.getByText("Lote 261001-1")).toBeVisible();
    await trace.getByRole("button", { name: "Repetir" }).click();
    await expect(trace.getByRole("button", { name: "Repetir" })).toBeEnabled({ timeout: 6000 });
  });

  test("glosario con búsqueda sin tildes", async ({ page }) => {
    await page.goto("/capacitacion/glosario");
    const search = page.getByLabel("Buscar en el glosario");
    await search.fill("lote");
    await expect(page.locator("dt").first()).toBeVisible();
    await search.fill("zzzz");
    await expect(page.getByText("No hay términos que coincidan.")).toBeVisible();
  });

  test.describe("operario en la tablet", () => {
    test.use({ storageState: asRole("operator") });
    test("entra desde planta, recorre los pasos y aprueba la autoevaluación", async ({ page }) => {
      await page.goto("/planta");
      await page.getByTestId("tile-capacitacion").click();
      await expect(page.getByRole("heading", { name: "Tu capacitación" })).toBeVisible();
      await page
        .getByRole("link", { name: new RegExp(quizModule.title) })
        .first()
        .click();

      const viewer = page.getByTestId("module-viewer");
      await expect(viewer.getByText(`1/${quizModule.steps.length}`)).toBeVisible();
      if (quizModule.steps.length > 1) {
        await viewer.getByRole("button", { name: "Siguiente" }).click();
        await expect(viewer.getByText(`2/${quizModule.steps.length}`)).toBeVisible();
      }

      // Primero mal (todas en una opción incorrecta), después bien.
      const quiz = page.getByTestId("quiz");
      for (const [qi, q] of quizModule.check.entries()) {
        const wrong = (q.answer + 1) % q.options.length;
        await quiz.locator(`#q${qi}-o${wrong}`).check();
      }
      await quiz.getByRole("button", { name: "Corregir" }).click();
      await expect(quiz.getByText(/correctas$/)).toBeVisible();
      await quiz.getByRole("button", { name: "Intentar de nuevo" }).click();
      for (const [qi, q] of quizModule.check.entries()) await quiz.locator(`#q${qi}-o${q.answer}`).check();
      await quiz.getByRole("button", { name: "Corregir" }).click();
      await expect(quiz.getByText("Módulo aprobado")).toBeVisible();
    });
  });

  test.describe("avance del equipo", () => {
    test.use({ storageState: asRole("production_manager") });
    test("la jefa de producción ve el avance; la contadora no", async ({ page, sql }) => {
      const [{ id }] = await sql`select id from users where username = 'jt'`;
      await sql`insert into training_progress (user_id, module_key, score, total, completed_at)
        values (${id}, ${`operario/${quizModule.id}`}, ${quizModule.check.length}, ${quizModule.check.length}, now())`;
      await page.goto("/capacitacion/equipo");
      const row = page.getByRole("row", { name: /J\.T\./ });
      await expect(row).toContainText("1 de");
      await expect(row).toContainText(quizModule.title);
    });
  });

  test.describe("contadora", () => {
    test.use({ storageState: asRole("accountant") });
    test("tiene su capacitación pero no ve el avance del equipo", async ({ page }) => {
      await page.goto("/capacitacion");
      await expect(page.getByRole("heading", { name: "Tu capacitación" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Avance del equipo" })).toHaveCount(0);
      await page.goto("/capacitacion/equipo");
      await expect(page).toHaveURL(/sin-permiso/);
    });
  });
});
