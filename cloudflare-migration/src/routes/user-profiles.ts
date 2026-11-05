import { Hono } from 'hono';
import { hasValidNequiNumber } from '../utils/storefront-access';
import type { Env, APIResponse, Tenant, AppEnv } from '../types';
import type { UserProfile } from '../../../lib/types';

const app = new Hono<AppEnv>();

/**
 * GET /api/user-profiles
 * Obtener el perfil del usuario actual
 */
app.get('/', async (c) => {
  try {
    const tenant: Tenant = c.get('tenant');
    const clerkUserId: string = c.get('clerkUserId');
    // El middleware de auth ya resolvió el perfil del owner (incluyendo el caso
    // dev donde el id vive en clerk_user_id_test) y lo dejó aquí.
    const resolvedProfileId: string | undefined = c.get('userProfileId');

    console.log('🔍 [GET /api/user-profiles] clerk_user_id:', clerkUserId);

    // Primero verificar si el usuario es un team member
    // Los team members NO tienen user_profile, solo tienen registro en team_members
    const teamMember = await c.env.DB.prepare(
      `SELECT id FROM team_members
       WHERE clerk_user_id = ?
       AND invitation_status = 'accepted'
       AND status = 'active'`
    )
      .bind(clerkUserId)
      .first<{ id: string }>();

    if (teamMember) {
      console.log('👥 [GET /api/user-profiles] Usuario es team member, retornando 404');
      // Team members no tienen user_profile
      return c.json<APIResponse<null>>({
        success: false,
        error: 'User is a team member, not an owner',
        data: null
      }, 404);
    }

    // Obtener el perfil del usuario actual (owner).
    // Preferimos el id ya resuelto por el middleware; si no está, caemos al
    // lookup por clerk_user_id OR clerk_user_id_test para cubrir el entorno dev.
    const result = resolvedProfileId
      ? await c.env.DB.prepare('SELECT * FROM user_profiles WHERE id = ?')
          .bind(resolvedProfileId)
          .first<UserProfile>()
      : await c.env.DB.prepare(
          'SELECT * FROM user_profiles WHERE clerk_user_id = ? OR clerk_user_id_test = ?'
        )
          .bind(clerkUserId, clerkUserId)
          .first<UserProfile>();

    console.log('📦 [GET /api/user-profiles] Perfil encontrado:', !!result);

    if (!result) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'User profile not found',
        data: null
      }, 404);
    }

    // Normalizar is_superadmin a boolean (viene como 0/1 desde SQLite)
    const normalizedResult = {
      ...result,
      is_superadmin: !!result.is_superadmin,
      has_ai_addon: !!result.has_ai_addon,
      auto_reports_enabled: !!result.auto_reports_enabled,
      store_enabled: !!result.store_enabled,
      store_shipping_enabled: !!result.store_shipping_enabled,
      store_pickup_enabled: !!result.store_pickup_enabled,
    };

    return c.json<APIResponse<UserProfile>>({
      success: true,
      data: normalizedResult as UserProfile
    });
  } catch (error: any) {
    console.error('Error fetching user profile:', error);
    return c.json<APIResponse<null>>({
      success: false,
      error: error.message || 'Failed to fetch user profile',
      data: null
    }, 500);
  }
});

/**
 * GET /api/user-profiles/all
 * Obtener todos los perfiles de usuario (solo para admins)
 * Nota: Esta ruta es diferente porque user_profiles es una tabla global
 */
app.get('/all', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM user_profiles ORDER BY created_at DESC'
    ).all<UserProfile>();

    // Normalizar booleanos para todos los perfiles (vienen como 0/1 desde SQLite)
    const normalizedResults = (result.results || []).map(profile => ({
      ...profile,
      is_superadmin: !!profile.is_superadmin,
      has_ai_addon: !!profile.has_ai_addon,
      auto_reports_enabled: !!profile.auto_reports_enabled,
    }));

    return c.json<APIResponse<UserProfile[]>>({
      success: true,
      data: normalizedResults as UserProfile[]
    });
  } catch (error: any) {
    console.error('Error fetching user profiles:', error);
    return c.json<APIResponse<null>>({
      success: false,
      error: error.message || 'Failed to fetch user profiles',
      data: null
    }, 500);
  }
});

/**
 * PUT /api/user-profiles/:id
 * Actualizar perfil de usuario
 */
