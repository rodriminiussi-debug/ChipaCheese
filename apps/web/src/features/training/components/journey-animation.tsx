"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Package,
  Pause,
  Play,
  Scale,
  Snowflake,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/brand";
import { cn } from "@/lib/utils";

/**
 * "El recorrido de una bolsa": cómo circula la información entre los módulos (relevamiento:
 * "Un pedido entra por M1, se produce en M4 consumiendo el stock de M3, sale por M5 con su lote
 * y se cobra en M6; BPM registra y traza cada lote, y el tablero lee todos los módulos").
 * Los datos son un ejemplo coherente con los datos de presentación.
 */
export interface Station {
  id: string;
  title: string;
  module: string;
  who: string;
  icon: LucideIcon;
  cold?: boolean;
  text: string;
  /** Línea que la etapa agrega a la etiqueta del recorrido. */
  label: string;
}

export const STATIONS: Station[] = [
  {
    id: "pedido",
    title: "Pedido",
    module: "M1 Pedidos",
    who: "Jefa de producción · celular",
    icon: ClipboardList,
    text: "La Reina pide 850 bolsas por WhatsApp. Se carga en menos de un minuto y el sistema calcula para cuándo se puede entregar según stock y capacidad.",
    label: "Pedido #312 · La Reina · 850 bolsas (425 kg) · posible mar 06/10",
  },
  {
    id: "plan",
    title: "Plan del día",
    module: "M4 Producción",
    who: "Jefa de producción",
    icon: CalendarDays,
    text: "El plan propone qué producir con los pedidos, el stock y el techo de 150 kg por día del abatidor. Mínimo 75 kg por tanda.",
    label: "Plan vie 02/10 · 150 kg · tapitas 75 · lengüitas 75",
  },
  {
    id: "produccion",
    title: "Producción",
    module: "M4 + M3 Stock",
    who: "Operarios · tablet",
    icon: Scale,
    text: "Se consumen 75 kg de fécula y el resto de la receta, lote por lote, primero el que vence antes. Si la leche sale del rango, la tablet avisa. Después se pesa cada forma.",
    label: "Fécula FEC-2609 · Queso TYBO-0925 · Pesado 149,3 kg · Rinde 1,99",
  },
  {
    id: "congelado",
    title: "Congelado",
    module: "M4 Producción",
    who: "Operarios",
    icon: Snowflake,
    cold: true,
    text: "Las bandejas pasan la noche en el abatidor F1 y F2. Las temperaturas se registran en la tablet; si salen de rango, pide la acción correctiva.",
    label: "Abatidor F1/F2 · −24 °C",
  },
  {
    id: "envasado",
    title: "Envasado y lote",
    module: "M4 Producción",
    who: "Operarios · tablet",
    icon: Package,
    cold: true,
    text: "Al embolsar nace el lote con su vencimiento a 6 meses. La etiqueta lleva un QR que abre la trazabilidad. Las bolsas entran al stock de F3 o F4.",
    label: "Lote 261002-1 · vence 02/04/2027 · 298 bolsas → F3",
  },
  {
    id: "despacho",
    title: "Reparto",
    module: "M5 Despacho",
    who: "Logística · celular",
    icon: Truck,
    cold: true,
    text: "La hoja de ruta agrupa por zona. El remito asigna el lote que vence primero y el cliente firma en el celular. Se registran km, horas y la temperatura del equipo de frío.",
    label: "Remito R-0234 · lote 261002-1 · km 1.204 → 1.262 · −20 °C",
  },
  {
    id: "cobro",
    title: "Factura y cobro",
    module: "M6 Cobranzas",
    who: "Dirección · Logística",
    icon: Wallet,
    text: "La factura vence según el plazo del cliente. El chofer cobra en ruta y los cheques quedan en cartera con su fecha de cobro.",
    label: "Factura A 0002-00001301 · cheque Macro a 30 días",
  },
  {
    id: "tablero",
    title: "Tablero",
    module: "M8 Tablero",
    who: "Dirección",
    icon: LayoutDashboard,
    text: "Todo lo anterior alimenta el costo por bolsa, el margen por canal y el resultado del mes: si cubre o no los retiros de los socios.",
    label: "Costo por bolsa $ 3.194 · margen 24 % · resultado del mes",
  },
];

const STEP_MS = 5200;

