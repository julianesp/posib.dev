/**
 * PUT /api/user-profiles/:id: el tendero (o un empleado con su token) no puede
 * activarse el plan ni los complementos sin pagar. Solo el superadmin y las
 * llamadas internas (apply-payment del webhook de ePayco) tocan esos campos.
 */
import { Hono } from 'hono';
import userProfileRoutes from '../../cloudflare-migration/src/routes/user-profiles';
import { D1DatabaseFake } from './helpers/d1-sqlite';

let db: D1DatabaseFake;

const put = async (body: Record<string, unknown>, isSuperadmin = false) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('tenant' as never, { id: 'p1', is_superadmin: isSuperadmin } as never);
    c.set('clerkUserId' as never, 'clerk_p1' as never);
    c.set('userProfileId' as never, 'p1' as never);
    await next();
  });
  app.route('/api/user-profiles', userProfileRoutes);
  const res = await app.request('/api/user-profiles/p1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as any };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const profile = () => db.sqlite.prepare(`SELECT * FROM user_profiles WHERE id = 'p1'`).get() as any;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  db = new D1DatabaseFake();
  for (const col of [
    'has_ai_addon INTEGER DEFAULT 0', 'has_store_addon INTEGER DEFAULT 0', 'has_email_addon INTEGER DEFAULT 0',
    'store_addon_expires_at TEXT',
  ]) {
    try {
      db.sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN ${col}`);
    } catch {
      // ya existe en el esquema base
    }
  }
  db.insert('user_profiles', {
    id: 'p1', clerk_user_id: 'clerk_p1', email: 'a@b.co', role: 'admin',
    subscription_status: 'expired', trial_end_date: '2026-01-01T00:00:00.000Z',
  });
});

describe('campos de cobro en el PUT del perfil', () => {
  it.each([
    [{ subscription_status: 'active', next_billing_date: '2099-01-01T00:00:00.000Z' }],
    [{ has_store_addon: 1, store_addon_expires_at: '2099-01-01T00:00:00.000Z' }],
    [{ has_ai_addon: true }],
    [{ trial_end_date: '2099-01-01T00:00:00.000Z' }],
    [{ plan_id: 'basic-monthly', last_payment_date: '2026-11-05T00:00:00.000Z' }],
  ])('el tendero no puede escribir %j', async (body) => {
    const res = await put({ full_name: 'Doña Marta', ...body });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('BILLING_FIELDS_FORBIDDEN');
    // Nada del guardado se aplica, ni siquiera los campos permitidos.
    expect(profile().subscription_status).toBe('expired');
    expect(profile().full_name).not.toBe('Doña Marta');
    expect(profile().has_store_addon).toBe(0);
  });

  it('sí puede marcar su propia suscripción como vencida', async () => {
    db.sqlite.exec(`UPDATE user_profiles SET subscription_status = 'trial' WHERE id = 'p1'`);
    expect((await put({ subscription_status: 'expired' })).status).toBe(200);
    expect(profile().subscription_status).toBe('expired');
  });

  it('puede fijar el fin del trial solo si no existía y a máximo 31 días', async () => {
    db.sqlite.exec(`UPDATE user_profiles SET trial_end_date = NULL WHERE id = 'p1'`);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString();
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString();
    expect((await put({ trial_end_date: in90 })).status).toBe(403);
    expect((await put({ trial_end_date: in30 })).status).toBe(200);
    expect((await put({ trial_end_date: in30 })).status).toBe(403);
  });

  it('el superadmin sí puede activar plan y complementos', async () => {
    const res = await put({ subscription_status: 'active', has_store_addon: 1 }, true);
    expect(res.status).toBe(200);
    expect(profile().subscription_status).toBe('active');
    expect(profile().has_store_addon).toBe(1);
  });

  it('los demás campos del perfil se siguen guardando', async () => {
    expect((await put({ full_name: 'Doña Marta', phone: '3001234567' })).status).toBe(200);
    expect(profile().full_name).toBe('Doña Marta');
  });
});
