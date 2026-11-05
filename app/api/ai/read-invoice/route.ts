import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { readPurchaseInvoice } from '@/lib/ai-invoice-helpers';
import { hasAIAccess } from '@/lib/cloudflare-subscription-helpers';
import type { UserProfile } from '@/lib/types';

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || 'https://tienda-pos-api.julii1295.workers.dev';

// Límite defensivo del tamaño de imagen (base64). ~8MB de imagen.
const MAX_BASE64_LENGTH = 11_000_000;

/**
 * Lee una factura de compra (imagen) con IA y devuelve los productos detectados.
 * Requiere acceso a IA (trial o suscripción activa), igual que el resto de
 * funciones de IA. Usa la API key de Gemini del tendero (si la tiene).
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { imageBase64, mimeType } = await request.json();

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return NextResponse.json({ error: 'Falta la imagen de la factura' }, { status: 400 });
    }
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: 'La imagen es muy grande. Usa una foto más liviana.' },
        { status: 413 },
      );
    }

    // Obtener el perfil para (1) verificar acceso a IA y (2) tomar la API key.
    const token = await getToken();
    let profile: UserProfile | undefined;
    let userApiKey: string | undefined;
    try {
      const profileRes = await fetch(`${WORKER_URL}/api/user-profiles`, {
        // Sin X-Tenant-ID el Worker usa la tienda propia del usuario.
        headers: {
          Authorization: `Bearer ${token}`,
          ...(request.headers.get('X-Tenant-ID')
            ? { 'X-Tenant-ID': request.headers.get('X-Tenant-ID')! }
            : {}),
        },
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        profile = profileData.data || profileData;
        userApiKey = profile?.gemini_api_key;
      }
    } catch {
      /* si falla la carga del perfil, se maneja abajo */
    }

    if (!profile) {
      return NextResponse.json({ error: 'No se pudo cargar tu perfil.' }, { status: 400 });
    }
    if (!hasAIAccess(profile)) {
      return NextResponse.json(
        {
          error:
            'Esta función usa IA y requiere una suscripción activa. Actívala para subir compras por foto.',
        },
        { status: 403 },
      );
    }

    const result = await readPurchaseInvoice(
      imageBase64,
      mimeType || 'image/jpeg',
      userApiKey,
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error leyendo factura:', error);
    const message = error instanceof Error ? error.message : 'Error al leer la factura';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