export function JourneyAnimation({ shots = {} }: { shots?: Record<string, string> }) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Arranca solo, salvo que la persona prefiera menos movimiento.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setPlaying(true), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setCurrent((c) => (c + 1) % STATIONS.length), STEP_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const go = (i: number) => {
    setPlaying(false);
    setCurrent((i + STATIONS.length) % STATIONS.length);
  };
  const station = STATIONS[current]!;
  const shot = shots[station.id];
  const pct = (i: number) => ((i + 0.5) / STATIONS.length) * 100;

  return (
    <section aria-label="El recorrido de una bolsa de chipá" className="grid gap-5" data-testid="journey">
      {/* Pista: una estación por etapa; la franja azul es la cadena de frío. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="relative min-w-[640px] pt-14">
          <div
            aria-hidden
            className="absolute top-14 h-[76px] rounded-xl bg-sky-100/80 dark:bg-sky-950/50"
            style={{ left: `${(3 / STATIONS.length) * 100}%`, width: `${(3 / STATIONS.length) * 100}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[11px] font-semibold whitespace-nowrap text-sky-700 dark:text-sky-300">
              cadena de frío · −18 °C
            </span>
          </div>
          <div aria-hidden className="bg-border absolute top-[94px] right-[6%] left-[6%] h-1 rounded-full" />
          <div
            aria-hidden
            className="bg-brand-red absolute top-[94px] left-[6%] h-1 rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.max(0, pct(current) - 6)}%` }}
          />
          {/* La mascota recorre la pista. */}
          <div
            aria-hidden
            className="absolute top-0 -translate-x-1/2 transition-[left] duration-700 ease-out motion-reduce:transition-none"
            style={{ left: `${pct(current)}%` }}
          >
            <BrandMark className="size-14 animate-[chipa-bob_1.6s_ease-in-out_infinite] drop-shadow-sm motion-reduce:animate-none" />
          </div>
          <ol className="relative grid grid-cols-8">
            {STATIONS.map((s, i) => {
              const Icon = s.icon;
              const state = i < current ? "done" : i === current ? "current" : "next";
              return (
                <li key={s.id} className="flex flex-col items-center gap-2 px-1 text-center">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={state === "current" ? "step" : undefined}
                    aria-label={`${i + 1}. ${s.title}`}
                    className={cn(
                      "focus-visible:ring-ring grid size-14 place-items-center rounded-full border-2 transition-all outline-none focus-visible:ring-2",
                      state === "current" && "border-brand-red bg-brand-red scale-110 text-white shadow-md",
                      state === "done" && "border-brand-red bg-background text-brand-red",
                      state === "next" && "border-border bg-background text-muted-foreground",
                    )}
                  >
                    <Icon className="size-6" />
                  </button>
                  <span
                    className={cn(
                      "text-xs leading-tight font-medium",
                      state === "current" ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="grid content-start gap-3" aria-live="polite">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide uppercase">
            <span className="tabular-nums">
              Etapa {current + 1} de {STATIONS.length}
            </span>
            <span aria-hidden>·</span>
            <span>{station.module}</span>
            {station.cold ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 font-mono text-sky-800 normal-case dark:bg-sky-950 dark:text-sky-200">
                −18 °C
              </span>
            ) : null}
          </div>
          <h3 className="text-2xl font-semibold text-balance">{station.title}</h3>
          <p className="text-muted-foreground text-sm">{station.who}</p>
          <p className="max-w-prose leading-relaxed">{station.text}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="icon" onClick={() => go(current - 1)} aria-label="Etapa anterior">
              <ChevronLeft />
            </Button>
            <Button onClick={() => setPlaying((p) => !p)} className="min-w-32">
              {playing ? <Pause /> : <Play />}
              {playing ? "Pausar" : "Reproducir"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => go(current + 1)}
              aria-label="Etapa siguiente"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          {/* Etiqueta del recorrido: se completa como la etiqueta de un lote, renglón por renglón. */}
          <figure
            className="bg-card rounded-xl border-2 border-dashed p-4 font-mono text-[13px] leading-relaxed"
            aria-label="Etiqueta del recorrido"
          >
            <figcaption className="mb-2 flex items-center justify-between font-sans text-xs font-semibold tracking-wide uppercase">
              <span>Etiqueta del recorrido</span>
              <span className="text-muted-foreground font-normal normal-case">ejemplo</span>
            </figcaption>
            <ol className="grid gap-1">
              {STATIONS.map((s, i) => (
                <li
                  key={s.id}
                  className={cn(
                    "rounded px-1.5 transition-colors duration-500",
                    i > current && "opacity-25",
                    i === current && "bg-brand-yellow/40 text-foreground",
                  )}
                >
                  <span className="text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, "0")}{" "}
                  </span>
                  {s.label}
                </li>
              ))}
            </ol>
          </figure>
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={shot}
              src={shot}
              alt={`Pantalla del sistema: ${station.title}`}
              className="animate-in fade-in w-full rounded-lg border shadow-sm duration-500"
              loading="lazy"
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
