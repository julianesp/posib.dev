/**
 * Resumen de cierre de mes por Telegram (solo al dueño).
 *
 * El día 1 de cada mes a las 7 AM Colombia (12h UTC, ver scheduled en
 * src/index.ts) le cuenta al tendero cómo le fue en el mes que acaba de
 * cerrar: cuánto vendió, cómo va frente al mes anterior, cuánto lleva en el
 * año, a cuánto cerraría el año a ese ritmo y qué tan cerca está del tope de
 * facturación electrónica de la DIAN (3.500 UVT).
 *
 * Se envía el día 1 y no el último día del mes porque las tiendas venden
 * hasta tarde: así el resumen tiene el mes completo.
 *
 * Las ventas son información sensible: va solo al chat del dueño, nunca a
 * los destinatarios adicionales (p. ej. la empleada). Para no repetirlo si el
 * cron corre dos veces, se marca en KV `month-summary:<tienda>:<AAAA-MM>`.
 */

import type { Env } from '../types';
import { E_INVOICE_UVT, coYearStart, uvtFor } from './dian-thresholds';
import { escapeTelegramHtml, sendTelegramMessage } from './telegram';

const CO_OFFSET_MS = 5 * 60 * 60 * 1000;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const toSqlUtc = (time: number) => new Date(time).toISOString().slice(0, 19).replace('T', ' ');

/** Mes cerrado respecto a `now` (hora Colombia): { year, month } con month 1-12. */
export function closedMonth(now: number): { year: number; month: number } {
  const co = new Date(now - CO_OFFSET_MS);
  const year = co.getUTCFullYear();
  const month = co.getUTCMonth(); // 0-11 del mes en curso = 1-12 del anterior
  return month === 0 ? { year: year - 1, month: 12 } : { year, month };
}

/** ¿Es el día 1 en Colombia? */
export function isFirstDayCo(now: number): boolean {
  return new Date(now - CO_OFFSET_MS).getUTCDate() === 1;
}

export interface MonthEndInput {
  storeName: string;
  year: number;
  /** Mes cerrado, 1-12. */
  month: number;
  /** Ventas del año del mes cerrado: índice 0 = enero … hasta el mes cerrado. */
  monthly: Array<{ sales: number; count: number }>;
  alreadyInvoicing: boolean;
}

export function monthEndMessage(input: MonthEndInput): string | null {
  const { year, month, monthly } = input;
  const current = monthly[month - 1] ?? { sales: 0, count: 0 };
  if (current.count === 0) return null; // sin ventas en el mes: no hay nada que contar

  const prev = month > 1 ? monthly[month - 2] : null;
  const total = monthly.slice(0, month).reduce((sum, m) => sum + m.sales, 0);
  // Promedio desde el primer mes con ventas: una tienda que empezó en posib a
  // mitad de año no tiene ventas antes y diluiría el promedio.
  const first = monthly.findIndex((m) => m.sales > 0);
  const avg = total / (month - first);
  const projected = Math.round(total + avg * (12 - month));
  const cap = E_INVOICE_UVT * uvtFor(year).uvt;
  const monthName = MONTHS[month - 1];

  const lines: string[] = [];
  let firstLine = `Vendiste <b>${cop(current.sales)}</b> en ${current.count} ${current.count === 1 ? 'venta' : 'ventas'}`;
  if (prev && prev.sales > 0) {
    const change = Math.round(((current.sales - prev.sales) / prev.sales) * 100);
    firstLine += ` (${change >= 0 ? '+' : ''}${change}% frente a ${MONTHS[month - 2]})`;
  }
  lines.push(`${firstLine}.`);
  lines.push(`Promedio por venta: ${cop(current.sales / current.count)}.`);

  if (month === 12) {
    lines.push(`Cerraste ${year} con <b>${cop(total)}</b> en ventas.`);
  } else {
    lines.push(`Llevas <b>${cop(total)}</b> en ${year}. Si sigues así, cerrarías el año con unos <b>${cop(projected)}</b>.`);
  }

  if (!input.alreadyInvoicing) {
    const closing = month === 12 ? total : projected;
    if (total >= cap) {
      lines.push(`⚠️ Ya pasaste el tope de ${cop(cap)} para facturar electrónicamente: la DIAN te exige factura electrónica. Habla con tu contador.`);
    } else if (closing >= cap) {
      lines.push(`⚠️ A este ritmo pasarías el tope de ${cop(cap)} antes de terminar el año y tendrías que facturar electrónicamente. Prepárate con tu contador.`);
    } else if (month < 12) {
      lines.push(`El tope para facturar electrónicamente es ${cop(cap)}: a este ritmo te quedarían unos ${cop(cap - closing)} de margen.`);
    }
  }

  return [
    `<b>📊 Cierre de ${monthName} ${year}</b>`,
    `<i>${escapeTelegramHtml(input.storeName)}</i>`,
    '',
    ...lines,
    '',
    '<i>Calculado con las ventas registradas en posib. El informe completo en PDF está en Ventas → Informes mensuales.</i>',
  ].join('\n');
}

