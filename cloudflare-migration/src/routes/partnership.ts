/**
 * Negocio de varios socios (migración 032).
 *
 * GET /api/partnership  -> { enabled, partners: [{ name, share }] }
 * PUT /api/partnership  -> { enabled: boolean, partners: [{ name, share }] }
 *
 * Con esto Rentabilidad muestra cuánto de la ganancia le corresponde a cada
 * socio. Lo ve el dueño o quien tenga permiso view_reports (la ganancia es
 * sensible); solo el dueño lo cambia.
 */

import { Hono } from 'hono';
import type { AppEnv, APIResponse } from '../types';

export interface Partner {
  name: string;
  share: number;
}

export interface Partnership {
  enabled: boolean;
  partners: Partner[];
}

export const MAX_PARTNERS = 10;

/**
 * Valida lo que manda el front. Activado exige al menos 2 socios con nombre y
 * porcentajes que sumen 100 (se admiten decimales: 33,33 + 33,33 + 33,34).
 * Desactivado conserva la lista tal cual, para no perderla al apagar.
 */
export function validatePartnership(body: unknown): { ok: true; value: Partnership } | { ok: false; error: string } {
  const b = (body ?? {}) as { enabled?: unknown; partners?: unknown };
  if (typeof b.enabled !== 'boolean') return { ok: false, error: 'enabled debe ser true o false' };
  if (!Array.isArray(b.partners)) return { ok: false, error: 'partners debe ser una lista' };
  if (b.partners.length > MAX_PARTNERS) return { ok: false, error: `Máximo ${MAX_PARTNERS} socios` };

  const partners: Partner[] = [];
  for (const raw of b.partners) {
    const p = (raw ?? {}) as { name?: unknown; share?: unknown };
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '';
    const share = typeof p.share === 'number' ? Math.round(p.share * 100) / 100 : NaN;
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      return { ok: false, error: 'Cada porcentaje debe estar entre 0 y 100' };
    }
    if (b.enabled && !name) return { ok: false, error: 'Escribe el nombre de cada socio' };
    partners.push({ name, share });
  }

  if (b.enabled) {
    if (partners.length < 2) return { ok: false, error: 'Agrega al menos 2 socios' };
    const total = Math.round(partners.reduce((sum, p) => sum + p.share, 0) * 100) / 100;
    if (total !== 100) return { ok: false, error: `Los porcentajes deben sumar 100 % (ahora suman ${total} %)` };
  }

  return { ok: true, value: { enabled: b.enabled, partners } };
}

function parsePartners(raw: string | null | undefined): Partner[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

type Access = 'owner' | 'reports' | null;

async function access(db: D1Database, tenantId: string, clerkUserId: string): Promise<Access> {
  const owner = await db
    // SELECT *: clerk_user_id_test (cuenta de prueba en dev) existe en producción pero no en el esquema base.
    .prepare('SELECT * FROM user_profiles WHERE id = ?')
    .bind(tenantId)
    .first<{ clerk_user_id: string; clerk_user_id_test?: string | null }>();
  if (owner && (owner.clerk_user_id === clerkUserId || owner.clerk_user_id_test === clerkUserId)) return 'owner';

  const member = await db
    .prepare(
      `SELECT permissions FROM team_members
       WHERE owner_id = ? AND clerk_user_id = ? AND status = 'active' AND invitation_status = 'accepted'`
    )
    .bind(tenantId, clerkUserId)
    .first<{ permissions: string }>();
  if (!member) return null;
  try {
    return (JSON.parse(member.permissions || '[]') as string[]).includes('view_reports') ? 'reports' : null;
  } catch {
    return null;
  }
}

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const tenant = c.get('tenant');
  try {
    if (!(await access(c.env.DB, tenant.id, c.get('clerkUserId')))) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso', data: null }, 403);
    }
    const row = await c.env.DB.prepare('SELECT partnership_enabled, partners FROM user_profiles WHERE id = ?')
      .bind(tenant.id)
      .first<{ partnership_enabled: number | null; partners: string | null }>();
    return c.json<APIResponse<Partnership>>({
      success: true,
      data: { enabled: row?.partnership_enabled === 1, partners: parsePartners(row?.partners) },
    });
  } catch (error) {
    console.error('[partnership] Error leyendo los socios:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudieron leer los socios', data: null }, 500);
  }
});

app.put('/', async (c) => {
  const tenant = c.get('tenant');
  try {
    if ((await access(c.env.DB, tenant.id, c.get('clerkUserId'))) !== 'owner') {
      return c.json<APIResponse<null>>({ success: false, error: 'Solo el dueño puede cambiar los socios', data: null }, 403);
    }
    const parsed = validatePartnership(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json<APIResponse<null>>({ success: false, error: parsed.error, data: null }, 400);

    await c.env.DB.prepare('UPDATE user_profiles SET partnership_enabled = ?, partners = ?, updated_at = ? WHERE id = ?')
      .bind(parsed.value.enabled ? 1 : 0, JSON.stringify(parsed.value.partners), new Date().toISOString(), tenant.id)
      .run();
    return c.json<APIResponse<Partnership>>({ success: true, data: parsed.value });
  } catch (error) {
    console.error('[partnership] Error guardando los socios:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo guardar', data: null }, 500);
  }
});

export default app;
