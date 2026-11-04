/**
 * Telegram routes
 *
 * 1. POST /api/telegram/webhook  — webhook público del bot. Telegram lo llama
 *    con cada mensaje. Procesamos `/start <código>` para vincular el chat del
 *    tendero con su tenant (guarda telegram_chat_id).
 * 2. POST /api/telegram/expiration-alerts — tarea interna disparada por el cron
 *    horario. Revisa productos próximos a vencer (≤30 días) y avisa por Telegram
 *    SOLO la primera vez que un producto entra en el umbral.
 *
 * El webhook debe montarse ANTES del authMiddleware (Telegram no envía JWT de
 * Clerk); se protege verificando el secret token de Telegram.
 */

import { Hono } from 'hono';
import type { Env, AppEnv } from '../types';
import { sendTelegramMessage, escapeTelegramHtml, getTenantChatIds, sendToChats } from '../utils/telegram';

const app = new Hono<AppEnv>();

// Umbral de "próximo a vencer": mismo que el front (lib/expiration-helpers.ts)
const EXPIRATION_WARNING_DAYS = 30;

/**
 * Días completos entre hoy y una fecha (negativo si ya pasó).
 * Compara a nivel de fecha para evitar desfases por hora/zona.
 */
function daysUntil(dateStr: string): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = new Date(dateStr);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/**
 * Devuelve todos los chat_ids que deben recibir notificaciones de un tenant:
 * el dueño (user_profiles.telegram_chat_id) + los destinatarios adicionales
 * activos (telegram_recipients). Deduplica por si algún chat está repetido.
 *
 * @param ownerChatId chat_id del dueño (puede venir null si no conectó).
 */

/**
 * Webhook del bot de Telegram. Procesa el comando /start <código> para
 * vincular el chat del usuario con el tenant cuyo telegram_link_code coincide.
 */
app.post('/webhook', async (c) => {
  // Verificación del secret token de Telegram (se configura al registrar el
  // webhook con setWebhook?secret_token=...). Evita que terceros llamen aquí.
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (got !== expectedSecret) {
      return c.json({ ok: true }); // respondemos 200 pero ignoramos
    }
  }

  try {
    const update = await c.req.json<any>();
    const message = update?.message;
    const text: string | undefined = message?.text;
    const chatId = message?.chat?.id;

    if (!text || !chatId) {
      return c.json({ ok: true });
    }

    const botToken = c.env.TELEGRAM_BOT_TOKEN;

    // Comando /start [código]
    if (text.startsWith('/start')) {
      const parts = text.trim().split(/\s+/);
      const code = parts[1];

      if (!code) {
        await sendTelegramMessage(
          String(chatId),
          '👋 ¡Hola! Para recibir alertas de tu tienda, entra a posib.dev → Configuración → Telegram y toca <b>Conectar</b>. Luego pega aquí el código que te muestra.',
          botToken
        );
        return c.json({ ok: true });
      }

      const now = new Date().toISOString();

      // 1) ¿Es el código del dueño? (user_profiles)
      const profile = await c.env.DB
        .prepare('SELECT id FROM user_profiles WHERE telegram_link_code = ?')
        .bind(code)
        .first<any>();

      if (profile) {
        await c.env.DB
          .prepare(
            'UPDATE user_profiles SET telegram_chat_id = ?, telegram_link_code = NULL, telegram_enabled = 1, updated_at = ? WHERE id = ?'
          )
          .bind(String(chatId), now, profile.id)
          .run();

        await sendTelegramMessage(
          String(chatId),
          '✅ ¡Listo! Tu tienda quedó conectada. Te avisaré aquí cuando tengas productos próximos a vencer y un resumen diario de tu tienda. 🧀🍞',
          botToken
        );
        return c.json({ ok: true });
      }

      // 2) ¿Es el código de un destinatario adicional? (telegram_recipients)
      const recipient = await c.env.DB
        .prepare('SELECT id, name FROM telegram_recipients WHERE link_code = ?')
        .bind(code)
        .first<any>();

      if (recipient) {
        await c.env.DB
          .prepare(
            'UPDATE telegram_recipients SET chat_id = ?, link_code = NULL, enabled = 1, updated_at = ? WHERE id = ?'
          )
          .bind(String(chatId), now, recipient.id)
          .run();

        await sendTelegramMessage(
          String(chatId),
          `✅ ¡Listo! Quedaste conectado a las alertas de la tienda. Recibirás aquí el resumen diario y los avisos de productos por vencer. 🧀🍞`,
          botToken
        );
        return c.json({ ok: true });
      }

      // Código no encontrado en ninguna de las dos tablas
      await sendTelegramMessage(
        String(chatId),
        '❌ El código no es válido o ya expiró. Genera uno nuevo desde posib.dev → Configuración → Telegram.',
        botToken
      );
      return c.json({ ok: true });
    }

    // Cualquier otro mensaje: ayuda breve
    await sendTelegramMessage(
      String(chatId),
      'Soy el bot de alertas de <b>posib.dev</b>. Te aviso de productos próximos a vencer. Si aún no conectaste tu tienda, usa el código de posib.dev → Configuración → Telegram.',
      botToken
    );
    return c.json({ ok: true });
  } catch (error) {
    console.error('Error en webhook de Telegram:', error);
    // Siempre 200 para que Telegram no reintente en bucle
    return c.json({ ok: true });
  }
});

