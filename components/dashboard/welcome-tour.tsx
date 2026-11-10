"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Camera,
  CloudUpload,
  FileSpreadsheet,
  Gift,
  Palette,
  Presentation,
  Sparkles,
  Users,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SCENES, type Scene } from "@/components/landing/process-showcase/scenes";
import { Phone } from "@/components/landing/process-showcase/ui";
import { usePrefersReducedMotion } from "@/components/landing/process-showcase/use-prefers-reduced-motion";
import {
  OPEN_WELCOME_TOUR_EVENT,
  WELCOME_TOUR_META_KEY,
  isWelcomeTourEnabled,
  markShownThisSession,
  wasShownThisSession,
  writeLocalWelcomeTour,
} from "@/lib/welcome-tour";
import { cn } from "@/lib/utils";

// Mismo ritmo que las demos del home y de la guía de uso.
const STEP_MS = 2800;
const HOLD_MS = 3600;
// Espera antes de salir sola: deja cargar el panel y que salgan primero los
// avisos de la prueba gratis o del informe mensual (luego espera a que se cierren).
const AUTO_OPEN_DELAY_MS = 4000;

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;

/** Guarda la preferencia en el usuario de Clerk (vale en todos sus dispositivos). */
async function saveWelcomeTourPref(user: ClerkUser, enabled: boolean): Promise<boolean> {
  writeLocalWelcomeTour(user.id, enabled);
  try {
    await user.update({
      unsafeMetadata: { ...user.unsafeMetadata, [WELCOME_TOUR_META_KEY]: enabled },
    });
    return true;
  } catch (err) {
    console.warn("[WelcomeTour] No se pudo guardar la preferencia en Clerk:", err);
    return false;
  }
}

/** Otro modal abierto (prueba gratis, informe mensual, anuncio, SweetAlert…). */
const otherModalOpen = () =>
  !!document.querySelector(
    '[data-blocking-modal]:not([data-welcome-tour]), [role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]:not([data-welcome-tour]), .swal2-container'
  );

/* ───────────── Beneficios extra (última diapositiva) ───────────── */

const EXTRAS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: WifiOff, title: "Sigue vendiendo sin internet", text: "Las ventas se guardan y se suben solas cuando vuelve la señal." },
  { icon: Camera, title: "Compras con foto de la factura", text: "Le tomas foto a la factura del proveedor y el inventario se llena solo." },
  { icon: BarChart3, title: "Informes y rentabilidad", text: "Qué se vende más, cuánto ganas y tu informe del mes en PDF." },
  { icon: Users, title: "Tu equipo, con permisos", text: "Agrega cajeros y decide qué puede ver o hacer cada uno." },
  { icon: Gift, title: "Puntos para clientes fieles", text: "Premia a quien vuelve y conoce a tus mejores clientes." },
  { icon: CloudUpload, title: "Copia en Google Drive", text: "Un respaldo diario de tus ventas en tu propia cuenta." },
  { icon: FileSpreadsheet, title: "Trae tu catálogo", text: "Importa productos y ventas desde Siigo, Excel u otro sistema." },
  { icon: Palette, title: "El color de tu tienda", text: "Elige el color del sistema; lo ve todo tu equipo." },
];

/* ───────────── Celular animado ───────────── */

function ScenePhone({ scene, step }: { scene: Scene; step: number }) {
  return (
    // keep-light: es una pantalla de celular, no se oscurece con el tema.
    <div className="keep-light relative mx-auto h-[324px] w-[162px] shrink-0 md:h-[432px] md:w-[216px]">
      <div className="absolute left-0 top-0 w-[270px] origin-top-left scale-[0.6] md:scale-[0.8]">
        <Phone>
          <scene.Screen step={step} />
        </Phone>
      </div>
    </div>
  );
}

