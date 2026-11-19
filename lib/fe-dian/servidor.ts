/**
 * Utilidades de SERVIDOR (rutas de Next) para facturación electrónica: hablar
 * con el Worker, verificar al dueño y reconstruir la firma digital descifrada.
 * No importar desde componentes de cliente: usa FE_MASTER_KEY y CRON_SECRET.
 */
import { descifrar, descifrarTexto } from './boveda';
import type { CredencialesFirma } from './certificado';
import type { RespuestaDian } from './soap';
import type { ConfigSoftware, Tercero, Tributo } from './xml';

export const API_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL || 'https://tienda-pos-api.julii1295.workers.dev';

export class ErrorFe extends Error {
  constructor(
    message: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Fila completa de fe_config (con los secretos cifrados), tal como la guarda D1. */
export type FilaFe = Record<string, string | number | null>;

/**
 * Confirma con el Worker que el usuario es el dueño de la tienda activa y que
 * tiene la facturación activada (GET /api/fe-config responde 403 si no).
 */
export async function configPublicaDelDueno(token: string, tenantHeader: string | null) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (tenantHeader) headers['X-Tenant-ID'] = tenantHeader;
  const res = await fetch(`${API_URL}/api/fe-config`, { headers });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    if (res.status === 403) throw new ErrorFe(json?.error || 'Solo el dueño puede hacer esto', 403);
    throw new ErrorFe('No se pudo verificar la tienda', 502);
  }
  return (await res.json()).data as { tenant_id: string; status: string; nit: string | null; faltantes: string[] };
}

function cabecerasInternas(): Record<string, string> {
  if (!process.env.CRON_SECRET) throw new ErrorFe('La facturación electrónica no está configurada en el servidor', 500);
  return { 'Content-Type': 'application/json', 'X-Cron-Secret': process.env.CRON_SECRET };
}

export async function filaCompleta(tenantId: string): Promise<FilaFe> {
  const res = await fetch(`${API_URL}/api/fe-internal/config/${encodeURIComponent(tenantId)}`, { headers: cabecerasInternas() });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new ErrorFe(json?.error || 'No se pudo leer la configuración', res.status === 403 ? 403 : 502);
  return json.data as FilaFe;
}

export async function guardarInterno(ruta: 'secretos' | 'pruebas', cuerpo: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/api/fe-internal/${ruta}`, {
    method: 'PUT',
    headers: cabecerasInternas(),
    body: JSON.stringify(cuerpo),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new ErrorFe(json?.error || 'No se pudo guardar', 502);
  return json.data;
}

function claveMaestra(): string {
  const k = process.env.FE_MASTER_KEY;
  if (!k) throw new ErrorFe('La facturación electrónica no está configurada en el servidor', 500);
  return k;
}

const texto = (f: FilaFe, k: string) => (f[k] == null ? '' : String(f[k]));

/** Descifra la llave y arma la cadena de certificados guardada. */
export async function credencialesDeFila(f: FilaFe): Promise<CredencialesFirma> {
  const tenantId = texto(f, 'tenant_id');
  if (!f.cert_llave_cifrada || !f.cert_cadena) throw new ErrorFe('La tienda no tiene firma digital cargada');
  const llave = await descifrar(texto(f, 'cert_llave_cifrada'), claveMaestra(), tenantId);
  const cadena = JSON.parse(texto(f, 'cert_cadena')) as Array<{ der: string; emisor: string; serialDecimal: string; titular: string }>;
  return {
    llavePrivadaPkcs8: llave,
    certificados: cadena.map((c) => ({
      der: new Uint8Array(Buffer.from(c.der, 'base64')),
      emisor: c.emisor,
      serialDecimal: c.serialDecimal,
      titular: c.titular,
    })),
  };
}

export async function softwareDeFila(f: FilaFe, ambiente: 1 | 2): Promise<ConfigSoftware> {
  if (!f.software_id || !f.software_pin_cifrado) throw new ErrorFe('Falta el Software ID o el PIN de la DIAN');
  const pin = await descifrarTexto(texto(f, 'software_pin_cifrado'), claveMaestra(), texto(f, 'tenant_id'));
  return { softwareId: texto(f, 'software_id'), pin, ambiente };
}

const TRIBUTOS: Record<string, Tributo> = {
  '01': { id: '01', nombre: 'IVA' },
  '04': { id: '04', nombre: 'INC' },
  ZA: { id: 'ZA', nombre: 'IVA e INC' },
  ZZ: { id: 'ZZ', nombre: 'No aplica' },
};

/** El facturador (la tienda) como Tercero del XML, siempre identificado por NIT (31). */
export function emisorDeFila(f: FilaFe): Tercero {
  return {
    tipoPersona: texto(f, 'tipo_persona') === '1' ? '1' : '2',
    tipoId: '31',
    identificacion: texto(f, 'nit'),
    dv: texto(f, 'dv'),
    razonSocial: texto(f, 'razon_social'),
    nombreComercial: texto(f, 'nombre_comercial') || undefined,
    responsabilidades: texto(f, 'responsabilidades') || 'R-99-PN',
    tributo: TRIBUTOS[texto(f, 'tributo')] ?? TRIBUTOS.ZZ,
    direccion: {
      municipioCodigo: texto(f, 'municipio_codigo'),
      municipio: texto(f, 'municipio'),
      departamento: texto(f, 'departamento'),
      departamentoCodigo: texto(f, 'departamento_codigo'),
      linea: texto(f, 'direccion'),
    },
    telefono: texto(f, 'telefono') || undefined,
    correo: texto(f, 'correo') || undefined,
  };
}

export type EstadoPrueba = 'enviado' | 'aceptado' | 'rechazado' | 'error';

/** Traduce la respuesta de GetStatusZip al estado del documento. */
export function estadoDeRespuesta(r: RespuestaDian | undefined): { estado: EstadoPrueba; errores: string[] } {
  if (!r) return { estado: 'enviado', errores: [] };
  if (r.valido) return { estado: 'aceptado', errores: r.errores }; // pueden venir notificaciones (no bloquean)
  const descripcion = [r.descripcion, r.mensaje].filter(Boolean).join(' — ');
  // Mientras la DIAN valida, responde "Batch en proceso de validación" sin errores.
  if (r.errores.length === 0 && /proceso/i.test(descripcion)) return { estado: 'enviado', errores: [] };
  return { estado: 'rechazado', errores: r.errores.length ? r.errores : [descripcion || 'Rechazado por la DIAN'] };
}