// Campos de suscripción, complementos y fidelización que el tendero no puede
// escribir por el PUT (ver billingFieldsForbiddenForOwner).
const BILLING_FIELDS = [
  'subscription_status',
  'trial_start_date',
  'trial_end_date',
  'subscription_id',
  'plan_id',
  'last_payment_date',
  'next_billing_date',
  'loyalty_points',
  'loyalty_tier',
  'has_ai_addon',
  'has_store_addon',
  'has_email_addon',
  'ai_addon_expires_at',
  'store_addon_expires_at',
  'email_addon_expires_at',
] as const;

const MAX_TRIAL_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * Devuelve los campos de cobro del body que un usuario que no es superadmin NO
 * puede escribir. Solo se permiten dos cambios que el front hace solo y que no
 * dan acceso gratis (lib/cloudflare-subscription-helpers.ts):
 *  - marcar la propia suscripción como 'expired';
 *  - fijar trial_end_date cuando aún no existe, a no más de 31 días.
 */
export function billingFieldsForbiddenForOwner(
  body: Record<string, unknown>,
  current: { trial_end_date?: string | null }
): string[] {
  return BILLING_FIELDS.filter((field) => {
    const value = body[field];
    if (value === undefined) return false;
    if (field === 'subscription_status') return value !== 'expired';
    if (field === 'trial_end_date') {
      if (current.trial_end_date) return true;
      const end = new Date(String(value)).getTime();
      return Number.isNaN(end) || end > Date.now() + MAX_TRIAL_MS;
    }
    return true;
  });
}

