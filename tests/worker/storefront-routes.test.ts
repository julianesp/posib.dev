/**
 * Tienda online pública (/api/storefront/*): las rutas reales del Worker contra
 * el doble de D1. Cubre quién puede vender, el catálogo, la creación de pedidos
 * (precios, ofertas, envío y stock calculados en el servidor) y el registro de
 * la referencia de pago por Nequi.
 *
 * Errores encontrados el 2026-11-04 y ya corregidos: costo publicado en el
 * detalle, número de pedido repetido, pedido mínimo y forma de entrega sin
 * validar en el servidor, y sesión de ePayco con el monto del cliente.
 */
import { Hono } from 'hono';
import storefrontRoutes from '../../cloudflare-migration/src/routes/storefront';
import epaycoStorefrontRoutes from '../../cloudflare-migration/src/routes/epayco-storefront';
import { hashOrderToken } from '../../cloudflare-migration/src/utils/payment-reference';
import { D1DatabaseFake } from './helpers/d1-sqlite';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

/**
 * Columnas y tablas de la tienda. Vienen de las migraciones 001, 002, 003, 006
 * y 009, que no están en git (*.sql se ignora), así que se crean aquí solo con
 * lo que usan estas rutas.
 */
function addStorefrontSchema(db: D1DatabaseFake) {
  const columns = [
    'store_slug TEXT', 'store_name TEXT', 'store_description TEXT', 'store_logo_url TEXT',
    'store_banner_url TEXT', 'store_banner_images TEXT', 'store_primary_color TEXT',
    'store_secondary_color TEXT', 'store_whatsapp TEXT', 'store_facebook TEXT', 'store_instagram TEXT',
    'store_address TEXT', 'store_city TEXT', 'store_phone TEXT', 'store_email TEXT',
    'store_enabled INTEGER DEFAULT 0', 'store_terms TEXT', 'store_shipping_enabled INTEGER DEFAULT 0',
    'store_pickup_enabled INTEGER DEFAULT 1', 'store_min_order REAL DEFAULT 0', 'store_nequi_number TEXT',
    'payment_qr_url TEXT', 'store_maps_url TEXT', 'has_store_addon INTEGER DEFAULT 0',
    'store_addon_expires_at TEXT', 'epayco_enabled INTEGER DEFAULT 0', 'epayco_public_key TEXT',
    'epayco_private_key TEXT', 'epayco_customer_id TEXT',
  ];
  for (const col of columns) db.sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN ${col}`);
  db.sqlite.exec(`
    CREATE TABLE shipping_zones (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, zone_name TEXT NOT NULL,
      shipping_cost REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
}

describe('tienda online pública', () => {
  let db: D1DatabaseFake;

  const call = async (method: string, path: string, body?: unknown) => {
    const app = new Hono();
    app.route('/api/storefront/epayco', epaycoStorefrontRoutes);
    app.route('/api/storefront', storefrontRoutes);
    const res = await app.request(
      `/api/storefront${path}`,
      { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined },
      { DB: db }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };
  const get = (path: string) => call('GET', path);
  const post = (path: string, body: unknown) => call('POST', path, body);

  const store = (id: string, slug: string, extra: Record<string, unknown> = {}) =>
    db.insert('user_profiles', {
      id,
      clerk_user_id: `clerk_${id}`,
      email: `${id}@tienda.co`,
      role: 'admin',
      subscription_status: 'active',
      has_store_addon: 1,
      store_addon_expires_at: iso(20),
      store_slug: slug,
      store_name: `Tienda ${slug}`,
      store_enabled: 1,
      store_whatsapp: '3001234567',
      store_nequi_number: '3001234567',
      store_shipping_enabled: 1,
      epayco_private_key: 'llave-secreta',
      ...extra,
    });

  const product = (id: string, tenant: string, extra: Record<string, unknown> = {}) =>
    db.insert('products', {
      id,
      tenant_id: tenant,
      name: id,
      cost_price: 1000,
      sale_price: 2000,
      stock: 10,
      ...extra,
    });

  const order = (items: { product_id: string; quantity: number; [k: string]: unknown }[], extra = {}) =>
    post('/orders/barrio', {
      customer_name: 'Marta Gómez',
      customer_phone: '3109876543',
      delivery_method: 'pickup',
      items,
      ...extra,
    });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db = new D1DatabaseFake();
    addStorefrontSchema(db);
    store('t_barrio', 'barrio');
    store('t_otra', 'otra');
    db.insert('categories', { id: 'cat_bebidas', tenant_id: 't_barrio', name: 'Bebidas' });
    product('Gaseosa', 't_barrio', { category_id: 'cat_bebidas', sale_price: 3000 });
    product('Arroz', 't_barrio', { sale_price: 4500 });
    product('Agotado', 't_barrio', { stock: 0 });
    product('De otra tienda', 't_otra');
  });

  describe('quién puede vender', () => {
    it.each([
      ['plan activo con el complemento vigente', {}, 200],
      ['prueba gratis vigente', { subscription_status: 'trial', has_store_addon: 0, trial_end_date: iso(5) }, 200],
      ['prueba gratis vencida', { subscription_status: 'trial', has_store_addon: 0, trial_end_date: iso(-1) }, 404],
      ['plan activo SIN el complemento de tienda', { has_store_addon: 0 }, 404],
      ['complemento vencido', { store_addon_expires_at: iso(-1) }, 404],
      ['suscripción vencida', { subscription_status: 'expired' }, 404],
      ['tienda apagada por el tendero', { store_enabled: 0 }, 404],
    ])('%s → %i', async (_caso, extra, status) => {
      store('t_caso', 'caso', extra);
      expect((await get('/config/caso')).status).toBe(status);
    });

    it('una tienda bloqueada tampoco recibe pedidos', async () => {
      store('t_bloq', 'bloq', { has_store_addon: 0 });
      product('Pan', 't_bloq');
      const res = await post('/orders/bloq', {
        customer_name: 'A', customer_phone: '1', delivery_method: 'pickup', items: [{ product_id: 'Pan', quantity: 1 }],
      });
      expect(res.status).toBe(404);
    });
  });

  describe('configuración pública', () => {
    it('no expone la suscripción ni las llaves de ePayco', async () => {
      const { json } = await get('/config/barrio');
      expect(json.data.store_name).toBe('Tienda barrio');
      expect(json.data.store_nequi_number).toBe('3001234567');
      for (const secret of ['subscription_status', 'has_store_addon', 'epayco_private_key', 'email', 'clerk_user_id']) {
        expect(json.data).not.toHaveProperty(secret);
      }
    });
  });

  describe('catálogo', () => {
    it('muestra solo productos con stock de esa tienda, sin el costo', async () => {
      const { json } = await get('/products/barrio');
      expect(json.data.map((p: { name: string }) => p.name)).toEqual(['Arroz', 'Gaseosa']);
      expect(json.data[0]).not.toHaveProperty('cost_price');
    });

    it('aplica solo ofertas activas y dentro de fechas', async () => {
      db.insert('offers', { id: 'o1', tenant_id: 't_barrio', product_id: 'Gaseosa', discount_percentage: 20, start_date: iso(-1), end_date: iso(1), is_active: 1 });
      db.insert('offers', { id: 'o2', tenant_id: 't_barrio', product_id: 'Arroz', discount_percentage: 50, start_date: iso(-5), end_date: iso(-1), is_active: 1 });
      const { json } = await get('/products/barrio');
      const byName = Object.fromEntries(json.data.map((p: { name: string; discount_percentage: number | null }) => [p.name, p.discount_percentage]));
      expect(byName).toEqual({ Arroz: null, Gaseosa: 20 });
    });

    it('filtra por categoría y agrupa los productos sin categoría', async () => {
      expect((await get('/products/barrio?category=cat_bebidas')).json.data.map((p: { name: string }) => p.name)).toEqual(['Gaseosa']);
      const { json } = await get('/categories/barrio');
      expect(json.data.map((c: { name: string; product_count: number }) => [c.name, c.product_count])).toEqual([
        ['Bebidas', 1],
        ['Sin categoría', 1],
      ]);
    });

    it('no deja ver el detalle de un producto de otra tienda', async () => {
      expect((await get('/product/barrio/De otra tienda')).status).toBe(404);
    });

    it('el detalle de un producto no publica el precio de compra ni datos internos', async () => {
      db.sqlite.exec(`UPDATE products SET barcode = '7701234', supplier_id = NULL WHERE id = 'Gaseosa'`);
      const { json } = await get('/product/barrio/Gaseosa');
      expect(json.data).toMatchObject({ name: 'Gaseosa', sale_price: 3000, stock: 10, category_name: 'Bebidas' });
      for (const internal of ['cost_price', 'barcode', 'supplier_id', 'tenant_id', 'min_stock']) {
        expect(json.data).not.toHaveProperty(internal);
      }
    });
  });

  describe('crear pedido', () => {
    it('calcula precios, ofertas y total en el servidor e ignora los que manda el cliente', async () => {
      db.insert('offers', { id: 'o1', tenant_id: 't_barrio', product_id: 'Gaseosa', discount_percentage: 10, start_date: iso(-1), end_date: iso(1), is_active: 1 });
      const res = await order([
        { product_id: 'Gaseosa', quantity: 2, unit_price: 1, subtotal: 1 },
        { product_id: 'Arroz', quantity: 1, unit_price: 1 },
      ], { total: 5, subtotal: 5 });

      expect(res.status).toBe(201);
      // Gaseosa 2 x 3.000 = 6.000 - 10 % = 5.400; Arroz 4.500
      expect(res.json.data).toMatchObject({ subtotal: 9900, shipping_cost: 0, total: 9900 });

      const sale = db.sqlite.prepare(`SELECT * FROM sales WHERE sale_number = ?`).get(res.json.data.order_number) as Record<string, unknown>;
      expect(sale).toMatchObject({ tenant_id: 't_barrio', status: 'pendiente', payment_status: 'pendiente', payment_method: 'transferencia', total: 9900, amount_pending: 9900 });
      expect(String(sale.notes)).toContain('Marta Gómez');
    });

    it('no descuenta inventario hasta que el tendero confirme el pago', async () => {
      await order([{ product_id: 'Gaseosa', quantity: 3 }]);
      const { stock } = db.sqlite.prepare(`SELECT stock FROM products WHERE id = 'Gaseosa'`).get() as { stock: number };
      expect(stock).toBe(10);
    });

    it('guarda solo el hash del código del pedido', async () => {
      const res = await order([{ product_id: 'Arroz', quantity: 1 }]);
      const { order_token } = db.sqlite.prepare(`SELECT order_token FROM sales WHERE sale_number = ?`).get(res.json.data.order_number) as { order_token: string };
      expect(order_token).toBe(await hashOrderToken(res.json.data.order_token));
      expect(order_token).not.toBe(res.json.data.order_token);
    });

    it.each([
      ['sin stock suficiente', [{ product_id: 'Gaseosa', quantity: 11 }], 'stock suficiente'],
      ['producto de otra tienda', [{ product_id: 'De otra tienda', quantity: 1 }], 'ya no está disponible'],
      ['producto que no existe', [{ product_id: 'Fantasma', quantity: 1 }], 'ya no está disponible'],
      ['cantidad cero', [{ product_id: 'Arroz', quantity: 0 }], 'no válidos'],
      ['cantidad con decimales', [{ product_id: 'Arroz', quantity: 1.5 }], 'no válidos'],
      ['cantidad absurda', [{ product_id: 'Arroz', quantity: 5000 }], 'no válidos'],
    ])('rechaza: %s', async (_caso, items, message) => {
      const res = await order(items);
      expect(res.status).toBe(400);
      expect(res.json.error).toContain(message);
    });

    it('suma las líneas repetidas del mismo producto antes de revisar el stock', async () => {
      const res = await order([{ product_id: 'Gaseosa', quantity: 6 }, { product_id: 'Gaseosa', quantity: 6 }]);
      expect(res.status).toBe(400);
    });

    it('rechaza pedidos sin datos del cliente', async () => {
      const res = await post('/orders/barrio', { customer_name: 'Marta', items: [{ product_id: 'Arroz', quantity: 1 }], delivery_method: 'pickup' });
      expect(res.status).toBe(400);
    });

    it('cobra el envío de la zona guardada, no el que manda el cliente', async () => {
      db.insert('shipping_zones', { id: 'z_centro', tenant_id: 't_barrio', zone_name: 'Centro', shipping_cost: 3000 });
      const res = await order([{ product_id: 'Arroz', quantity: 1 }], {
        delivery_method: 'delivery', shipping_zone_id: 'z_centro', shipping_cost: 0, delivery_address: 'Cra 5 # 10-20',
      });
      expect(res.json.data).toMatchObject({ subtotal: 4500, shipping_cost: 3000, total: 7500 });
    });

    it('exige elegir una zona válida cuando la tienda tiene zonas', async () => {
      db.insert('shipping_zones', { id: 'z_centro', tenant_id: 't_barrio', zone_name: 'Centro', shipping_cost: 3000 });
      db.insert('shipping_zones', { id: 'z_otra', tenant_id: 't_otra', zone_name: 'Otra', shipping_cost: 0 });
      expect((await order([{ product_id: 'Arroz', quantity: 1 }], { delivery_method: 'delivery' })).status).toBe(400);
      expect((await order([{ product_id: 'Arroz', quantity: 1 }], { delivery_method: 'delivery', shipping_zone_id: 'z_otra' })).status).toBe(400);
    });

    it('respeta el pedido mínimo de la tienda (sobre el subtotal con ofertas, sin el envío)', async () => {
      db.sqlite.exec(`UPDATE user_profiles SET store_min_order = 9000 WHERE id = 't_barrio'`);
      db.insert('shipping_zones', { id: 'z_centro', tenant_id: 't_barrio', zone_name: 'Centro', shipping_cost: 5000 });
      // $4.500 + $5.000 de envío no completa el mínimo de $9.000
      const low = await order([{ product_id: 'Arroz', quantity: 1 }], { delivery_method: 'delivery', shipping_zone_id: 'z_centro' });
      expect(low.status).toBe(400);
      expect(low.json.error).toContain('pedido mínimo');
      expect((await order([{ product_id: 'Arroz', quantity: 2 }])).status).toBe(201);

      // Con 50 % de oferta, 2 arroces quedan en $4.500: ya no alcanza.
      db.insert('offers', { id: 'o1', tenant_id: 't_barrio', product_id: 'Arroz', discount_percentage: 50, start_date: iso(-1), end_date: iso(1), is_active: 1 });
      expect((await order([{ product_id: 'Arroz', quantity: 2 }])).status).toBe(400);
    });

    it('no acepta envío a domicilio si la tienda solo tiene recogida', async () => {
      db.sqlite.exec(`UPDATE user_profiles SET store_shipping_enabled = 0 WHERE id = 't_barrio'`);
      const res = await order([{ product_id: 'Arroz', quantity: 1 }], { delivery_method: 'delivery' });
      expect(res.status).toBe(400);
      expect(res.json.error).toContain('no hace envíos');
      expect((await order([{ product_id: 'Arroz', quantity: 1 }])).status).toBe(201);
    });

    it('no acepta recogida si la tienda solo hace domicilios', async () => {
      db.sqlite.exec(`UPDATE user_profiles SET store_pickup_enabled = 0 WHERE id = 't_barrio'`);
      expect((await order([{ product_id: 'Arroz', quantity: 1 }])).status).toBe(400);
      expect((await order([{ product_id: 'Arroz', quantity: 1 }], { delivery_method: 'delivery' })).status).toBe(201);
    });

    it('si la tienda apagó las dos formas de entrega, igual deja recoger', async () => {
      db.sqlite.exec(`UPDATE user_profiles SET store_pickup_enabled = 0, store_shipping_enabled = 0 WHERE id = 't_barrio'`);
      expect((await order([{ product_id: 'Arroz', quantity: 1 }])).status).toBe(201);
      expect((await order([{ product_id: 'Arroz', quantity: 1 }], { delivery_method: 'delivery' })).status).toBe(400);
    });

    it('no repite el número de pedido aunque se borre una venta', async () => {
      db.insert('sales', { id: 'pos1', tenant_id: 't_barrio', sale_number: 'VTA-1', cashier_id: 't_barrio', total: 1000, payment_method: 'efectivo' });
      const first = await order([{ product_id: 'Arroz', quantity: 1 }]);
      db.sqlite.exec(`DELETE FROM sales WHERE id = 'pos1'`);
      const second = await order([{ product_id: 'Arroz', quantity: 1 }]);
      expect(second.json.data.order_number).not.toBe(first.json.data.order_number);
    });

    it('numera los pedidos del día seguidos, después del mayor ya usado', async () => {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      // Pedido de hoy creado con la numeración vieja ("ventas + 1")
      db.insert('sales', { id: 'viejo', tenant_id: 't_barrio', sale_number: `WEB-${today}-000033`, cashier_id: 't_barrio', total: 1000, payment_method: 'transferencia' });
      db.insert('sales', { id: 'ajeno', tenant_id: 't_otra', sale_number: `WEB-${today}-000090`, cashier_id: 't_otra', total: 1000, payment_method: 'transferencia' });
      const a = await order([{ product_id: 'Arroz', quantity: 1 }]);
      const b = await order([{ product_id: 'Arroz', quantity: 1 }]);
      expect([a.json.data.order_number, b.json.data.order_number]).toEqual([`WEB-${today}-000034`, `WEB-${today}-000035`]);
    });
  });

  describe('referencia de pago por Nequi', () => {
    const newOrder = async () => (await order([{ product_id: 'Arroz', quantity: 1 }])).json.data;
    const sendRef = (orderNumber: string, token: string, reference: string) =>
      post(`/orders/barrio/${orderNumber}/reference`, { token, reference });

    it('queda "por verificar" y NO marca el pedido como pagado', async () => {
      const o = await newOrder();
      const res = await sendRef(o.order_number, o.order_token, 'm 1234 5678');
      expect(res.json.data).toMatchObject({ payment_reference: 'M12345678', verification_status: 'por_verificar' });
      const sale = db.sqlite.prepare(`SELECT status, payment_status, payment_reference FROM sales WHERE sale_number = ?`).get(o.order_number);
      expect(sale).toMatchObject({ status: 'pendiente', payment_status: 'pendiente', payment_reference: 'M12345678' });
    });

    it('sin el código secreto del pedido responde 404 (no revela qué pedidos existen)', async () => {
      const o = await newOrder();
      expect((await sendRef(o.order_number, 'otro-token', 'ABCD1234')).status).toBe(404);
      expect((await sendRef('WEB-NO-EXISTE', o.order_token, 'ABCD1234')).status).toBe(404);
    });

    it('no deja usar la misma referencia en dos pedidos', async () => {
      const a = await newOrder();
      const b = await newOrder();
      expect((await sendRef(a.order_number, a.order_token, 'ABCD1234')).status).toBe(200);
      const dup = await sendRef(b.order_number, b.order_token, 'abcd1234');
      expect(dup.status).toBe(409);
      expect(dup.json.error).toContain('ya fue usado');
    });

    it('con dos pedidos de igual número (numeración vieja), la referencia cae en el del código', async () => {
      const a = await newOrder();
      const b = await newOrder();
      db.sqlite.exec(`UPDATE sales SET sale_number = '${a.order_number}' WHERE sale_number = '${b.order_number}'`);
      expect((await sendRef(a.order_number, b.order_token, 'BBBB1111')).status).toBe(200);
      const rows = db.sqlite.prepare(`SELECT order_token, payment_reference FROM sales WHERE sale_number = ?`).all(a.order_number) as { order_token: string; payment_reference: string | null }[];
      const tokenB = await hashOrderToken(b.order_token);
      expect(rows.find((r) => r.order_token === tokenB)?.payment_reference).toBe('BBBB1111');
      expect(rows.find((r) => r.order_token !== tokenB)?.payment_reference).toBeNull();
    });

    it('rechaza referencias mal escritas', async () => {
      const o = await newOrder();
      expect((await sendRef(o.order_number, o.order_token, 'ab')).status).toBe(400);
    });

    it('un pedido ya confirmado no admite cambiar la referencia', async () => {
      const o = await newOrder();
      db.sqlite.exec(`UPDATE sales SET status = 'completada', payment_status = 'pagado' WHERE sale_number = '${o.order_number}'`);
      expect((await sendRef(o.order_number, o.order_token, 'ABCD1234')).status).toBe(409);
    });
  });

  describe('Nequi obligatorio', () => {
    it('una tienda sin número de Nequi no recibe pedidos (el cliente no tendría a dónde pagar)', async () => {
      store('t_sin_nequi', 'sin-nequi', { store_nequi_number: null });
      product('Pan', 't_sin_nequi');
      const res = await post('/orders/sin-nequi', {
        customer_name: 'Marta', customer_phone: '3109876543', delivery_method: 'pickup', items: [{ product_id: 'Pan', quantity: 1 }],
      });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('STORE_NEQUI_REQUIRED');
      expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id = 't_sin_nequi'`).get()).toMatchObject({ n: 0 });
    });

    it('un número incompleto tampoco sirve', async () => {
      store('t_corto', 'corto', { store_nequi_number: '317450' });
      product('Pan', 't_corto');
      const res = await post('/orders/corto', {
        customer_name: 'Marta', customer_phone: '3109876543', delivery_method: 'pickup', items: [{ product_id: 'Pan', quantity: 1 }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('pago con Wompi desde la tienda', () => {
    // Descartado: tomaba el monto del navegador y el webhook lo daba por pagado.
    it('está desactivado', async () => {
      global.fetch = jest.fn() as typeof fetch;
      const res = await post('/wompi/create-payment-link/barrio', { order_id: 'x', order_number: 'y', amount_in_cents: 200000 });
      expect(res.status).toBe(410);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('pago con ePayco desde la tienda', () => {
    // Desactivado: el monto lo mandaba el navegador (se podía pagar menos).
    it('está desactivado y no llama a ePayco aunque la tienda tenga llaves', async () => {
      db.sqlite.exec(`UPDATE user_profiles SET epayco_enabled = 1, epayco_public_key = 'pk', epayco_customer_id = '123' WHERE id = 't_barrio'`);
      const o = (await order([{ product_id: 'Arroz', quantity: 10 }])).json.data;
      global.fetch = jest.fn() as typeof fetch;
      const res = await post('/epayco/create-session/barrio', { order_id: o.order_id, order_number: o.order_number, amount: 1000 });
      expect(res.status).toBe(410);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
