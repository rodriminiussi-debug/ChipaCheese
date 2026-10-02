import { describe, expect, it } from "vitest";
import { renderBpmPdf } from "./pdf";

describe("planilla BPM en PDF", () => {
  it("genera un PDF válido con varias páginas", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`${i + 1}/09/2026`, "Freezer F3", -20, "J.T."]);
    const buf = await renderBpmPdf(
      {
        title: "Registro de temperaturas",
        code: "BPM-TEMP",
        version: "2022",
        period: "Septiembre 2026",
        columns: [
          { header: "Fecha" },
          { header: "Equipo", width: 2 },
          { header: "°C", align: "right" },
          { header: "Responsable" },
        ],
        rows,
        signatures: ["Responsable", "Supervisor"],
      },
      "02/10/2026 10:00",
    );
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
  });
});