app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const tenant: Tenant = c.get('tenant');
    const clerkUserId: string = c.get('clerkUserId');
    // El middleware de auth ya resolvió el perfil del owner (incluyendo el caso
    // dev donde el id vive en clerk_user_id_test) y lo dejó aquí.
    const resolvedProfileId: string | undefined = c.get('userProfileId');

    // Verificar que el usuario solo pueda actualizar su propio perfil
    // (a menos que sea superadmin)
    const currentProfile = await c.env.DB.prepare(
      'SELECT * FROM user_profiles WHERE id = ?'
    )
      .bind(id)
      .first<UserProfile>();

    if (!currentProfile) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'User profile not found',
        data: null
      }, 404);
    }

    // Verificar si el usuario que hace la petición es superadmin
    const isSuperAdmin = (tenant as any).is_superadmin === true;

    // Determinar si el perfil objetivo pertenece al usuario autenticado.
    // Igual que en GET, aceptamos tanto clerk_user_id como clerk_user_id_test
    // (el token trae el id de test en local) y el id ya resuelto por el
    // middleware, para no rechazar al dueño legítimo entre entornos.
    const isOwnProfile =
      (resolvedProfileId && currentProfile.id === resolvedProfileId) ||
      currentProfile.clerk_user_id === clerkUserId ||
      currentProfile.clerk_user_id_test === clerkUserId;

    // Solo permitir actualización si es el mismo usuario o es superadmin
    if (!isOwnProfile && !isSuperAdmin) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'Unauthorized - Solo puedes actualizar tu propio perfil o ser superadmin',
        data: null
      }, 403);
    }

    // Campos de cobro: solo los cambian el superadmin y las llamadas internas
    // (webhook de ePayco vía apply-payment, con X-Webhook-Secret). Antes el
    // tendero —o un empleado con su token— podía activarse el plan o los
    // complementos sin pagar con un PUT directo.
    if (!isSuperAdmin) {
      const forbidden = billingFieldsForbiddenForOwner(body, currentProfile);
      if (forbidden.length > 0) {
        return c.json<APIResponse<null>>({
          success: false,
          error: `No puedes modificar estos campos: ${forbidden.join(', ')}`,
          code: 'BILLING_FIELDS_FORBIDDEN',
          data: null,
        } as APIResponse<null>, 403);
      }
    }

    // La tienda online solo se enciende con un número de Nequi: sin él el
    // cliente hace el pedido y no tiene a dónde pagar.
    const turnsStoreOn = body.store_enabled === true || body.store_enabled === 1;
    if (turnsStoreOn) {
      const nequi = body.store_nequi_number !== undefined ? body.store_nequi_number : currentProfile.store_nequi_number;
      if (!hasValidNequiNumber(nequi)) {
        return c.json<APIResponse<null>>({
          success: false,
          error: 'Para activar la tienda online escribe tu número de Nequi (10 dígitos): ahí te pagan los clientes.',
          code: 'STORE_NEQUI_REQUIRED',
          data: null,
        } as APIResponse<null>, 400);
      }
    }

    // Actualizar solo campos permitidos
    const allowedFields = [
      'full_name',
      'phone',
      'subscription_status',
      'trial_start_date',
      'trial_end_date',
      'subscription_id',
      'plan_id',
      'last_payment_date',
      'next_billing_date',
      'loyalty_points',
      'loyalty_tier',
      // is_superadmin NO se puede cambiar por API: solo admin@neurai.dev lo
      // tiene, y se asigna al crear su perfil (middleware/auth.ts).
      // Clasificación de tienda (abarrotes, papelería, pizzería, licorera, farmacia)
      'business_type',
      // QR de pagos del tendero (Nequi/Daviplata/Bre-B) para cobrar en el POS
      'payment_qr_url',
      // Color del sistema elegido por el tendero (id de lib/accent.ts). Migración 029.
      'ui_accent',
      // Addon subscriptions
      'has_ai_addon',
      'has_store_addon',
      'has_email_addon',
      'ai_addon_expires_at',
      'store_addon_expires_at',
      'email_addon_expires_at',
      // Storefront configuration fields
      'store_slug',
      'store_name',
      'store_description',
      'store_logo_url',
      'store_banner_url',
      'store_banner_images',
      'store_primary_color',
      'store_secondary_color',
      'store_whatsapp',
      'store_facebook',
      'store_instagram',
      'store_address',
      'store_city',
      'store_phone',
      'store_email',
      'store_enabled',
      'store_terms',
      'store_shipping_enabled',
      'store_pickup_enabled',
      'store_min_order',
      'store_nequi_number',
      'store_maps_url',
      // Reportes automáticos
      'auto_reports_enabled',
      'auto_reports_time',
      'auto_reports_email',
      // API Key personal de Gemini
      'gemini_api_key',
      // Telegram (avisos de vencimiento)
      'telegram_link_code',
      'telegram_enabled',
      'telegram_chat_id',
    ];

    const updates: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    if (updates.length === 0) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'No fields to update',
        data: null
      }, 400);
    }

    // Agregar updated_at
    updates.push('updated_at = datetime(\'now\')');
    values.push(id);

    await c.env.DB.prepare(
      `UPDATE user_profiles SET ${updates.join(', ')} WHERE id = ?`
    )
      .bind(...values)
      .run();

    // Obtener el perfil actualizado
    const updated = await c.env.DB.prepare(
      'SELECT * FROM user_profiles WHERE id = ?'
    )
      .bind(id)
      .first<UserProfile>();

    // Normalizar booleanos
    const normalizedUpdated = {
      ...updated!,
      is_superadmin: !!updated!.is_superadmin,
      has_ai_addon: !!updated!.has_ai_addon,
      auto_reports_enabled: !!updated!.auto_reports_enabled,
      store_enabled: !!updated!.store_enabled,
      store_shipping_enabled: !!updated!.store_shipping_enabled,
      store_pickup_enabled: !!updated!.store_pickup_enabled,
    };

    return c.json<APIResponse<UserProfile>>({
      success: true,
      data: normalizedUpdated as UserProfile,
      message: 'User profile updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating user profile:', error);
    return c.json<APIResponse<null>>({
      success: false,
      error: error.message || 'Failed to update user profile',
      data: null
    }, 500);
  }
});

const ADDON_EXPIRY_COLUMN = {
  store: { flag: 'has_store_addon', expires: 'store_addon_expires_at' },
  ai: { flag: 'has_ai_addon', expires: 'ai_addon_expires_at' },
  email: { flag: 'has_email_addon', expires: 'email_addon_expires_at' },
} as const;

// Un mes después de MAX(vencimiento vigente, ahora): pagar antes de vencer suma
// el mes al final del período en curso en vez de perder los días que faltaban.
// `column` sale de ADDON_EXPIRY_COLUMN / 'next_billing_date', nunca del cliente.
const monthFromCurrentExpiry = (column: string) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', MAX(COALESCE(julianday(${column}), 0), julianday('now')), '+1 month')`;

/**
 * POST /api/user-profiles/:id/apply-payment
 * Aplica un pago aprobado de ePayco (plan o complemento) al perfil y registra la
 * transacción, todo en un único batch. Idempotente por `payment_key`: el webhook
 * y la página de retorno pueden llamarlo a la vez y solo el primero suma el mes.
 * Solo superadmin / llamada interna con X-Webhook-Secret.
 */
