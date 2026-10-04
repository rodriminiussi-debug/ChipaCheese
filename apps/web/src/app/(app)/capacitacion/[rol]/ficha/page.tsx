import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand";
import { requirePermission } from "@/server/auth/session";
import { findRole, screenshotUrl } from "@/features/training/content";
import { RichText } from "@/features/training/components/rich-text";
import { PrintButton, PrintStyles } from "@/features/production/components/print";

/** Ficha del rol para imprimir y plastificar (A4): pasos de cada módulo con su captura. */
export default async function TrainingSheetPage(props: PageProps<"/capacitacion/[rol]/ficha">) {
  await requirePermission("training:read");
  const { rol } = await props.params;
  const role = findRole(rol);
  if (!role) notFound();
  return (
    <div className="mx-auto grid max-w-4xl gap-6 print:max-w-none print:gap-3">
      <PrintStyles pageSize="A4" margin="10mm" />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-muted-foreground text-sm">
          Vista para imprimir y plastificar. Una sección por módulo.
        </p>
        <PrintButton label="Imprimir ficha" />
      </div>
      <header className="flex items-center justify-between gap-4 border-b-4 border-[var(--color-brand-red)] pb-3">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">Ficha de capacitación</p>
          <h1 className="text-2xl font-bold">{role.title}</h1>
          <p className="text-muted-foreground text-sm">
            {[role.who, role.device].filter(Boolean).join(" · ")}
          </p>
        </div>
        <BrandLogo className="w-36" />
      </header>
      {role.modules.map((m, i) => (
        <section key={m.id} className="grid break-inside-avoid-page gap-3 print:break-inside-avoid">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="grid size-7 place-items-center rounded-full bg-[var(--color-brand-yellow)] text-sm text-[var(--color-brand-ink)]">
              {i + 1}
            </span>
            {m.title}
          </h2>
          <ol className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
            {m.steps.map((s, n) => (
              <li
                key={n}
                className="grid break-inside-avoid content-start gap-1.5 rounded-lg border p-2 text-sm"
              >
                {s.screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={screenshotUrl(s.screenshot)}
                    alt=""
                    className="w-full rounded border"
                    loading="eager"
                  />
                ) : null}
                <p>
                  <span className="mr-1 font-mono font-semibold">{n + 1}.</span>
                  <RichText text={s.text} />
                </p>
              </li>
            ))}
          </ol>
          {m.mistakes.length ? (
            <p className="bg-muted rounded-md p-2 text-xs">
              <strong>Si algo sale mal: </strong>
              {m.mistakes.map((x, k) => (
                <span key={k}>
                  <RichText text={x.problem} /> → <RichText text={x.fix} />
                  {k < m.mistakes.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
