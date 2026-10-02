import Link from "next/link";

export default function NoPermission() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid gap-3">
        <h1 className="text-2xl font-semibold">Sin permiso</h1>
        <p className="text-muted-foreground">Tu rol no tiene acceso a esta pantalla.</p>
        <Link href="/" className="underline">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
