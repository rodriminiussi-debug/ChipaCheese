import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MIN_HOLDERS, type CriticalAlert } from "../skills";

/** Alerta de dependencia crítica (RF-23): tareas críticas con menos de 2 personas que puedan hacerlas. */
export function CriticalAlerts({
  alerts,
  people,
}: {
  alerts: CriticalAlert[];
  people: { id: string; initials: string }[];
}) {
  if (!alerts.length) return null;
  return (
    <Alert variant="destructive" data-testid="critical-alerts">
      <AlertTriangle />
      <AlertTitle>
        Dependencia crítica: {alerts.length} tarea{alerts.length > 1 ? "s" : ""} sin reemplazo
      </AlertTitle>
      <AlertDescription>
        <p>
          Cada tarea crítica necesita al menos {MIN_HOLDERS} personas con nivel “puede” o “experto”. Si falta
          la única persona capacitada, se frena la planta.
        </p>
        <ul className="mt-2 list-disc pl-5">
          {alerts.map((a) => {
            const names = a.holders.map((h) => people.find((p) => p.id === h)?.initials ?? "?");
            return (
              <li key={a.task.id}>
                <span className="font-medium">{a.task.name}</span>:{" "}
                {names.length ? `solo ${names.join(", ")}` : "nadie capacitado"}
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
