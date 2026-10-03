import { UserX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AbsenceGap } from "../service";

/**
 * RF-23: resumen de las tareas que quedaron sin nadie por las ausencias marcadas, con los reemplazos
 * habilitados (nivel “puede” o “experto” de la matriz de polivalencia).
 */
export function AbsenceGaps({
  gaps,
  people,
}: {
  gaps: AbsenceGap[];
  people: { id: string; initials: string; name: string }[];
}) {
  if (!gaps.length) return null;
  const initials = (id: string) => people.find((p) => p.id === id)?.initials ?? "?";
  return (
    <Alert data-testid="absence-gaps">
      <UserX />
      <AlertTitle>
        {gaps.length} tarea{gaps.length > 1 ? "s" : ""} sin cubrir por ausencias
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc pl-5">
          {gaps.map((g) => (
            <li key={g.task.id}>
              <span className="font-medium">{g.task.name}</span> ({g.absent.map(initials).join(", ")}{" "}
              ausente):{" "}
              {g.replacements.length
                ? `reemplazan ${g.replacements
                    .map((r) => `${initials(r.userId)} (${r.level === "expert" ? "experto" : "puede"})`)
                    .join(", ")}`
                : "nadie más habilitado"}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
