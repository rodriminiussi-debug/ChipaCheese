import { z } from "zod";
import { ROLES } from "@/lib/rbac";
import { optText } from "@/lib/zod";

const pin = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^\d{4,6}$/.test(v), "El PIN debe tener 4 a 6 dígitos");

const password = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || v.length >= 8, "Mínimo 8 caracteres");

export const userInput = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre"),
  initials: z.string().trim().min(1, "Ingresá las iniciales").max(6),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,30}$/, "Solo minúsculas, números, punto o guion"),
  email: optText().refine((v) => v == null || z.string().email().safeParse(v).success, "Email inválido"),
  role: z.enum(ROLES),
  password,
  pin,
  active: z.boolean().default(true),
});
export type UserInput = z.input<typeof userInput>;
export type UserData = z.output<typeof userInput>;

export const updateUserInput = userInput.extend({ id: z.string().uuid() });

export const settingInput = z.object({
  key: z.string().min(1),
  value: z.string().transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Valor inválido (número, texto entre comillas o lista [1,2])",
      });
      return z.NEVER;
    }
  }),
});
