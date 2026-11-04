/**
 * Webhooks API Routes
 * Procesa webhooks de servicios externos (Wompi, etc.)
 */

import { Hono } from 'hono';
import type { Env, APIResponse, AppEnv } from '../types';

const app = new Hono<AppEnv>();

// (Se quitó GET /wompi/config: devolvía en público el secreto de eventos.)

/**
 * Lo que dice WOMPI de una transacción, consultado a su API: el cuerpo del
 * webhook no se usa como prueba de pago (cualquiera con el secreto podía
 * fingir un "APPROVED" y activarse un plan). null si Wompi no la conoce.
 */
export async function fetchWompiTransaction(
  transactionId: string,
  env: { WOMPI_PUBLIC_KEY?: string }
): Promise<{ id: string; status: string; amount_in_cents: number; reference: string; payment_method_type?: string } | null> {
  if (!transactionId || !/^[\w-]+$/.test(transactionId)) return null;
  const res = await fetch(`https://production.wompi.co/v1/transactions/${encodeURIComponent(transactionId)}`, {
    headers: env.WOMPI_PUBLIC_KEY ? { Authorization: `Bearer ${env.WOMPI_PUBLIC_KEY}` } : {},
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
  const t = body?.data;
  if (!t || typeof t.id !== 'string' || typeof t.status !== 'string' || typeof t.reference !== 'string') return null;
  return {
    id: t.id,
    status: t.status,
    amount_in_cents: Number(t.amount_in_cents) || 0,
    reference: t.reference,
    payment_method_type: typeof t.payment_method_type === 'string' ? t.payment_method_type : undefined,
  };
}

// POST /api/webhooks/wompi - Procesar webhook de Wompi
app.post('/wompi', async (c) => {
  try {
    const webhookSecret = c.req.header('X-Webhook-Secret');
    const expectedSecret = c.env.WOMPI_EVENTS_SECRET;

    // Verificar el secret del webhook (sin valor por defecto en el código)
    if (!expectedSecret || webhookSecret !== expectedSecret) {
      console.error('❌ Invalid webhook secret');
      return c.json<APIResponse>({
        success: false,
        error: 'Invalid webhook secret',
      }, 401);
    }

    const event = await c.req.json();

    console.log('📨 Wompi webhook event received:', event.event);
    console.log('Transaction data:', event.data);

    // 🔄 REENVIAR EVENTO A NEURAI.DEV
    // Neurai.dev ya tiene configurado este webhook y debe seguir funcionando
    try {
      console.log('📤 Forwarding event to Neurai.dev...');
      const neuraiResponse = await fetch('https://neurai.dev/api/payments/confirmation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': expectedSecret,
        },
        body: JSON.stringify(event),
      });

      if (neuraiResponse.ok) {
        console.log('✅ Event forwarded to Neurai.dev successfully');
      } else {
        console.warn(`⚠️ Failed to forward to Neurai.dev: ${neuraiResponse.status}`);
      }
    } catch (error) {
      console.error('❌ Error forwarding to Neurai.dev:', error);
      // No fallar si Neurai no responde, continuar procesando para tienda-pos
    }

    // Procesar según el tipo de evento
    if (event.event === 'transaction.updated') {
      const transaction = event.data?.transaction ?? {};
      const payment_link_id = transaction.payment_link_id;

      // Pedidos de la tienda pagados con link de Wompi: descartado (la tienda
      // cobra por Nequi con referencia). No se marca nada como pagado.
      if (payment_link_id) {
        console.warn(`⚠️ Evento de payment link ${payment_link_id} ignorado: Wompi en la tienda está desactivado`);
        return c.json<APIResponse>({ success: true, message: 'Payment links are disabled; event ignored' });
      }

      // Estado, monto y referencia salen de la API de Wompi, no del aviso.
      const verified = await fetchWompiTransaction(String(transaction.id ?? ''), c.env);
      if (!verified) {
        console.error('❌ Wompi no confirma la transacción del aviso:', transaction.id);
        return c.json<APIResponse>({ success: false, error: 'Transaction not found in Wompi' }, 404);
      }
      const { id, status, reference, amount_in_cents, payment_method_type } = verified;

      console.log(`🔄 Processing transaction ${id} with status: ${status}`);
      console.log(`Reference: ${reference}, Payment Link ID: ${payment_link_id}`);

      // 💳 PROCESAR SUSCRIPCIÓN O ADDON (transacciones directas, no de payment links)
      // Determinar el tipo de transacción según el reference
      // - Suscripciones: SUB-{primeros8chars}-{timestamp} o SUBSCRIPTION-{planId}-{userId}-{timestamp}
      // - Addons: ADDON-{addonId}-{userId}-{timestamp}
      const referenceParts = reference.split('-');
      const transactionType = referenceParts[0]; // SUB, SUBSCRIPTION, o ADDON

      if (referenceParts.length < 2 || !['SUB', 'SUBSCRIPTION', 'ADDON'].includes(transactionType)) {
        console.error('❌ Invalid reference format:', reference);
        return c.json<APIResponse>({
          success: true,
          message: 'Transaction received but not processed (unknown type)',
        });
      }

      // Extraer el userId del reference
      let userId = '';
      if (transactionType === 'SUB') {
        // SUB-{primeros8chars}-{timestamp}
        userId = referenceParts[1]; // Primeros 8 caracteres
      } else if (transactionType === 'SUBSCRIPTION' || transactionType === 'ADDON') {
        // SUBSCRIPTION-{planId}-{userId}-{timestamp} o ADDON-{addonId}-{userId}-{timestamp}
        userId = referenceParts[2]; // userId completo
      }

      // Buscar el user_profile
      const userProfileResult = await c.env.DB.prepare(
        `SELECT id, email, subscription_status, has_ai_addon, has_store_addon, has_email_addon FROM user_profiles WHERE id LIKE ?`
      ).bind(`${userId}%`).first<{
        id: string;
        email: string;
        subscription_status: string;
        has_ai_addon: number;
        has_store_addon: number;
        has_email_addon: number;
      }>();

      if (!userProfileResult) {
        console.error('❌ User profile not found for reference:', reference);
        return c.json<APIResponse>({
          success: false,
          error: 'User profile not found',
        }, 404);
      }

      console.log(`✅ Found user profile: ${userProfileResult.id} (${userProfileResult.email})`);

      // Verificar si ya existe la transacción
      const existingTransaction = await c.env.DB.prepare(
        `SELECT id FROM payment_transactions WHERE wompi_transaction_id = ?`
      ).bind(id).first();

      // Crear o actualizar la transacción
      if (!existingTransaction) {
        const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const now = new Date().toISOString();

        await c.env.DB.prepare(
          `INSERT INTO payment_transactions (
            id, user_profile_id, wompi_transaction_id, amount, currency,
            status, payment_method_type, reference, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          transactionId,
          userProfileResult.id,
          id,
          amount_in_cents / 100,
          'COP',
          status,
          payment_method_type || 'unknown',
          reference,
          now
        ).run();

        console.log(`✅ Payment transaction created: ${transactionId}`);
      } else {
        // Actualizar estado de transacción existente
        await c.env.DB.prepare(
          `UPDATE payment_transactions SET status = ? WHERE wompi_transaction_id = ?`
        ).bind(status, id).run();

        console.log(`✅ Payment transaction updated: ${id}`);
      }

      // Si el pago fue aprobado, activar la suscripción
      if (status === 'APPROVED') {
        const now = new Date();
        const nextBillingDate = new Date(now);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

        // Determinar qué activar basado en el tipo de transacción y monto
        const amountCOP = amount_in_cents / 100;
        let planId = userProfileResult.subscription_status === 'trial' ? null : 'basic-monthly';
        let hasAIAddon = userProfileResult.has_ai_addon;
        let hasStoreAddon = userProfileResult.has_store_addon;
        let hasEmailAddon = userProfileResult.has_email_addon;
        let updateSubscriptionStatus = false;

        // Si es un ADDON, solo activar el addon correspondiente
        if (transactionType === 'ADDON') {
          const addonId = referenceParts[1]; // addon-ai-monthly, addon-store-monthly, etc.

          if (addonId.includes('ai')) {
            hasAIAddon = 1;
            console.log('✅ Activating AI addon');
          } else if (addonId.includes('store')) {
            hasStoreAddon = 1;
            console.log('✅ Activating Store addon');
          } else if (addonId.includes('email')) {
            hasEmailAddon = 1;
            console.log('✅ Activating Email addon');
          }
        }
        // Si es SUBSCRIPTION, activar el plan y/o addons
        else if (transactionType === 'SUBSCRIPTION' || transactionType === 'SUB') {
          // Solo un monto de plan conocido activa la suscripción (abajo).
          updateSubscriptionStatus = [24900, 4900, 9900, 29800, 34800].includes(amountCOP);
          if (!updateSubscriptionStatus) {
            console.warn(`⚠️ Pago ${id} por $${amountCOP}: no coincide con ningún plan; no se activa`);
          }

          // Plan básico
          if (amountCOP === 24900) {
            planId = 'basic-monthly';
          }
          // Addon IA solo (mantener estado de trial si lo tiene)
          else if (amountCOP === 4900) {
            hasAIAddon = 1;
          }
          // Addon Tienda solo
          else if (amountCOP === 9900) {
            hasStoreAddon = 1;
          }
          // Plan básico + IA addon
          else if (amountCOP === 29800) {
            planId = 'basic-monthly';
            hasAIAddon = 1;
          }
          // Plan básico + Tienda
          else if (amountCOP === 34800) {
            planId = 'basic-monthly';
            hasStoreAddon = 1;
          }
        }

        // Construir query de actualización dinámicamente
        const updates: string[] = [];
        const bindings: any[] = [];

        if (updateSubscriptionStatus) {
          updates.push('subscription_status = ?', 'plan_id = ?', 'trial_start_date = NULL', 'trial_end_date = NULL');
          bindings.push('active', planId);
        }

        updates.push(
          'has_ai_addon = ?',
          'has_store_addon = ?',
          'has_email_addon = ?',
          'last_payment_date = ?',
          'next_billing_date = ?',
          'updated_at = ?'
        );

        bindings.push(
          hasAIAddon,
          hasStoreAddon,
          hasEmailAddon,
          now.toISOString(),
          nextBillingDate.toISOString(),
          now.toISOString(),
          userProfileResult.id
        );

        await c.env.DB.prepare(
          `UPDATE user_profiles SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...bindings).run();

        console.log(`✅ ${transactionType === 'ADDON' ? 'Addon' : 'Subscription'} activated for user: ${userProfileResult.id}`);
        console.log(`Plan: ${planId}, AI: ${hasAIAddon}, Store: ${hasStoreAddon}, Email: ${hasEmailAddon}`);

        return c.json<APIResponse>({
          success: true,
          message: transactionType === 'ADDON' ? 'Addon activated successfully' : 'Subscription activated successfully',
          data: {
            userId: userProfileResult.id,
            planId,
            hasAIAddon: hasAIAddon === 1,
            hasStoreAddon: hasStoreAddon === 1,
            hasEmailAddon: hasEmailAddon === 1,
          },
        });
      }

      // Pago rechazado / con error / anulado: NO tocar la suscripción. Un
      // intento fallido no quita los días ya pagados o de prueba; el acceso
      // termina solo cuando vence la fecha (lo aplica authMiddleware).
      if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
        console.log(`⚠️  Payment ${status} for user ${userProfileResult.id}; subscription unchanged`);

        return c.json<APIResponse>({
          success: true,
          message: 'Payment not approved; subscription unchanged',
          data: {
            userId: userProfileResult.id,
            status: userProfileResult.subscription_status,
          },
        });
      }

      // Para estados pendientes, solo registrar la transacción
      console.log(`⏳ Transaction status is ${status}, waiting for completion`);

      return c.json<APIResponse>({
        success: true,
        message: 'Transaction recorded, awaiting completion',
        data: {
          userId: userProfileResult.id,
          transactionStatus: status,
        },
      });
    }

    // Otros eventos no manejados
    return c.json<APIResponse>({
      success: true,
      message: 'Event received but not processed',
    });

  } catch (error) {
    console.error('❌ Error processing Wompi webhook:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
