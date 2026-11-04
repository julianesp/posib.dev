/**
 * Payment Transactions API Routes
 * Transacciones de pago de suscripciones (hoy ePayco). La columna se sigue
 * llamando wompi_transaction_id por historia (guarda el id de ePayco); ver la
 * memoria "Columna legacy de payment_transactions".
 * NO usa tenant_id, está ligado a user_profile_id
 */

import { Hono } from 'hono';
import type { Env, Tenant, APIResponse, AppEnv } from '../types';

const app = new Hono<AppEnv>();

interface PaymentTransaction {
  id: string;
  user_profile_id: string;
  wompi_transaction_id: string;
  amount: number;
  currency: string;
  status: 'APPROVED' | 'DECLINED' | 'PENDING' | 'ERROR';
  payment_method_type?: string;
  reference?: string;
  created_at: string;
}

// GET /api/payment-transactions - Get all payment transactions (superadmin only)
app.get('/', async (c) => {
  const tenant: Tenant = c.get('tenant');

  // Solo superadmins pueden ver todas las transacciones
  if (!tenant.is_superadmin) {
    return c.json<APIResponse>({
      success: false,
      error: 'Unauthorized - Superadmin access required',
    }, 403);
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM payment_transactions ORDER BY created_at DESC`
    ).all();

    return c.json<APIResponse<PaymentTransaction[]>>({
      success: true,
      data: result.results as unknown as PaymentTransaction[],
    });
  } catch (error) {
    console.error('Error fetching payment transactions:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch payment transactions',
    }, 500);
  }
});

// GET /api/payment-transactions/my - Get payment transactions for current user profile
app.get('/my', async (c) => {
  const tenant: Tenant = c.get('tenant');

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM payment_transactions
       WHERE user_profile_id = ?
       ORDER BY created_at DESC`
    )
      .bind(tenant.id)
      .all();

    return c.json<APIResponse<PaymentTransaction[]>>({
      success: true,
      data: result.results as unknown as PaymentTransaction[],
    });
  } catch (error) {
    console.error('Error fetching my payment transactions:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch payment transactions',
    }, 500);
  }
});

// GET /api/payment-transactions/user/:userId - Get payment transactions for specific user (superadmin only)
app.get('/user/:userId', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const userId = c.req.param('userId');

  // Solo superadmins pueden ver transacciones de otros usuarios
  if (!tenant.is_superadmin) {
    return c.json<APIResponse>({
      success: false,
      error: 'Unauthorized - Superadmin access required',
    }, 403);
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM payment_transactions
       WHERE user_profile_id = ?
       ORDER BY created_at DESC`
    )
      .bind(userId)
      .all();

    return c.json<APIResponse<PaymentTransaction[]>>({
      success: true,
      data: result.results as unknown as PaymentTransaction[],
    });
  } catch (error) {
    console.error('Error fetching user payment transactions:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch payment transactions',
    }, 500);
  }
});

// GET /api/payment-transactions/:id - Get single payment transaction
app.get('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const transactionId = c.req.param('id');

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM payment_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .first();

    if (!result) {
      return c.json<APIResponse>({
        success: false,
        error: 'Payment transaction not found',
      }, 404);
    }

    const transaction = result as unknown as PaymentTransaction;

    // Solo el dueño o un superadmin puede ver la transacción
    if (transaction.user_profile_id !== tenant.id && !tenant.is_superadmin) {
      return c.json<APIResponse>({
        success: false,
        error: 'Unauthorized - You can only view your own transactions',
      }, 403);
    }

    return c.json<APIResponse<PaymentTransaction>>({
      success: true,
      data: transaction,
    });
  } catch (error) {
    console.error('Error fetching payment transaction:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch payment transaction',
    }, 500);
  }
});

// POST /api/payment-transactions - Create new payment transaction (webhook/internal)
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const {
      user_profile_id,
      wompi_transaction_id,
      amount,
      currency = 'COP',
      status,
      payment_method_type,
      reference
    } = body;

    // Validar campos requeridos
    if (!user_profile_id || !wompi_transaction_id || !amount || !status) {
      return c.json<APIResponse>({
        success: false,
        error: 'Missing required fields: user_profile_id, wompi_transaction_id, amount, status',
      }, 400);
    }

    // Verificar que el user_profile exista
    const userProfile = await c.env.DB.prepare(
      `SELECT id FROM user_profiles WHERE id = ?`
    )
      .bind(user_profile_id)
      .first();

    if (!userProfile) {
      return c.json<APIResponse>({
        success: false,
        error: 'User profile not found',
      }, 404);
    }

    // Generar ID único
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    // Crear transacción
    await c.env.DB.prepare(
      `INSERT INTO payment_transactions (
        id, user_profile_id, wompi_transaction_id, amount, currency,
        status, payment_method_type, reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        transactionId,
        user_profile_id,
        wompi_transaction_id,
        amount,
        currency,
        status,
        payment_method_type || null,
        reference || null,
        now
      )
      .run();

    const transaction: PaymentTransaction = {
      id: transactionId,
      user_profile_id,
      wompi_transaction_id,
      amount,
      currency,
      status,
      payment_method_type,
      reference,
      created_at: now,
    };

    return c.json<APIResponse<PaymentTransaction>>({
      success: true,
      data: transaction,
    }, 201);
  } catch (error) {
    console.error('Error creating payment transaction:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to create payment transaction',
    }, 500);
  }
});

// PUT /api/payment-transactions/:id - Update payment transaction status
app.put('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const transactionId = c.req.param('id');

  // Solo superadmins pueden actualizar transacciones
  if (!tenant.is_superadmin) {
    return c.json<APIResponse>({
      success: false,
      error: 'Unauthorized - Superadmin access required',
    }, 403);
  }

  try {
    const body = await c.req.json();

    // Verificar que la transacción exista
    const existingTransaction = await c.env.DB.prepare(
      `SELECT * FROM payment_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .first();

    if (!existingTransaction) {
      return c.json<APIResponse>({
        success: false,
        error: 'Payment transaction not found',
      }, 404);
    }

    // Actualizar solo el estado
    if (body.status) {
      await c.env.DB.prepare(
        `UPDATE payment_transactions SET status = ? WHERE id = ?`
      )
        .bind(body.status, transactionId)
        .run();
    }

    // Obtener la transacción actualizada
    const updatedTransaction = await c.env.DB.prepare(
      `SELECT * FROM payment_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .first();

    return c.json<APIResponse<PaymentTransaction>>({
      success: true,
      data: updatedTransaction as unknown as PaymentTransaction,
    });
  } catch (error) {
    console.error('Error updating payment transaction:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to update payment transaction',
    }, 500);
  }
});

export default app;
