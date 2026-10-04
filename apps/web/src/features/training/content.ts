import { z } from "zod";
import manifestJson from "./content/manifest.json";
import glossaryJson from "./content/glosario.json";
import type { Role } from "@/lib/rbac";

/**
 * Contenido de la capacitación: guion por rol con capturas reales del sistema
 * (generado por scripts/capture-training.ts; ver content/README.md). Se valida al compilar.
 */
const highlight = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const step = z.object({
  text: z.string(),
  screenshot: z.string().optional().nullable(),
  highlight: highlight.optional().nullable(),
});
const question = z.object({
  q: z.string(),
  options: z.array(z.string()).min(2),
  answer: z.number().int().min(0),
  explain: z.string().optional().default(""),
});
const trainingModule = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string().optional().default(""),
  steps: z.array(step).min(1),
  tips: z.array(z.string()).optional().default([]),
  mistakes: z
    .array(z.object({ problem: z.string(), fix: z.string() }))
    .optional()
    .default([]),
  check: z.array(question).optional().default([]),
});
const trainingRole = z.object({
  id: z.string(),
  title: z.string(),
  who: z.string().optional().default(""),
  device: z.string().optional().default(""),
  goal: z.string().optional().default(""),
  permissions: z.string().optional().default(""),
  modules: z.array(trainingModule),
});
const manifestSchema = z.object({
  generatedAt: z.string().optional(),
  today: z.string().optional(),
  roles: z.array(trainingRole),
});

const glossarySchema = z.array(
  z
    .object({ term: z.string(), definition: z.string().optional(), def: z.string().optional() })
    .transform((g) => ({
      term: g.term,
      definition: g.definition ?? g.def ?? "",
    })),
);

export type TrainingRole = z.output<typeof trainingRole>;
export type TrainingModule = z.output<typeof trainingModule>;
export type TrainingStep = z.output<typeof step>;
export type Question = z.output<typeof question>;

export const TRAINING = manifestSchema.parse(manifestJson);
export const GLOSSARY = glossarySchema.parse(glossaryJson).sort((a, b) => a.term.localeCompare(b.term, "es"));

/** Rol del sistema → rol de capacitación (ids del manifest). */
export const ROLE_TO_TRAINING: Record<Role, string> = {
  admin: "direccion",
  production_manager: "produccion",
  operator: "operario",
  logistics: "logistica",
  store: "local",
  technical_lead: "tecnico",
  accountant: "contadora",
};

export const moduleKey = (roleId: string, moduleId: string) => `${roleId}/${moduleId}`;

export function findRole(roleId: string) {
  return TRAINING.roles.find((r) => r.id === roleId);
}
export function findModule(roleId: string, moduleId: string) {
  return findRole(roleId)?.modules.find((m) => m.id === moduleId);
}
/** URL pública de una captura (apps/web/public/capacitacion/...). */
export const screenshotUrl = (path: string) =>
  `/capacitacion/${path.replace(/^\/+/, "").replace(/^capacitacion\//, "")}`;

/** Captura representativa de cada etapa de la animación, buscada en el guion por palabras clave. */
const JOURNEY_KEYWORDS: Record<string, RegExp> = {
  pedido: /pedido[s]?[-/](nuevo|alta|carga)|nuevo-pedido|pedido/i,
  plan: /plan/i,
  produccion: /pesada|consumo|produccion/i,
  congelado: /congel|temperatura/i,
  envasado: /envasad|etiqueta|lote/i,
  despacho: /ruta|remito|despacho|chofer/i,
  cobro: /cobr|cuenta|cheque/i,
  tablero: /tablero/i,
};
export function journeyShots(): Record<string, string> {
  const all = TRAINING.roles.flatMap((r) =>
    r.modules.flatMap((m) => m.steps.map((s) => s.screenshot).filter((s): s is string => !!s)),
  );
  const out: Record<string, string> = {};
  for (const [station, re] of Object.entries(JOURNEY_KEYWORDS)) {
    const hit = all.find((p) => re.test(p));
    if (hit) out[station] = screenshotUrl(hit);
  }
  return out;
}
