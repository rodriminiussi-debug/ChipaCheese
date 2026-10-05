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
  it("local y logística ven solo lo de su día a día", () => {
    expect(can("store", "customers:read")).toBe(false);
    expect(can("store", "stock:read")).toBe(false);
    expect(can("store", "orders:read")).toBe(false);
    expect(can("store", "store:write")).toBe(true);
    expect(can("logistics", "billing:read")).toBe(false);
    expect(can("logistics", "collections:write")).toBe(true);
    expect(can("operator", ["purchases:receive", "maintenance:report", "stock:count"])).toBe(true);
    expect(can("operator", "purchases:write")).toBe(false);
  });

  it("recibir, avisar fallas y contar: quién puede cada cosa", () => {
    // Recibir mercadería: operarios, jefa y Dirección.
    for (const r of ["operator", "production_manager", "admin"] as const)
      expect(can(r, "purchases:receive")).toBe(true);
    for (const r of ["logistics", "store", "technical_lead", "accountant"] as const)
      expect(can(r, "purchases:receive")).toBe(false);
    // Avisar fallas: todos los que operan (planta, chofer, local, jefa, Dirección); no los externos.
    for (const r of ["operator", "logistics", "store", "production_manager", "admin"] as const)
      expect(can(r, "maintenance:report")).toBe(true);
    for (const r of ["technical_lead", "accountant"] as const)
      expect(can(r, "maintenance:report")).toBe(false);
    // Contar inventario: el operario cuenta pero no ajusta (stock:write).
    expect(can("operator", "stock:count")).toBe(true);
    expect(can("operator", "stock:write")).toBe(false);
    expect(can("production_manager", ["stock:write", "stock:count"])).toBe(true);
    // Recibir la rendición del chofer: Dirección y jefa; el chofer rinde con collections:write pero no la recibe.
    expect(can("admin", "dispatch:settle")).toBe(true);
    expect(can("production_manager", "dispatch:settle")).toBe(true);
    for (const r of ["logistics", "operator", "store", "technical_lead", "accountant"] as const)
      expect(can(r, "dispatch:settle")).toBe(false);
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
