/**
 * Rutas reales del Worker (/api/sales) contra el esquema real de D1 en memoria.
 */
import { OTHER_TENANT_ID, createWorker, seed } from './helpers/worker-app';

type Worker = ReturnType<typeof createWorker>;

const item = (product_id: string, quantity: number, unit_price = 2500) => ({
  product_id,
  quantity,
  unit_price,
  subtotal: unit_price * quantity,
});

const stockOf = (w: Worker, id: string) =>
  w.db.get<{ stock: number }>('SELECT stock FROM products WHERE id = ?', id)!.stock;

function sell(w: Worker, body: Record<string, unknown>) {
  const items = (body.items as ReturnType<typeof item>[]) ?? [];
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  return w.call('POST', '/api/sales', { total, payment_method: 'efectivo', ...body });
}

let w: Worker;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  w = createWorker();
  seed(w.db);
});

describe('POST /api/sales', () => {
  it('registra una venta en efectivo, sus items y descuenta el stock', async () => {
    const { status, json } = await sell(w, {
      items: [item('prod_gaseosa', 3), item('prod_pan', 1, 4200)],
    });

    expect(status).toBe(201);
    expect(json.data).toMatchObject({
      total: 11700,
      payment_method: 'efectivo',
      status: 'completada',
      payment_status: null,
      amount_pending: null,
    });
    expect(json.data.sale_number).toMatch(/^VTA-\d{8}-000001$/);
    expect(json.data.items).toHaveLength(2);
    expect(stockOf(w, 'prod_gaseosa')).toBe(17);
    expect(stockOf(w, 'prod_pan')).toBe(4);
  });

  it('varios computadores vendiendo a la vez: no se pierde stock ni se repite el número', async () => {
    // 5 cajas venden el mismo producto en paralelo (stock inicial 20)
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sell(w, { items: [item('prod_gaseosa', 2)] })),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(stockOf(w, 'prod_gaseosa')).toBe(10);
    const numbers = results.map((r) => r.json.data.sale_number);
    expect(new Set(numbers).size).toBe(5);
  });

  it('no descuenta stock de productos sin control de inventario', async () => {
    await sell(w, { items: [item('prod_servicio', 2, 10000)] });
    expect(stockOf(w, 'prod_servicio')).toBe(0);
  });

  it('una venta fiada queda pendiente y con todo el saldo por cobrar', async () => {
    const { json } = await sell(w, {
      payment_method: 'credito',
      customer_id: 'cli_rosa',
      items: [item('prod_gaseosa', 4)],
    });

    expect(json.data).toMatchObject({
      status: 'pendiente', // no cuenta en las estadísticas hasta que se pague
      payment_status: 'pendiente',
      amount_paid: 0,
      amount_pending: 10000,
    });
  });

  it('acepta pagos con Nequi (antes los rechazaba el CHECK de la tabla)', async () => {
    const { status } = await sell(w, { payment_method: 'nequi', items: [item('prod_pan', 1)] });
    expect(status).toBe(201);
  });

  it('numera las ventas de forma consecutiva por tienda', async () => {
    await sell(w, { items: [item('prod_pan', 1)] });
    const { json } = await sell(w, { items: [item('prod_pan', 1)] });
    expect(json.data.sale_number).toMatch(/-000002$/);
  });

  it.each([
    ['sin items', { items: [] }],
    ['sin método de pago', { payment_method: undefined, items: [item('prod_pan', 1)] }],
    ['cantidad 0', { items: [item('prod_pan', 0)] }],
    ['item sin subtotal', { items: [{ product_id: 'prod_pan', quantity: 1, unit_price: 2500 }] }],
  ])('rechaza una venta %s y no guarda nada', async (_case, body) => {
    const { status } = await w.call('POST', '/api/sales', { total: 2500, payment_method: 'efectivo', ...body });

    expect(status).toBe(400);
    expect(w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales')!.n).toBe(0);
    expect(stockOf(w, 'prod_pan')).toBe(5);
  });

  // BUG conocido: el número sale de COUNT(*) + 1, así que al borrar una venta
  // la siguiente repite el número de la última. Cuando se corrija, quitar `.failing`.
  it.failing('no repite números de venta después de eliminar una', async () => {
    const first = await sell(w, { items: [item('prod_pan', 1)] });
    await sell(w, { items: [item('prod_pan', 1)] });
    const third = await sell(w, { items: [item('prod_pan', 1)] });
    await w.call('DELETE', `/api/sales/${first.json.data.id}`);

    const fourth = await sell(w, { items: [item('prod_pan', 1)] });

    expect(fourth.json.data.sale_number).not.toBe(third.json.data.sale_number);
  });

  // BUG conocido: no se valida que el producto sea de la misma tienda; la venta
  // se guarda con un producto ajeno (aunque no le descuenta stock a la otra tienda).
  it.failing('rechaza productos de otra tienda', async () => {
    const { status } = await sell(w, { items: [item('prod_ajeno', 1)] });
    expect(status).toBe(400);
  });
});

