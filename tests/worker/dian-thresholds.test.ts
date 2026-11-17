/**
 * Topes DIAN (/api/dian-thresholds y aviso diario): reglas, cambio de año,
 * permisos y envío de avisos contra el esquema real de D1.
 */
import { Hono } from 'hono';
import dianRoutes, { runDianThresholdAlerts } from '../../cloudflare-migration/src/routes/dian-thresholds';
import {
  evaluateDianThresholds,
  shouldNotify,
  dianAlertMessage,
  uvtFor,
  type DianThresholdsInput,
} from '../../cloudflare-migration/src/utils/dian-thresholds';
import { D1DatabaseFake } from './helpers/d1-sqlite';

// 26 de octubre de 2026, 10 AM en Colombia.
const NOW = Date.parse('2026-10-26T15:00:00Z');
const CAP_2026 = 3500 * 52374; // $183.309.000

const base: DianThresholdsInput = {
  year: 2026,
  yearSales: 50_000_000,
  previousYearSales: 0,
  firstSaleAt: Date.parse('2026-01-02T15:00:00Z'),
  alreadyInvoicing: false,
};
const evalAt = (input: Partial<DianThresholdsInput>, now = NOW) => evaluateDianThresholds({ ...base, ...input }, now);

describe('evaluateDianThresholds', () => {
  it('usa la UVT de 2026 ($52.374): tope de facturación $183.309.000 y de renta $73.323.600', () => {
    const r = evalAt({});
    expect(r).toMatchObject({ uvt: 52374, uvtEstimated: false, eInvoiceCap: 183_309_000, incomeTaxCap: 73_323_600 });
    expect(r.remaining).toBe(183_309_000 - 50_000_000);
    expect(r.level).toBe('ok');
  });

  it('sube de nivel al 70 %, 90 % y 100 % del tope', () => {
    expect(evalAt({ yearSales: Math.ceil(CAP_2026 * 0.7) }).level).toBe('aviso');
    expect(evalAt({ yearSales: Math.ceil(CAP_2026 * 0.9) }).level).toBe('importante');
    const over = evalAt({ yearSales: CAP_2026 });
    expect(over).toMatchObject({ level: 'obligado', remaining: 0, incomeTaxExceeded: true });
  });

  it('en 2027 el conteo empieza en cero, pero si 2026 pasó el tope sigue obligado desde enero', () => {
    const jan2027 = Date.parse('2027-01-05T15:00:00Z');
    const fresh = evalAt({ year: 2027, yearSales: 0, previousYearSales: 90_000_000, firstSaleAt: null }, jan2027);
    expect(fresh).toMatchObject({ yearSales: 0, level: 'ok' });

    const carried = evalAt({ year: 2027, yearSales: 0, previousYearSales: 190_000_000, firstSaleAt: null }, jan2027);
    expect(carried.level).toBe('obligado');
    expect(carried.previousYear).toMatchObject({ year: 2026, cap: CAP_2026, exceeded: true });
  });

  it('si la DIAN no ha publicado la UVT del año usa la última conocida y lo marca', () => {
    expect(uvtFor(2027)).toEqual({ uvt: 52374, estimated: true });
    expect(uvtFor(2025)).toEqual({ uvt: 49799, estimated: false });
  });

  it('proyecta la fecha en que llegaría al tope al ritmo actual', () => {
    // ~$600.000 diarios desde el 2 de enero -> llega al tope en octubre/noviembre.
    const r = evalAt({ yearSales: 177_000_000 });
    expect(r.projectedCapDate).toMatch(/^2026-1[01]-\d{2}$/);
    expect(r.projectedYearSales).toBeGreaterThan(CAP_2026);
    // Una tienda chica no llega al tope este año.
    expect(evalAt({}).projectedCapDate).toBeNull();
  });

  it('no proyecta con menos de dos semanas de datos', () => {
    expect(evalAt({ firstSaleAt: NOW - 5 * 86400000 }).projectedYearSales).toBeNull();
  });
});

describe('shouldNotify', () => {
  const at = (yearSales: number, extra: Partial<DianThresholdsInput> = {}) => evalAt({ yearSales, ...extra });

  it('avisa una vez por nivel y vuelve a avisar al subir', () => {
    const aviso = at(CAP_2026 * 0.75);
    expect(shouldNotify(aviso, null)).toBe(true);
    expect(shouldNotify(aviso, '2026:aviso')).toBe(false);
    expect(shouldNotify(at(CAP_2026 * 0.95), '2026:aviso')).toBe(true);
    expect(shouldNotify(at(CAP_2026 * 0.75), '2026:importante')).toBe(false);
  });

  it('un año nuevo vuelve a avisar aunque el nivel sea el mismo', () => {
    const r = evalAt({ year: 2027, yearSales: 0, previousYearSales: 190_000_000 }, Date.parse('2027-01-02T15:00:00Z'));
    expect(shouldNotify(r, '2026:obligado')).toBe(true);
  });

  it('no molesta a quien ya factura electrónicamente ni a quien está lejos del tope', () => {
    expect(shouldNotify(at(CAP_2026, { alreadyInvoicing: true }), null)).toBe(false);
    expect(shouldNotify(at(10_000_000), null)).toBe(false);
  });

  it('el mensaje dice cuánto lleva, cuánto le queda y aclara que es orientativo', () => {
    const { title, lines } = dianAlertMessage(at(170_000_000));
    expect(title).toContain('Importante');
    const text = lines.join(' ');
    expect(text).toContain('$170.000.000');
    expect(text).toContain('$13.309.000');
    expect(text).toContain('contador');
  });
});

