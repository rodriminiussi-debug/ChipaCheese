"use client";

import { useState } from "react";
import { CheckCircle2, CircleX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import type { Question } from "../content";
import { submitQuizAction } from "../actions";
import type { QuizResult } from "../service";

/** Autoevaluación del módulo. La corrección la hace el servidor y queda en el avance del usuario. */
export function Quiz({
  roleId,
  moduleId,
  questions,
}: {
  roleId: string;
  moduleId: string;
  questions: Omit<Question, "answer" | "explain">[];
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [result, setResult] = useState<QuizResult | null>(null);
  const submit = useAction(submitQuizAction, {
    success: (r) =>
      r.passed ? "¡Módulo aprobado!" : `${r.score} de ${r.total} correctas. Revisá y probá de nuevo.`,
    onSuccess: setResult,
  });
  const complete = answers.every((a) => a != null);

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) submit.run({ roleId, moduleId, answers: answers as number[] });
      }}
      data-testid="quiz"
    >
      {questions.map((q, qi) => {
        const r = result?.results[qi];
        return (
          <fieldset key={qi} className="grid gap-2">
            <legend className="mb-1 font-medium">
              {qi + 1}. {q.q}
            </legend>
            {q.options.map((opt, oi) => {
              const id = `q${qi}-o${oi}`;
              const chosen = answers[qi] === oi;
              return (
                <label
                  key={oi}
                  htmlFor={id}
                  className={cn(
                    "hover:bg-muted flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
                    chosen && "border-primary bg-secondary/60",
                    r && oi === r.answer && "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
                    r && chosen && !r.correct && "border-destructive bg-red-50 dark:bg-red-950/40",
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name={`q${qi}`}
                    className="accent-primary mt-0.5 size-4"
                    checked={chosen}
                    disabled={!!result}
                    onChange={() => setAnswers((a) => a.map((v, k) => (k === qi ? oi : v)))}
                  />
                  {opt}
                </label>
              );
            })}
            {r ? (
              <p
                className={cn(
                  "flex items-start gap-2 text-sm",
                  r.correct ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
                )}
              >
                {r.correct ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0" />
                )}
                <span>
                  {r.correct ? "Correcto. " : "No es así. "}
                  {r.explain}
                </span>
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        {result ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResult(null);
              setAnswers(questions.map(() => null));
            }}
          >
            <RotateCcw /> Intentar de nuevo
          </Button>
        ) : (
          <Button type="submit" disabled={!complete || submit.pending}>
            Corregir
          </Button>
        )}
        {result ? (
          <span
            className={cn(
              "font-medium",
              result.passed ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {result.passed ? "Módulo aprobado" : `${result.score} de ${result.total} correctas`}
          </span>
        ) : null}
      </div>
    </form>
  );
}
