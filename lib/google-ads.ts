// Helpers para el seguimiento de conversiones de Google Ads (gtag.js).
//
// La etiqueta base (AW-17995545981) se carga en app/layout.tsx. Aquí solo
// disparamos eventos de conversión concretos. El "label" de cada acción de
// conversión lo genera Google Ads y se pasa por variable de entorno para no
// hardcodearlo (y poder cambiarlo sin tocar código).

const GOOGLE_ADS_ID = 'AW-17995545981';

// Label de la acción de conversión "Registro" (creada en Google Ads por el
// método "etiqueta de Google Ads", fuente de datos posib.dev). Es el texto que
// va después de la barra en el send_to: AW-17995545981/<label>.
// Se puede sobrescribir por variable de entorno si en el futuro cambia.
const SIGNUP_LABEL =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL || 'IZxsCNmDue8cEP36-IRD';

type GtagFn = (
  command: string,
  action: string,
  params?: Record<string, unknown>,
) => void;

/**
 * Dispara la conversión de "registro completado" en Google Ads.
 * No hace nada si gtag aún no cargó o si el label no está configurado,
 * así que es seguro llamarla siempre.
 */
export function trackSignupConversion(userId?: string): void {
  if (typeof window === 'undefined') return;

  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (!gtag || !SIGNUP_LABEL) return;

  // Evita contar dos veces al mismo usuario (la dispara /sign-up y el
  // respaldo global de SignupConversionTracker).
  const key = `gads_signup_${userId || 'anon'}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // localStorage bloqueado: seguimos y dejamos que Google deduplique.
  }

  gtag('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${SIGNUP_LABEL}`,
    value: 1.0,
    currency: 'COP',
  });
}
