"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { settingInput, updateUserInput, userInput } from "./schemas";
import { createUser, updateSetting, updateUser } from "./service";

export const createUserAction = action({ permission: "admin", schema: userInput }, async (input, { tx }) => {
  const row = await createUser(tx, input);
  revalidatePath("/admin");
  return row;
});

export const updateUserAction = action(
  { permission: "admin", schema: updateUserInput },
  async ({ id, ...input }, { tx, user }) => {
    const row = await updateUser(tx, id, input, user.id);
    revalidatePath("/admin");
    return row;
  },
);

export const updateSettingAction = action(
  { permission: "admin", schema: settingInput },
  async ({ key, value }, { tx }) => {
    await updateSetting(tx, key, value);
    revalidatePath("/admin");
    return { key };
  },
);