describe('GET /api/sales', () => {
  it('devuelve las ventas con el nombre de cada producto y sin el token del pedido', async () => {
    await sell(w, { items: [item('prod_gaseosa', 1)] });
    w.db.sqlite.exec(`UPDATE sales SET order_token = 'secreto'`);

    const { json } = await w.call('GET', '/api/sales');

    expect(json.data).toHaveLength(1);
    expect(json.data[0].items[0].product.name).toBe('Gaseosa 350ml');
    expect(json.data[0]).not.toHaveProperty('order_token');
  });
});

describe('aislamiento entre tiendas (multi-tenant)', () => {
  it('una tienda no ve, ni consulta, ni borra las ventas de otra', async () => {
    const { json: created } = await sell(w, { items: [item('prod_gaseosa', 2)] });
    const saleId = created.data.id;
    const vecina = createWorker(OTHER_TENANT_ID, w.db);

    expect((await vecina.call('GET', '/api/sales')).json.data).toEqual([]);
    expect((await vecina.call('GET', `/api/sales/${saleId}`)).status).toBe(404);
    expect((await vecina.call('DELETE', `/api/sales/${saleId}`)).status).toBe(404);

    expect(stockOf(w, 'prod_gaseosa')).toBe(18);
    expect((await w.call('GET', `/api/sales/${saleId}`)).status).toBe(200);
  });
});

describe('DELETE /api/sales/:id', () => {
  it('elimina la venta y sus items y devuelve el stock', async () => {
    const { json } = await sell(w, { items: [item('prod_gaseosa', 5)] });
    expect(stockOf(w, 'prod_gaseosa')).toBe(15);

    const res = await w.call('DELETE', `/api/sales/${json.data.id}`);

    expect(res.status).toBe(200);
    expect(stockOf(w, 'prod_gaseosa')).toBe(20);
    expect(w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sale_items')!.n).toBe(0);
    expect((await w.call('GET', `/api/sales/${json.data.id}`)).status).toBe(404);
  });

  it('descuenta los puntos que el cliente ganó con esa venta (sin bajar de 0)', async () => {
    const { json } = await sell(w, {
      customer_id: 'cli_rosa',
      points_earned: 120,
      items: [item('prod_gaseosa', 1)],
    });

    await w.call('DELETE', `/api/sales/${json.data.id}`);

    expect(w.db.get<{ loyalty_points: number }>(
      'SELECT loyalty_points FROM customers WHERE id = ?',
      'cli_rosa'
    )!.loyalty_points).toBe(0);
  });

  it('al borrar una venta fiada le quita ese saldo a la deuda del cliente', async () => {
    const { json } = await sell(w, {
      payment_method: 'credito',
      customer_id: 'cli_pedro',
      items: [item('prod_gaseosa', 4)],
    });

    await w.call('DELETE', `/api/sales/${json.data.id}`);

    // Pedro debía 30.000; la venta (10.000) se registró aparte en el front, así
    // que el Worker resta el saldo pendiente: 30.000 − 10.000.
    expect(w.db.get<{ current_debt: number }>(
      'SELECT current_debt FROM customers WHERE id = ?',
      'cli_pedro'
    )!.current_debt).toBe(20000);
  });

  it('responde 404 si la venta no existe', async () => {
    expect((await w.call('DELETE', '/api/sales/no-existe')).status).toBe(404);
  });
});
