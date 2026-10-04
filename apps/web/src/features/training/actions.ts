"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { quizInput } from "./schemas";
import { submitQuiz } from "./service";

export const submitQuizAction = action(
  { permission: "training:read", schema: quizInput },
  async (input, { tx, user }) => {
    const result = await submitQuiz(tx, user.id, input);
    revalidatePath("/capacitacion");
    revalidatePath(`/capacitacion/${input.roleId}`);
    return result;
  },
);
