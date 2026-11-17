/**
 * Customers API Routes
 * Todos los clientes están aislados por tenant automáticamente
 */

import { Hono } from 'hono';
import type { Env, Tenant, APIResponse, AppEnv } from '../types';
import { TenantDB, generateId } from '../utils/db-helpers';

const app = new Hono<AppEnv>();

interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string; // Obligatorio para recordatorios de pago
  phone: string; // Obligatorio para recordatorios de pago
  address?: string;
  city?: string;
  id_number?: string;
  loyalty_points: number;
  created_at: string;
  updated_at: string;
}

// GET /api/customers - Get all customers
app.get('/', async (c) => {
  const tenant: Tenant = c.get('tenant');

  try {
    const tenantDB = new TenantDB(c.env.DB, tenant.id);
    const customers = await tenantDB.getAll<Customer>('customers');

    return c.json<APIResponse<Customer[]>>({
      success: true,
      data: customers,
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch customers',
    }, 500);
  }
});

// GET /api/customers/:id - Get single customer
app.get('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const customerId = c.req.param('id');

  try {
    const tenantDB = new TenantDB(c.env.DB, tenant.id);
    const customer = await tenantDB.getById<Customer>('customers', customerId);

    if (!customer) {
      return c.json<APIResponse>({
        success: false,
        error: 'Customer not found',
      }, 404);
    }

    return c.json<APIResponse<Customer>>({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch customer',
    }, 500);
  }
});

// POST /api/customers - Create new customer
app.post('/', async (c) => {
  const tenant: Tenant = c.get('tenant');

  try {
    const body = await c.req.json();

    // Validar campos obligatorios
    if (!body.name) {
      return c.json<APIResponse>({
        success: false,
        error: 'El nombre es requerido',
      }, 400);
    }

    if (!body.email || body.email.trim() === '') {
      return c.json<APIResponse>({
        success: false,
        error: 'El email es requerido para enviar recordatorios de pago',
      }, 400);
    }

    if (!body.phone || body.phone.trim() === '') {
      return c.json<APIResponse>({
        success: false,
        error: 'El teléfono es requerido para enviar recordatorios de pago',
      }, 400);
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return c.json<APIResponse>({
        success: false,
        error: 'El email no tiene un formato válido',
      }, 400);
    }

    // Validar que el teléfono tenga al menos 7 dígitos
    const phoneDigits = body.phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) {
      return c.json<APIResponse>({
        success: false,
        error: 'El teléfono debe tener al menos 7 dígitos',
      }, 400);
    }

    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    const customerData = {
      id: generateId('cust'),
      name: body.name,
      email: body.email.trim(),
      phone: body.phone.trim(),
      address: body.address || null,
      city: body.city || null,
      id_number: body.id_number || null,
      loyalty_points: body.loyalty_points || 0,
    };

    await tenantDB.insert('customers', customerData);
    const customer = await tenantDB.getById<Customer>('customers', customerData.id);

    return c.json<APIResponse<Customer>>({
      success: true,
      data: customer!,
      message: 'Customer created successfully',
    }, 201);
  } catch (error) {
    console.error('Error creating customer:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to create customer',
    }, 500);
  }
});

// PUT /api/customers/:id - Update customer
app.put('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const customerId = c.req.param('id');

  try {
    const body = await c.req.json();
    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    const existing = await tenantDB.getById('customers', customerId);
    if (!existing) {
      return c.json<APIResponse>({
        success: false,
        error: 'Customer not found',
      }, 404);
    }

    await tenantDB.update('customers', customerId, body);
    const customer = await tenantDB.getById<Customer>('customers', customerId);

    return c.json<APIResponse<Customer>>({
      success: true,
      data: customer!,
      message: 'Customer updated successfully',
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to update customer',
    }, 500);
  }
});