export async function runMonthEndSummary(env: Env, now = Date.now()) {
  if (!isFirstDayCo(now)) return { skipped: true, sent: 0 };
  const { year, month } = closedMonth(now);
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const db = env.DB;

  const [stores, sales] = await Promise.all([
    db
      .prepare(
        // SELECT *: store_name viene de una migración que el esquema base no trae.
        `SELECT * FROM user_profiles
         WHERE subscription_status IN ('active', 'trial') AND COALESCE(is_superadmin, 0) = 0
           AND telegram_chat_id IS NOT NULL AND telegram_chat_id != '' AND COALESCE(telegram_enabled, 1) != 0`
      )
      .all<{
        id: string;
        full_name: string | null;
        store_name: string | null;
        telegram_chat_id: string;
        dian_e_invoicing: number | null;
      }>(),
    db
      .prepare(
        `SELECT tenant_id,
                CAST(strftime('%m', datetime(created_at, '-5 hours')) AS INTEGER) AS month,
                COALESCE(SUM(total), 0) AS sales,
                COUNT(*) AS count
         FROM sales
         WHERE status != 'cancelada'
           AND datetime(created_at) >= ? AND datetime(created_at) < ?
         GROUP BY tenant_id, month`
      )
      .bind(toSqlUtc(coYearStart(year)), toSqlUtc(coYearStart(year + 1)))
      .all<{ tenant_id: string; month: number; sales: number; count: number }>(),
  ]);

  const byTenant = new Map<string, Array<{ sales: number; count: number }>>();
  for (const row of sales.results || []) {
    const m = Number(row.month);
    if (m < 1 || m > month) continue;
    const list = byTenant.get(row.tenant_id) ?? Array.from({ length: month }, () => ({ sales: 0, count: 0 }));
    list[m - 1] = { sales: Math.round(Number(row.sales) || 0), count: Number(row.count) || 0 };
    byTenant.set(row.tenant_id, list);
  }

  let sent = 0;
  for (const store of stores.results || []) {
    const monthly = byTenant.get(store.id);
    if (!monthly) continue;
    const text = monthEndMessage({
      storeName: store.store_name || store.full_name || 'Tu tienda',
      year,
      month,
      monthly,
      alreadyInvoicing: store.dian_e_invoicing === 1,
    });
    if (!text) continue;

    const flag = `month-summary:${store.id}:${key}`;
    if (await env.TENANTS.get(flag)) continue;
    const result = await sendTelegramMessage(store.telegram_chat_id, text, env.TELEGRAM_BOT_TOKEN);
    if (result.success) {
      await env.TENANTS.put(flag, '1', { expirationTtl: 60 * 60 * 24 * 40 });
      sent++;
    }
  }

  return { skipped: false, month: key, sent };
}
