/**
 * Facturación electrónica DIAN — configuración por tienda (tabla fe_config, migración 035).
 *
 *   GET  /api/fe-config            (dueño) datos fiscales + estado, SIN secretos
 *   PUT  /api/fe-config            (dueño) guarda datos fiscales y del software DIAN
 *   PUT  /api/fe-internal/secretos (interno, X-Cron-Secret) guarda certificado y PIN ya cifrados
 *
 * Los secretos (llave del certificado y PIN) los cifra Next con FE_MASTER_KEY
 * (lib/fe-dian/boveda.ts) y llegan por la ruta interna: el Worker nunca los ve
 * en claro ni los devuelve al navegador.
 */
import { Hono } from 'hono';
import type { AppEnv, APIResponse } from '../types';

export interface FeConfigPublica {
  tenant_id: string;
  status: 'borrador' | 'listo_pruebas' | 'habilitado' | 'produccion';
  tipo_persona: '1' | '2' | null;
  nit: string | null;
  dv: string | null;
  razon_social: string | null;
  nombre_comercial: string | null;
  responsabilidades: string | null;
  tributo: '01' | '04' | 'ZA' | 'ZZ' | null;
  municipio_codigo: string | null;
  municipio: string | null;
  departamento: string | null;
  departamento_codigo: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  software_id: string | null;
  test_set_id: string | null;
  tiene_pin: boolean;
  certificado: null | {
    proveedor: string | null;
    titular: string | null;
    emisor: string | null;
    valido_desde: string | null;
    vence: string | null;
    cargado_at: string | null;
  };
  /** Qué falta para poder correr el set de pruebas. */
  faltantes: string[];
}

const CAMPOS_TEXTO = [
  'tipo_persona', 'nit', 'dv', 'razon_social', 'nombre_comercial', 'responsabilidades', 'tributo',
  'municipio_codigo', 'municipio', 'departamento', 'departamento_codigo', 'direccion', 'telefono',
  'correo', 'software_id', 'test_set_id',
] as const;
type CampoTexto = (typeof CAMPOS_TEXTO)[number];
export type FeConfigEntrada = Partial<Record<CampoTexto, string | null>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESPONSABILIDAD = /^(O-\d{1,2}|R-99-PN|A-\d{1,2})$/;

/** Dígito de verificación del NIT (algoritmo DIAN, módulo 11). */
export function calcularDv(nit: string): string {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digitos = nit.split('').reverse();
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) suma += Number(digitos[i]) * pesos[i];
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

/** Valida y normaliza lo que manda el formulario. Función pura (se prueba aparte). */
export function validarFeConfig(body: unknown): { ok: true; value: FeConfigEntrada } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Datos inválidos' };
  const entrada = body as Record<string, unknown>;
  const v: FeConfigEntrada = {};
  for (const campo of CAMPOS_TEXTO) {
    if (!(campo in entrada)) continue;
    const bruto = entrada[campo];
    if (bruto === null || bruto === undefined || String(bruto).trim() === '') {
      v[campo] = null;
      continue;
    }
    const s = String(bruto).trim();
    if (s.length > 300) return { ok: false, error: `El campo ${campo} es demasiado largo` };
    v[campo] = s;
  }

  if (v.nit) {
    v.nit = v.nit.replace(/[.\s-]/g, '');
    if (!/^\d{5,15}$/.test(v.nit)) return { ok: false, error: 'El NIT debe tener solo números (sin dígito de verificación)' };
  }
  if (v.dv && !/^\d$/.test(v.dv)) return { ok: false, error: 'El dígito de verificación es un solo número' };
  if (v.nit && v.dv && calcularDv(v.nit) !== v.dv) {
    return { ok: false, error: `El dígito de verificación no corresponde al NIT (debería ser ${calcularDv(v.nit)})` };
  }
  if (v.tipo_persona && !['1', '2'].includes(v.tipo_persona)) return { ok: false, error: 'Tipo de persona inválido' };
  if (v.tributo && !['01', '04', 'ZA', 'ZZ'].includes(v.tributo)) return { ok: false, error: 'Tributo inválido' };
  if (v.responsabilidades) {
    v.responsabilidades = v.responsabilidades.toUpperCase().replace(/\s+/g, '').replace(/;+$/, '');
    if (!v.responsabilidades.split(';').every((r) => RESPONSABILIDAD.test(r))) {
      return { ok: false, error: 'Responsabilidades inválidas: usa los códigos del RUT, p. ej. O-13;O-15 o R-99-PN' };
    }
  }
  if (v.municipio_codigo && !/^\d{5}$/.test(v.municipio_codigo)) return { ok: false, error: 'El código DANE del municipio tiene 5 dígitos' };
  if (v.departamento_codigo && !/^\d{2}$/.test(v.departamento_codigo)) return { ok: false, error: 'El código DANE del departamento tiene 2 dígitos' };
  if (v.municipio_codigo && v.departamento_codigo && !v.municipio_codigo.startsWith(v.departamento_codigo)) {
    return { ok: false, error: 'El municipio no pertenece a ese departamento (los 2 primeros dígitos deben coincidir)' };
  }
  if (v.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.correo)) return { ok: false, error: 'Correo inválido' };
  if (v.software_id && !UUID.test(v.software_id)) return { ok: false, error: 'El Software ID de la DIAN tiene formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' };
  if (v.test_set_id && !UUID.test(v.test_set_id)) return { ok: false, error: 'El Test Set ID de la DIAN tiene formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' };
  return { ok: true, value: v };
}

