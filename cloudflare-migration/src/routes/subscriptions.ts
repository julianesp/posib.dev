/**
 * Suscripciones del SaaS: aviso de pruebas/planes por vencer.
 * Los pagos de planes y complementos van por ePayco (Next:
 * /api/subscription/create-payment y lib/epayco-activation.ts).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';


const app = new Hono<AppEnv>();

/**
 * POST /api/subscriptions/check-expiring
 * CRON job para verificar suscripciones próximas a expirar
 * y enviar notificaciones de recordatorio
 */
app.post('/check-expiring', async (c) => {
  try {
    // Verificar autorización del CRON
    const authHeader = c.req.header('Authorization');
    const cronSecret = c.env.CRON_SECRET;

    if (!authHeader || !cronSecret || !authHeader.includes(cronSecret)) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const now = new Date();
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Buscar usuarios con trial que expira en 3 días
    const expiringTrials = await c.env.DB.prepare(
      `SELECT id, email, full_name, trial_end_date, clerk_user_id
       FROM user_profiles
       WHERE subscription_status = 'trial'
         AND trial_end_date IS NOT NULL
         AND date(trial_end_date) = date(?, 'unixepoch')`
    )
      .bind(Math.floor(threeDaysFromNow.getTime() / 1000))
      .all();

    // Buscar usuarios con suscripción activa que vence en 3 días
    const expiringSubscriptions = await c.env.DB.prepare(
      `SELECT id, email, full_name, next_billing_date, clerk_user_id
       FROM user_profiles
       WHERE subscription_status = 'active'
         AND next_billing_date IS NOT NULL
         AND date(next_billing_date) = date(?, 'unixepoch')`
    )
      .bind(Math.floor(threeDaysFromNow.getTime() / 1000))
      .all();

    const notificationsToSend = [
      ...expiringTrials.results.map((user: any) => ({
        userId: user.clerk_user_id,
        email: user.email,
        type: 'trial_expiring',
        daysLeft: 3,
      })),
      ...expiringSubscriptions.results.map((user: any) => ({
        userId: user.clerk_user_id,
        email: user.email,
        type: 'subscription_expiring',
        daysLeft: 3,
      })),
    ];

    console.log(`Found ${notificationsToSend.length} users to notify`);

    // Aquí podrías integrar con un servicio de email (SendGrid, Resend, etc.)
    // Por ahora, solo registramos los usuarios que deberían recibir notificación

    // Guardar notificaciones en una tabla de logs (opcional)
    for (const notification of notificationsToSend) {
      console.log(`Notification needed for ${notification.email}: ${notification.type}`);
      // TODO: Enviar email real con SendGrid/Resend
    }

    return c.json({
      success: true,
      notificationsSent: notificationsToSend.length,
      expiringTrials: expiringTrials.results.length,
      expiringSubscriptions: expiringSubscriptions.results.length,
    });

  } catch (error: any) {
    console.error('Error checking expiring subscriptions:', error);
    return c.json({
      success: false,
      error: error.message || 'Failed to check expiring subscriptions',
    }, 500);
  }
});

export default app;
