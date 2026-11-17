/**
 * Reseñas de posib: al calificar llega un aviso por Telegram al superadmin,
 * y si el tendero cambia lo que dice, la reseña vuelve a moderación.
 */
import { Hono } from 'hono';
import reviewRoutes from '../../cloudflare-migration/src/routes/pos-reviews';
import { D1DatabaseFake } from './helpers/d1-sqlite';

describe('PUT /api/pos-reviews/me', () => {
  let db: D1DatabaseFake;
  const sends: { url: string; body: string }[] = [];

  const put = async (body: unknown) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('tenant' as never, { id: 't_saira' } as never);
      await next();
    });
    app.route('/api/pos-reviews', reviewRoutes);
    const res = await app.request(
      '/api/pos-reviews/me',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { DB: db, TELEGRAM_BOT_TOKEN: 'tg' }
    );
    return res.status;
  };
  const approved = () =>
    db.get<{ v: number }>('SELECT is_approved AS v FROM pos_reviews WHERE user_profile_id = ?', 't_saira')!.v;

  beforeEach(() => {
    sends.length = 0;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sends.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    db = new D1DatabaseFake();
    // store_name y store_city existen en producción pero no en el esquema base.
    db.exec('ALTER TABLE user_profiles ADD COLUMN store_name TEXT');
    db.exec('ALTER TABLE user_profiles ADD COLUMN store_city TEXT');
    db.insert('user_profiles', { id: 't_saira', clerk_user_id: 'c1', email: 's@x.co', role: 'admin', store_name: 'Variedades Saira', store_city: 'Pasto' });
    db.insert('user_profiles', { id: 'admin', clerk_user_id: 'c2', email: 'admin@neurai.dev', role: 'admin', is_superadmin: 1, telegram_chat_id: '111' });
    db.insert('user_profiles', { id: 'admin_sin_tg', clerk_user_id: 'c3', email: 'a2@x.co', role: 'admin', is_superadmin: 1 });
  });

  it('avisa al superadmin por Telegram con la tienda, las estrellas y el comentario', async () => {
    expect(await put({ rating: 5, comment: 'Me ayuda mucho con el fiado' })).toBe(200);
    const telegram = sends.filter((s) => s.url.includes('api.telegram.org'));
    expect(telegram).toHaveLength(1);
    const body = JSON.parse(telegram[0].body);
    expect(body.chat_id).toBe('111');
    expect(body.text).toContain('Nueva reseña');
    expect(body.text).toContain('Variedades Saira');
    expect(body.text).toContain('⭐⭐⭐⭐⭐');
    expect(body.text).toContain('Me ayuda mucho con el fiado');
    expect(approved()).toBe(0);
  });

  it('guardar lo mismo no avisa; cambiar el texto avisa y la saca de la página hasta aprobarla otra vez', async () => {
    await put({ rating: 5, comment: 'Muy bueno' });
    db.exec("UPDATE pos_reviews SET is_approved = 1");
    sends.length = 0;

    await put({ rating: 5, comment: 'Muy bueno' });
    expect(sends).toHaveLength(0);
    expect(approved()).toBe(1);

    await put({ rating: 4, comment: 'Bueno' });
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0].body).text).toContain('editada');
    expect(approved()).toBe(0);
  });
});