app.post('/:id/apply-payment', async (c) => {
  try {
    const tenant: Tenant = c.get('tenant');
    if ((tenant as any).is_superadmin !== true) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'Unauthorized - Solo superadmin o llamada interna',
        data: null,
      }, 403);
    }

    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const kind = body.kind as string;
    const paymentKey = typeof body.payment_key === 'string' ? body.payment_key.trim() : '';
    const planId = typeof body.plan_id === 'string' ? body.plan_id.trim().slice(0, 100) : '';
    const businessType = typeof body.business_type === 'string' ? body.business_type.trim().slice(0, 50) : '';

    if (!paymentKey || paymentKey.length > 200) {
      return c.json<APIResponse<null>>({ success: false, error: 'payment_key requerido', data: null }, 400);
    }
    if (kind !== 'plan' && !(kind in ADDON_EXPIRY_COLUMN)) {
      return c.json<APIResponse<null>>({ success: false, error: 'kind inválido', data: null }, 400);
    }
    if (kind === 'plan' && !planId) {
      return c.json<APIResponse<null>>({ success: false, error: 'plan_id requerido para kind=plan', data: null }, 400);
    }

    const exists = await c.env.DB.prepare('SELECT id FROM user_profiles WHERE id = ?')
      .bind(id)
      .first<{ id: string }>();
    if (!exists) {
      return c.json<APIResponse<null>>({ success: false, error: 'User profile not found', data: null }, 404);
    }

    const amount = Number(body.amount);
    const currency = typeof body.currency === 'string' && body.currency ? body.currency.slice(0, 10) : 'COP';
    const reference = typeof body.reference === 'string' && body.reference ? body.reference.slice(0, 300) : null;
    const nowIso = new Date().toISOString();

    const notYetApplied = `NOT EXISTS (
      SELECT 1 FROM payment_transactions WHERE user_profile_id = ? AND wompi_transaction_id = ?
    )`;

    let updateStatement: D1PreparedStatement;
    if (kind === 'plan') {
      updateStatement = c.env.DB.prepare(
        `UPDATE user_profiles SET
           subscription_status = 'active',
           last_payment_date = ?,
           next_billing_date = ${monthFromCurrentExpiry('next_billing_date')},
           trial_start_date = NULL,
           trial_end_date = NULL,
           plan_id = ?,
           business_type = COALESCE(NULLIF(?, ''), business_type),
           updated_at = datetime('now')
         WHERE id = ? AND ${notYetApplied}`
      ).bind(nowIso, planId, businessType, id, id, paymentKey);
    } else {
      const { flag, expires } = ADDON_EXPIRY_COLUMN[kind as keyof typeof ADDON_EXPIRY_COLUMN];
      updateStatement = c.env.DB.prepare(
        `UPDATE user_profiles SET
           ${flag} = 1,
           ${expires} = ${monthFromCurrentExpiry(expires)},
           last_payment_date = ?,
           updated_at = datetime('now')
         WHERE id = ? AND ${notYetApplied}`
      ).bind(nowIso, id, id, paymentKey);
    }

    const insertStatement = c.env.DB.prepare(
      `INSERT INTO payment_transactions (
         id, user_profile_id, wompi_transaction_id, amount, currency,
         status, payment_method_type, reference, created_at
       )
       SELECT ?, ?, ?, ?, ?, 'APPROVED', 'epayco', ?, ?
       WHERE ${notYetApplied}`
    ).bind(
      `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      id,
      paymentKey,
      Number.isFinite(amount) && amount > 0 ? amount : 0,
      currency,
      reference,
      nowIso,
      id,
      paymentKey,
    );

    const [updateResult] = await c.env.DB.batch([updateStatement, insertStatement]);
    const applied = (updateResult.meta?.changes ?? 0) > 0;

    const profile = await c.env.DB.prepare(
      `SELECT subscription_status, plan_id, next_billing_date, has_store_addon, store_addon_expires_at,
              has_ai_addon, ai_addon_expires_at, has_email_addon, email_addon_expires_at
       FROM user_profiles WHERE id = ?`
    )
      .bind(id)
      .first();

    return c.json<APIResponse<{ applied: boolean; profile: unknown }>>({
      success: true,
      data: { applied, profile },
    });
  } catch (error: any) {
    console.error('Error applying payment:', error);
    return c.json<APIResponse<null>>({
      success: false,
      error: error.message || 'Failed to apply payment',
      data: null,
    }, 500);
  }
});

/**
 * DELETE /api/user-profiles/:id
 * Eliminar un usuario y todos sus datos relacionados
 * Solo disponible para superadmins
 */
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const tenant: Tenant = c.get('tenant');

    // Verificar que el usuario sea superadmin.
    // El authMiddleware ya resolvió el perfil (contemplando clerk_user_id y
    // clerk_user_id_test) y adjuntó el flag al tenant. Reusarlo evita un lookup
    // que fallaba en desarrollo, donde el clerk_user_id es el de la instancia test.
    if (!(tenant as any).is_superadmin) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'Unauthorized - Solo superadmins pueden eliminar usuarios',
        data: null
      }, 403);
    }

    // Obtener el usuario a eliminar
    const userToDelete = await c.env.DB.prepare(
      'SELECT * FROM user_profiles WHERE id = ?'
    )
      .bind(id)
      .first<UserProfile>();

    if (!userToDelete) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'User profile not found',
        data: null
      }, 404);
    }

    // Verificar que no se esté eliminando a sí mismo
    if (userToDelete.clerk_user_id === tenant.clerk_user_id) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'No puedes eliminar tu propia cuenta',
        data: null
      }, 400);
    }

    // Verificar que no sea otro superadmin
    if (userToDelete.is_superadmin) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'No se puede eliminar a otro superadmin',
        data: null
      }, 400);
    }

    // Obtener estadísticas antes de eliminar
    const stats = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM products WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM sales WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM customers WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM categories WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM suppliers WHERE tenant_id = ?').bind(id),
    ]);

    const deletionStats = {
      products: (stats[0].results[0] as any)?.count || 0,
      sales: (stats[1].results[0] as any)?.count || 0,
      customers: (stats[2].results[0] as any)?.count || 0,
      categories: (stats[3].results[0] as any)?.count || 0,
      suppliers: (stats[4].results[0] as any)?.count || 0,
    };

    // Eliminar manualmente en el orden correcto para evitar violaciones de FK
    // Primero eliminar tablas que dependen de otras
    await c.env.DB.batch([
      // 1. Eliminar items de carritos, pagos, items de ventas, items de órdenes
      c.env.DB.prepare('DELETE FROM cart_items WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM credit_payments WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM sale_items WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM purchase_order_items WHERE tenant_id = ?').bind(id),

      // 2. Eliminar carritos, ventas, órdenes de compra
      c.env.DB.prepare('DELETE FROM shopping_carts WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM sales WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM purchase_orders WHERE tenant_id = ?').bind(id),

      // 3. Eliminar ofertas, movimientos de inventario
      c.env.DB.prepare('DELETE FROM offers WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM inventory_movements WHERE tenant_id = ?').bind(id),

      // 4. Eliminar productos
      c.env.DB.prepare('DELETE FROM products WHERE tenant_id = ?').bind(id),

      // 5. Eliminar clientes, categorías, proveedores
      c.env.DB.prepare('DELETE FROM customers WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM categories WHERE tenant_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM suppliers WHERE tenant_id = ?').bind(id),
    ]);

    // Finalmente eliminar el usuario
    await c.env.DB.prepare(
      'DELETE FROM user_profiles WHERE id = ?'
    )
      .bind(id)
      .run();

    // También eliminar el tenant asociado si existe
    try {
      await c.env.DB.prepare(
        'DELETE FROM tenants WHERE clerk_user_id = ?'
      )
        .bind(userToDelete.clerk_user_id)
        .run();
    } catch (error) {
      console.warn('Error deleting tenant (might not exist):', error);
    }

    return c.json<APIResponse<any>>({
      success: true,
      data: {
        deleted_user: {
          id: userToDelete.id,
          email: userToDelete.email,
          full_name: userToDelete.full_name,
        },
        deleted_data: deletionStats,
      },
      message: `Usuario ${userToDelete.email} eliminado correctamente junto con todos sus datos`
    });
  } catch (error: any) {
    console.error('Error deleting user profile:', error);
    return c.json<APIResponse<null>>({
      success: false,
      error: error.message || 'Failed to delete user profile',
      data: null
    }, 500);
  }
});

export default app;
