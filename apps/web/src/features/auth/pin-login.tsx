"use client";

import { useActionState, useState } from "react";
import { Delete } from "lucide-react";
import { pinLoginAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/** Pantalla de tablet: botones grandes, usable con guantes. */
export function PinLogin({ people }: { people: { id: string; name: string; initials: string }[] }) {
  const [state, formAction, pending] = useActionState(pinLoginAction, null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const person = people.find((p) => p.id === userId);

  if (!person) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {people.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            className="h-28 flex-col gap-1 text-2xl"
            onClick={() => setUserId(p.id)}
          >
            <span className="font-bold">{p.initials}</span>
            <span className="text-muted-foreground text-sm">{p.name}</span>
          </Button>
        ))}
      </div>
    );
  }

  const press = (d: string) => setPin((v) => (v.length < 6 ? v + d : v));
  return (
    <form action={formAction} className="mx-auto grid max-w-sm gap-4">
      <input type="hidden" name="userId" value={person.id} />
      <input type="hidden" name="pin" value={pin} />
      <div className="text-center">
        <div className="text-3xl font-bold">{person.initials}</div>
        <button
          type="button"
          className="text-muted-foreground text-sm underline"
          onClick={() => {
            setUserId(null);
            setPin("");
          }}
        >
          No soy yo
        </button>
      </div>
      <div className="flex justify-center gap-3" aria-label="PIN ingresado">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={cn("size-4 rounded-full border-2", i < pin.length && "bg-foreground")} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button key={d} type="button" variant="outline" className="h-20 text-3xl" onClick={() => press(d)}>
            {d}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-20"
          aria-label="Borrar"
          onClick={() => setPin((v) => v.slice(0, -1))}
        >
          <Delete className="size-8" />
        </Button>
        <Button type="button" variant="outline" className="h-20 text-3xl" onClick={() => press("0")}>
          0
        </Button>
        <Button type="submit" className="h-20 text-xl" disabled={pin.length < 4 || pending}>
          Entrar
        </Button>
      </div>
      {state?.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
