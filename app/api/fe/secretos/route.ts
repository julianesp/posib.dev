/**
 * Facturación electrónica: recibe la firma digital (.p12 de Maticerts) y/o el
 * PIN del software DIAN de una tienda, los valida, los CIFRA con FE_MASTER_KEY
 * y los guarda en el Worker (ruta interna /api/fe-internal/secretos).
 *
 * Por qué pasa por Next y no va directo al Worker:
 *  - abrir un .p12 consume mucha CPU (el plan gratis de Workers da 10 ms);
 *  - la clave maestra vive solo aquí: D1 guarda el texto cifrado y nadie que
 *    tenga acceso a la base puede usar las firmas de las tiendas.
 *
 * La clave del .p12 se usa solo para abrirlo y no se guarda: se guarda la llave
 * privada ya extraída y cifrada.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { leerP12 } from '@/lib/fe-dian/certificado';
import { cifrar } from '@/lib/fe-dian/boveda';

export const runtime = 'nodejs';

const API_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL || 'https://tienda-pos-api.julii1295.workers.dev';
const MAX_P12_BYTES = 50_000; // un .p12 real pesa 3–10 KB

function aBase64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

function error(mensaje: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error: mensaje, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const claveMaestra = process.env.FE_MASTER_KEY;
    if (!claveMaestra || !process.env.CRON_SECRET) {
      console.error('[fe/secretos] Falta FE_MASTER_KEY o CRON_SECRET en el servidor');
      return error('La facturación electrónica no está configurada en el servidor', 500);
    }

    const { getToken, userId } = await auth();
    if (!userId) return error('No autorizado', 401);
    const token = await getToken();
    if (!token) return error('No se pudo obtener el token', 401);

    // Confirmar con el Worker que este usuario es el dueño de la tienda activa
    // (GET /api/fe-config responde 403 a quien no lo es). No se confía en el body.
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const tenantHeader = request.headers.get('X-Tenant-ID');
    if (tenantHeader) headers['X-Tenant-ID'] = tenantHeader;
    const cfgRes = await fetch(`${API_URL}/api/fe-config`, { headers });
    if (!cfgRes.ok) {
      return error(cfgRes.status === 403 ? 'Solo el dueño puede cargar la firma digital' : 'No se pudo verificar la tienda', cfgRes.status === 403 ? 403 : 502);
    }
    const cfg = (await cfgRes.json()).data as { tenant_id: string; nit: string | null };
    const tenantId = cfg.tenant_id;

    const body = (await request.json().catch(() => null)) as { p12Base64?: string; p12Clave?: string; pin?: string } | null;
    if (!body || (!body.p12Base64 && !body.pin)) return error('Envía la firma digital (.p12) o el PIN');

    const salida: Record<string, unknown> = { tenant_id: tenantId };
    const avisos: string[] = [];

    if (body.pin !== undefined) {
      const pin = String(body.pin).trim();
      if (!/^\d{4,10}$/.test(pin)) return error('El PIN del software debe ser solo números (el que elegiste en el portal de la DIAN)');
      salida.pin_cifrado = await cifrar(pin, claveMaestra, tenantId);
    }

    if (body.p12Base64) {
      const p12 = new Uint8Array(Buffer.from(body.p12Base64, 'base64'));
      if (p12.length === 0 || p12.length > MAX_P12_BYTES) return error('El archivo no parece una firma digital .p12');

      let leido: ReturnType<typeof leerP12>;
      try {
        leido = leerP12(p12, body.p12Clave ?? '');
      } catch {
        return error('No se pudo abrir la firma digital. Revisa que el archivo sea el .p12 y que la clave (PIN de Maticerts) sea correcta.');
      }
      const { credenciales, info } = leido;
      if (info.problemas.length) return error('Esta firma digital no sirve para la DIAN', 400, { problemas: info.problemas });

      // Regla DIAN ZE03: el dueño del certificado debe ser el mismo facturador.
      // El NIT/cédula suele venir en el sujeto del certificado; si no aparece, solo se avisa.
      if (cfg.nit && !info.sujeto.replace(/\D+/g, ' ').split(' ').some((n) => n.startsWith(cfg.nit!))) {
        avisos.push(
          `No encontramos el NIT ${cfg.nit} dentro de la firma (titular: ${info.titular}). La DIAN rechaza facturas firmadas con la firma de otra persona: verifica que la firma sea a nombre de la tienda.`,
        );
      }

      salida.certificado = {
        llave_cifrada: await cifrar(credenciales.llavePrivadaPkcs8, claveMaestra, tenantId),
        cadena: JSON.stringify(
          credenciales.certificados.map((c) => ({ der: aBase64(c.der), emisor: c.emisor, serialDecimal: c.serialDecimal, titular: c.titular })),
        ),
        titular: info.titular,
        emisor: info.emisor,
        valido_desde: info.validoDesde.toISOString(),
        vence: info.validoHasta.toISOString(),
        proveedor: 'maticerts',
      };
    }

    const guardado = await fetch(`${API_URL}/api/fe-internal/secretos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': process.env.CRON_SECRET },
      body: JSON.stringify(salida),
    });
    const json = await guardado.json().catch(() => null);
    if (!guardado.ok || !json?.success) {
      console.error('[fe/secretos] El Worker no guardó:', guardado.status, json?.error);
      return error(json?.error || 'No se pudo guardar', 502);
    }
    return NextResponse.json({ success: true, data: json.data, avisos });
  } catch (e) {
    console.error('[fe/secretos] Error:', e);
    return error('Error al guardar la firma digital', 500);
  }
}
