/**
 * Negocio de varios socios (/api/partnership): validación, permisos y guardado
 * contra el esquema real de D1 (migración 032).
 */
import { Hono } from 'hono';
import partnershipRoutes, { validatePartnership } from '../../cloudflare-migration/src/routes/partnership';
import { D1DatabaseFake } from './helpers/d1-sqlite';

describe('validatePartnership', () => {
  const two = [
    { name: 'Carlos', share: 60 },
    { name: 'Luz Marina', share: 40 },
  ];

  it('acepta 2 o más socios que suman 100 %, también con decimales', () => {
    expect(validatePartnership({ enabled: true, partners: two })).toEqual({
      ok: true,
      value: { enabled: true, partners: two },
    });
    const thirds = [
      { name: 'A', share: 33.33 },
      { name: 'B', share: 33.33 },
      { name: 'C', share: 33.34 },
    ];
    expect(validatePartnership({ enabled: true, partners: thirds }).ok).toBe(true);
  });

  it('rechaza porcentajes que no suman 100, un solo socio o socios sin nombre', () => {
    const bad = validatePartnership({ enabled: true, partners: [{ name: 'A', share: 50 }, { name: 'B', share: 40 }] });
    expect(bad).toEqual({ ok: false, error: 'Los porcentajes deben sumar 100 % (ahora suman 90 %)' });
    expect(validatePartnership({ enabled: true, partners: [{ name: 'A', share: 100 }] }).ok).toBe(false);
    expect(validatePartnership({ enabled: true, partners: [{ name: ' ', share: 50 }, { name: 'B', share: 50 }] }).ok).toBe(false);
    expect(validatePartnership({ enabled: true, partners: [{ name: 'A', share: -5 }, { name: 'B', share: 105 }] }).ok).toBe(false);
  });

  it('desactivado guarda la lista aunque esté incompleta (para no perderla al apagar)', () => {
    expect(validatePartnership({ enabled: false, partners: [{ name: 'A', share: 50 }] }).ok).toBe(true);
  });
});

describe('rutas', () => {
  let db: D1DatabaseFake;

  const call = async (clerkUserId: string, method = 'GET', body?: unknown) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('tenant' as never, { id: 't_tienda' } as never);
      c.set('clerkUserId' as never, clerkUserId as never);
      await next();
    });
    app.route('/api/partnership', partnershipRoutes);
    const res = await app.request(
      '/api/partnership',
      { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined },
      { DB: db }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db = new D1DatabaseFake();
    db.insert('user_profiles', {
      id: 't_tienda',
      clerk_user_id: 'clerk_dueno',
      email: 'dueno@tienda.co',
      role: 'admin',
      subscription_status: 'active',
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
    member('m_cajera', 'clerk_cajera', ['access_pos']);
    member('m_admin', 'clerk_admin', ['view_reports']);
  });

  it('por defecto la tienda es de un solo dueño', async () => {
    const res = await call('clerk_dueno');
    expect(res.json.data).toEqual({ enabled: false, partners: [] });
  });

  it('el dueño guarda los socios y quien ve reportes los puede leer', async () => {
    const partners = [
      { name: 'Carlos', share: 50 },
      { name: 'Luz Marina', share: 50 },
    ];
    expect((await call('clerk_dueno', 'PUT', { enabled: true, partners })).status).toBe(200);
    expect((await call('clerk_admin')).json.data).toEqual({ enabled: true, partners });
  });

  it('solo el dueño cambia los socios; la cajera ni siquiera los ve', async () => {
    const body = { enabled: true, partners: [{ name: 'X', share: 50 }, { name: 'Y', share: 50 }] };
    expect((await call('clerk_admin', 'PUT', body)).status).toBe(403);
    expect((await call('clerk_cajera')).status).toBe(403);
    expect((await call('clerk_dueno')).json.data.enabled).toBe(false);
  });

  it('responde 400 con un mensaje claro si los porcentajes no cuadran', async () => {
    const res = await call('clerk_dueno', 'PUT', { enabled: true, partners: [{ name: 'A', share: 70 }, { name: 'B', share: 20 }] });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('sumar 100');
  });
});
