import { Hono } from 'hono';
import salesRoutes from '../../../cloudflare-migration/src/routes/sales';
import creditPaymentRoutes from '../../../cloudflare-migration/src/routes/credit-payments';
import customerRoutes from '../../../cloudflare-migration/src/routes/customers';
import { D1DatabaseFake } from './d1-sqlite';

export const TENANT_ID = 'tenant_tienda';
export const OTHER_TENANT_ID = 'tenant_vecina';

/**
 * Monta las rutas reales del Worker con un tenant ya autenticado (en producción
 * lo resuelve authMiddleware a partir del JWT de Clerk) y una base D1 en memoria.
 */
export function createWorker(tenantId = TENANT_ID, db = new D1DatabaseFake()) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('tenant' as never, { id: tenantId } as never);
    await next();
  });
  app.route('/api/sales', salesRoutes);
  app.route('/api/credit-payments', creditPaymentRoutes);
  app.route('/api/customers', customerRoutes);

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(
      url,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { DB: db }
    );
    // Respuestas de la API leídas libremente en las aserciones.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };

  return { db, call };
}

/** Siembra dos tiendas (tenants) con productos y clientes. */
export function seed(db: D1DatabaseFake) {
  for (const id of [TENANT_ID, OTHER_TENANT_ID]) {
    db.insert('user_profiles', {
      id,
      clerk_user_id: `clerk_${id}`,
      email: `${id}@posib.dev`,
      role: 'admin',
    });
  }

  const product = (id: string, tenant_id: string, name: string, stock: number, extra = {}) =>
    db.insert('products', {
      id,
      tenant_id,
      name,
      cost_price: 1000,
      sale_price: 2500,
      stock,
      min_stock: 1,
      ...extra,
    });

  product('prod_gaseosa', TENANT_ID, 'Gaseosa 350ml', 20);
  product('prod_pan', TENANT_ID, 'Pan tajado', 5);
  product('prod_servicio', TENANT_ID, 'Recarga celular', 0, { track_inventory: 0 });
  product('prod_ajeno', OTHER_TENANT_ID, 'Producto de otra tienda', 10);

  db.insert('customers', {
    id: 'cli_rosa',
    tenant_id: TENANT_ID,
    name: 'Doña Rosa',
    credit_limit: 100000,
    current_debt: 0,
    loyalty_points: 95,
  });
  db.insert('customers', {
    id: 'cli_pedro',
    tenant_id: TENANT_ID,
    name: 'Pedro',
    current_debt: 30000,
  });
}
