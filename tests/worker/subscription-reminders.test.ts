/**
 * Recordatorio de suscripción por correo (/api/email/subscription-reminders):
 * sale UNA sola vez, 3 días antes de vencer, con el acceso directo al pago.
 */
import { Hono } from 'hono';
import emailRoutes from '../../cloudflare-migration/src/routes/email';
import { D1DatabaseFake } from './helpers/d1-sqlite';

describe('recordatorio de suscripción', () => {
  let db: D1DatabaseFake;
  const sends: { to: string; subject: string; html: string }[] = [];
  const DAY = 86_400_000;

  const profile = (id: string, status: 'trial' | 'active', endsInDays: number) =>
    db.insert('user_profiles', {
      id,
      clerk_user_id: `clerk_${id}`,
      email: `${id}@tienda.co`,
      full_name: id,
      role: 'admin',
      subscription_status: status,
      [status === 'trial' ? 'trial_end_date' : 'next_billing_date']: new Date(Date.now() + endsInDays * DAY).toISOString(),
    });

  const run = async () => {
    const app = new Hono();
    app.route('/api/email', emailRoutes);
    const res = await app.request('/api/email/subscription-reminders', { method: 'POST' }, {
      DB: db,
      RESEND_API_KEY: 'test',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await res.json()) as any;
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    sends.length = 0;
    global.fetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      sends.push({ to: String([body.to].flat()[0]).replace(/^.*<(.+)>$/, '$1'), subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    }) as typeof fetch;
    db = new D1DatabaseFake();
    // Tablas de la migración 005 (no versionada en git: *.sql está ignorado), solo
    // con las columnas que usa esta ruta.
    db.sqlite.exec(`
      CREATE TABLE email_preferences (
        id TEXT PRIMARY KEY, user_profile_id TEXT NOT NULL UNIQUE,
        subscription_reminders_enabled INTEGER DEFAULT 1
      );
      CREATE TABLE email_logs (
        id TEXT PRIMARY KEY, user_profile_id TEXT NOT NULL, email_type TEXT NOT NULL,
        recipient_email TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL,
        error_message TEXT, sent_at TEXT, created_at TEXT, metadata TEXT
      );
    `);
  });

  it('avisa solo a quien le quedan entre 2 y 3 días (un correo por período, no cada día)', async () => {
    profile('a_7dias', 'active', 6.5);
    profile('a_3dias', 'active', 2.6);
    profile('a_1dia', 'active', 0.8);
    profile('t_3dias', 'trial', 2.9);

    const result = await run();
    expect(result.emails_sent).toBe(2);
    expect(sends.map((s) => s.to).sort()).toEqual(['a_3dias@tienda.co', 't_3dias@tienda.co']);
  });

  it('el correo trae el acceso directo al pago', async () => {
    profile('a_3dias', 'active', 2.6);
    await run();
    expect(sends[0].html).toContain('https://posib.dev/dashboard/subscription?pagar=plan');
    expect(sends[0].html).toContain('Pagar ahora');
    expect(sends[0].html).toContain('No pierdes días');
  });

  it('en prueba gratis no promete conservar los días (el mes cuenta desde el pago)', async () => {
    profile('t_3dias', 'trial', 2.9);
    await run();
    expect(sends[0].html).not.toContain('No pierdes días');
  });
});