type Fila = Record<string, string | number | null>;

const REQUISITOS: Array<[string, (f: Fila) => boolean]> = [
  ['Tipo de persona', (f) => !!f.tipo_persona],
  ['NIT y dígito de verificación', (f) => !!f.nit && !!f.dv],
  ['Razón social (como en el RUT)', (f) => !!f.razon_social],
  ['Responsabilidades del RUT', (f) => !!f.responsabilidades],
  ['Responsable de IVA o no', (f) => !!f.tributo],
  ['Municipio y departamento (DANE)', (f) => !!f.municipio_codigo && !!f.municipio && !!f.departamento && !!f.departamento_codigo],
  ['Dirección', (f) => !!f.direccion],
  ['Correo de facturación', (f) => !!f.correo],
  ['Software ID de la DIAN', (f) => !!f.software_id],
  ['PIN del software', (f) => !!f.software_pin_cifrado],
  ['Test Set ID de la DIAN', (f) => !!f.test_set_id],
  ['Firma digital (.p12)', (f) => !!f.cert_llave_cifrada],
];

function faltantes(f: Fila | null): string[] {
  return REQUISITOS.filter(([, ok]) => !f || !ok(f)).map(([nombre]) => nombre);
}

/** Recalcula el estado. Nunca baja de 'habilitado'/'produccion' (eso lo decide la DIAN). */
function nuevoEstado(f: Fila): FeConfigPublica['status'] {
  if (f.status === 'habilitado' || f.status === 'produccion') return f.status;
  return faltantes(f).length === 0 ? 'listo_pruebas' : 'borrador';
}

function aPublica(tenantId: string, f: Fila | null): FeConfigPublica {
  const s = (k: string) => (f && f[k] != null ? String(f[k]) : null);
  return {
    tenant_id: tenantId,
    status: (s('status') as FeConfigPublica['status']) ?? 'borrador',
    tipo_persona: s('tipo_persona') as FeConfigPublica['tipo_persona'],
    nit: s('nit'),
    dv: s('dv'),
    razon_social: s('razon_social'),
    nombre_comercial: s('nombre_comercial'),
    responsabilidades: s('responsabilidades'),
    tributo: s('tributo') as FeConfigPublica['tributo'],
    municipio_codigo: s('municipio_codigo'),
    municipio: s('municipio'),
    departamento: s('departamento'),
    departamento_codigo: s('departamento_codigo'),
    direccion: s('direccion'),
    telefono: s('telefono'),
    correo: s('correo'),
    software_id: s('software_id'),
    test_set_id: s('test_set_id'),
    tiene_pin: !!s('software_pin_cifrado'),
    certificado: s('cert_llave_cifrada')
      ? {
          proveedor: s('cert_proveedor'),
          titular: s('cert_titular'),
          emisor: s('cert_emisor'),
          valido_desde: s('cert_valido_desde'),
          vence: s('cert_vence'),
          cargado_at: s('cert_cargado_at'),
        }
      : null,
    faltantes: faltantes(f),
  };
}

async function esDueno(db: D1Database, tenantId: string, clerkUserId: string): Promise<boolean> {
  const owner = await db
    // SELECT *: clerk_user_id_test (cuenta de prueba en dev) no está en el esquema base.
    .prepare('SELECT * FROM user_profiles WHERE id = ?')
    .bind(tenantId)
    .first<{ clerk_user_id: string; clerk_user_id_test?: string | null }>();
  return !!owner && (owner.clerk_user_id === clerkUserId || owner.clerk_user_id_test === clerkUserId);
}

async function leer(db: D1Database, tenantId: string): Promise<Fila | null> {
  return db.prepare('SELECT * FROM fe_config WHERE tenant_id = ?').bind(tenantId).first<Fila>();
}

