/**
 * Preferencia de los avisos de la guía de uso (components/guide/), guardada
 * POR DISPOSITIVO en localStorage. No se sincroniza entre equipos: cada
 * navegador tiene la suya, igual que el progreso de lib/guide/guide-progress.ts.
 *
 * - Por defecto están ACTIVOS (un tendero nuevo ve un aviso pequeño la primera
 *   vez que entra a cada sección).
 * - El tendero puede apagarlos desde el check "Ayudas gráficas" del panel de
 *   inicio o desde la guía de uso (botón de ayuda); entonces el aviso deja de
 *   salir solo, pero las guías siguen disponibles a mano.
 */

const AUTO_HELP_KEY = 'help_auto_enabled';

/**
 * ¿Están habilitadas las ayudas automáticas en este dispositivo?
 * Devuelve true si nunca se ha tocado la preferencia (activas por defecto).
 */
export function isAutoHelpEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(AUTO_HELP_KEY) !== 'false';
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();

/** Activa o desactiva las ayudas automáticas en este dispositivo. */
export function setAutoHelpEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTO_HELP_KEY, enabled ? 'true' : 'false');
  } catch {
    // Sin almacenamiento disponible: el cambio no se recuerda.
  }
  listeners.forEach((l) => l());
}

/**
 * Para useSyncExternalStore: avisa cuando cambia la preferencia, así el check
 * del panel y el interruptor de la guía de uso quedan siempre iguales (también
 * entre pestañas abiertas).
 */
export function subscribeAutoHelp(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === AUTO_HELP_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}
