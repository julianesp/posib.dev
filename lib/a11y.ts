/**
 * Accesibilidad (ayudas visuales y de audio).
 *
 * Preferencias por dispositivo en localStorage (`posib-a11y`). Las visuales
 * se aplican como clases y tamaño de letra en <html> (ver globals.css,
 * sección "Accesibilidad") y el script A11Y_INIT_SCRIPT las aplica antes de
 * pintar para que no haya parpadeo. Las de audio las usan lib/a11y-audio.ts y
 * el POS. Menú: components/a11y/AccessibilityMenu.tsx.
 */

export const A11Y_KEY = "posib-a11y";
export const A11Y_EVENT = "posib-a11y-change";

/** Pasos de tamaño de letra (porcentaje del tamaño base). */
export const FONT_STEPS = [100, 112, 125, 140] as const;

export interface A11yPrefs {
  /** Índice en FONT_STEPS. */
  fontStep: number;
  contrast: boolean;
  underlineLinks: boolean;
  reduceMotion: boolean;
  /** Pitidos al escanear en el POS (bien / no encontrado). */
  posSounds: boolean;
  /** Decir en voz alta el total al terminar una venta. */
  speakTotal: boolean;
}

export const DEFAULT_A11Y: A11yPrefs = {
  fontStep: 0,
  contrast: false,
  underlineLinks: false,
  reduceMotion: false,
  posSounds: false,
  speakTotal: false,
};

export function getA11yPrefs(): A11yPrefs {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (!raw) return DEFAULT_A11Y;
    const parsed = JSON.parse(raw) as Partial<A11yPrefs>;
    const fontStep = Number(parsed.fontStep);
    return {
      ...DEFAULT_A11Y,
      ...parsed,
      fontStep: Number.isInteger(fontStep) && fontStep >= 0 && fontStep < FONT_STEPS.length ? fontStep : 0,
    };
  } catch {
    return DEFAULT_A11Y;
  }
}

export function applyA11yPrefs(prefs: A11yPrefs): void {
  const root = document.documentElement;
  root.classList.toggle("a11y-contrast", prefs.contrast);
  root.classList.toggle("a11y-underline", prefs.underlineLinks);
  root.classList.toggle("a11y-reduce-motion", prefs.reduceMotion);
  const pct = FONT_STEPS[prefs.fontStep] ?? 100;
  root.style.fontSize = pct === 100 ? "" : `${pct}%`;
}

export function setA11yPrefs(prefs: A11yPrefs): void {
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(prefs));
  } catch {
    // Sin almacenamiento: solo dura mientras la página esté abierta.
  }
  applyA11yPrefs(prefs);
  window.dispatchEvent(new Event(A11Y_EVENT));
}

/** Se ejecuta en <head> antes de pintar (ver app/layout.tsx). */
export const A11Y_INIT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  A11Y_KEY,
)})||"{}");var r=document.documentElement;if(p.contrast)r.classList.add("a11y-contrast");if(p.underlineLinks)r.classList.add("a11y-underline");if(p.reduceMotion)r.classList.add("a11y-reduce-motion");var s=${JSON.stringify(
  FONT_STEPS,
)}[p.fontStep|0];if(s&&s!==100)r.style.fontSize=s+"%";}catch(e){}})();`;
