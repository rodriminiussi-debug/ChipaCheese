import { z } from "zod";

export const changePasswordInput = z
  .object({
    current: z.string().min(1, "Ingresá tu contraseña actual"),
    password: z.string().min(8, "Mínimo 8 caracteres"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "No coincide con la nueva contraseña",
  })
  .refine((v) => v.password !== v.current, {
    path: ["password"],
    message: "Tiene que ser distinta de la actual",
  });
export type ChangePasswordInput = z.input<typeof changePasswordInput>;

export const changePinInput = z
  .object({
    /** Contraseña o PIN actual. */
    current: z.string().min(1, "Ingresá tu contraseña o PIN actual"),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,6}$/, "El PIN debe tener 4 a 6 dígitos"),
    confirm: z.string().trim(),
  })
  .refine((v) => v.pin === v.confirm, { path: ["confirm"], message: "No coincide con el PIN nuevo" });
export type ChangePinInput = z.input<typeof changePinInput>;
