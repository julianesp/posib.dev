'use client';

import { useEffect, useRef } from 'react';
import { SignUp, useUser } from '@clerk/nextjs';
import { trackSignupConversion } from '@/lib/google-ads';

export default function SignUpPage() {
  const { isSignedIn, user, isLoaded } = useUser();
  const firedRef = useRef(false);

  // Cuando Clerk confirma que el usuario acaba de registrarse en esta página,
  // reportamos la conversión a Google Ads una sola vez. Filtramos por cuentas
  // creadas hace muy poco para no contar inicios de sesión de usuarios ya
  // existentes que pasen por aquí.
  useEffect(() => {
    if (firedRef.current) return;
    if (!isLoaded || !isSignedIn || !user) return;

    const createdAt = user.createdAt ? user.createdAt.getTime() : 0;
    const recienCreado = createdAt > 0 && Date.now() - createdAt < 5 * 60 * 1000;
    if (!recienCreado) return;

    firedRef.current = true;
    trackSignupConversion(user.id);
  }, [isLoaded, isSignedIn, user]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
      <SignUp
        appearance={{
          elements: {
            formButtonPrimary:
              'bg-brand hover:bg-brand-hover text-sm normal-case',
          },
        }}
      />
    </div>
  );
}
