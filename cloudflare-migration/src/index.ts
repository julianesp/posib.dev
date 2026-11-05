/**
 * Tienda POS - Cloudflare Workers API
 * Multi-tenant POS system with isolated databases per store
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppEnv } from './types';
import { authMiddleware, verifyClerkToken } from './middleware/auth';
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';

// Import routes
import productsRoutes from './routes/products';
import customersRoutes from './routes/customers';
import salesRoutes from './routes/sales';
import categoriesRoutes from './routes/categories';
import monthlyReportsRoutes from './routes/monthly-reports';
import suppliersRoutes from './routes/suppliers';
import purchaseOrdersRoutes from './routes/purchase-orders';
import debtorsRoutes from './routes/debtors';
import userProfilesRoutes from './routes/user-profiles';
import creditPaymentsRoutes from './routes/credit-payments';
import offersRoutes from './routes/offers';
import paymentTransactionsRoutes from './routes/payment-transactions';
import adminStatsRoutes from './routes/admin-stats';
import storeHealthRoutes from './routes/store-health';
import dianThresholdsRoutes, { runDianThresholdAlerts } from './routes/dian-thresholds';
import partnershipRoutes from './routes/partnership';
import storefrontRoutes from './routes/storefront';
import shippingZonesRoutes from './routes/shipping-zones';
import epaycoStorefrontRoutes from './routes/epayco-storefront';
import subscriptionsRoutes from './routes/subscriptions';
import emailRoutes from './routes/email';
import statsRoutes from './routes/stats';
import loyaltySettingsRoutes from './routes/loyalty-settings';
import teamInvitationsRoutes from './routes/team-invitations';
import analyticsRoutes from './routes/analytics';
import userStoresRoutes from './routes/user-stores';
import facturasRoutes from './routes/facturas';
import marketTrendsRoutes from './routes/market-trends';
import posReviewsRoutes from './routes/pos-reviews';
import telegramRoutes from './routes/telegram';
import telegramRecipientsRoutes from './routes/telegram-recipients';
import businessTypePricesRoutes from './routes/business-type-prices';
import { backupAuth, backupPublic } from './routes/backup';
import { siteVisitsPublic, siteVisitsAdmin } from './routes/site-visits';

const app = new Hono<AppEnv>();

// CORS middleware - allow localhost and vercel domains
app.use('/*', cors({
  origin: (origin) => {
    // Allow localhost
    if (origin?.startsWith('http://localhost:')) return origin;
    // Allow Vercel deployments
    if (origin?.endsWith('.vercel.app')) return origin;
    // Allow specific production domain if needed
    if (origin === 'https://posib.dev') return origin;
    return 'http://localhost:3000'; // fallback
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}));

// Health check endpoint (no auth required)
app.get('/health', (c) => {
  return c.json({
    success: true,
    message: 'Tienda POS API is running',
    environment: c.env.ENVIRONMENT || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// Public endpoints
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'Tienda POS Multi-Tenant API',
    version: '1.0.0',
    docs: '/docs',
  });
});


// Visitas al sitio público (NO auth - beacon anónimo desde el navegador)
app.route('/api/visits', siteVisitsPublic);

// Telegram webhook (NO auth - Telegram no envía JWT; se verifica su secret token)
app.route('/api/telegram', telegramRoutes);

// Storefront public API (NO auth required - endpoints públicos para tiendas online)
app.route('/api/storefront', storefrontRoutes);

// ePayco storefront (NO auth required - pagos públicos para tiendas online)
app.route('/api/storefront/epayco', epaycoStorefrontRoutes);

// Stats public API (NO auth required - estadísticas públicas)
app.route('/stats', statsRoutes);

// Team invitations accept endpoint (NO auth middleware - maneja autenticación internamente)
app.post('/api/team-invitations/accept', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'No autorizado',
      }, 401);
    }

    const token = authHeader.substring(7);

    // Verificar firma, expiración e issuer del token de Clerk (antes solo se
    // decodificaba sin verificar: cualquiera podía aceptar una invitación a
    // nombre de otro usuario).
    const clerkUserId = await verifyClerkToken(token, c.env);
    if (!clerkUserId) {
      return c.json({
        success: false,
        error: 'Token inválido',
      }, 401);
    }

    // Obtener datos del body
    const body = await c.req.json();
    const { token: invitationToken } = body;

    // IMPORTANTE: Usar SOLO el clerk_user_id del token JWT autenticado
    // NO usar el que viene en el body, ya que podría ser diferente
    const userId = clerkUserId;

    if (!invitationToken || !userId) {
      return c.json({
        success: false,
        error: 'Token de invitación requerido',
      }, 400);
    }

    // Buscar la invitación
    const member = await c.env.DB
      .prepare('SELECT * FROM team_members WHERE invitation_token = ?')
      .bind(invitationToken)
      .first<any>();

    if (!member) {
      return c.json({
        success: false,
        error: 'Invitación no encontrada',
      }, 404);
    }

    // Verificar si la invitación ya fue aceptada
    if (member.invitation_status === 'accepted') {
      return c.json({
        success: false,
        error: 'Esta invitación ya fue aceptada',
      }, 400);
    }

    // Verificar si la invitación expiró
    if (member.invitation_expires_at && new Date(member.invitation_expires_at) < new Date()) {
      return c.json({
        success: false,
        error: 'Esta invitación ha expirado',
      }, 400);
    }

    // Verificar si la invitación fue revocada
    if (member.invitation_status === 'revoked') {
      return c.json({
        success: false,
        error: 'Esta invitación ha sido revocada',
      }, 400);
    }

    // Actualizar el miembro con el clerk_user_id y marcar como aceptado
    const now = new Date().toISOString();
    await c.env.DB
      .prepare(`
        UPDATE team_members
        SET clerk_user_id = ?,
            invitation_status = 'accepted',
            invitation_accepted_at = ?,
            status = 'active',
            updated_at = ?
        WHERE id = ?
      `)
      .bind(userId, now, now, member.id)
      .run();

    const updatedMember = await c.env.DB
      .prepare('SELECT * FROM team_members WHERE id = ?')
      .bind(member.id)
      .first<any>();

    return c.json({
      success: true,
      teamMember: updatedMember,
      message: 'Invitación aceptada exitosamente',
    });
  } catch (error: any) {
    console.error('Error aceptando invitación:', error);
    return c.json({
      success: false,
      error: error.message || 'Error al aceptar invitación',
    }, 500);
  }
});

// Email CRON endpoints (NO auth - solo para llamadas internas de CRON)
// IMPORTANTE: Estos endpoints solo deben ser llamados por el CRON scheduler
// Necesitamos crear un handler específico que llame al sub-router sin autenticación
const emailCronHandler = async (c: any) => {
  // Crear una request interna que será procesada por emailRoutes
  const path = c.req.path.replace('/api/email', '');
  const newReq = new Request(c.req.url.replace(c.req.path, path), {
    method: c.req.method,
    headers: c.req.headers,
    body: c.req.body,
  });
  return emailRoutes.fetch(newReq, c.env, c.executionCtx);
};

app.post('/api/email/daily-reports', emailCronHandler);
app.post('/api/email/subscription-reminders', emailCronHandler);
app.post('/api/email/stock-alerts', emailCronHandler);
app.post('/api/email/abandoned-carts', emailCronHandler);
// Valida X-Cron-Secret dentro de la ruta. Antes faltaba aquí y el cron recibía
// 401 del authMiddleware: los recordatorios de fiado nunca se enviaban.
app.post('/api/email/debt-reminders', emailCronHandler);

// Rutas internas de respaldo a Drive (NO auth de Clerk; validan X-Cron-Secret).
// Las llaman el flujo OAuth de Next.js y el cron del Worker.
app.route('/api/backup-internal', backupPublic);

// Team invitations public endpoint (NO auth - para usuarios no autenticados)
app.get('/api/team-invitations/validate', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.json({
      error: 'Token requerido',
    }, 400);
  }

  try {
    // Buscar la invitación por token
    const member = await c.env.DB
      .prepare('SELECT * FROM team_members WHERE invitation_token = ?')
      .bind(token)
      .first<any>();

    if (!member) {
      return c.json({
        error: 'Invitación no encontrada',
      }, 404);
    }

    // Verificar si la invitación ya fue aceptada
    if (member.invitation_status === 'accepted') {
      return c.json({
        error: 'Esta invitación ya fue aceptada',
      }, 400);
    }

    // Verificar si la invitación expiró
    if (member.invitation_expires_at && new Date(member.invitation_expires_at) < new Date()) {
      return c.json({
        error: 'Esta invitación ha expirado',
      }, 400);
    }

    // Verificar si la invitación fue revocada
    if (member.invitation_status === 'revoked') {
      return c.json({
        error: 'Esta invitación ha sido revocada',
      }, 400);
    }

    // Obtener información del owner (dueño de la tienda)
    const owner = await c.env.DB
      .prepare('SELECT * FROM user_profiles WHERE id = ?')
      .bind(member.owner_id)
      .first<any>();

    return c.json({
      email: member.email,
      role: member.role,
      store_name: owner?.store_name || 'Sistema POS',
      inviter_name: owner?.full_name || owner?.email,
      expires_at: member.invitation_expires_at,
    });
  } catch (error: any) {
    console.error('Error validando invitación:', error);
    return c.json({
      error: error.message || 'Error al validar invitación',
    }, 500);
  }
});

// Apply authentication middleware to all API routes
app.use('/api/*', authMiddleware);


// Subscriptions routes (protected - requieren autenticación)
app.route('/api/subscriptions', subscriptionsRoutes);

// API Routes (all protected by auth)
app.route('/api/products', productsRoutes);
app.route('/api/customers', customersRoutes);
app.route('/api/sales', salesRoutes);
app.route('/api/dian-thresholds', dianThresholdsRoutes);
app.route('/api/partnership', partnershipRoutes);
app.route('/api/categories', categoriesRoutes);
app.route('/api/suppliers', suppliersRoutes);
app.route('/api/purchase-orders', purchaseOrdersRoutes);
app.route('/api/debtors', debtorsRoutes);
app.route('/api/user-profiles', userProfilesRoutes);
app.route('/api/credit-payments', creditPaymentsRoutes);
app.route('/api/offers', offersRoutes);
app.route('/api/payment-transactions', paymentTransactionsRoutes);
app.route('/api/shipping-zones', shippingZonesRoutes);
app.route('/api/admin/visits', siteVisitsAdmin);
app.route('/api/admin/health', storeHealthRoutes);
app.route('/api/admin', adminStatsRoutes);
app.route('/api/email', emailRoutes);
app.route('/loyalty-settings', loyaltySettingsRoutes);
app.route('/api/team-invitations', teamInvitationsRoutes);
// Alias para team-members (mismas rutas que team-invitations)
app.route('/api/team-members', teamInvitationsRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/user-stores', userStoresRoutes);
app.route('/api/facturas', facturasRoutes);
app.route('/api/market', marketTrendsRoutes);
app.route('/api/pos-reviews', posReviewsRoutes);
app.route('/api/telegram-recipients', telegramRecipientsRoutes);
app.route('/api/business-type-prices', businessTypePricesRoutes);
// Respaldo a Drive - rutas del tendero (autenticadas)
app.route('/api/backup', backupAuth);
app.route('/api/monthly-reports', monthlyReportsRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Global error handler:', err);

  return c.json({
    success: false,
    error: 'Internal Server Error',
    message: c.env.ENVIRONMENT === 'development' ? err.message : 'An error occurred',
  }, 500);
});

/**
 * Scheduled handler para Cron Triggers
 * Ejecuta los trabajos programados de email marketing
 */