function SceneSlide({ scene }: { scene: Scene }) {
  const reduced = usePrefersReducedMotion();
  const last = scene.steps.length - 1;
  const [step, setStep] = useState(0);
  // Con movimiento reducido se muestra el resultado final, quieto.
  const shown = reduced ? last : step;

  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(
      () => setStep((n) => (n < last ? n + 1 : 0)),
      step === last ? HOLD_MS : STEP_MS
    );
    return () => window.clearTimeout(id);
  }, [reduced, step, last]);

  const Icon = scene.icon;

  return (
    <div className="grid items-center gap-5 md:grid-cols-[auto_1fr] md:gap-8">
      <div className="order-2 md:order-1">
        <ScenePhone scene={scene} step={shown} />
      </div>

      <div className="order-1 min-w-0 md:order-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light text-brand">
            <Icon className="h-5 w-5" />
          </span>
          {scene.badge && (
            <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
              {scene.badge}
            </span>
          )}
        </div>
        <h3 className="mt-3 text-xl font-semibold text-gray-900 sm:text-2xl">{scene.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600 sm:text-base">{scene.blurb}</p>

        {/* Los pasos siguen al celular; en el celular (pantalla chica) se ocultan para que quepa. */}
        <ol className="mt-4 hidden space-y-1.5 md:block">
          {scene.steps.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "flex w-full gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                  i === shown ? "bg-brand-light" : "hover:bg-gray-100"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    i === shown ? "bg-brand text-white" : "bg-gray-200 text-gray-600"
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{s.title}</span>
                  {i === shown && <span className="block text-xs text-gray-600">{s.text}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function IntroSlide({ name, onJump }: { name?: string | null; onJump: (i: number) => void }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
        <Sparkles className="h-4 w-4" /> Bienvenido a posib
      </p>
      <h3 className="mt-2 text-2xl font-semibold text-gray-900 sm:text-3xl">
        {name ? `${name}, tu tienda ya tiene sistema` : "Tu tienda ya tiene sistema"}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 sm:text-base">
        En un par de minutos te mostramos todo lo que posib hace por tu negocio: vender más
        rápido, llevar los fiados, cuadrar la caja y saber qué se acaba antes de que se acabe.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {SCENES.map((scene, i) => {
          const Icon = scene.icon;
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onJump(i + 1)}
              className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand-light/60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium leading-tight text-gray-900">{scene.tab}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onJump(SCENES.length + 1)}
          className="flex items-center gap-2.5 rounded-xl border border-dashed border-gray-300 p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand-light/60"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium leading-tight text-gray-900">Y mucho más</span>
        </button>
      </div>
    </div>
  );
}

function ExtrasSlide() {
  return (
    <div>
      <h3 className="text-xl font-semibold text-gray-900 sm:text-2xl">Y además…</h3>
      <p className="mt-1.5 text-sm text-gray-600 sm:text-base">
        Todo incluido en tu plan, listo para cuando lo necesites.
      </p>
      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        {EXTRAS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900">{title}</span>
              <span className="block text-xs leading-relaxed text-gray-600">{text}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Presentación ───────────── */

/**
 * Presentación de bienvenida con los beneficios de posib. Sale sola a los
 * usuarios nuevos (una vez por sesión) hasta que tocan "No mostrar"; se vuelve
 * a activar o se abre a mano desde Configuración (WelcomeTourConfig).
 */
export function WelcomeTour() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const total = SCENES.length + 2; // bienvenida + procesos + "y además"
  const isLast = index === total - 1;

  // Salir sola a los usuarios con la presentación activa.
  useEffect(() => {
    if (!isLoaded || !user) return;
    if (!isWelcomeTourEnabled(user) || wasShownThisSession(user.id)) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;

    const show = () => {
      if (cancelled) return;
      markShownThisSession(user.id);
      setIndex(0);
      setOpen(true);
    };

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!otherModalOpen()) return show();
      observer = new MutationObserver(() => {
        if (!otherModalOpen()) {
          observer?.disconnect();
          // Pequeña pausa para no encimarse con la animación de cierre del otro modal.
          window.setTimeout(show, 400);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    }, AUTO_OPEN_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [isLoaded, user]);

  // Abrirla a mano (Configuración → "Verla ahora").
  useEffect(() => {
    const onOpen = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_WELCOME_TOUR_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WELCOME_TOUR_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, total - 1)), [total]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, next, prev]);

  if (!open || !user) return null;

  const dontShow = async () => {
    setOpen(false);
    await saveWelcomeTourPref(user, false);
    toast.success("Listo, la presentación no volverá a salir.", {
      description: "Puedes activarla otra vez en Configuración.",
    });
  };

  const finish = () => {
    setOpen(false);
    router.push("/dashboard/pos");
  };

  const scene = index >= 1 && index <= SCENES.length ? SCENES[index - 1] : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center modal-backdrop p-3 sm:p-4"
      onClick={close}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bienvenida-titulo"
        data-blocking-modal
        data-welcome-tour
        className="relative flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Barra de progreso */}
        <div className="h-1 bg-gray-100" aria-hidden="true">
          <div
            className="h-full bg-brand transition-[width] duration-300"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-7">
          <p id="bienvenida-titulo" className="text-xs font-medium text-gray-500">
            Lo que puedes hacer con posib · {index + 1} de {total}
          </p>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7 md:min-h-[460px]">
          {index === 0 && <IntroSlide name={user.firstName} onJump={setIndex} />}
          {scene && <SceneSlide key={scene.id} scene={scene} />}
          {isLast && <ExtrasSlide />}
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex items-center justify-center gap-1.5 sm:order-2" role="tablist" aria-label="Diapositivas">
            {Array.from({ length: total }, (_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Ir a la diapositiva ${i + 1}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === index ? "w-6 bg-brand" : "w-2 bg-gray-300 hover:bg-gray-400"
                )}
              />
            ))}
          </div>

          <Button variant="ghost" size="sm" onClick={dontShow} className="text-gray-600 sm:order-1">
            No mostrar
          </Button>

          <div className="flex gap-2 sm:order-3">
            <Button variant="outline" onClick={prev} disabled={index === 0} className="flex-1 sm:flex-none">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Anterior
            </Button>
            {isLast ? (
              <Button onClick={finish} className="flex-1 sm:flex-none">
                Empezar a vender <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={next} className="flex-1 sm:flex-none">
                Siguiente <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Configuración ───────────── */

/** Tarjeta de Configuración: activar/desactivar la presentación y verla cuando quiera. */
export function WelcomeTourConfig() {
  const { user, isLoaded } = useUser();
  // Lo que el usuario acaba de elegir aquí; si no ha tocado nada, lo guardado.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const enabled = chosen ?? (isLoaded && user ? isWelcomeTourEnabled(user) : null);

  const toggle = async (value: boolean) => {
    if (!user) return;
    setChosen(value);
    setSaving(true);
    const ok = await saveWelcomeTourPref(user, value);
    setSaving(false);
    if (ok) {
      toast.success(value ? "La presentación saldrá al entrar al sistema." : "La presentación ya no saldrá al entrar.");
    } else {
      toast.warning("Se guardó solo en este dispositivo. Revisa tu conexión e inténtalo de nuevo.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Presentation className="h-5 w-5 text-brand" />
          Presentación de bienvenida
        </CardTitle>
        <CardDescription>
          Diapositivas con todo lo que puedes hacer en posib: ventas, fiados, caja, inventario y más.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-700">
          <Switch
            checked={enabled ?? false}
            disabled={enabled === null || saving}
            onCheckedChange={toggle}
          />
          Mostrarla al entrar al sistema
        </label>
        <Button
          variant="outline"
          onClick={() => window.dispatchEvent(new Event(OPEN_WELCOME_TOUR_EVENT))}
        >
          <Presentation className="mr-2 h-4 w-4" />
          Verla ahora
        </Button>
      </CardContent>
    </Card>
  );
}
