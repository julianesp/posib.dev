"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Check, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChooseAccent } from "@/components/config/accent-config";
import { ACCENTS } from "@/lib/accent";
import { getSelectedTenantId, getUserProfile } from "@/lib/cloudflare-api";
import { cn } from "@/lib/utils";

// Anuncio único de la nueva interfaz "Mostrador" y del color por tienda.
const ANNOUNCEMENT_ID = "interfaz-mostrador-2026-10";
// Pasada esta fecha el anuncio ya no tiene sentido para nadie.
const ANNOUNCEMENT_ENDS = new Date("2026-12-31T23:59:59-05:00");

const seenKey = (tenant: string) => `posib:anuncio:${ANNOUNCEMENT_ID}:${tenant}`;

function wasSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function markSeen(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* sin almacenamiento: el anuncio puede volver a salir, no es grave */
  }
}

// Otro modal bloqueante abierto (p. ej. el informe mensual): esperar a que se cierre.
const otherModalOpen = () => !!document.querySelector("[data-blocking-modal]");

/**
 * Avisa a cada tendero (dueño con cuenta activa o en prueba) que posib estrenó
 * interfaz y que puede elegir el color de su tienda, ahí mismo o en Configuración.
 * No vuelve a salir si ya eligió color (en cualquier dispositivo, se guarda en su
 * perfil) o si lo cerró en este dispositivo.
 */
export function NewInterfaceAnnouncement() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { current, saving, choose } = useChooseAccent();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const key = seenKey(getSelectedTenantId() || "propia");

  useEffect(() => {
    if (Date.now() > ANNOUNCEMENT_ENDS.getTime() || wasSeen(key)) return;
    let cancelled = false;
    let observer: MutationObserver | null = null;

    const show = () => {
      if (cancelled) return;
      if (!otherModalOpen()) {
        setOpen(true);
        return;
      }
      observer = new MutationObserver(() => {
        if (!otherModalOpen()) {
          observer?.disconnect();
          if (!cancelled) setOpen(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    (async () => {
      try {
        // ¿Ya eligió su color (en este u otro dispositivo)? Entonces ya conoce la novedad.
        const profile = await getUserProfile(getToken);
        if (profile?.ui_accent) {
          markSeen(key);
          return;
        }
      } catch {
        // Si no se pudo leer el perfil, igual se muestra el anuncio.
      }
      // Pequeña pausa para no aparecer encima de la carga inicial del panel.
      setTimeout(show, 1200);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [getToken, key]);

  const close = () => {
    markSeen(key);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const pick = async (id: string) => {
    const ok = await choose(id);
    if (ok) setPicked(true);
  };

  const goToSettings = () => {
    close();
    router.push("/dashboard/config#color-sistema");
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center modal-backdrop p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="anuncio-interfaz-titulo"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Franja con los colores disponibles: invita a tocar uno. */}
        <div className="flex h-3" aria-hidden="true">
          {ACCENTS.map((a) => (
            <span key={a.id} className="flex-1" style={{ backgroundColor: a.light.brand }} />
          ))}
        </div>

        <div className="px-6 pb-6 pt-5 sm:px-7">
          <p className="text-xs font-medium text-brand">Novedad en posib</p>
          <h2 id="anuncio-interfaz-titulo" className="mt-1 pr-8 text-2xl font-semibold text-gray-900">
            posib estrena interfaz
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Rediseñamos el sistema para que trabajar en tu mostrador sea más claro y cómodo,
            de día y de noche. Y ahora puedes elegir el color de tu tienda: se aplica en todo
            el sistema y lo ve todo tu equipo.
          </p>

          <div className="mt-5 rounded-xl border border-dashed border-gray-300 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
              <Palette className="h-4 w-4 text-brand" />
              Toca un color para probarlo
            </p>
            <div role="radiogroup" aria-label="Color de tu tienda" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {ACCENTS.map((accent) => {
                const selected = accent.id === current;
                return (
                  <button
                    key={accent.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={accent.name}
                    title={accent.name}
                    disabled={saving !== null}
                    onClick={() => pick(accent.id)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-xl text-white transition-transform",
                      "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-900",
                      selected && "ring-2 ring-offset-2 ring-gray-900"
                    )}
                    style={{ backgroundColor: accent.light.brand }}
                  >
                    {selected && <Check className="h-5 w-5" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 h-4 text-xs text-gray-500">
              {saving ? "Guardando…" : picked ? `Listo: tu tienda ahora es ${ACCENTS.find((a) => a.id === current)?.name}.` : "Puedes cambiarlo cuando quieras en Configuración."}
            </p>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={close}>
              {picked ? "Cerrar" : "Ahora no"}
            </Button>
            {picked ? (
              <Button ref={primaryRef} onClick={close}>
                Listo
              </Button>
            ) : (
              <Button ref={primaryRef} onClick={goToSettings}>
                <Palette className="mr-2 h-4 w-4" />
                Elegir el color de mi tienda
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
