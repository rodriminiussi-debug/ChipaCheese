"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function Glossary({ items }: { items: { term: string; definition: string }[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = normalize(q.trim());
    return n ? items.filter((i) => normalize(`${i.term} ${i.definition}`).includes(n)) : items;
  }, [items, q]);
  return (
    <div className="grid gap-4">
      <Input
        id="glossary-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar un término (p. ej. lote, FEFO, cobertura)…"
        aria-label="Buscar en el glosario"
        className="max-w-md"
      />
      <dl className="grid gap-3 sm:grid-cols-2">
        {shown.map((i) => (
          <div key={i.term} className="rounded-xl border p-4">
            <dt className="font-semibold">{i.term}</dt>
            <dd className="text-muted-foreground mt-1 text-sm">{i.definition}</dd>
          </div>
        ))}
      </dl>
      {!shown.length ? <p className="text-muted-foreground">No hay términos que coincidan.</p> : null}
    </div>
  );
}
