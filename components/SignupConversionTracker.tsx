'use client';

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { trackSignupConversion } from '@/lib/google-ads';

/**
 * Respaldo del seguimiento de conversiones de Google Ads.
 *
 * Clerk redirige a /dashboard apenas termina el registro, y a veces eso pasa
 * antes de que el efecto de /sign-up alcance a disparar la conversión. Este
 * componente vive en el layout raíz y la dispara en cualquier página si la
 * cuenta se creó hace menos de 10 minutos. trackSignupConversion deduplica por
 * usuario, así que nunca se cuenta dos veces.
 */
export default function SignupConversionTracker() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user?.createdAt) return;
    if (Date.now() - user.createdAt.getTime() > 10 * 60 * 1000) return;

    // gtag.js carga "afterInteractive": reintenta un momento si aún no está.
    let intentos = 0;
    const t = setInterval(() => {
      intentos += 1;
      const listo = typeof (window as unknown as { gtag?: unknown }).gtag === 'function';
      if (listo || intentos >= 10) {
        clearInterval(t);
        if (listo) trackSignupConversion(user.id);
      }
    }, 500);
    return () => clearInterval(t);
  }, [isLoaded, isSignedIn, user]);

  return null;
}
