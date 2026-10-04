import { z } from "zod";

export const quizInput = z.object({
  roleId: z.string().min(1),
  moduleId: z.string().min(1),
  answers: z.array(z.number().int().min(0)),
});
