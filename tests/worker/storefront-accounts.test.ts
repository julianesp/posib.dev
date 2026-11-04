/**
 * Cuentas de clientes de la tienda online ("Entrar") con historial de compras:
 * registro, inicio de sesión, pedidos ligados a la cuenta y "Mis compras".
 * Rutas reales del Worker + D1 en memoria (migración 033).
 */
import { Hono } from 'hono';
import storefrontRoutes from '../../cloudflare-migration/src/routes/storefront';
import { customerOrderStatus } from '../../cloudflare-migration/src/utils/storefront-session';
import { D1DatabaseFake } from './helpers/d1-sqlite';

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('cuentas de clientes de la tienda', () => {
  let db: D1DatabaseFake;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const app = new Hono();
    app.route('/api/storefront', storefrontRoutes);
    const res = await app.request(
      `/api/storefront${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      },
      { DB: db }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };

  const register = (slug = 'esquina', email = 'ana@correo.co') =>
    call('POST', `/auth/register/${slug}`, { name: 'Ana Ruiz', email, password: 'secreta123', phone: '3001112233' });
  const order = (token?: string, slug = 'esquina') =>
    call(
      'POST',
      `/orders/${slug}`,
      { customer_name: 'Ana Ruiz', customer_phone: '3001112233', delivery_method: 'pickup', items: [{ product_id: `arroz_${slug}`, quantity: 2 }] },
      token
    );

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db = new D1DatabaseFake();
    for (const col of [
      'store_slug TEXT', 'store_name TEXT', 'store_enabled INTEGER DEFAULT 0', 'store_nequi_number TEXT',
      'store_whatsapp TEXT', 'store_phone TEXT', 'store_address TEXT', 'epayco_enabled INTEGER DEFAULT 0',
      'store_min_order REAL DEFAULT 0', 'store_shipping_enabled INTEGER DEFAULT 0', 'store_pickup_enabled INTEGER DEFAULT 1',
      'has_store_addon INTEGER DEFAULT 0', 'store_addon_expires_at TEXT',
    ]) {
      db.sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN ${col}`);
    }
    for (const [id, slug] of [['t_esquina', 'esquina'], ['t_otra', 'otra']]) {
      db.insert('user_profiles', {
        id, clerk_user_id: `c_${id}`, email: `${id}@x.co`, role: 'admin', subscription_status: 'active',
        has_store_addon: 1, store_addon_expires_at: iso(20), store_slug: slug, store_name: `Tienda ${slug}`,
        store_enabled: 1, store_nequi_number: '3001234567',
      });
      db.insert('products', { id: `arroz_${slug}`, tenant_id: id, name: 'Arroz', sale_price: 4800, stock: 20 });
    }
  });

  it('registrarse devuelve el código de sesión y guarda solo el hash de la contraseña', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ name: 'Ana Ruiz', email: 'ana@correo.co', phone: '3001112233' });
    expect(res.json.data.token).toMatch(/^[a-f0-9]{64}$/);
    const row = db.sqlite.prepare(`SELECT password_hash FROM storefront_users`).get() as { password_hash: string };
    expect(row.password_hash).not.toContain('secreta123');
    const session = db.sqlite.prepare(`SELECT token_hash FROM storefront_sessions`).get() as { token_hash: string };
    expect(session.token_hash).not.toBe(res.json.data.token);
  });

  it('no deja registrar el mismo correo dos veces en la tienda (sin importar mayúsculas)', async () => {
    await register();
    expect((await register('esquina', 'ANA@Correo.co')).status).toBe(400);
    // En otra tienda sí: cada tienda tiene sus clientes.
    expect((await register('otra', 'ana@correo.co')).status).toBe(201);
  });

  it('inicia sesión con la contraseña correcta y rechaza la incorrecta', async () => {
    await register();
    const ok = await call('POST', '/auth/login/esquina', { email: 'Ana@Correo.co', password: 'secreta123' });
    expect(ok.status).toBe(200);
    expect(ok.json.data.token).toMatch(/^[a-f0-9]{64}$/);
    expect((await call('POST', '/auth/login/esquina', { email: 'ana@correo.co', password: 'otra' })).status).toBe(401);
  });

  it('un pedido hecho con la sesión iniciada aparece en "Mis compras"', async () => {
    const { token } = (await register()).json.data;
    const created = await order(token);
    expect(created.status).toBe(201);
    await order(); // pedido sin sesión: no se liga a nadie

    const mine = await call('GET', '/me/esquina/orders', undefined, token);
    expect(mine.status).toBe(200);
    expect(mine.json.data.orders).toHaveLength(1);
    expect(mine.json.data.orders[0]).toMatchObject({
      order_number: created.json.data.order_number,
      total: 9600,
      status: 'pendiente',
      items: [{ name: 'Arroz', quantity: 2, unit_price: 4800, subtotal: 9600 }],
    });
  });

  it('muestra el estado del pago: por verificar, pagado o cancelado', async () => {
    const { token } = (await register()).json.data;
    const { order_number } = (await order(token)).json.data;
    db.sqlite.exec(`UPDATE sales SET payment_reference = 'M123456' WHERE sale_number = '${order_number}'`);
    expect((await call('GET', '/me/esquina/orders', undefined, token)).json.data.orders[0].status).toBe('por_verificar');
    db.sqlite.exec(`UPDATE sales SET status = 'completada', payment_status = 'pagado' WHERE sale_number = '${order_number}'`);
    expect((await call('GET', '/me/esquina/orders', undefined, token)).json.data.orders[0].status).toBe('pagado');
  });

  it('nadie ve las compras de otro: sin sesión, con sesión de otra tienda o con un código inventado', async () => {
    const { token } = (await register()).json.data;
    await order(token);
    expect((await call('GET', '/me/esquina/orders')).status).toBe(401);
    expect((await call('GET', '/me/esquina/orders', undefined, 'a'.repeat(64))).status).toBe(401);
    const otherStore = (await register('otra', 'ana@correo.co')).json.data.token;
    expect((await call('GET', '/me/esquina/orders', undefined, otherStore)).status).toBe(401);
  });

  it('una sesión vencida ya no sirve', async () => {
    const { token } = (await register()).json.data;
    db.sqlite.exec(`UPDATE storefront_sessions SET expires_at = '2020-01-01T00:00:00.000Z'`);
    expect((await call('GET', '/me/esquina', undefined, token)).status).toBe(401);
  });

  it('cerrar sesión invalida el código', async () => {
    const { token } = (await register()).json.data;
    expect((await call('GET', '/me/esquina', undefined, token)).status).toBe(200);
    await call('POST', '/auth/logout/esquina', undefined, token);
    expect((await call('GET', '/me/esquina', undefined, token)).status).toBe(401);
  });
});

describe('estado del pedido para el cliente', () => {
  it.each([
    [{ status: 'pendiente', payment_status: 'pendiente', payment_reference: null }, 'pendiente'],
    [{ status: 'pendiente', payment_status: 'pendiente', payment_reference: 'M1' }, 'por_verificar'],
    [{ status: 'completada', payment_status: 'pagado', payment_reference: 'M1' }, 'pagado'],
    [{ status: 'cancelada', payment_status: 'pendiente', payment_reference: null }, 'cancelado'],
  ])('%j → %s', (sale, expected) => {
    expect(customerOrderStatus(sale)).toBe(expected);
  });
});
