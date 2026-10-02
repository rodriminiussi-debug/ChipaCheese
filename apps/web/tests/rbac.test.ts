import { describe, expect, it } from "vitest";
import { can, homeFor, PERMISSIONS, ROLES } from "@/lib/rbac";

describe("RBAC (tabla Usuarios y permisos)", () => {
  it("Dirección tiene todos los permisos", () => {
    for (const p of PERMISSIONS) expect(can("admin", p)).toBe(true);
  });
  it("Jefa de producción: todo menos finanzas", () => {
    expect(can("production_manager", "production:write")).toBe(true);
    expect(can("production_manager", "purchases:write")).toBe(true);
    expect(can("production_manager", "finance:read")).toBe(false);
    expect(can("production_manager", "billing:write")).toBe(false);
    expect(can("production_manager", "billing:read")).toBe(false);
  });
  it("Operario: solo carga de su tarea", () => {
    expect(can("operator", "production:record")).toBe(true);
    expect(can("operator", "quality:record")).toBe(true);
    expect(can("operator", "purchases:read")).toBe(false);
    expect(can("operator", "production:write")).toBe(false);
  });
  it("externos son solo lectura", () => {
    for (const role of ["technical_lead", "accountant"] as const) {
      const writes = PERMISSIONS.filter((p) => p.endsWith(":write") || p.endsWith(":record"));
      for (const p of writes) expect(can(role, p)).toBe(false);
    }
  });
  it("cada rol tiene una pantalla de inicio", () => {
    for (const r of ROLES) expect(homeFor(r)).toMatch(/^\//);
  });
});
