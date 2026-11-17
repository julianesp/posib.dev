"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Accessibility, Minus, Plus, RotateCcw, Square, Volume2 } from "lucide-react";
import {
  A11Y_EVENT,
  DEFAULT_A11Y,
  FONT_STEPS,
  getA11yPrefs,
  setA11yPrefs,
  type A11yPrefs,
} from "@/lib/a11y";
import { canSpeak, isSpeaking, posBeep, speak, stopSpeaking, textToRead } from "@/lib/a11y-audio";

interface Props {
  /** Clases del botón que abre el menú (cada barra tiene su estilo). */
  className?: string;
  /** Muestra las opciones del punto de venta (solo dentro del sistema). */
  showPosOptions?: boolean;
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-gray-50">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {hint && <span className="block text-xs text-gray-600">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand,#007c80)]"
      />
    </label>
  );
}

/**
 * Menú de accesibilidad: letra más grande, alto contraste, enlaces
 * subrayados, sin animaciones, leer en voz alta y, en el sistema, sonidos del
 * POS y decir el total de la venta. Se guarda por dispositivo (lib/a11y.ts).
 */
export function AccessibilityMenu({ className, showPosOptions = false }: Props) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULT_A11Y);
  const [reading, setReading] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Cargar al abrir (y si otro menú abierto en la página lo cambia).
  useEffect(() => {
    const sync = () => setPrefs(getA11yPrefs());
    window.addEventListener(A11Y_EVENT, sync);
    return () => window.removeEventListener(A11Y_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const update = (patch: Partial<A11yPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setA11yPrefs(next);
  };

  const toggleOpen = () => {
    if (!open) setPrefs(getA11yPrefs());
    setOpen((v) => !v);
  };

  const toggleRead = () => {
    if (reading || isSpeaking()) {
      stopSpeaking();
      setReading(false);
      return;
    }
    const text = textToRead();
    if (speak(text, () => setReading(false))) setReading(true);
  };

  const fontPct = FONT_STEPS[prefs.fontStep] ?? 100;

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Accesibilidad: tamaño de letra, contraste y lectura en voz alta"
        aria-expanded={open}
        aria-controls={panelId}
        title="Accesibilidad"
        className={className}
      >
        <Accessibility className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Opciones de accesibilidad"
          className="absolute right-0 top-full z-[80] mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-3 text-left shadow-xl"
        >
          <p className="mb-2 px-2 text-sm font-bold text-gray-900">Accesibilidad</p>

          {/* Tamaño de letra */}
          <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-2">
            <span className="text-sm font-medium text-gray-900">Tamaño de letra</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => update({ fontStep: Math.max(0, prefs.fontStep - 1) })}
                disabled={prefs.fontStep === 0}
                aria-label="Letra más pequeña"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-900 hover:bg-gray-100 disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="w-12 text-center text-sm tabular-nums text-gray-900" aria-live="polite">
                {fontPct}%
              </span>
              <button
                type="button"
                onClick={() => update({ fontStep: Math.min(FONT_STEPS.length - 1, prefs.fontStep + 1) })}
                disabled={prefs.fontStep === FONT_STEPS.length - 1}
                aria-label="Letra más grande"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-900 hover:bg-gray-100 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <Toggle label="Alto contraste" hint="Colores más marcados" checked={prefs.contrast} onChange={(v) => update({ contrast: v })} />
          <Toggle label="Subrayar enlaces" checked={prefs.underlineLinks} onChange={(v) => update({ underlineLinks: v })} />
          <Toggle label="Sin animaciones" hint="Quita movimientos y transiciones" checked={prefs.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />

          {showPosOptions && (
            <>
              <div className="my-2 border-t border-gray-100" />
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Punto de venta</p>
              <Toggle
                label="Sonidos al escanear"
                hint="Un pitido si el producto entra, dos si no se encuentra"
                checked={prefs.posSounds}
                onChange={(v) => {
                  update({ posSounds: v });
                  if (v) setTimeout(() => posBeep("ok"), 0);
                }}
              />
              <Toggle
                label="Decir el total en voz alta"
                hint="Al terminar cada venta"
                checked={prefs.speakTotal}
                onChange={(v) => update({ speakTotal: v })}
              />
            </>
          )}

          {canSpeak() && (
            <>
              <div className="my-2 border-t border-gray-100" />
              <button
                type="button"
                onClick={toggleRead}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand,#007c80)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                {reading ? <Square className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
                {reading ? "Detener lectura" : "Leer en voz alta"}
              </button>
              <p className="mt-1 px-2 text-xs text-gray-600">
                Lee lo que tengas seleccionado o, si no hay nada, la pantalla.
              </p>
            </>
          )}

          <button
            type="button"
            onClick={() => update(DEFAULT_A11Y)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restablecer
          </button>
        </div>
      )}
    </div>
  );
}
