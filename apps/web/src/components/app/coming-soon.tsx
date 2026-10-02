import { Construction } from "lucide-react";
import { PageHeader } from "./page-header";

/** Placeholder de pantallas aún no implementadas (se reemplaza en el sprint del módulo). */
export function ComingSoon({ title, module, rfs }: { title: string; module: string; rfs: string }) {
  return (
    <>
      <PageHeader title={title} description={`${module} · ${rfs}`} />
      <div className="text-muted-foreground flex items-center gap-3 rounded-lg border border-dashed p-8">
        <Construction className="size-6" /> En construcción.
      </div>
    </>
  );
}