async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  console.log('Cron trigger fired:', event.cron);

  // Helper para hacer requests internos
  const makeRequest = async (path: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      // Rutas de cron protegidas (p. ej. Telegram) validan este secret.
      if (env.CRON_SECRET) {
        headers['X-Cron-Secret'] = env.CRON_SECRET;
      }

      const request = new Request(`https://internal/${path}`, {
        method: 'POST',
        headers,
      });

      const response = await app.fetch(request, env, ctx);
      return await response.json();
    } catch (error) {
      console.error(`Error in ${path}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  // Ejecutar tareas según el horario
  const hour = new Date().getUTCHours();

  // 9 AM UTC - Recordatorios de suscripción
  if (hour === 9) {
    console.log('Running subscription reminders...');
    const result = await makeRequest('api/email/subscription-reminders');
    console.log('Subscription reminders result:', result);
  }

  // Cada hora - Reportes diarios (verifican preferencias internas)
  console.log('Running daily reports check...');
  const reportsResult = await makeRequest('api/email/daily-reports');
  console.log('Daily reports result:', reportsResult);

  // Cada 2 horas - Alertas de stock (solo en horas pares)
  if (hour % 2 === 0) {
    console.log('Running stock alerts...');
    const stockResult = await makeRequest('api/email/stock-alerts');
    console.log('Stock alerts result:', stockResult);
  }

  // Cada hora - Carritos abandonados
  console.log('Running abandoned carts check...');
  const cartsResult = await makeRequest('api/email/abandoned-carts');
  console.log('Abandoned carts result:', cartsResult);

  // 13h UTC = 8 AM Colombia - Recordatorios de fiado (clientes + aviso al tendero
  // por correo y Telegram). Antes corría a las 8h UTC, es decir 3 AM en Colombia.
  if (hour === 13) {
    console.log('Running debt reminders...');
    const debtResult = await makeRequest('api/email/debt-reminders');
    console.log('Debt reminders result:', debtResult);
  }

  // Copia de seguridad de ventas a Google Drive.
  // El trabajo pesado (Excel + subida a Drive) lo hace Next.js; aquí solo
  // decidimos a quién disparar y llamamos a su endpoint /api/backup/run.
  await runDriveBackups(env, ctx, hour);

  // A las 13h UTC (8 AM Colombia) - Alertas por Telegram.
  if (hour === 13) {
    // Vencimiento: solo notifica productos que entran por primera vez en el
    // umbral, así que correr una vez al día no genera avisos repetidos.
    console.log('Running Telegram expiration alerts...');
    const telegramResult = await makeRequest('api/telegram/expiration-alerts');
    console.log('Telegram expiration alerts result:', telegramResult);

    // Resumen diario: ventas de ayer, stock por reponer, fiado por cobrar y
    // aviso de suscripción, agrupados en un solo mensaje por tenant.
    console.log('Running Telegram daily summary...');
    const summaryResult = await makeRequest('api/telegram/daily-summary');
    console.log('Telegram daily summary result:', summaryResult);
  }

  // 14h UTC = 9 AM Colombia - Topes DIAN (facturación electrónica): avisa al
  // dueño por Telegram y correo solo cuando sube de nivel en el año.
  if (hour === 14) {
    try {
      const dianResult = await runDianThresholdAlerts(env);
      console.log('DIAN threshold alerts result:', dianResult);
    } catch (error) {
      console.error('Error in DIAN threshold alerts:', error);
    }
  }

  console.log('Cron jobs completed');
}

/**
 * Copia de seguridad de ventas del día a Google Drive.
 *
 * @param utcHour hora UTC actual (el cron dispara cada hora en punto).
 *
 * Dos fases, ambas independientes de que el tendero tenga el sistema abierto:
 *   1. Disparo puntual: por cada tienda cuya backup_time (hora Colombia) coincide
 *      con la hora actual, respalda las ventas de HOY.
 *   2. Verificación matutina (7 AM Colombia = 12h UTC): busca copias de AYER que
 *      no quedaron 'uploaded' y las reintenta.
 *
 * El Worker no genera el Excel ni habla con Google (ExcelJS y el SDK OAuth viven
 * en Next.js): delega en POST {APP_URL}/api/backup/run, protegido por CRON_SECRET.
 */
async function runDriveBackups(env: Env, ctx: ExecutionContext, utcHour: number) {
  if (!env.APP_URL) {
    console.log('[backup] APP_URL no configurado; se omite el respaldo a Drive');
    return;
  }

  // Fecha en zona Colombia (UTC-5) para "hoy" y "ayer".
  const nowCo = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const colombiaHour = nowCo.getUTCHours();
  const todayStr = nowCo.toISOString().split('T')[0];
  const yesterday = new Date(nowCo.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.CRON_SECRET) headers['X-Cron-Secret'] = env.CRON_SECRET;

  // Llama al Worker (rutas internas) sin salir a la red.
  const internal = async (path: string) => {
    const req = new Request(`https://internal/api/backup-internal${path}`, { headers });
    const res = await app.fetch(req, env, ctx);
    return (await res.json()) as { success: boolean; data?: any[] };
  };

  // Dispara el respaldo de un día concreto para un tenant, en Next.js.
  const triggerRun = async (userProfileId: string, date: string) => {
    try {
      const res = await fetch(`${env.APP_URL}/api/backup/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_profile_id: userProfileId, date }),
      });
      const json = await res.json().catch(() => ({}));
      console.log(`[backup] run ${userProfileId} ${date}:`, JSON.stringify(json));
    } catch (err) {
      console.error(`[backup] error al disparar ${userProfileId} ${date}:`, err);
    }
  };

  try {
    // Fase 1 - disparo puntual según la hora elegida por cada tienda.
    const hourStr = colombiaHour.toString().padStart(2, '0');
    const due = await internal(`/due?hour=${hourStr}`);
    for (const row of due.data || []) {
      await triggerRun(row.user_profile_id, todayStr);
    }

    // Fase 2 - verificación matutina (7 AM Colombia): reintenta las de ayer.
    if (colombiaHour === 7) {
      const pending = await internal(`/pending-yesterday?date=${yesterdayStr}`);
      for (const row of pending.data || []) {
        console.log(`[backup] reintento matutino de ${row.user_profile_id} para ${yesterdayStr}`);
        await triggerRun(row.user_profile_id, yesterdayStr);
      }
    }
  } catch (err) {
    console.error('[backup] error en runDriveBackups:', err);
  }
}

// Export default compatible con ambos fetch y scheduled
export default {
  fetch: app.fetch,
  scheduled,
};
