/**
 * Apertura y cierre de caja (/api/cash-sessions, migración 034): el cuadre lo
 * calcula el servidor con las ventas y abonos del turno, una sola caja abierta
 * por tienda y permisos de dueño / cajero.
 */
import { Hono } from 'hono';
import cashRoutes, { buildCloseMessage, parseAmount } from '../../cloudflare-migration/src/routes/cash-sessions';
import { D1DatabaseFake } from './helpers/d1-sqlite';

let db: D1DatabaseFake;

const call = async (clerkUserId: string, method: string, url: string, body?: unknown, tenantId = 't_tienda') => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('tenant' as never, { id: tenantId } as never);
    c.set('clerkUserId' as never, clerkUserId as never);
    await next();
  });
  app.route('/api/cash-sessions', cashRoutes);
  const res = await app.request(
    url,
    { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { DB: db }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as any };
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function sale(id: string, method: string, total: number, createdAt: string, extra: Record<string, unknown> = {}, tenant = 't_tienda') {
  db.insert('sales', {
    id, tenant_id: tenant, sale_number: `VTA-${id}`, cashier_id: tenant, total, subtotal: total,
    payment_method: method, status: method === 'credito' ? 'pendiente' : 'completada',
    created_at: createdAt, updated_at: createdAt, ...extra,
  });
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  db = new D1DatabaseFake();
  for (const [id, clerk] of [['t_tienda', 'clerk_dueno'], ['t_vecina', 'clerk_vecina']]) {
    db.insert('user_profiles', { id, clerk_user_id: clerk, email: `${id}@tienda.co`, full_name: 'Doña Marta', role: 'admin', subscription_status: 'active' });
  }
  db.insert('customers', { id: 'c1', tenant_id: 't_tienda', name: 'Don Jorge' });
  db.insert('team_members', {
    id: 'm1', tenant_id: 't_tienda', owner_id: 't_tienda', clerk_user_id: 'clerk_cajera', email: 'cajera@tienda.co', full_name: 'Luz',
    role: 'cajero', permissions: JSON.stringify(['access_pos', 'process_sales']), status: 'active', invitation_status: 'accepted',
  });
  db.insert('team_members', {
    id: 'm2', tenant_id: 't_tienda', owner_id: 't_tienda', clerk_user_id: 'clerk_bodega', email: 'bodega@tienda.co',
    role: 'custom', permissions: JSON.stringify(['view_products']), status: 'active', invitation_status: 'accepted',
  });
});

