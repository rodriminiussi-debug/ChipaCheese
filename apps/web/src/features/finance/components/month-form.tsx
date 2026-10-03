import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Selector de mes (GET `?mes=AAAA-MM`): funciona sin JavaScript y se puede compartir el link. */
export function MonthForm({
  action,
  month,
  label = "Mes",
}: {
  action: string;
  month: string;
  label?: string;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      <Input type="month" name="mes" aria-label={label} defaultValue={month} className="w-44" required />
      <Button type="submit" variant="outline">
        Ver
      </Button>
    </form>
  );
}
