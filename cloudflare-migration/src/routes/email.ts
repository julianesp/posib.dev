/**
 * Email routes - Send automated marketing emails
 */

import { Hono } from 'hono';
import type { Env, AppEnv } from '../types';
import { sendEmail, logEmail } from '../utils/email';
import { getTenantChatIds, sendToChats } from '../utils/telegram';
import {
  buildOwnerEmail,
  buildOwnerTelegramMessage,
  daysUntilDue,
  shouldRemindCustomer,
  type DueDebtor,
} from '../utils/debt-reminders';
import {
  subscriptionReminderTemplate,
  dailyReportTemplate,
  stockAlertTemplate,
  abandonedCartTemplate,
} from '../utils/email-templates';

const app = new Hono<AppEnv>();

/**
 * CRON: Send subscription reminder emails
 * Trigger: Diariamente a las 9 AM
 */
app.post('/subscription-reminders', async (c) => {
  const db = c.env.DB;

  try {
    // UN solo correo por período, 3 días antes de que venza el trial o el plan
    // (antes salía cada día desde 7 días antes y cansaba al tendero). El cron
    // corre una vez al día, así que la ventana (2, 3] días coincide con una sola
    // corrida. En la app el aviso y el botón de pago siguen en el Panel de control.
    const users = await db
      .prepare(
        `SELECT id, clerk_user_id, email, full_name, subscription_status,
                trial_end_date, next_billing_date
         FROM user_profiles
         WHERE subscription_status IN ('trial', 'active')
           AND (
             (subscription_status = 'trial'
               AND julianday(trial_end_date) - julianday('now') > 2
               AND julianday(trial_end_date) - julianday('now') <= 3)
             OR (subscription_status = 'active'
               AND julianday(next_billing_date) - julianday('now') > 2
               AND julianday(next_billing_date) - julianday('now') <= 3)
           )`
      )
      .all();

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const user of users.results as any[]) {
      // Verificar preferencias de email
      const prefs = await db
        .prepare('SELECT * FROM email_preferences WHERE user_profile_id = ?')
        .bind(user.id)
        .first();

      if (prefs && !(prefs as any).subscription_reminders_enabled) {
        continue; // Usuario desactivó recordatorios
      }

      const expirationDate =
        user.subscription_status === 'trial'
          ? user.trial_end_date
          : user.next_billing_date;

      const daysLeft = Math.ceil(
        (new Date(expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const emailData = {
        user_name: user.full_name || user.email.split('@')[0],
        days_left: daysLeft,
        next_billing_date: expirationDate,
        plan_price: 24900,
        is_trial: user.subscription_status === 'trial',
        // Abre ePayco directo (ver app/dashboard/subscription/page.tsx, ?pagar=plan).
        payment_link: `https://posib.dev/dashboard/subscription?pagar=plan`,
      };

      const html = subscriptionReminderTemplate(emailData);

      const result = await sendEmail({
        to: user.email,
        toName: user.full_name,
        from: 'noreply@posib.dev',
        fromName: 'Tienda POS',
        subject: `⏰ Tu suscripción vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`,
        html,
      }, c.env.RESEND_API_KEY);

      if (result.success) {
        emailsSent++;
        await logEmail(
          db,
          user.id,
          'subscription_reminder',
          user.email,
          `Recordatorio de suscripción - ${daysLeft} días`,
          'sent',
          undefined,
          { days_left: daysLeft }
        );
      } else {
        emailsFailed++;
        await logEmail(
          db,
          user.id,
          'subscription_reminder',
          user.email,
          `Recordatorio de suscripción - ${daysLeft} días`,
          'failed',
          result.error
        );
      }
    }

    return c.json({
      success: true,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
      total_users: users.results.length,
    });
  } catch (error) {
    console.error('Error sending subscription reminders:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * CRON: Send daily report emails
 * Trigger: Según preferencias del usuario (configurado en email_preferences)
 */
app.post('/daily-reports', async (c) => {
  const db = c.env.DB;

  try {
    // Obtener hora actual en Colombia (UTC-5)
    const now = new Date();
    const colombiaTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const currentHour = colombiaTime.getUTCHours();
    const currentMinute = colombiaTime.getUTCMinutes();
    const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute
      .toString()
      .padStart(2, '0')}`;

    console.log('Daily reports check - Colombia time:', currentTime);

    // Obtener usuarios con reportes diarios activados para esta hora
    // Comparamos solo la hora (HH:00 a HH:59) para dar margen al CRON
    const targetHour = `${currentHour.toString().padStart(2, '0')}`;

    const prefs = await db
      .prepare(
        `SELECT ep.*, up.email, up.full_name, up.store_name
         FROM email_preferences ep
         JOIN user_profiles up ON ep.user_profile_id = up.id
         WHERE ep.daily_reports_enabled = 1
           AND substr(ep.daily_reports_time, 1, 2) = ?`
      )
      .bind(targetHour)
      .all();

    console.log(`Found ${prefs.results.length} users with daily reports enabled for hour ${targetHour}`);

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const pref of prefs.results as any[]) {
      // Obtener datos del reporte del día anterior
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Total de ventas
      const salesData = await db
        .prepare(
          `SELECT COUNT(*) as total_sales, SUM(total) as total_revenue
           FROM sales
           WHERE tenant_id = ?
             AND DATE(created_at) = ?
             AND status = 'completada'`
        )
        .bind(pref.user_profile_id, yesterdayStr)
        .first();

      // Top productos
      const topProducts = await db
        .prepare(
          `SELECT p.name, SUM(si.quantity) as quantity, SUM(si.subtotal) as revenue
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           JOIN products p ON si.product_id = p.id
           WHERE s.tenant_id = ?
             AND DATE(s.created_at) = ?
             AND s.status = 'completada'
           GROUP BY p.id, p.name
           ORDER BY revenue DESC
           LIMIT 5`
        )
        .bind(pref.user_profile_id, yesterdayStr)
        .all();

      // Productos con bajo stock
      const lowStock = await db
        .prepare(
          `SELECT name, stock as current_stock, min_stock
           FROM products
           WHERE tenant_id = ?
             AND stock <= min_stock AND COALESCE(track_inventory, 1) = 1
           ORDER BY (stock - min_stock) ASC
           LIMIT 5`
        )
        .bind(pref.user_profile_id)
        .all();

      const emailData = {
        store_name: pref.store_name || 'Tu Tienda',
        date: yesterdayStr,
        total_sales: (salesData as any)?.total_sales || 0,
        total_revenue: (salesData as any)?.total_revenue || 0,
        top_products: (topProducts.results as any[]) || [],
        low_stock_products: (lowStock.results as any[]) || [],
      };

      const html = dailyReportTemplate(emailData);

      const result = await sendEmail({
        to: pref.email,
        toName: pref.full_name,
        from: pref.from_email || 'noreply@posib.dev',
        fromName: pref.from_name || 'Tienda POS',
        subject: `📊 Reporte Diario - ${emailData.store_name} - ${new Date(
          yesterdayStr
        ).toLocaleDateString('es-CO')}`,
        html,
      }, c.env.RESEND_API_KEY);

      if (result.success) {
        emailsSent++;
        console.log(`✓ Daily report sent to ${pref.email}`);
        await logEmail(
          db,
          pref.user_profile_id,
          'daily_report',
          pref.email,
          'Reporte diario',
          'sent',
          undefined,
          { date: yesterdayStr, total_sales: emailData.total_sales }
        );
      } else {
        emailsFailed++;
        console.error(`✗ Failed to send daily report to ${pref.email}:`, result.error);
        await logEmail(
          db,
          pref.user_profile_id,
          'daily_report',
          pref.email,
          'Reporte diario',
          'failed',
          result.error
        );
      }
    }

    const response = {
      success: true,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
      total_prefs: prefs.results.length,
    };

    console.log('Daily reports result:', response);
    return c.json(response);
  } catch (error) {
    console.error('Error sending daily reports:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * CRON: Send stock alert emails
 * Trigger: Cuando un producto vuelve a tener stock
 */
app.post('/stock-alerts', async (c) => {
  const db = c.env.DB;

  try {
    // Obtener suscripciones pendientes donde el producto ahora tiene stock
    const subscriptions = await db
      .prepare(
        `SELECT sa.*, p.name as product_name, p.stock, p.image_url, up.store_slug, up.store_name
         FROM stock_alert_subscriptions sa
         JOIN products p ON sa.product_id = p.id
         JOIN user_profiles up ON sa.user_profile_id = up.id
         WHERE sa.notified = 0
           AND p.stock > 0`
      )
      .all();

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const sub of subscriptions.results as any[]) {
      // Verificar preferencias
      const prefs = await db
        .prepare('SELECT * FROM email_preferences WHERE user_profile_id = ?')
        .bind(sub.user_profile_id)
        .first();

      if (prefs && !(prefs as any).stock_alerts_enabled) {
        continue;
      }

      const productUrl = `https://posib.dev/store/${sub.store_slug}/product/${sub.product_id}`;

      const emailData = {
        product_name: sub.product_name,
        product_image: sub.image_url,
        product_url: productUrl,
        store_name: sub.store_name || 'Nuestra tienda',
      };

      const html = stockAlertTemplate(emailData);

      const result = await sendEmail({
        to: sub.customer_email,
        toName: sub.customer_name,
        from: (prefs as any)?.from_email || 'noreply@posib.dev',
        fromName: (prefs as any)?.from_name || sub.store_name || 'Tienda POS',
        subject: `✨ ${sub.product_name} está disponible!`,
        html,
      }, c.env.RESEND_API_KEY);

      if (result.success) {
        emailsSent++;

        // Marcar como notificado
        await db
          .prepare(
            'UPDATE stock_alert_subscriptions SET notified = 1, notified_at = ? WHERE id = ?'
          )
          .bind(new Date().toISOString(), sub.id)
          .run();

        await logEmail(
          db,
          sub.user_profile_id,
          'stock_alert',
          sub.customer_email,
          `Producto disponible: ${sub.product_name}`,
          'sent',
          undefined,
          { product_id: sub.product_id, product_name: sub.product_name }
        );
      } else {
        emailsFailed++;
        await logEmail(
          db,
          sub.user_profile_id,
          'stock_alert',
          sub.customer_email,
          `Producto disponible: ${sub.product_name}`,
          'failed',
          result.error
        );
      }
    }

    return c.json({
      success: true,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
      total_subscriptions: subscriptions.results.length,
    });
  } catch (error) {
    console.error('Error sending stock alerts:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * CRON: Send abandoned cart emails
 * Trigger: 1 hora, 24 horas, y 72 horas después del abandono
 */
app.post('/abandoned-carts', async (c) => {
  const db = c.env.DB;

  try {
    const now = new Date();
    let emailsSent = 0;
    let emailsFailed = 0;

    // Obtener carritos abandonados no recuperados
    const carts = await db
      .prepare(
        `SELECT ac.*, up.store_slug, up.store_name
         FROM abandoned_carts ac
         JOIN user_profiles up ON ac.user_profile_id = up.id
         WHERE ac.recovered = 0`
      )
      .all();

    for (const cart of carts.results as any[]) {
      // Verificar preferencias
      const prefs = await db
        .prepare('SELECT * FROM email_preferences WHERE user_profile_id = ?')
        .bind(cart.user_profile_id)
        .first();

      if (prefs && !(prefs as any).abandoned_cart_emails_enabled) {
        continue;
      }

      const abandonedAt = new Date(cart.abandoned_at);
      const hoursSinceAbandoned = (now.getTime() - abandonedAt.getTime()) / (1000 * 60 * 60);

      let emailNumber: 1 | 2 | 3 | null = null;

      // Primer email: 1 hora después
      if (hoursSinceAbandoned >= 1 && hoursSinceAbandoned < 2 && !cart.first_email_sent) {
        emailNumber = 1;
      }
      // Segundo email: 24 horas después
      else if (hoursSinceAbandoned >= 24 && hoursSinceAbandoned < 25 && !cart.second_email_sent) {
        emailNumber = 2;
      }
      // Tercer email: 72 horas después
      else if (hoursSinceAbandoned >= 72 && hoursSinceAbandoned < 73 && !cart.third_email_sent) {
        emailNumber = 3;
      }

      if (!emailNumber) continue;

      // Obtener items del carrito
      const items = await db
        .prepare(
          `SELECT p.name as product_name, ci.quantity, p.sale_price as price, p.image_url as image
           FROM cart_items ci
           JOIN products p ON ci.product_id = p.id
           WHERE ci.cart_id = ?`
        )
        .bind(cart.cart_id)
        .all();

      const cartUrl = `https://posib.dev/store/${cart.store_slug}/cart`;

      const emailData = {
        customer_name: cart.customer_name || 'Cliente',
        cart_items: items.results as any[],
        cart_total: cart.total_amount,
        discount_code: emailNumber === 2 ? 'CART10' : emailNumber === 3 ? 'CART15' : undefined,
        discount_percentage: emailNumber === 2 ? 10 : emailNumber === 3 ? 15 : undefined,
        cart_url: cartUrl,
        store_name: cart.store_name || 'Nuestra tienda',
      };

      const html = abandonedCartTemplate(emailData, emailNumber);

      const result = await sendEmail({
        to: cart.customer_email,
        toName: cart.customer_name,
        from: (prefs as any)?.from_email || 'noreply@posib.dev',
        fromName: (prefs as any)?.from_name || cart.store_name || 'Tienda POS',
        subject:
          emailNumber === 1
            ? '🛒 ¡Olvidaste algo en tu carrito!'
            : emailNumber === 2
            ? '⏰ Tu carrito te está esperando + 10% descuento'
            : '🎁 Última oportunidad - 15% descuento en tu carrito',
        html,
      }, c.env.RESEND_API_KEY);

      if (result.success) {
        emailsSent++;

        // Actualizar flag de email enviado
        const field =
          emailNumber === 1
            ? 'first_email_sent'
            : emailNumber === 2
            ? 'second_email_sent'
            : 'third_email_sent';

        await db
          .prepare(`UPDATE abandoned_carts SET ${field} = 1 WHERE id = ?`)
          .bind(cart.id)
          .run();

        await logEmail(
          db,
          cart.user_profile_id,
          'cart_abandoned',
          cart.customer_email,
          `Carrito abandonado - Email ${emailNumber}`,
          'sent',
          undefined,
          {
            cart_id: cart.cart_id,
            email_number: emailNumber,
            total: cart.total_amount,
          }
        );
      } else {
        emailsFailed++;
        await logEmail(
          db,
          cart.user_profile_id,
          'cart_abandoned',
          cart.customer_email,
          `Carrito abandonado - Email ${emailNumber}`,
          'failed',
          result.error
        );
      }
    }

    return c.json({
      success: true,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
      total_carts: carts.results.length,
    });
  } catch (error) {
    console.error('Error sending abandoned cart emails:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get email preferences for a user
 */
app.get('/preferences', async (c) => {
  const db = c.env.DB;
  const userProfileId = c.get('userProfileId');

  try {
    let prefs = await db
      .prepare('SELECT * FROM email_preferences WHERE user_profile_id = ?')
      .bind(userProfileId)
      .first();

    // Si no existen preferencias, crear por defecto
    if (!prefs) {
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO email_preferences (
            id, user_profile_id, daily_reports_enabled, daily_reports_time,
            subscription_reminders_enabled, stock_alerts_enabled, abandoned_cart_emails_enabled
          ) VALUES (?, ?, 1, '20:00', 1, 1, 1)`
        )
        .bind(id, userProfileId)
        .run();

      prefs = await db
        .prepare('SELECT * FROM email_preferences WHERE id = ?')
        .bind(id)
        .first();
    }

    return c.json({ success: true, data: prefs });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Update email preferences
 */
app.put('/preferences', async (c) => {
  const db = c.env.DB;
  const userProfileId = c.get('userProfileId');
  const body = await c.req.json();

  try {
    await db
      .prepare(
        `UPDATE email_preferences SET
          daily_reports_enabled = ?,
          daily_reports_time = ?,
          subscription_reminders_enabled = ?,
          stock_alerts_enabled = ?,
          abandoned_cart_emails_enabled = ?,
          offers_emails_enabled = ?,
          from_name = ?,
          from_email = ?
        WHERE user_profile_id = ?`
      )
      .bind(
        body.daily_reports_enabled ? 1 : 0,
        body.daily_reports_time || '20:00',
        body.subscription_reminders_enabled ? 1 : 0,
        body.stock_alerts_enabled ? 1 : 0,
        body.abandoned_cart_emails_enabled ? 1 : 0,
        body.offers_emails_enabled ? 1 : 0,
        body.from_name || null,
        body.from_email || null,
        userProfileId
      )
      .run();

    return c.json({ success: true, message: 'Preferencias actualizadas' });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get email logs for a user
 */
app.get('/logs', async (c) => {
  const db = c.env.DB;
  const userProfileId = c.get('userProfileId');
  const limit = c.req.query('limit') || '50';

  try {
    const logs = await db
      .prepare(
        `SELECT * FROM email_logs
         WHERE user_profile_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(userProfileId, parseInt(limit))
      .all();

    return c.json({ success: true, data: logs.results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * TEST: Send a test email
 */
app.post('/test', async (c) => {
  const db = c.env.DB;
  const userProfileId = c.get('userProfileId');

  try {
    // Obtener datos del usuario
    const user = await db
      .prepare('SELECT * FROM user_profiles WHERE id = ?')
      .bind(userProfileId)
      .first();

    if (!user) {
      return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
    }

    const userData = user as any;

    // Email de prueba simple
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .success { color: #10b981; font-size: 48px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>¡Email de Prueba!</h1>
            </div>
            <div class="content">
              <p class="success">✅</p>
              <h2>¡Hola ${userData.full_name || 'Usuario'}!</h2>
              <p>Este es un email de prueba para confirmar que tu configuración de emails está funcionando correctamente.</p>
              <p><strong>Tu sistema de emails automáticos está activo y listo para usar:</strong></p>
              <ul>
                <li>📊 Reportes diarios de ventas</li>
                <li>⏰ Recordatorios de suscripción</li>
                <li>📦 Alertas de stock</li>
                <li>🛒 Recuperación de carritos abandonados</li>
              </ul>
              <p>Si recibiste este email, significa que todo está funcionando perfectamente.</p>
              <p>¡Saludos!<br>Tu Tienda POS</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const result = await sendEmail({
      to: userData.email,
      toName: userData.full_name,
      from: 'noreply@posib.dev',
      fromName: 'Tienda POS - Prueba',
      subject: '✅ Email de Prueba - Tienda POS',
      html: testHtml,
    }, c.env.RESEND_API_KEY);

    if (result.success) {
      await logEmail(
        db,
        userProfileId,
        'general',
        userData.email,
        'Email de prueba',
        'sent'
      );

      return c.json({
        success: true,
        message: `Email de prueba enviado a ${userData.email}`,
      });
    } else {
      await logEmail(
        db,
        userProfileId,
        'general',
        userData.email,
        'Email de prueba',
        'failed',
        result.error
      );

      return c.json({
        success: false,
        error: result.error,
      }, 500);
    }
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get email statistics for a user
 */
app.get('/stats', async (c) => {
  const db = c.env.DB;
  const userProfileId = c.get('userProfileId');

  try {
    // Total de emails enviados
    const totalSent = await db
      .prepare(
        'SELECT COUNT(*) as count FROM email_logs WHERE user_profile_id = ? AND status = ?'
      )
      .bind(userProfileId, 'sent')
      .first();

    // Total de emails fallidos
    const totalFailed = await db
      .prepare(
        'SELECT COUNT(*) as count FROM email_logs WHERE user_profile_id = ? AND status = ?'
      )
      .bind(userProfileId, 'failed')
      .first();

    // Emails este mes
    const firstDayOfMonth = new Date();
    firstDayOfMonth.setDate(1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const thisMonth = await db
      .prepare(
        `SELECT COUNT(*) as count FROM email_logs
         WHERE user_profile_id = ?
         AND status = 'sent'
         AND created_at >= ?`
      )
      .bind(userProfileId, firstDayOfMonth.toISOString())
      .first();

    // Por tipo
    const byType = await db
      .prepare(
        `SELECT email_type as type, COUNT(*) as count
         FROM email_logs
         WHERE user_profile_id = ? AND status = 'sent'
         GROUP BY email_type
         ORDER BY count DESC`
      )
      .bind(userProfileId)
      .all();

    const sent = (totalSent as any)?.count || 0;
    const failed = (totalFailed as any)?.count || 0;
    const total = sent + failed;
    const successRate = total > 0 ? (sent / total) * 100 : 0;

    return c.json({
      success: true,
      data: {
        total_sent: sent,
        total_failed: failed,
        total_this_month: (thisMonth as any)?.count || 0,
        success_rate: successRate,
        by_type: byType.results,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Send email campaign
 */
app.post('/campaign', async (c) => {
  const db = c.env.DB;
  const userProfileId = c.get('userProfileId');
  const body = await c.req.json();

  try {
    const { name, subject, message, segment } = body;

    // Obtener lista de destinatarios según el segmento
    let query = 'SELECT email, name FROM customers WHERE tenant_id = ?';
    const params = [userProfileId];

    switch (segment) {
      case 'active':
        query += ' AND last_purchase_date >= date(\'now\', \'-30 days\')';
        break;
      case 'inactive':
        query += ' AND last_purchase_date < date(\'now\', \'-30 days\')';
        break;
      case 'vip':
        query += ' AND total_spent > 500000';
        break;
      case 'new':
        query += ' AND created_at >= date(\'now\', \'-30 days\')';
        break;
    }

    const recipients = await db.prepare(query).bind(...params).all();

    let emailsSent = 0;
    let emailsFailed = 0;

    // Obtener configuración del remitente
    const prefs = await db
      .prepare('SELECT * FROM email_preferences WHERE user_profile_id = ?')
      .bind(userProfileId)
      .first();

    for (const recipient of recipients.results as any[]) {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${subject}</h1>
              </div>
              <div class="content">
                <p>Hola ${recipient.name || 'Cliente'},</p>
                ${message.split('\n').map((line: string) => `<p>${line}</p>`).join('')}
              </div>
            </div>
          </body>
        </html>
      `;

      const result = await sendEmail(
        {
          to: recipient.email,
          toName: recipient.name,
          from: (prefs as any)?.from_email || 'noreply@posib.dev',
          fromName: (prefs as any)?.from_name || 'Tu Tienda',
          subject,
          html,
        },
        c.env.RESEND_API_KEY
      );

      if (result.success) {
        emailsSent++;
        await logEmail(
          db,
          userProfileId,
          'new_product_campaign',
          recipient.email,
          subject,
          'sent',
          undefined,
          { campaign_name: name }
        );
      } else {
        emailsFailed++;
        await logEmail(
          db,
          userProfileId,
          'new_product_campaign',
          recipient.email,
          subject,
          'failed',
          result.error,
          { campaign_name: name }
        );
      }
    }

    return c.json({
      success: true,
      recipients_count: recipients.results.length,
      emails_sent: emailsSent,
      emails_failed: emailsFailed,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * CRON: Recordatorios de fiado
 * Trigger: una vez al día, 8 AM hora Colombia (13h UTC, ver scheduled en index.ts)
 *
 * - Al CLIENTE (si tiene correo y la tienda no lo desactivó): faltando 3 días,
 *   el día que vence y, ya vencido, una vez por semana.
 * - Al TENDERO, por correo y por Telegram: los clientes a los que se les vence
 *   el fiado en 3 días o hoy (incluye clientes sin correo).
 */
app.post('/debt-reminders', async (c) => {
  const db = c.env.DB;

  // Ruta sin auth de Clerk (la llama el cron): sin el secret, cualquiera podría
  // disparar correos a los clientes de todas las tiendas. Sin secret, se niega.
  if (!c.env.CRON_SECRET || c.req.header('X-Cron-Secret') !== c.env.CRON_SECRET) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const stores = await db
      .prepare(
        `SELECT up.id, up.email, up.store_name, up.phone, up.telegram_chat_id, up.telegram_enabled,
                ep.debt_reminders_enabled
         FROM user_profiles up
         LEFT JOIN email_preferences ep ON ep.user_profile_id = up.id
         WHERE up.subscription_status IN ('active', 'trial')
           AND up.deleted_at IS NULL`
      )
      .all();

    const now = new Date();
    let customerEmailsSent = 0;
    let customerEmailsFailed = 0;
    let ownerEmailsSent = 0;
    let telegramSent = 0;

    for (const store of (stores.results as any[]) || []) {
      try {
        // Vencimiento más cercano entre los fiados pendientes de cada cliente
        const rows = await db
          .prepare(
            `SELECT c.id, c.name, c.email, c.phone, c.current_debt,
                    (SELECT MIN(s.due_date) FROM sales s
                     WHERE s.tenant_id = c.tenant_id
                       AND s.customer_id = c.id
                       AND s.payment_method = 'credito'
                       AND s.payment_status IN ('pendiente', 'parcial')
                       AND s.due_date IS NOT NULL) AS due_date
             FROM customers c
             WHERE c.tenant_id = ? AND c.current_debt > 0`
          )
          .bind(store.id)
          .all();

        const debtors: Array<DueDebtor & { id: string; email: string | null }> = [];
        for (const row of (rows.results as any[]) || []) {
          if (!row.due_date) continue;
          const days = daysUntilDue(row.due_date, now);
          if (days === null) continue;
          debtors.push({
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            debt: row.current_debt,
            days,
          });
        }
        if (debtors.length === 0) continue;

        const storeName = store.store_name || 'Tu tienda';

        // 1) Correo a cada cliente (activo salvo que la tienda lo apague)
        if (store.debt_reminders_enabled !== 0) {
          const { debtReminderTemplate } = await import('../utils/email-templates');
          for (const debtor of debtors) {
            if (!debtor.email || !shouldRemindCustomer(debtor.days)) continue;
            const isOverdue = debtor.days < 0;
            const amount = `$${Math.round(debtor.debt).toLocaleString('es-CO')}`;
            const subject = isOverdue
              ? `Recordatorio: Pago vencido - ${amount}`
              : debtor.days === 0
                ? `Recordatorio: Tu pago vence HOY - ${amount}`
                : `Recordatorio: Tu pago vence en ${debtor.days} días - ${amount}`;

            const result = await sendEmail(
              {
                to: debtor.email,
                toName: debtor.name,
                from: 'noreply@posib.dev',
                fromName: storeName,
                subject,
                html: debtReminderTemplate({
                  customer_name: debtor.name,
                  debt_amount: debtor.debt,
                  store_name: storeName,
                  store_phone: store.phone,
                  overdue_days: isOverdue ? Math.abs(debtor.days) : undefined,
                  days_until_due: !isOverdue ? debtor.days : undefined,
                  payment_methods: 'Efectivo, Transferencia, Tarjeta',
                }),
                replyTo: store.email,
              },
              c.env.RESEND_API_KEY
            );
            if (result.success) customerEmailsSent++;
            else customerEmailsFailed++;
            await safeLogEmail(db, store.id, debtor.email, subject, result, {
              kind: 'debt_reminder',
              customer_id: debtor.id,
              debt_amount: debtor.debt,
              days_until_due: debtor.days,
            });
          }
        }

        // 2) Aviso al tendero por correo
        const ownerEmail = buildOwnerEmail(debtors, storeName);
        if (ownerEmail && store.email) {
          const result = await sendEmail(
            {
              to: store.email,
              from: 'noreply@posib.dev',
              fromName: 'posib.dev',
              subject: ownerEmail.subject,
              html: ownerEmail.html,
            },
            c.env.RESEND_API_KEY
          );
          if (result.success) ownerEmailsSent++;
          await safeLogEmail(db, store.id, store.email, ownerEmail.subject, result, {
            kind: 'debt_due_owner_alert',
          });
        }

        // 3) Aviso al tendero por Telegram (dueño + destinatarios adicionales)
        const telegramMessage = buildOwnerTelegramMessage(debtors);
        if (
          telegramMessage &&
          c.env.TELEGRAM_BOT_TOKEN &&
          store.telegram_chat_id &&
          store.telegram_enabled === 1
        ) {
          const chatIds = await getTenantChatIds(db, store.id, store.telegram_chat_id);
          telegramSent += await sendToChats(chatIds, telegramMessage, c.env.TELEGRAM_BOT_TOKEN);
        }
      } catch (storeError) {
        console.error(`Error procesando recordatorios de fiado de la tienda ${store.id}:`, storeError);
      }
    }

    console.log(
      `Recordatorios de fiado: ${customerEmailsSent} a clientes (${customerEmailsFailed} fallidos), ${ownerEmailsSent} a tenderos, ${telegramSent} por Telegram`
    );

    return c.json({
      success: true,
      customerEmailsSent,
      customerEmailsFailed,
      ownerEmailsSent,
      telegramSent,
    });
  } catch (error) {
    console.error('Error en cron de recordatorios de deudas:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * email_logs.email_type tiene un CHECK sin 'debt_reminder' (migración 005), así
 * que estos correos se registran como 'general' con el tipo real en metadata.
 * Un fallo al registrar no debe cortar el envío de los demás.
 */
async function safeLogEmail(
  db: D1Database,
  storeId: string,
  recipient: string,
  subject: string,
  result: { success: boolean; error?: string },
  metadata: Record<string, unknown>
) {
  try {
    await logEmail(
      db,
      storeId,
      'general',
      recipient,
      subject,
      result.success ? 'sent' : 'failed',
      result.success ? undefined : result.error,
      metadata
    );
  } catch (error) {
    console.error('No se pudo registrar el correo en email_logs:', error);
  }
}

/**
 * Preferencia de la tienda: enviar o no los recordatorios de fiado a los
 * clientes. Ruta propia para no pisar las demás preferencias de correo.
 */
app.put('/preferences/debt-reminders', async (c) => {
  const db = c.env.DB;
  const tenant = c.get('tenant');
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled ? 1 : 0;

  try {
    const updated = await db
      .prepare('UPDATE email_preferences SET debt_reminders_enabled = ? WHERE user_profile_id = ?')
      .bind(enabled, tenant.id)
      .run();
    if (!updated.meta.changes) {
      await db
        .prepare(
          // Mismos valores por defecto que GET /preferences al crear la fila
          `INSERT INTO email_preferences (
            id, user_profile_id, daily_reports_enabled, daily_reports_time,
            subscription_reminders_enabled, stock_alerts_enabled, abandoned_cart_emails_enabled,
            debt_reminders_enabled
          ) VALUES (?, ?, 1, '20:00', 1, 1, 1, ?)`
        )
        .bind(crypto.randomUUID(), tenant.id, enabled)
        .run();
    }
    return c.json({ success: true, data: { enabled: enabled === 1 } });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

app.get('/preferences/debt-reminders', async (c) => {
  const db = c.env.DB;
  const tenant = c.get('tenant');
  try {
    const row = await db
      .prepare('SELECT debt_reminders_enabled FROM email_preferences WHERE user_profile_id = ?')
      .bind(tenant.id)
      .first<{ debt_reminders_enabled: number | null }>();
    return c.json({ success: true, data: { enabled: row?.debt_reminders_enabled !== 0 } });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

export default app;