describe('rutas y aviso diario', () => {
  let db: D1DatabaseFake;
  const sends: { url: string; body: string }[] = [];

  const call = async (clerkUserId: string, method = 'GET', path = '/', body?: unknown) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('tenant' as never, { id: 't_tienda' } as never);
      c.set('clerkUserId' as never, clerkUserId as never);
      await next();
    });
    app.route('/api/dian-thresholds', dianRoutes);
    const res = await app.request(
      `/api/dian-thresholds${path === '/' ? '' : path}`,
      { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined },
      { DB: db }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };

  const sale = (id: string, total: number, created_at: string, extra = {}) =>
    db.insert('sales', {
      id,
      tenant_id: 't_tienda',
      sale_number: id,
      cashier_id: 't_tienda',
      total,
      payment_method: 'efectivo',
      created_at,
      ...extra,
    });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(NOW);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    sends.length = 0;
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sends.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ ok: true, id: 'x' }), { status: 200 });
    }) as typeof fetch;

    db = new D1DatabaseFake();
    db.insert('user_profiles', {
      id: 't_tienda',
      clerk_user_id: 'clerk_dueno',
      email: 'dueno@tienda.co',
      role: 'admin',
      full_name: 'Doña Marta',
      subscription_status: 'active',
      telegram_chat_id: '999',
    });
    const member = (id: string, clerk: string, permissions: string[]) =>
      db.insert('team_members', {
        id,
        tenant_id: 't_tienda',
        owner_id: 't_tienda',
        clerk_user_id: clerk,
        email: `${id}@tienda.co`,
        role: 'custom',
        permissions: JSON.stringify(permissions),
        status: 'active',
        invitation_status: 'accepted',
      });
    member('m_cajera', 'clerk_cajera', ['access_pos', 'process_sales']);
    member('m_admin', 'clerk_admin', ['view_reports']);

    sale('s_2025', 20_000_000, '2025-12-31 23:00:00'); // 31 dic, 6 PM en Colombia: cuenta para 2025
    sale('s_ano_nuevo', 1_000_000, '2026-01-01T04:30:00.000Z'); // 31 dic 11:30 PM Colombia: también 2025
    sale('s_ene', 100_000_000, '2026-01-10T15:00:00.000Z');
    sale('s_oct', 50_000_000, '2026-10-20 15:00:00');
    sale('s_fiado', 5_000_000, '2026-10-21 15:00:00', { payment_method: 'credito', status: 'pendiente' });
    sale('s_anulada', 99_000_000, '2026-10-22 15:00:00', { status: 'cancelada' });
  });

  afterEach(() => jest.useRealTimers());

  it('el dueño ve lo vendido en el año según la hora de Colombia, sin anuladas', async () => {
    const { status, json } = await call('clerk_dueno');
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      year: 2026,
      yearSales: 155_000_000,
      previousYear: { year: 2025, sales: 21_000_000, exceeded: false },
      level: 'aviso',
    });
  });

  it('trae lo vendido mes a mes del año (hora Colombia, sin anuladas)', async () => {
    const { json } = await call('clerk_dueno');
    expect(json.data.months).toEqual([
      { month: 1, sales: 100_000_000, count: 1 },
      { month: 10, sales: 55_000_000, count: 2 },
    ]);
  });

  it('la cajera no ve las ventas del año; quien tiene permiso de reportes sí', async () => {
    expect((await call('clerk_cajera')).status).toBe(403);
    expect((await call('clerk_admin')).status).toBe(200);
    expect((await call('clerk_desconocido')).status).toBe(403);
  });

  it('el tendero puede marcar que ya factura electrónicamente', async () => {
    expect((await call('clerk_dueno', 'PUT', '/ack', { already_invoicing: true })).status).toBe(200);
    expect((await call('clerk_dueno')).json.data.alreadyInvoicing).toBe(true);
    expect((await call('clerk_dueno', 'PUT', '/ack', { already_invoicing: 'si' })).status).toBe(400);
  });

  it('el aviso diario llega por Telegram al dueño y por correo, una sola vez por nivel', async () => {
    const env = { DB: db, TELEGRAM_BOT_TOKEN: 'tg', RESEND_API_KEY: 're' } as never;

    expect(await runDianThresholdAlerts(env, NOW)).toMatchObject({ year: 2026, checked: 1, notified: 1 });
    const telegram = sends.filter((s) => s.url.includes('api.telegram.org'));
    const email = sends.filter((s) => s.url.includes('api.resend.com'));
    expect(telegram).toHaveLength(1);
    expect(JSON.parse(telegram[0].body)).toMatchObject({ chat_id: '999' });
    expect(telegram[0].body).toContain('$155.000.000');
    expect(email).toHaveLength(1);
    expect(db.get<{ v: string }>('SELECT dian_alert_sent AS v FROM user_profiles WHERE id = ?', 't_tienda')!.v).toBe('2026:aviso');

    sends.length = 0;
    expect((await runDianThresholdAlerts(env, NOW)).notified).toBe(0);
    expect(sends).toHaveLength(0);
  });
});
