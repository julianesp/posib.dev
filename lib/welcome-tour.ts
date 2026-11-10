/**
 * Presentación de bienvenida (components/dashboard/welcome-tour.tsx): las
 * diapositivas con los beneficios de posib que ve un usuario nuevo al entrar.
 *
 * La preferencia es POR USUARIO y se guarda en el `unsafeMetadata` de Clerk
 * (lo puede escribir el propio usuario desde el navegador, sin pasar por el
 * Worker), así que vale en cualquier dispositivo donde inicie sesión. Además se
 * copia en localStorage para que el cambio se note al instante y sobreviva si
 * Clerk no responde.
 *
 * - Sin preferencia guardada: se muestra solo a las cuentas creadas desde el
 *   lanzamiento (WELCOME_TOUR_SINCE); las cuentas viejas no la ven de golpe.
 * - "No mostrar" (en la presentación) guarda `false`.
 * - El interruptor de Configuración guarda `true` / `false`.
 * - Mientras esté activa sale una vez por sesión del navegador.
 */

export const WELCOME_TOUR_META_KEY = "posibWelcomeTour";

/** Cuentas creadas desde esta fecha cuentan como "nuevas". */
export const WELCOME_TOUR_SINCE = new Date("2026-11-10T00:00:00-05:00");

/** Evento para abrir la presentación a mano (botón "Verla ahora" de Configuración). */
export const OPEN_WELCOME_TOUR_EVENT = "posib:abrir-bienvenida";

const localKey = (userId: string) => `posib:bienvenida:${userId}`;
const sessionKey = (userId: string) => `posib:bienvenida-vista:${userId}`;

/** Lo mínimo del usuario de Clerk que necesitamos (facilita las pruebas). */
export interface WelcomeTourUser {
  id: string;
  createdAt?: Date | null;
  unsafeMetadata?: Record<string, unknown>;
}

function readLocal(userId: string): boolean | undefined {
  try {
    const v = localStorage.getItem(localKey(userId));
    return v === "1" ? true : v === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalWelcomeTour(userId: string, enabled: boolean) {
  try {
    localStorage.setItem(localKey(userId), enabled ? "1" : "0");
  } catch {
    /* sin almacenamiento: queda solo lo de Clerk */
  }
}

/** ¿La presentación está activa para este usuario? */
export function isWelcomeTourEnabled(user: WelcomeTourUser): boolean {
  const saved = user.unsafeMetadata?.[WELCOME_TOUR_META_KEY];
  if (typeof saved === "boolean") return saved;
  const local = readLocal(user.id);
  if (local !== undefined) return local;
  const created = user.createdAt ? new Date(user.createdAt).getTime() : 0;
  return created >= WELCOME_TOUR_SINCE.getTime();
}

export function wasShownThisSession(userId: string): boolean {
  try {
    return sessionStorage.getItem(sessionKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markShownThisSession(userId: string) {
  try {
    sessionStorage.setItem(sessionKey(userId), "1");
  } catch {
    /* sin almacenamiento: puede volver a salir al recargar */
  }
}
