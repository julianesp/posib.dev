/**
 * Enlace para abrir la app de Nequi desde la tienda online (checkout).
 *
 * Nequi no publica un enlace para abrir "Enviar plata" con número y monto ya
 * puestos, así que se abre la app y el cliente pega el número (el botón lo copia
 * antes de abrirla):
 *  - Android: intent de Chrome al paquete com.nequi.MobileApp; si no la tiene
 *    instalada, Chrome lleva a Play Store (browser_fallback_url).
 *  - iPhone: no hay esquema público; se abre su página en App Store, que muestra
 *    "Abrir" si ya está instalada.
 *  - Computador: null (se paga con el celular escaneando el QR).
 */

export const NEQUI_ANDROID_PACKAGE = 'com.nequi.MobileApp';
export const NEQUI_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${NEQUI_ANDROID_PACKAGE}`;
export const NEQUI_APP_STORE_URL = 'https://apps.apple.com/co/app/nequi-colombia/id1075378688';

export type NequiPlatform = 'android' | 'ios' | 'desktop';

export function detectNequiPlatform(userAgent: string, maxTouchPoints = 0): NequiPlatform {
  if (/android/i.test(userAgent)) return 'android';
  // iPadOS se presenta como Mac: se reconoce por la pantalla táctil.
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

export function nequiAppLink(platform: NequiPlatform): string | null {
  if (platform === 'android') {
    return (
      `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;` +
      `package=${NEQUI_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(NEQUI_PLAY_STORE_URL)};end`
    );
  }
  if (platform === 'ios') return NEQUI_APP_STORE_URL;
  return null;
}
