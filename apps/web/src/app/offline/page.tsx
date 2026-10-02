export const metadata = { title: "Sin conexión" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid gap-3">
        <h1 className="text-3xl font-semibold">Sin conexión</h1>
        <p className="text-muted-foreground text-lg">
          Los registros que cargues en planta se guardan en la tablet y se envían solos cuando vuelva la
          señal.
        </p>
      </div>
    </main>
  );
}