/**
 * CRON: avisa por Telegram de productos próximos a vencer.
 * Recorre los tenants con Telegram conectado y activo, busca sus productos
 * que vencen dentro del umbral (con stock y sin haber sido notificados aún),
 * y envía UN mensaje resumido por tenant. Registra lo notificado para no repetir.
 */
app.post('/expiration-alerts', async (c) => {
  const db = c.env.DB;
  const botToken = c.env.TELEGRAM_BOT_TOKEN;

  // Esta ruta es pública (montada antes del authMiddleware) porque la dispara el
  // cron sin JWT de Clerk. Si CRON_SECRET está configurado, exigirlo para evitar
  // que terceros la invoquen. El cron interno pasa la cabecera X-Cron-Secret.
  if (c.env.CRON_SECRET) {
    const provided = c.req.header('X-Cron-Secret');
    if (provided !== c.env.CRON_SECRET) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
  }

  if (!botToken) {
    return c.json({ success: false, error: 'TELEGRAM_BOT_TOKEN not configured' }, 200);
  }

  try {
    // Tenants con Telegram conectado y activo
    const tenants = await db
      .prepare(
        `SELECT id, telegram_chat_id
         FROM user_profiles
         WHERE telegram_chat_id IS NOT NULL AND telegram_enabled = 1`
      )
      .all();

    let messagesSent = 0;
    let productsNotified = 0;

    for (const tenant of (tenants.results as any[]) || []) {
      // Productos por vencer del tenant (con stock, aún no vencidos), que NO
      // tengan ya un registro de notificación para su fecha actual.
      const products = await db
        .prepare(
          `SELECT p.id, p.name, p.stock, p.sale_price, p.expiration_date
           FROM products p
           LEFT JOIN expiration_notifications en
             ON en.product_id = p.id AND en.expiration_date = p.expiration_date
           WHERE p.tenant_id = ?
             AND p.expiration_date IS NOT NULL
             AND p.stock > 0
             AND date(p.expiration_date) >= date('now')
             AND date(p.expiration_date) <= date('now', '+${EXPIRATION_WARNING_DAYS} days')
             AND en.id IS NULL`
        )
        .bind(tenant.id)
        .all();

      const list = (products.results as any[]) || [];
      if (list.length === 0) continue;

      // Ordenar por urgencia (más próximos primero)
      list.sort((a, b) => daysUntil(a.expiration_date) - daysUntil(b.expiration_date));

      // Construir el mensaje
      const lines = list.map((p) => {
        const days = daysUntil(p.expiration_date);
        const when = days === 0 ? 'vence hoy' : days === 1 ? 'vence mañana' : `vence en ${days} días`;
        return `• <b>${escapeTelegramHtml(p.name)}</b> — ${when} (stock ${p.stock})`;
      });

      const header =
        list.length === 1
          ? '⚠️ Tienes <b>1 producto</b> próximo a vencer:'
          : `⚠️ Tienes <b>${list.length} productos</b> próximos a vencer:`;

      const message =
        `${header}\n\n${lines.join('\n')}\n\n` +
        '💡 Ponlos en promoción desde posib.dev → Ofertas para venderlos antes de que se venzan.';

      // Enviar al dueño + destinatarios adicionales (empleada, etc.)
      const chatIds = await getTenantChatIds(db, tenant.id, tenant.telegram_chat_id);
      const sent = await sendToChats(chatIds, message, botToken);

      if (sent > 0) {
        messagesSent += sent;

        // Registrar cada producto como notificado (idempotente por índice único).
        // Se marca una sola vez por producto, no por destinatario.
        const now = new Date().toISOString();
        for (const p of list) {
          const id = crypto.randomUUID();
          await db
            .prepare(
              `INSERT OR IGNORE INTO expiration_notifications
                 (id, tenant_id, product_id, expiration_date, notified_at)
               VALUES (?, ?, ?, ?, ?)`
            )
            .bind(id, tenant.id, p.id, p.expiration_date, now)
            .run();
          productsNotified++;
        }
      }
    }

    return c.json({ success: true, messagesSent, productsNotified });
  } catch (error) {
    console.error('Error en expiration-alerts de Telegram:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      200
    );
  }
});