/** Inserta o actualiza columnas y recalcula el estado. */
async function guardar(db: D1Database, tenantId: string, cambios: Record<string, string | null>): Promise<Fila> {
  const ahora = new Date().toISOString();
  const actual = (await leer(db, tenantId)) ?? { tenant_id: tenantId, status: 'borrador', created_at: ahora };
  const fusion: Fila = { ...actual, ...cambios, updated_at: ahora };
  fusion.status = nuevoEstado(fusion);

  const columnas = Object.keys(fusion).filter((k) => fusion[k] !== undefined);
  const sql =
    `INSERT INTO fe_config (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')}) ` +
    `ON CONFLICT(tenant_id) DO UPDATE SET ${columnas.filter((k) => k !== 'tenant_id' && k !== 'created_at').map((k) => `${k} = excluded.${k}`).join(', ')}`;
  await db.prepare(sql).bind(...columnas.map((k) => fusion[k] ?? null)).run();
  return fusion;
}

/* ─────────────────────────────── Rutas del dueño ─────────────────────────────── */

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const tenant = c.get('tenant');
  try {
    if (!(await esDueno(c.env.DB, tenant.id, c.get('clerkUserId')))) {
      return c.json<APIResponse<null>>({ success: false, error: 'Solo el dueño puede ver la facturación electrónica', data: null }, 403);
    }
    return c.json<APIResponse<FeConfigPublica>>({ success: true, data: aPublica(tenant.id, await leer(c.env.DB, tenant.id)) });
  } catch (error) {
    console.error('[fe-config] Error leyendo la configuración:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo leer la configuración', data: null }, 500);
  }
});

app.put('/', async (c) => {
  const tenant = c.get('tenant');
  try {
    if (!(await esDueno(c.env.DB, tenant.id, c.get('clerkUserId')))) {
      return c.json<APIResponse<null>>({ success: false, error: 'Solo el dueño puede cambiar la facturación electrónica', data: null }, 403);
    }
    const parsed = validarFeConfig(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json<APIResponse<null>>({ success: false, error: parsed.error, data: null }, 400);
    const fila = await guardar(c.env.DB, tenant.id, parsed.value as Record<string, string | null>);
    return c.json<APIResponse<FeConfigPublica>>({ success: true, data: aPublica(tenant.id, fila) });
  } catch (error) {
    console.error('[fe-config] Error guardando la configuración:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo guardar', data: null }, 500);
  }
});

export default app;

/* ──────────────────────── Ruta interna (solo Next, con secreto) ──────────────────────── */

export const feInternal = new Hono<AppEnv>();

feInternal.use('/*', async (c, next) => {
  // Sin CRON_SECRET configurado la ruta queda cerrada (a diferencia de backup):
  // aquí se escriben las firmas digitales de las tiendas.
  if (!c.env.CRON_SECRET || c.req.header('X-Cron-Secret') !== c.env.CRON_SECRET) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  await next();
});

interface SecretosEntrada {
  tenant_id?: string;
  pin_cifrado?: string;
  certificado?: {
    llave_cifrada: string;
    cadena: string;
    titular: string;
    emisor: string;
    valido_desde: string;
    vence: string;
    proveedor?: string;
  };
}

feInternal.put('/secretos', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SecretosEntrada | null;
  const tenantId = body?.tenant_id;
  if (!tenantId) return c.json({ success: false, error: 'Falta tenant_id' }, 400);
  if (!body?.pin_cifrado && !body?.certificado) return c.json({ success: false, error: 'Nada que guardar' }, 400);
  const esCifrado = (s: unknown) => typeof s === 'string' && s.startsWith('v1:');

  const existe = await c.env.DB.prepare('SELECT id FROM user_profiles WHERE id = ?').bind(tenantId).first();
  if (!existe) return c.json({ success: false, error: 'Tienda no encontrada' }, 404);

  const cambios: Record<string, string | null> = {};
  if (body.pin_cifrado) {
    if (!esCifrado(body.pin_cifrado)) return c.json({ success: false, error: 'El PIN debe llegar cifrado' }, 400);
    cambios.software_pin_cifrado = body.pin_cifrado;
  }
  if (body.certificado) {
    const k = body.certificado;
    if (!esCifrado(k.llave_cifrada)) return c.json({ success: false, error: 'La llave debe llegar cifrada' }, 400);
    Object.assign(cambios, {
      cert_llave_cifrada: k.llave_cifrada,
      cert_cadena: k.cadena,
      cert_titular: k.titular,
      cert_emisor: k.emisor,
      cert_valido_desde: k.valido_desde,
      cert_vence: k.vence,
      cert_proveedor: k.proveedor ?? 'maticerts',
      cert_cargado_at: new Date().toISOString(),
    });
  }
  try {
    const fila = await guardar(c.env.DB, tenantId, cambios);
    return c.json<APIResponse<FeConfigPublica>>({ success: true, data: aPublica(tenantId, fila) });
  } catch (error) {
    console.error('[fe-internal] Error guardando secretos:', error);
    return c.json({ success: false, error: 'No se pudo guardar' }, 500);
  }
});