describe('parseAmount', () => {
  it('acepta números y textos con separadores; rechaza negativos y basura', () => {
    expect(parseAmount(50000)).toBe(50000);
    expect(parseAmount('50.000')).toBe(50000);
    expect(parseAmount(0)).toBe(0);
    expect(parseAmount(-1)).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('abrir y cerrar la caja', () => {
  it('cuadra con base + ventas en efectivo + abonos en efectivo del turno', async () => {
    const opened = await call('clerk_cajera', 'POST', '/api/cash-sessions/open', { opening_amount: 50000 });
    expect(opened.status).toBe(201);
    expect(opened.json.data.opened_by_name).toBe('Luz');
    const id = opened.json.data.id;

    // Antes de abrir (no cuenta), en el turno (cuentan) y de otra tienda (no cuenta).
    sale('antes', 'efectivo', 99000, ago(600));
    db.sqlite.exec(`UPDATE cash_sessions SET opened_at = '${ago(120)}' WHERE id = '${id}'`);
    sale('s1', 'efectivo', 12000, ago(60));
    sale('s2', 'efectivo', 8000, ago(30));
    sale('s3', 'nequi', 25000, ago(20));
    sale('s4', 'credito', 40000, ago(10), { customer_id: 'c1', payment_status: 'pendiente', amount_pending: 40000 });
    sale('anulada', 'efectivo', 7000, ago(15), { status: 'cancelada' });
    sale('vecina', 'efectivo', 5000, ago(5), {}, 't_vecina');
    db.insert('credit_payments', { id: 'p1', tenant_id: 't_tienda', sale_id: 's4', customer_id: 'c1', amount: 10000, payment_method: 'efectivo', cashier_id: 't_tienda', created_at: ago(5) });
    db.insert('credit_payments', { id: 'p2', tenant_id: 't_tienda', sale_id: 's4', customer_id: 'c1', amount: 6000, payment_method: 'transferencia', cashier_id: 't_tienda', created_at: ago(4) });

    const current = await call('clerk_cajera', 'GET', '/api/cash-sessions/current');
    expect(current.json.data.summary).toMatchObject({
      cash_sales: 20000,
      cash_payments: 10000,
      expected_cash: 80000, // 50.000 + 20.000 + 10.000
      sales_count: 4,
    });
    expect(current.json.data.summary.sales.nequi).toEqual({ count: 1, total: 25000 });

    const closed = await call('clerk_cajera', 'POST', `/api/cash-sessions/${id}/close`, { counted_cash: 78000, notes: 'Faltó cambio' });
    expect(closed.status).toBe(200);
    expect(closed.json.data).toMatchObject({
      status: 'closed', expected_cash: 80000, counted_cash: 78000, difference: -2000, closed_by_name: 'Luz', notes: 'Faltó cambio',
    });
    expect(closed.json.data.totals.sales.credito.total).toBe(40000);

    // Ya no hay caja abierta y no se puede cerrar dos veces.
    expect((await call('clerk_cajera', 'GET', '/api/cash-sessions/current')).json.data.session).toBeNull();
    expect((await call('clerk_cajera', 'POST', `/api/cash-sessions/${id}/close`, { counted_cash: 1 })).status).toBe(409);
  });

  it('cuenta las fechas guardadas con formato de SQLite (sin T ni Z)', async () => {
    const opened = await call('clerk_dueno', 'POST', '/api/cash-sessions/open', { opening_amount: 0 });
    const id = opened.json.data.id;
    db.sqlite.exec(`UPDATE cash_sessions SET opened_at = '${ago(60)}' WHERE id = '${id}'`);
    sale('s1', 'efectivo', 3000, ago(30).replace('T', ' ').replace(/\.\d+Z$/, ''));
    const current = await call('clerk_dueno', 'GET', '/api/cash-sessions/current');
    expect(current.json.data.summary.cash_sales).toBe(3000);
  });

  it('solo una caja abierta por tienda', async () => {
    expect((await call('clerk_dueno', 'POST', '/api/cash-sessions/open', { opening_amount: 1000 })).status).toBe(201);
    const again = await call('clerk_cajera', 'POST', '/api/cash-sessions/open', { opening_amount: 1000 });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('CASH_ALREADY_OPEN');
    // La tienda vecina sí puede abrir la suya.
    expect((await call('clerk_vecina', 'POST', '/api/cash-sessions/open', { opening_amount: 0 }, 't_vecina')).status).toBe(201);
  });

  it('valida los montos', async () => {
    expect((await call('clerk_dueno', 'POST', '/api/cash-sessions/open', { opening_amount: -5 })).status).toBe(400);
    const id = (await call('clerk_dueno', 'POST', '/api/cash-sessions/open', { opening_amount: 0 })).json.data.id;
    expect((await call('clerk_dueno', 'POST', `/api/cash-sessions/${id}/close`, {})).status).toBe(400);
  });

  it('no se puede cerrar la caja de otra tienda', async () => {
    const id = (await call('clerk_vecina', 'POST', '/api/cash-sessions/open', { opening_amount: 0 }, 't_vecina')).json.data.id;
    expect((await call('clerk_dueno', 'POST', `/api/cash-sessions/${id}/close`, { counted_cash: 0 })).status).toBe(404);
  });
});

describe('entradas y salidas de efectivo', () => {
  const open = async (clerk = 'clerk_dueno', amount = 50000) =>
    (await call(clerk, 'POST', '/api/cash-sessions/open', { opening_amount: amount })).json.data.id as string;
  const move = (clerk: string, id: string, body: unknown, tenant = 't_tienda') =>
    call(clerk, 'POST', `/api/cash-sessions/${id}/movements`, body, tenant);

  it('las salidas restan y las entradas suman en lo que debe haber en la caja', async () => {
    const id = await open('clerk_cajera');
    db.sqlite.exec(`UPDATE cash_sessions SET opened_at = '${ago(120)}' WHERE id = '${id}'`);
    sale('s1', 'efectivo', 30000, ago(10));
    expect((await move('clerk_cajera', id, { kind: 'salida', amount: '20.000', reason: 'Pago a proveedor de huevos' })).status).toBe(201);
    expect((await move('clerk_cajera', id, { kind: 'entrada', amount: 10000, reason: 'Cambio de la dueña' })).status).toBe(201);

    const current = await call('clerk_cajera', 'GET', '/api/cash-sessions/current');
    expect(current.json.data.summary).toMatchObject({ cash_out: 20000, cash_in: 10000, expected_cash: 70000 }); // 50.000 + 30.000 + 10.000 - 20.000
    expect(current.json.data.summary.movements).toHaveLength(2);
    expect(current.json.data.summary.movements[0]).toMatchObject({ kind: 'salida', reason: 'Pago a proveedor de huevos', created_by_name: 'Luz' });

    const closed = await call('clerk_cajera', 'POST', `/api/cash-sessions/${id}/close`, { counted_cash: 70000 });
    expect(closed.json.data).toMatchObject({ expected_cash: 70000, difference: 0 });
    expect(closed.json.data.totals).toMatchObject({ cash_out: 20000, cash_in: 10000 });
    expect(closed.json.data.totals.movements).toHaveLength(2);
  });

  it('valida el tipo, el valor y el motivo', async () => {
    const id = await open();
    expect((await move('clerk_dueno', id, { kind: 'otra', amount: 1000, reason: 'x' })).status).toBe(400);
    expect((await move('clerk_dueno', id, { kind: 'salida', amount: 0, reason: 'x' })).status).toBe(400);
    expect((await move('clerk_dueno', id, { kind: 'salida', amount: -5, reason: 'x' })).status).toBe(400);
    expect((await move('clerk_dueno', id, { kind: 'salida', amount: 1000, reason: '  ' })).status).toBe(400);
  });

  it('no se registra en una caja cerrada, ajena o sin permiso', async () => {
    const id = await open();
    const vecina = (await call('clerk_vecina', 'POST', '/api/cash-sessions/open', { opening_amount: 0 }, 't_vecina')).json.data.id;
    expect((await move('clerk_dueno', vecina, { kind: 'salida', amount: 1000, reason: 'x' })).status).toBe(404);
    expect((await move('clerk_bodega', id, { kind: 'salida', amount: 1000, reason: 'x' })).status).toBe(403);
    await call('clerk_dueno', 'POST', `/api/cash-sessions/${id}/close`, { counted_cash: 0 });
    expect((await move('clerk_dueno', id, { kind: 'salida', amount: 1000, reason: 'x' })).status).toBe(409);
  });

  it('solo el dueño borra un movimiento, y solo con la caja abierta', async () => {
    const id = await open();
    const movementId = (await move('clerk_cajera', id, { kind: 'salida', amount: 5000, reason: 'Bolsas' })).json.data.id;
    const del = (clerk: string) => call(clerk, 'DELETE', `/api/cash-sessions/${id}/movements/${movementId}`);

    expect((await del('clerk_cajera')).status).toBe(403);
    expect((await call('clerk_cajera', 'GET', '/api/cash-sessions/current')).json.data.summary.cash_out).toBe(5000);
    expect((await call('clerk_cajera', 'GET', '/api/cash-sessions/current')).json.data.is_owner).toBe(false);
    expect((await call('clerk_dueno', 'GET', '/api/cash-sessions/current')).json.data.is_owner).toBe(true);

    expect((await del('clerk_dueno')).status).toBe(200);
    expect((await call('clerk_dueno', 'GET', '/api/cash-sessions/current')).json.data.summary.cash_out).toBe(0);
    expect((await del('clerk_dueno')).status).toBe(404);

    const again = (await move('clerk_dueno', id, { kind: 'salida', amount: 1000, reason: 'Hielo' })).json.data.id;
    await call('clerk_dueno', 'POST', `/api/cash-sessions/${id}/close`, { counted_cash: 0 });
    expect((await call('clerk_dueno', 'DELETE', `/api/cash-sessions/${id}/movements/${again}`)).status).toBe(404);
  });
});

describe('permisos', () => {
  it('un empleado sin permiso de vender no abre caja ni ve el historial; la cajera abre pero no ve el historial', async () => {
    expect((await call('clerk_bodega', 'POST', '/api/cash-sessions/open', { opening_amount: 0 })).status).toBe(403);
    expect((await call('clerk_bodega', 'GET', '/api/cash-sessions/current')).status).toBe(403);
    expect((await call('clerk_desconocido', 'GET', '/api/cash-sessions/current')).status).toBe(403);
    expect((await call('clerk_cajera', 'GET', '/api/cash-sessions')).status).toBe(403);
  });

  it('el dueño ve el historial, del más reciente al más viejo', async () => {
    const a = (await call('clerk_dueno', 'POST', '/api/cash-sessions/open', { opening_amount: 0 })).json.data.id;
    db.sqlite.exec(`UPDATE cash_sessions SET opened_at = '${ago(300)}' WHERE id = '${a}'`);
    await call('clerk_dueno', 'POST', `/api/cash-sessions/${a}/close`, { counted_cash: 0 });
    const b = (await call('clerk_dueno', 'POST', '/api/cash-sessions/open', { opening_amount: 20000 })).json.data.id;
    const history = await call('clerk_dueno', 'GET', '/api/cash-sessions');
    expect(history.status).toBe(200);
    expect(history.json.data.map((s: { id: string }) => s.id)).toEqual([b, a]);
  });
});

describe('mensaje de Telegram', () => {
  it('dice si sobra o falta y lista los otros medios de pago', () => {
    const base = {
      id: 'x', status: 'closed' as const, opened_at: '2026-11-05T13:00:00.000Z', opened_by_name: 'Luz', opening_amount: 50000,
      closed_at: '2026-11-05T23:00:00.000Z', closed_by_name: 'Luz', cash_sales: 20000, cash_payments: 10000,
      expected_cash: 80000, counted_cash: 78000, difference: -2000, sales_count: 4, notes: null,
      totals: { sales: { efectivo: { count: 2, total: 20000 }, nequi: { count: 1, total: 25000 } }, payments: {} },
    };
    const msg = buildCloseMessage('La <Esquina>', base);
    expect(msg).toContain('La &lt;Esquina&gt;');
    expect(msg).toContain('Faltan');
    expect(msg).toContain('Nequi');
    expect(buildCloseMessage('X', { ...base, difference: 0 })).toContain('cuadra exacto');
  });

  it('lista los movimientos de efectivo con su motivo (escapado)', () => {
    const msg = buildCloseMessage('X', {
      id: 'x', status: 'closed', opened_at: '2026-11-05T13:00:00.000Z', opened_by_name: null, opening_amount: 0,
      closed_at: '2026-11-05T23:00:00.000Z', closed_by_name: null, cash_sales: 0, cash_payments: 0,
      expected_cash: 0, counted_cash: 0, difference: 0, sales_count: 0, notes: null,
      totals: {
        sales: {}, payments: {}, cash_in: 0, cash_out: 20000,
        movements: [{ id: 'm', kind: 'salida', amount: 20000, reason: 'Proveedor <Alpina>', created_by_name: 'Luz', created_at: '2026-11-05T15:00:00.000Z' }],
      },
    });
    expect(msg).toContain('Salidas de efectivo: -');
    expect(msg).toContain('Proveedor &lt;Alpina&gt;');
  });
});
