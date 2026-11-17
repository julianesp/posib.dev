/**
 * Topes DIAN de la tienda (facturación electrónica y renta) según sus ventas.
 *
 * GET /api/dian-thresholds      -> ventas del año, tope, saldo, proyección y nivel de alerta
 * PUT /api/dian-thresholds/ack  -> { already_invoicing: boolean } (migración 031)
 * runDianThresholdAlerts()      -> cron diario: avisa por Telegram y correo al subir de nivel
 *
 * Las ventas del año son información sensible: solo las ve el dueño o un
 * miembro del equipo con permiso view_reports, y el Telegram va solo al chat
 * del dueño (no a los destinatarios adicionales, p. ej. la empleada).
 * Reglas en utils/dian-thresholds.ts.
 */

import { Hono } from 'hono';
import type { AppEnv, APIResponse, Env } from '../types';
import { parseDbDate } from '../utils/store-health';
import {
  coYear,
  coYearStart,
  dianAlertMessage,
  evaluateDianThresholds,
  shouldNotify,
  type DianThresholds,
} from '../utils/dian-thresholds';
import { sendTelegramMessage, escapeTelegramHtml } from '../utils/telegram';
import { sendEmail } from '../utils/email';

const toSqlUtc = (time: number) => new Date(time).toISOString().slice(0, 19).replace('T', ' ');

interface SalesTotals {
  tenant_id: string;
  year_sales: number;
  previous_year_sales: number;
  first_sale_at: string | null;
}

/**
 * Ventas del año en curso y del anterior (hora Colombia), sin canceladas.
 * datetime() normaliza created_at: D1 mezcla 'YYYY-MM-DD HH:MM:SS' con ISO de JavaScript.
 */
function salesTotalsQuery(db: D1Database, year: number, tenantId?: string) {
  return db
    .prepare(
      `SELECT tenant_id,
              COALESCE(SUM(CASE WHEN datetime(created_at) >= ?1 THEN total ELSE 0 END), 0) AS year_sales,
              COALESCE(SUM(CASE WHEN datetime(created_at) < ?1 THEN total ELSE 0 END), 0) AS previous_year_sales,
              MIN(CASE WHEN datetime(created_at) >= ?1 THEN created_at END) AS first_sale_at
       FROM sales
       WHERE status != 'cancelada'
         AND datetime(created_at) >= ?2 AND datetime(created_at) < ?3
         ${tenantId ? 'AND tenant_id = ?4' : ''}
       GROUP BY tenant_id`
    )
    .bind(
      toSqlUtc(coYearStart(year)),
      toSqlUtc(coYearStart(year - 1)),
      toSqlUtc(coYearStart(year + 1)),
      ...(tenantId ? [tenantId] : [])
    );
}

export interface MonthSales {
  /** 1 = enero … 12 = diciembre (hora Colombia). */
  month: number;
  sales: number;
  count: number;
}

/**
 * Ventas del año en curso mes a mes (hora Colombia), sin canceladas. Solo
 * vienen los meses con ventas; el front completa los demás con cero.
 */
async function monthlySales(db: D1Database, year: number, tenantId: string): Promise<MonthSales[]> {
  const { results } = await db
    .prepare(
      `SELECT CAST(strftime('%m', datetime(created_at, '-5 hours')) AS INTEGER) AS month,
              COALESCE(SUM(total), 0) AS sales,
              COUNT(*) AS count
       FROM sales
       WHERE tenant_id = ?1 AND status != 'cancelada'
         AND datetime(created_at) >= ?2 AND datetime(created_at) < ?3
       GROUP BY month
       ORDER BY month`
    )
    .bind(tenantId, toSqlUtc(coYearStart(year)), toSqlUtc(coYearStart(year + 1)))
    .all<{ month: number; sales: number; count: number }>();
  return (results ?? []).map((r) => ({
    month: Number(r.month),
    sales: Math.round(Number(r.sales) || 0),
    count: Number(r.count) || 0,
  }));
}

function evaluate(row: SalesTotals | null | undefined, year: number, alreadyInvoicing: boolean, now: number) {
  return evaluateDianThresholds(
    {
      year,
      yearSales: Math.round(Number(row?.year_sales ?? 0)),
      previousYearSales: Math.round(Number(row?.previous_year_sales ?? 0)),
      firstSaleAt: parseDbDate(row?.first_sale_at),
      alreadyInvoicing,
    },
    now
  );
}

