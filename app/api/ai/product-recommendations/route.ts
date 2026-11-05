import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateProductRecommendations } from '@/lib/ai-insights-helpers';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://tienda-pos-api.julii1295.workers.dev';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { currentInventory, storeType, storeCity } = body;

    if (!currentInventory) {
      return NextResponse.json({ error: 'Inventario requerido' }, { status: 400 });
    }

    let userApiKey: string | undefined;
    try {
      const token = await getToken();
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
        userApiKey = profileData.data?.gemini_api_key || profileData.gemini_api_key;
      }
    } catch { /* continúa sin key del usuario */ }

    // Generar recomendaciones de productos con IA
    const recommendations = await generateProductRecommendations(
      currentInventory,
      storeType || 'Tienda general',
      storeCity,
      userApiKey
    );

    return NextResponse.json({
      success: true,
      recommendations,
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return NextResponse.json(
      { error: 'Error al generar recomendaciones' },
      { status: 500 }
    );
  }
}
