import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac";

/**
 * Permisos de las acciones compartidas entre el escritorio y la tablet/celular. Cada acción se llama con
 * un payload INVÁLIDO a propósito: si el rol tiene permiso, falla la validación ("Revisá los datos") y no se
 * escribe nada; si no lo tiene, el rechazo es "No tenés permiso". Así se prueba la autorización real sin tocar la base.
 */
let role: Role = "operator";
vi.mock("@/server/auth/session", () => ({
  getCurrentUser: async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    name: "t",
    initials: "T",
    username: "t",
    role,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PERMITTED = "Revisá los datos marcados.";
const DENIED = "No tenés permiso para esta acción.";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bad = {} as any;

async function outcome(fn: (input: never) => Promise<{ ok: boolean; error?: string }>) {
  const res = await fn(bad as never);
  return res.ok ? "ok" : res.error;
}

describe("acciones compartidas: quién puede ejecutarlas", () => {
  beforeEach(() => {
    role = "operator";
  });

  it("recibir mercadería: operario, jefa y Dirección sí; logística, local y contadora no", async () => {
    const { createReceptionAction } = await import("@/features/purchases/actions");
    for (const r of ["operator", "production_manager", "admin"] as const) {
      role = r;
      expect(await outcome(createReceptionAction), r).toBe(PERMITTED);
    }
    for (const r of ["logistics", "store", "accountant", "technical_lead"] as const) {
      role = r;
      expect(await outcome(createReceptionAction), r).toBe(DENIED);
    }
  });

  it("el operario recibe, pero no carga facturas, ni paga proveedores ni arma órdenes de compra", async () => {
    const a = await import("@/features/purchases/actions");
    role = "operator";
    for (const fn of [
      a.createManualInvoiceAction,
      a.saveInvoiceAction,
      a.registerPaymentAction,
      a.createOrderAction,
    ])
      expect(await outcome(fn as never)).toBe(DENIED);
  });

  it("avisar una falla: operario, chofer, local, jefa y Dirección sí; contadora y responsable técnico no", async () => {
    const { reportFaultAction, createCorrectiveAction, closeCorrectiveAction } =
      await import("@/features/maintenance/actions");
    for (const r of ["operator", "logistics", "store", "production_manager", "admin"] as const) {
      role = r;
      expect(await outcome(reportFaultAction), r).toBe(PERMITTED);
    }
    for (const r of ["accountant", "technical_lead"] as const) {
      role = r;
      expect(await outcome(reportFaultAction), r).toBe(DENIED);
    }
    // Avisar no da acceso a gestionar el mantenimiento.
    for (const r of ["operator", "logistics", "store"] as const) {
      role = r;
      expect(await outcome(createCorrectiveAction), r).toBe(DENIED);
      expect(await outcome(closeCorrectiveAction), r).toBe(DENIED);
    }
  });

  it("inventario: el operario crea el conteo y guarda el avance, pero NO lo confirma ni lo anula", async () => {
    const s = await import("@/features/stock/actions");
    role = "operator";
    expect(await outcome(s.createInventoryCountAction)).toBe(PERMITTED);
    expect(await outcome(s.saveInventoryCountAction)).toBe(PERMITTED);
    expect(await outcome(s.confirmInventoryCountAction)).toBe(DENIED);
    expect(await outcome(s.voidInventoryCountAction)).toBe(DENIED);
    expect(await outcome(s.adjustIngredientStockAction as never)).toBe(DENIED);
    for (const r of ["production_manager", "admin"] as const) {
      role = r;
      expect(await outcome(s.confirmInventoryCountAction), r).toBe(PERMITTED);
    }
    for (const r of ["store", "logistics", "accountant"] as const) {
      role = r;
      expect(await outcome(s.createInventoryCountAction), r).toBe(DENIED);
    }
  });
});
