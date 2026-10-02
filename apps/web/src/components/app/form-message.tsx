import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionResult } from "@/lib/action-result";

/** Muestra el error general de un ActionResult. */
export function FormMessage({ state }: { state: ActionResult<unknown> | null | undefined }) {
  if (!state || state.ok) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}

export function fieldError(
  state: ActionResult<unknown> | null | undefined,
  field: string,
): string | undefined {
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[field]?.[0];
}