/** Dueño de la tienda o miembro del equipo con permiso para ver reportes. */
async function canSeeRevenue(db: D1Database, tenantId: string, clerkUserId: string): Promise<boolean> {
  const owner = await db
    // SELECT *: clerk_user_id_test (cuenta de prueba en dev) existe en producción pero no en el esquema base.
    .prepare('SELECT * FROM user_profiles WHERE id = ?')
    .bind(tenantId)
    .first<{ clerk_user_id: string; clerk_user_id_test?: string | null }>();
  if (owner && (owner.clerk_user_id === clerkUserId || owner.clerk_user_id_test === clerkUserId)) return true;

  const member = await db
    .prepare(
      `SELECT role, permissions FROM team_members
       WHERE owner_id = ? AND clerk_user_id = ? AND status = 'active' AND invitation_status = 'accepted'`
    )
    .bind(tenantId, clerkUserId)
    .first<{ role: string; permissions: string }>();
  if (!member) return false;
  try {
    return (JSON.parse(member.permissions || '[]') as string[]).includes('view_reports');
  } catch {
    return false;
  }
}

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const tenant = c.get('tenant');
  try {
    if (!(await canSeeRevenue(c.env.DB, tenant.id, c.get('clerkUserId')))) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso para ver las ventas del año', data: null }, 403);
    }

    const now = Date.now();
    const year = coYear(now);
    const [salesRow, months, profileRow] = await Promise.all([
      salesTotalsQuery(c.env.DB, year, tenant.id).first<SalesTotals>(),
      monthlySales(c.env.DB, year, tenant.id),
      c.env.DB.prepare('SELECT dian_e_invoicing FROM user_profiles WHERE id = ?')
        .bind(tenant.id)
        .first<{ dian_e_invoicing: number | null }>(),
    ]);

    return c.json<APIResponse<DianThresholds & { months: MonthSales[] }>>({
      success: true,
      data: { ...evaluate(salesRow, year, profileRow?.dian_e_invoicing === 1, now), months },
    });
  } catch (error) {
    console.error('[dian-thresholds] Error calculando los topes:', error);
    return c.json<APIResponse<null>>(
      { success: false, error: 'No se pudieron calcular los topes de la DIAN', data: null },
      500
    );
  }
});

app.put('/ack', async (c) => {
  const tenant = c.get('tenant');
  try {
    if (!(await canSeeRevenue(c.env.DB, tenant.id, c.get('clerkUserId')))) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso', data: null }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { already_invoicing?: unknown };
    if (typeof body.already_invoicing !== 'boolean') {
      return c.json<APIResponse<null>>(
        { success: false, error: 'already_invoicing debe ser true o false', data: null },
        400
      );
    }
    await c.env.DB.prepare('UPDATE user_profiles SET dian_e_invoicing = ?, updated_at = ? WHERE id = ?')
      .bind(body.already_invoicing ? 1 : 0, new Date().toISOString(), tenant.id)
      .run();
    return c.json<APIResponse<{ already_invoicing: boolean }>>({
      success: true,
      data: { already_invoicing: body.already_invoicing },
    });
  } catch (error) {
    console.error('[dian-thresholds] Error guardando la preferencia:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo guardar', data: null }, 500);
  }
});

function alertEmailHtml(storeName: string, title: string, lines: string[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;color:#6b7280;font-size:14px">${esc(storeName)}</p>
    <h1 style="margin:0 0 16px;font-size:20px">${esc(title)}</h1>
    ${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${esc(l)}</p>`).join('')}
    <p style="margin:20px 0 0"><a href="https://posib.dev/dashboard" style="background:#007C80;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">Ver en posib</a></p>
  </div></body></html>`;
}

/**
 * Cron diario: calcula los topes de cada tienda activa y le avisa al dueño
 * (Telegram + correo) cuando sube de nivel: aviso 70 %, importante 90 %,
 * obligado 100 % o año anterior por encima del tope. Una vez por nivel y año.
 */
export async function runDianThresholdAlerts(env: Env, now = Date.now()) {
  const db = env.DB;
  const year = coYear(now);
  const [stores, totals] = await Promise.all([
    db
      .prepare(
        // SELECT *: store_name viene de una migración que el esquema base no trae.
        `SELECT * FROM user_profiles
         WHERE subscription_status IN ('active', 'trial') AND COALESCE(is_superadmin, 0) = 0`
      )
      .all<{
        id: string;
        email: string;
        full_name: string | null;
        store_name: string | null;
        telegram_chat_id: string | null;
        telegram_enabled: number | null;
        dian_e_invoicing: number | null;
        dian_alert_sent: string | null;
      }>(),
    salesTotalsQuery(db, year).all<SalesTotals>(),
  ]);

  const totalsBy = new Map((totals.results || []).map((r) => [r.tenant_id, r]));
  let notified = 0;

  for (const store of stores.results || []) {
    const result = evaluate(totalsBy.get(store.id), year, store.dian_e_invoicing === 1, now);
    if (!shouldNotify(result, store.dian_alert_sent)) continue;

    const { title, lines } = dianAlertMessage(result);
    const storeName = store.store_name || store.full_name || 'Tu tienda';
    let delivered = false;

    if (store.telegram_chat_id && store.telegram_enabled !== 0) {
      const text = `<b>${escapeTelegramHtml(title)}</b>\n<i>${escapeTelegramHtml(storeName)}</i>\n\n${lines
        .map(escapeTelegramHtml)
        .join('\n\n')}`;
      const sent = await sendTelegramMessage(store.telegram_chat_id, text, env.TELEGRAM_BOT_TOKEN);
      delivered ||= sent.success;
    }

    if (store.email) {
      const sent = await sendEmail(
        {
          to: store.email,
          toName: store.full_name || undefined,
          from: 'noreply@posib.dev',
          fromName: 'posib',
          subject: title.replace(/^\S+\s/, ''),
          html: alertEmailHtml(storeName, title, lines),
          text: `${title}\n\n${lines.join('\n\n')}`,
        },
        env.RESEND_API_KEY
      );
      delivered ||= sent.success;
    }

    // Si no salió por ningún canal se reintenta mañana; la campana de la app lo muestra igual.
    if (delivered) {
      await db
        .prepare('UPDATE user_profiles SET dian_alert_sent = ? WHERE id = ?')
        .bind(`${result.year}:${result.level}`, store.id)
        .run();
      notified++;
    }
  }

  return { year, checked: stores.results?.length ?? 0, notified };
}

export default app;
