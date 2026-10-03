"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/server/action";
import { copyAssignmentsInput, setSkillInput, toggleAssignmentInput } from "./schemas";
import { copyPreviousAssignments, setSkill, toggleAssignment } from "./service";

function revalidatePeople() {
  revalidatePath("/personas");
  revalidatePath("/planta/tareas");
}

export const toggleAssignmentAction = action(
  { permission: "people:write", schema: toggleAssignmentInput },
  async (input, { tx }) => {
    await toggleAssignment(tx, input);
    revalidatePeople();
    return { ok: true };
  },
);

export const copyAssignmentsAction = action(
  { permission: "people:write", schema: copyAssignmentsInput },
  async ({ date }, { tx }) => {
    const res = await copyPreviousAssignments(tx, date);
    revalidatePeople();
    return res;
  },
);

export const setSkillAction = action(
  { permission: "people:write", schema: setSkillInput },
  async (input, { tx }) => {
    await setSkill(tx, input);
    revalidatePeople();
    return { ok: true };
  },
);