// DELETE /api/customers/:id - Delete customer
/** Ventas y abonos de un cliente (para no borrar historial ni fiados). */
async function customerHistory(db: D1Database, tenantId: string, customerId: string) {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE tenant_id = ?1 AND customer_id = ?2) AS sales,
         (SELECT COUNT(*) FROM credit_payments WHERE tenant_id = ?1 AND customer_id = ?2) AS payments`
    )
    .bind(tenantId, customerId)
    .first<{ sales: number; payments: number }>();
  return { sales: Number(row?.sales ?? 0), payments: Number(row?.payments ?? 0) };
}

// DELETE /api/customers/:id - Borra un cliente SIN historial.
// Con ventas o abonos se responde 409: borrarlo dejaría ventas sin cliente y
// fiados sin dueño. Para un cliente repetido se usa POST /:id/merge.
app.delete('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const customerId = c.req.param('id');

  try {
    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    const existing = await tenantDB.getById('customers', customerId);
    if (!existing) {
      return c.json<APIResponse>({
        success: false,
        error: 'Customer not found',
      }, 404);
    }

    const history = await customerHistory(c.env.DB, tenant.id, customerId);
    if (history.sales > 0 || history.payments > 0) {
      return c.json<APIResponse>({
        success: false,
        error: `Este cliente tiene ${history.sales} ${history.sales === 1 ? 'venta' : 'ventas'}${history.payments > 0 ? ` y ${history.payments} ${history.payments === 1 ? 'abono' : 'abonos'}` : ''}. Para no perder ese historial, únelo con el otro cliente en vez de eliminarlo.`,
        data: history,
      }, 409);
    }

    await tenantDB.delete('customers', customerId);

    return c.json<APIResponse>({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to delete customer',
    }, 500);
  }
});

// POST /api/customers/:id/merge  { into: string }
// Une un cliente repetido (:id) con otro (into): le pasa sus ventas, abonos y
// carritos, le suma la deuda y los puntos, completa los datos que le falten y
// borra el repetido. Todo en un solo batch de D1 (o se hace todo o nada).
app.post('/:id/merge', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const sourceId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { into?: unknown };
  const targetId = typeof body.into === 'string' ? body.into : '';

  if (!targetId || targetId === sourceId) {
    return c.json<APIResponse>({ success: false, error: 'Elige otro cliente para unir' }, 400);
  }

  try {
    const db = c.env.DB;
    const tenantDB = new TenantDB(db, tenant.id);
    const [source, target] = await Promise.all([
      tenantDB.getById<Record<string, unknown>>('customers', sourceId),
      tenantDB.getById<Record<string, unknown>>('customers', targetId),
    ]);
    if (!source || !target) {
      return c.json<APIResponse>({ success: false, error: 'Cliente no encontrado' }, 404);
    }

    const now = new Date().toISOString();
    await db.batch([
      db.prepare('UPDATE sales SET customer_id = ?1 WHERE tenant_id = ?2 AND customer_id = ?3').bind(targetId, tenant.id, sourceId),
      db.prepare('UPDATE credit_payments SET customer_id = ?1 WHERE tenant_id = ?2 AND customer_id = ?3').bind(targetId, tenant.id, sourceId),
      db.prepare('UPDATE shopping_carts SET customer_id = ?1 WHERE tenant_id = ?2 AND customer_id = ?3').bind(targetId, tenant.id, sourceId),
      db
        .prepare(
          `UPDATE customers SET
             current_debt = COALESCE(current_debt, 0) + ?1,
             loyalty_points = COALESCE(loyalty_points, 0) + ?2,
             credit_limit = MAX(COALESCE(credit_limit, 0), ?3),
             phone = COALESCE(NULLIF(phone, ''), ?4),
             email = COALESCE(NULLIF(email, ''), ?5),
             address = COALESCE(NULLIF(address, ''), ?6),
             city = COALESCE(NULLIF(city, ''), ?7),
             id_number = COALESCE(NULLIF(id_number, ''), ?8),
             updated_at = ?9
           WHERE id = ?10 AND tenant_id = ?11`
        )
        .bind(
          Number(source.current_debt) || 0,
          Number(source.loyalty_points) || 0,
          Number(source.credit_limit) || 0,
          (source.phone as string) || null,
          (source.email as string) || null,
          (source.address as string) || null,
          (source.city as string) || null,
          (source.id_number as string) || null,
          now,
          targetId,
          tenant.id
        ),
      db.prepare('DELETE FROM customers WHERE id = ?1 AND tenant_id = ?2').bind(sourceId, tenant.id),
    ]);

    const merged = await tenantDB.getById('customers', targetId);
    return c.json<APIResponse>({ success: true, data: merged });
  } catch (error) {
    console.error('Error merging customers:', error);
    return c.json<APIResponse>({ success: false, error: 'No se pudieron unir los clientes' }, 500);
  }
});

export default app;
