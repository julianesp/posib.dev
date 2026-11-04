/**
 * Tienda online y pagos (2026-11-04):
 * - No se puede encender la tienda sin número de Nequi (PUT /api/user-profiles/:id).
 * - Wompi se quitó por completo (publicaba su secreto en /api/webhooks/wompi/config).
 * - Aviso interno de posib al dueño de una tienda por Telegram.
 */
import { Hono } from 'hono';
import userProfileRoutes from '../../cloudflare-migration/src/routes/user-profiles';
import telegramRoutes from '../../cloudflare-migration/src/routes/telegram';
import { D1DatabaseFake } from './helpers/d1-sqlite';

function addColumns(db: D1DatabaseFake) {
  for (const col of [
    'store_slug TEXT', 'store_name TEXT', 'store_enabled INTEGER DEFAULT 0', 'store_nequi_number TEXT',
    'has_ai_addon INTEGER DEFAULT 0', 'has_store_addon INTEGER DEFAULT 0', 'has_email_addon INTEGER DEFAULT 0',
  ]) {
    try {
      db.sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN ${col}`);
    } catch {
      // ya existe en el esquema base
    }
  }
}

describe('encender la tienda exige número de Nequi', () => {
  let db: D1DatabaseFake;

  const put = async (body: Record<string, unknown>) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('tenant' as never, { id: 'p1' } as never);
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

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    db = new D1DatabaseFake();
    addColumns(db);
    db.insert('user_profiles', { id: 'p1', clerk_user_id: 'clerk_p1', email: 'a@b.co', role: 'admin', store_slug: 'esquina', store_name: 'La Esquina' });
  });

  const enabled = () => (db.sqlite.prepare(`SELECT store_enabled FROM user_profiles WHERE id = 'p1'`).get() as { store_enabled: number }).store_enabled;

  it('sin Nequi responde 400 y la tienda sigue apagada', async () => {
    const res = await put({ store_enabled: true, store_name: 'La Esquina' });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('STORE_NEQUI_REQUIRED');
    expect(enabled()).toBe(0);
  });

  it('con un número incompleto tampoco', async () => {
    expect((await put({ store_enabled: true, store_nequi_number: '317450' })).status).toBe(400);
  });

  it('con el número de Nequi en el mismo guardado, se enciende', async () => {
    const res = await put({ store_enabled: true, store_nequi_number: '317 450 3604' });
    expect(res.status).toBe(200);
    expect(enabled()).toBe(1);
  });

  it('si ya tenía el número guardado, basta con encenderla', async () => {
    db.sqlite.exec(`UPDATE user_profiles SET store_nequi_number = '3174503604' WHERE id = 'p1'`);
    expect((await put({ store_enabled: true })).status).toBe(200);
  });

  it('apagarla o guardar otras cosas no exige Nequi', async () => {
    expect((await put({ store_enabled: false })).status).toBe(200);
    expect((await put({ full_name: 'Doña Marta' })).status).toBe(200);
  });
});

describe('Wompi quitado del sistema', () => {
  it('el Worker ya no tiene rutas de Wompi (ni la que publicaba el secreto)', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = path.join(__dirname, '../../cloudflare-migration/src');
    expect(fs.existsSync(path.join(src, 'routes/webhooks.ts'))).toBe(false);
    expect(fs.existsSync(path.join(src, 'routes/wompi.ts'))).toBe(false);
    const index = fs.readFileSync(path.join(src, 'index.ts'), 'utf8');
    expect(index).not.toMatch(/wompi/i);
  });
});

describe('aviso de posib al dueño de una tienda (Telegram)', () => {
  let db: D1DatabaseFake;
  const sent: { chat_id: string; text: string }[] = [];

  const notice = async (body: unknown, secret?: string) => {
    const app = new Hono();
    app.route('/api/telegram', telegramRoutes);
    const res = await app.request('/api/telegram/store-notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Cron-Secret': secret } : {}) },
      body: JSON.stringify(body),
    }, { DB: db, CRON_SECRET: 'cron', TELEGRAM_BOT_TOKEN: 'bot' });
    return res.status;
  };

  beforeEach(() => {
    sent.length = 0;
    global.fetch = jest.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    db = new D1DatabaseFake();
    addColumns(db);
    db.insert('user_profiles', { id: 's1', clerk_user_id: 'c', email: 'x@y.co', role: 'admin', store_slug: 'la10', telegram_chat_id: '777', telegram_enabled: 1 });
  });

  it('sin el secreto interno no envía nada', async () => {
    expect(await notice({ store_slug: 'la10', message: 'hola' })).toBe(401);
    expect(await notice({ store_slug: 'la10', message: 'hola' }, 'otro')).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('envía el mensaje solo al chat del dueño de la tienda', async () => {
    expect(await notice({ store_slug: 'la10', message: 'Activa el domicilio' }, 'cron')).toBe(200);
    expect(sent).toEqual([expect.objectContaining({ chat_id: '777', text: 'Activa el domicilio' })]);
  });

  it('si la tienda no tiene Telegram responde 404', async () => {
    expect(await notice({ store_slug: 'no-existe', message: 'x' }, 'cron')).toBe(404);
  });
});
