/**
 * Resumen de cierre de mes por Telegram: cuándo se envía, a quién, qué dice
 * y que no se repite.
 */
import {
  closedMonth,
  monthEndMessage,
  runMonthEndSummary,
} from '../../cloudflare-migration/src/utils/month-end-summary';
import { D1DatabaseFake } from './helpers/d1-sqlite';

// 1 de noviembre de 2026, 7 AM en Colombia.
const NOV_1 = Date.parse('2026-11-01T12:00:00Z');

describe('monthEndMessage', () => {
  const months = (sales: number[]) => sales.map((s) => ({ sales: s, count: s > 0 ? 10 : 0 }));

  it('cuenta el mes, la variación, el acumulado y la proyección del año', () => {
    const text = monthEndMessage({
      storeName: 'Tienda Marta',
      year: 2026,
      month: 10,
      monthly: months([0, 0, 0, 0, 0, 0, 0, 0, 10_000_000, 12_000_000]),
      alreadyInvoicing: false,
    })!;
    expect(text).toContain('Cierre de octubre 2026');
    expect(text).toContain('$12.000.000');
    expect(text).toContain('+20% frente a septiembre');
    expect(text).toContain('Llevas <b>$22.000.000</b> en 2026');
    expect(text).toContain('$44.000.000'); // 22M + 11M de promedio × 2 meses
    expect(text).toContain('margen');
  });

  it('avisa si a ese ritmo pasaría el tope de la DIAN', () => {
    const text = monthEndMessage({
      storeName: 'T',
      year: 2026,
      month: 6,
      monthly: months([18e6, 18e6, 18e6, 18e6, 18e6, 18e6]),
      alreadyInvoicing: false,
    })!;
    expect(text).toContain('pasarías el tope');
  });

  it('a quien ya factura no le habla del tope; sin ventas en el mes no envía nada', () => {
    const base = { storeName: 'T', year: 2026, month: 2, alreadyInvoicing: true };
    expect(monthEndMessage({ ...base, monthly: months([5e6, 5e6]) })).not.toContain('tope');
    expect(monthEndMessage({ ...base, monthly: months([5e6, 0]) })).toBeNull();
  });

  it('el 1 de enero resume diciembre y el cierre del año anterior', () => {
    expect(closedMonth(Date.parse('2027-01-01T12:00:00Z'))).toEqual({ year: 2026, month: 12 });
    const text = monthEndMessage({ storeName: 'T', year: 2026, month: 12, monthly: months(Array(12).fill(1e6)), alreadyInvoicing: false })!;
    expect(text).toContain('Cerraste 2026 con <b>$12.000.000</b>');
  });
});

describe('runMonthEndSummary', () => {
  let db: D1DatabaseFake;
  const sends: { url: string; body: string }[] = [];
  const kv = new Map<string, string>();
  const env = () =>
    ({
      DB: db,
      TELEGRAM_BOT_TOKEN: 'tg',
      TENANTS: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => void kv.set(k, v),
      },
    }) as never;

  beforeEach(() => {
    sends.length = 0;
    kv.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sends.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    db = new D1DatabaseFake();
    const store = (id: string, extra = {}) =>
      db.insert('user_profiles', {
        id,
        clerk_user_id: `clerk_${id}`,
        email: `${id}@tienda.co`,
        role: 'admin',
        subscription_status: 'active',
        telegram_chat_id: `chat_${id}`,
        ...extra,
      });
    store('t_marta');
    store('t_sin_telegram', { telegram_chat_id: null });
    store('t_apagado', { telegram_enabled: 0 });
    store('t_vencida', { subscription_status: 'expired' });
    const sale = (id: string, tenant: string, total: number, created_at: string, extra = {}) =>
      db.insert('sales', { id, tenant_id: tenant, sale_number: id, cashier_id: tenant, total, payment_method: 'efectivo', created_at, ...extra });
    sale('s1', 't_marta', 3_000_000, '2026-10-05 15:00:00');
    sale('s2', 't_marta', 2_000_000, '2026-11-01T04:00:00.000Z'); // 31 oct, 11 PM Colombia
    sale('s3', 't_marta', 9_000_000, '2026-10-06 15:00:00', { status: 'cancelada' });
    sale('s4', 't_marta', 1_000_000, '2026-11-01T13:00:00.000Z'); // ya es noviembre
    for (const t of ['t_sin_telegram', 't_apagado', 't_vencida']) sale(`x_${t}`, t, 1_000_000, '2026-10-05 15:00:00');
  });

  it('el día 1 envía el cierre del mes solo al Telegram de las tiendas activas, una sola vez', async () => {
    expect(await runMonthEndSummary(env(), NOV_1)).toMatchObject({ month: '2026-10', sent: 1 });
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0].body)).toMatchObject({ chat_id: 'chat_t_marta' });
    expect(sends[0].body).toContain('$5.000.000'); // sin anulada, con la venta de las 11 PM del 31

    sends.length = 0;
    expect((await runMonthEndSummary(env(), NOV_1)).sent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('otros días no hace nada', async () => {
    expect(await runMonthEndSummary(env(), Date.parse('2026-11-02T12:00:00Z'))).toMatchObject({ skipped: true });
    expect(sends).toHaveLength(0);
  });
});