/**
 * Formatea un número como pesos colombianos sin decimales (ej. "$1.234.500").
 */
function formatCOP(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

/**
 * Nombre legible de un plan a partir de su planId (para los avisos al admin).
 * Los ids son estables (ver lib/business-types.ts y lib/epayco.ts en el front).
 */
function planLabel(planId: string): string {
  const map: Record<string, string> = {
    'plan-abarrotes-monthly': 'Plan Abarrotes / Minimercado',
    'plan-papeleria-monthly': 'Plan Papelería',
    'plan-comidas-rapidas-monthly': 'Plan Comidas rápidas / Pizzería',
    'plan-licorera-monthly': 'Plan Licorera / Estanco',
    'plan-farmacia-monthly': 'Plan Farmacia / Droguería',
    'basic-monthly': 'Plan Básico',
    'ai-addon-monthly': 'Complemento: Análisis con IA',
    'addon-store-monthly': 'Complemento: Tienda Online',
    'store-addon-monthly': 'Complemento: Tienda Online',
    'email-addon-monthly': 'Complemento: Email Marketing',
  };
  return map[planId] || planId;
}

/**
 * POST /api/telegram/admin-payment — aviso al administrador de que un cliente
 * pagó. Lo dispara el webhook de ePayco del front (best-effort) tras activar la
 * suscripción. Se envía a los superadmins que tengan Telegram conectado.
 *
 * Es una ruta pública (montada antes del authMiddleware, igual que las demás de
 * este archivo) protegida por el secret del webhook. El front la llama con la
 * cabecera X-Webhook-Secret: CRON_SECRET (mismo secret que ya usa para el PUT
 * de user-profiles). Responde 200 aun ante errores para no provocar reintentos.
 */
app.post('/admin-payment', async (c) => {
  const db = c.env.DB;
  const botToken = c.env.TELEGRAM_BOT_TOKEN;

  // Protección: exigir el secret del webhook si está configurado. Aceptamos
  // tanto X-Webhook-Secret (lo que manda el webhook de ePayco) como
  // X-Cron-Secret (convención de las tareas internas), ambos contra CRON_SECRET.
  if (c.env.CRON_SECRET) {
    const provided =
      c.req.header('X-Webhook-Secret') || c.req.header('X-Cron-Secret');
    if (provided !== c.env.CRON_SECRET) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
  }

  if (!botToken) {
    return c.json({ success: false, error: 'TELEGRAM_BOT_TOKEN not configured' }, 200);
  }

  try {
    const body = await c.req.json<{
      userProfileId?: string;
      planId?: string;
      isAddon?: boolean;
      amount?: string | number;
    }>();

    const { userProfileId, planId, isAddon } = body;
    const amountNum =
      typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? '0'));

    // Datos del cliente que pagó (para dar contexto en el aviso).
    let buyerLine = '';
    if (userProfileId) {
      const buyer = await db
        .prepare('SELECT email, full_name, store_name FROM user_profiles WHERE id = ?')
        .bind(userProfileId)
        .first<{ email: string; full_name: string | null; store_name: string | null }>();
      if (buyer) {
        const who = buyer.store_name || buyer.full_name || buyer.email;
        buyerLine = `\n👤 <b>${escapeTelegramHtml(who)}</b>\n✉️ ${escapeTelegramHtml(buyer.email)}`;
      }
    }

    const concepto = planId ? planLabel(planId) : isAddon ? 'Complemento' : 'Suscripción';

    const message =
      `💰 <b>¡Nuevo pago recibido!</b>\n` +
      `\n🧾 ${escapeTelegramHtml(concepto)}` +
      (amountNum > 0 ? `\n💵 ${formatCOP(amountNum)}` : '') +
      buyerLine +
      `\n\nLa cuenta ya quedó activa automáticamente.`;

    // Destinatarios: superadmins con Telegram conectado y activo.
    const admins = await db
      .prepare(
        `SELECT telegram_chat_id
         FROM user_profiles
         WHERE is_superadmin = 1
           AND telegram_chat_id IS NOT NULL
           AND telegram_enabled = 1`
      )
      .all();

    const chatIds = ((admins.results as any[]) || [])
      .map((r) => r.telegram_chat_id as string)
      .filter(Boolean);

    if (chatIds.length === 0) {
      return c.json({ success: true, messagesSent: 0, note: 'No hay superadmin con Telegram conectado' });
    }

    const sent = await sendToChats(chatIds, message, botToken);
    return c.json({ success: true, messagesSent: sent });
  } catch (error) {
    console.error('Error en admin-payment de Telegram:', error);
    // 200 para que el webhook del front no lo trate como fallo.
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      200
    );
  }
});

