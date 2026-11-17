/**
 * POS Reviews API Routes
 *
 * Reseñas de los tenderos sobre el sistema POS de posib.dev.
 * Una reseña por tienda (user_profile). Estas rutas requieren autenticación
 * (authMiddleware). El promedio y las reseñas públicas se sirven desde stats.ts
 * (sin autenticación) para mostrarse en la landing.
 */

import { Hono, type Context } from 'hono';
import type { Env, Tenant, APIResponse, AppEnv } from '../types';
import { escapeTelegramHtml, sendTelegramMessage } from '../utils/telegram';

const app = new Hono<AppEnv>();

interface ReviewRow {
  user_profile_id: string;
  rating: number;
  comment: string | null;
  store_name: string | null;
  store_city: string | null;
  is_approved: number;
  created_at: string;
  updated_at: string;
}

function serialize(row: ReviewRow) {
  return {
    rating: row.rating,
    comment: row.comment || '',
    storeName: row.store_name || '',
    storeCity: row.store_city || '',
    isApproved: row.is_approved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/pos-reviews/me
 * Devuelve la reseña de la tienda autenticada (o null si aún no ha reseñado).
 */
app.get('/me', async (c) => {
  const tenant: Tenant = c.get('tenant');

  const row = await c.env.DB.prepare(
    'SELECT * FROM pos_reviews WHERE user_profile_id = ?'
  )
    .bind(tenant.id)
    .first<ReviewRow>();

  return c.json<APIResponse<any>>({
    success: true,
    data: row ? serialize(row) : null,
  });
});

/**
 * PUT /api/pos-reviews/me
 * Crea o actualiza la reseña de la tienda autenticada.
 */
app.put('/me', async (c) => {
  const tenant: Tenant = c.get('tenant');

  const body = await c.req.json<{ rating?: number; comment?: string }>();
  const rating = Number(body.rating);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return c.json<APIResponse<null>>(
      { success: false, error: 'La calificación debe ser entre 1 y 5 estrellas', data: null },
      400
    );
  }

  const comment = body.comment?.trim() || null;

  // Datos de la tienda para mostrarlos junto a la reseña pública.
  const profile = await c.env.DB.prepare(
    'SELECT store_name, full_name, store_city FROM user_profiles WHERE id = ?'
  )
    .bind(tenant.id)
    .first<{ store_name: string | null; full_name: string | null; store_city: string | null }>();

  const storeName = profile?.store_name || profile?.full_name || 'Tienda';
  const storeCity = profile?.store_city || null;
  const now = new Date().toISOString();

  const previous = await c.env.DB.prepare(
    'SELECT rating, comment FROM pos_reviews WHERE user_profile_id = ?'
  )
    .bind(tenant.id)
    .first<{ rating: number; comment: string | null }>();
  const changed = !previous || previous.rating !== rating || (previous.comment || null) !== comment;

  // Upsert: una reseña por tienda.
  await c.env.DB.prepare(
    `INSERT INTO pos_reviews
       (user_profile_id, rating, comment, store_name, store_city, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_profile_id) DO UPDATE SET
       rating = excluded.rating,
       comment = excluded.comment,
       store_name = excluded.store_name,
       store_city = excluded.store_city,
       -- Si cambia lo que dice, vuelve a moderación: no se publica un texto que
       -- el superadmin no ha visto.
       is_approved = CASE WHEN pos_reviews.rating = excluded.rating
                           AND COALESCE(pos_reviews.comment, '') = COALESCE(excluded.comment, '')
                          THEN pos_reviews.is_approved ELSE 0 END,
       updated_at = excluded.updated_at`
  )
    .bind(tenant.id, rating, comment, storeName, storeCity, now, now)
    .run();

  if (changed) {
    const notify = notifyAdminsOfReview(c.env, {
      isNew: !previous,
      rating,
      comment,
      storeName,
      storeCity,
    }).catch((error) => console.error('[pos-reviews] Aviso por Telegram falló:', error));
    try {
      c.executionCtx.waitUntil(notify);
    } catch {
      await notify; // fuera de Workers (pruebas) no hay executionCtx
    }
  }

  const saved = await c.env.DB.prepare(
    'SELECT * FROM pos_reviews WHERE user_profile_id = ?'
  )
    .bind(tenant.id)
    .first<ReviewRow>();

  return c.json<APIResponse<any>>({ success: true, data: serialize(saved!) });
});

/**
 * DELETE /api/pos-reviews/me
 * Elimina la reseña de la tienda autenticada.
 */
app.delete('/me', async (c) => {
  const tenant: Tenant = c.get('tenant');

  await c.env.DB.prepare('DELETE FROM pos_reviews WHERE user_profile_id = ?')
    .bind(tenant.id)
    .run();

  return c.json<APIResponse<null>>({ success: true, data: null });
});

/**
 * Avisa por Telegram a los superadmins con Telegram conectado que hay una
 * reseña nueva o editada, pendiente de aprobar para salir en la landing.
 */
async function notifyAdminsOfReview(
  env: Env,
  review: { isNew: boolean; rating: number; comment: string | null; storeName: string; storeCity: string | null }
): Promise<number> {
  const admins = await env.DB.prepare(
    `SELECT telegram_chat_id FROM user_profiles
     WHERE is_superadmin = 1 AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
       AND COALESCE(telegram_enabled, 1) != 0`
  ).all<{ telegram_chat_id: string }>();
  const chatIds = (admins.results || []).map((r) => r.telegram_chat_id);
  if (chatIds.length === 0) return 0;

  const stars = '⭐'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  const where = review.storeCity ? ` · ${escapeTelegramHtml(review.storeCity)}` : '';
  const text =
    `📝 <b>${review.isNew ? 'Nueva reseña de posib' : 'Reseña de posib editada'}</b>\n` +
    `\n🏪 <b>${escapeTelegramHtml(review.storeName)}</b>${where}` +
    `\n${stars} (${review.rating}/5)` +
    (review.comment ? `\n\n“${escapeTelegramHtml(review.comment)}”` : '\n\n<i>Sin comentario.</i>') +
    `\n\nPara que salga en la página de inicio, apruébala en Superadmin → Reseñas.`;

  let sent = 0;
  for (const chatId of chatIds) {
    const result = await sendTelegramMessage(chatId, text, env.TELEGRAM_BOT_TOKEN);
    if (result.success) sent++;
  }
  return sent;
}

// ============================================
// Moderación (solo superadmin)
// ============================================

/** Verifica que el usuario autenticado sea superadmin. */
async function ensureSuperAdmin(c: Context<AppEnv>): Promise<Response | null> {
  const tenant: Tenant = c.get('tenant');

  // El authMiddleware ya resolvió el perfil (contemplando clerk_user_id y
  // clerk_user_id_test) y adjuntó el flag al tenant. Reusarlo evita un lookup
  // que fallaba en desarrollo, donde el clerk_user_id es el de la instancia test.
  if (!(tenant as any).is_superadmin) {
    return c.json<APIResponse<null>>(
      { success: false, error: 'No tienes permisos para moderar reseñas', data: null },
      403
    );
  }
  return null;
}

/**
 * GET /api/pos-reviews/admin/all
 * Lista todas las reseñas (aprobadas y pendientes) para moderación.
 */
app.get('/admin/all', async (c) => {
  const denied = await ensureSuperAdmin(c);
  if (denied) return denied;

  const result = await c.env.DB.prepare(
    'SELECT * FROM pos_reviews ORDER BY is_approved ASC, updated_at DESC'
  ).all<ReviewRow>();

  const reviews = (result.results || []).map((r) => ({
    userProfileId: r.user_profile_id,
    ...serialize(r),
  }));

  return c.json<APIResponse<typeof reviews>>({ success: true, data: reviews });
});

/**
 * PUT /api/pos-reviews/admin/:userProfileId
 * Aprueba o rechaza una reseña. Body: { isApproved: boolean }.
 */
app.put('/admin/:userProfileId', async (c) => {
  const denied = await ensureSuperAdmin(c);
  if (denied) return denied;

  const userProfileId = c.req.param('userProfileId');
  const body = await c.req.json<{ isApproved?: boolean }>();

  const result = await c.env.DB.prepare(
    'UPDATE pos_reviews SET is_approved = ?, updated_at = ? WHERE user_profile_id = ?'
  )
    .bind(body.isApproved ? 1 : 0, new Date().toISOString(), userProfileId)
    .run();

  if (!result.meta.changes) {
    return c.json<APIResponse<null>>(
      { success: false, error: 'Reseña no encontrada', data: null },
      404
    );
  }

  return c.json<APIResponse<null>>({ success: true, data: null });
});

/**
 * DELETE /api/pos-reviews/admin/:userProfileId
 * Elimina cualquier reseña (moderación).
 */
app.delete('/admin/:userProfileId', async (c) => {
  const denied = await ensureSuperAdmin(c);
  if (denied) return denied;

  const userProfileId = c.req.param('userProfileId');
  const result = await c.env.DB.prepare(
    'DELETE FROM pos_reviews WHERE user_profile_id = ?'
  )
    .bind(userProfileId)
    .run();

  if (!result.meta.changes) {
    return c.json<APIResponse<null>>(
      { success: false, error: 'Reseña no encontrada', data: null },
      404
    );
  }

  return c.json<APIResponse<null>>({ success: true, data: null });
});

export default app;
