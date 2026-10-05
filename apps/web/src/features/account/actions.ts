"use server";

import { action } from "@/server/action";
import { currentSessionId } from "@/server/auth/session";
import { changePasswordInput, changePinInput } from "./schemas";
import { changePassword, changePin } from "./service";

/** Cualquier usuario con sesión puede cambiar SU contraseña (todos los roles tienen training:read; el id sale de la sesión, no del cliente). */
export const changePasswordAction = action(
  { permission: "training:read", schema: changePasswordInput },
  async (input, { tx, user }) => changePassword(tx, user.id, await currentSessionId(), input),
);

export const changePinAction = action(
  { permission: "training:read", schema: changePinInput },
  async (input, { tx, user }) => changePin(tx, user.id, input),
);