/**
 * CRON: resumen diario por Telegram. Agrupa en UN solo mensaje por tenant:
 *  - Ventas del día anterior (total y # de órdenes) + top productos
 *  - Productos con stock bajo / agotados
 *  - Fiado por cobrar (clientes con deuda y total)
 *  - Aviso de suscripción próxima a vencer
 *
 * Se envía una vez al día. Se omiten las secciones sin datos; si no hay nada
 * relevante, no se envía mensaje (para no molestar en días tranquilos).
 */
app.post('/daily-summary', async (c) => {
  const db = c.env.DB;
  const botToken = c.env.TELEGRAM_BOT_TOKEN;

  if (c.env.CRON_SECRET) {
    const provided = c.req.header('X-Cron-Secret');
    if (provided !== c.env.CRON_SECRET) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
  }
  if (!botToken) {
    return c.json({ success: false, error: 'TELEGRAM_BOT_TOKEN not configured' }, 200);
  }

  try {
    const tenants = await db
      .prepare(
        `SELECT id, telegram_chat_id, subscription_status, trial_end_date, next_billing_date
         FROM user_profiles
         WHERE telegram_chat_id IS NOT NULL AND telegram_enabled = 1`
      )
      .all();

    // Fecha de "ayer" en zona horaria de Colombia (UTC-5). created_at se guarda
    // en UTC, así que un día Colombia [00:00, 24:00) UTC-5 equivale al rango
    // [date 05:00 UTC, date+1 05:00 UTC). Usamos ese rango para que el resumen
    // coincida con las "Ventas de Hoy" del dashboard (que corta a medianoche
    // hora Colombia), en vez de DATE(created_at) que agrupa por fecha UTC.
    const nowBogota = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const yesterdayStr = new Date(nowBogota.getTime() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const dayStartUtc = `${yesterdayStr}T05:00:00.000Z`;
    const dayEndUtc = new Date(new Date(`${yesterdayStr}T05:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000)
      .toISOString();

    let messagesSent = 0;

    for (const tenant of (tenants.results as any[]) || []) {
      const sections: string[] = [];

      // 1) Ventas del día anterior + top productos
      const salesData = await db
        .prepare(
          `SELECT COUNT(*) as total_sales, COALESCE(SUM(total), 0) as total_revenue
           FROM sales
           WHERE tenant_id = ? AND created_at >= ? AND created_at < ? AND status = 'completada'`
        )
        .bind(tenant.id, dayStartUtc, dayEndUtc)
        .first<any>();

      if (salesData && salesData.total_sales > 0) {
        const top = await db
          .prepare(
            `SELECT p.name, SUM(si.quantity) as qty
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             JOIN products p ON si.product_id = p.id
             WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ? AND s.status = 'completada'
             GROUP BY p.id, p.name
             ORDER BY qty DESC
             LIMIT 3`
          )
          .bind(tenant.id, dayStartUtc, dayEndUtc)
          .all();

        let ventas = `📊 <b>Ventas de ayer</b>\n${formatCOP(salesData.total_revenue)} en ${salesData.total_sales} ${salesData.total_sales === 1 ? 'venta' : 'ventas'}`;
        const topList = (top.results as any[]) || [];
        if (topList.length > 0) {
          ventas +=
            '\nMás vendidos: ' +
            topList.map((p) => `${escapeTelegramHtml(p.name)} (${p.qty})`).join(', ');
        }
        sections.push(ventas);
      }

      // 2) Stock bajo / agotado
      const lowStock = await db
        .prepare(
          `SELECT name, stock FROM products
           WHERE tenant_id = ? AND stock <= min_stock AND COALESCE(track_inventory, 1) = 1
           ORDER BY stock ASC LIMIT 8`
        )
        .bind(tenant.id)
        .all();
      const lowList = (lowStock.results as any[]) || [];
      if (lowList.length > 0) {
        const lines = lowList.map((p) => {
          const estado = p.stock <= 0 ? 'agotado' : `quedan ${p.stock}`;
          return `• ${escapeTelegramHtml(p.name)} — ${estado}`;
        });
        sections.push(`📦 <b>Stock por reponer</b>\n${lines.join('\n')}`);
      }

      // 3) Fiado por cobrar
      const debt = await db
        .prepare(
          `SELECT COUNT(*) as num, COALESCE(SUM(current_debt), 0) as total
           FROM customers
           WHERE tenant_id = ? AND current_debt > 0`
        )
        .bind(tenant.id)
        .first<any>();
      if (debt && debt.num > 0) {
        sections.push(
          `💰 <b>Fiado por cobrar</b>\nTe deben ${formatCOP(debt.total)} entre ${debt.num} ${debt.num === 1 ? 'cliente' : 'clientes'}`
        );
      }

      // 4) Suscripción próxima a vencer (≤5 días)
      const refDate =
        tenant.subscription_status === 'trial'
          ? tenant.trial_end_date
          : tenant.next_billing_date;
      if (refDate) {
        const days = daysUntil(refDate);
        if (days >= 0 && days <= 5) {
          const cuando = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
          sections.push(
            `⏰ <b>Tu plan vence ${cuando}</b>\nRenueva en posib.dev → Suscripción para no perder el servicio.`
          );
        }
      }

      // Si no hay nada que reportar, no enviamos mensaje ese día
      if (sections.length === 0) continue;

      const message = `☀️ <b>Resumen de tu tienda</b>\n\n${sections.join('\n\n')}`;
      // Enviar al dueño + destinatarios adicionales (empleada, etc.)
      const chatIds = await getTenantChatIds(db, tenant.id, tenant.telegram_chat_id);
      messagesSent += await sendToChats(chatIds, message, botToken);
    }

    return c.json({ success: true, messagesSent });
  } catch (error) {
    console.error('Error en daily-summary de Telegram:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      200
    );
  }
});

/**
 * POST /api/telegram/store-notice - Aviso de posib al DUEÑO de una tienda (no a
 * sus destinatarios adicionales), p. ej. "activa el domicilio". Ruta interna:
 * exige X-Cron-Secret = CRON_SECRET (obligatorio). Body: { store_slug, message }
 * con el mensaje en HTML de Telegram.
 */
app.post('/store-notice', async (c) => {
  if (!c.env.CRON_SECRET || c.req.header('X-Cron-Secret') !== c.env.CRON_SECRET) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json<{ store_slug?: string; message?: string }>().catch(() => ({}) as { store_slug?: string; message?: string });
  if (!body.store_slug || !body.message?.trim()) {
    return c.json({ success: false, error: 'store_slug y message son obligatorios' }, 400);
  }
  const owner = await c.env.DB.prepare(
    'SELECT telegram_chat_id, telegram_enabled FROM user_profiles WHERE store_slug = ?'
  )
    .bind(body.store_slug)
    .first<{ telegram_chat_id: string | null; telegram_enabled: number | null }>();
  if (!owner?.telegram_chat_id || !owner.telegram_enabled) {
    return c.json({ success: false, error: 'La tienda no tiene Telegram conectado' }, 404);
  }
  const result = await sendTelegramMessage(owner.telegram_chat_id, body.message, c.env.TELEGRAM_BOT_TOKEN);
  return c.json({ success: result.success, ...(result.success ? {} : { error: result.error }) }, result.success ? 200 : 502);
});

export default app;
