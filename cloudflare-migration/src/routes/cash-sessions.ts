/**
 * Apertura y cierre de caja (migración 034).
 *
 * GET  /api/cash-sessions/current   -> { session | null, summary | null }  caja abierta + totales en vivo
 * POST /api/cash-sessions/open      -> { opening_amount }                   abre la caja con una base
 * POST /api/cash-sessions/:id/close -> { counted_cash, notes? }             cierra y congela el cuadre
 * POST /api/cash-sessions/:id/movements -> { kind, amount, reason }          entrada o salida de efectivo del turno
 * DELETE /api/cash-sessions/:id/movements/:movementId                        borra un movimiento (solo el dueño, caja abierta)
 * GET  /api/cash-sessions?limit=30  -> CashSession[]                        historial de turnos
 *
 * El cuadre lo calcula SIEMPRE el servidor con las ventas y abonos del turno:
 * esperado = base + ventas en efectivo + abonos de fiado en efectivo
 * + entradas - salidas de efectivo registradas. El cajero solo informa cuánto
 * contó. Nequi, transferencia y fiado se muestran
 * aparte porque no entran al cajón.
 *
 * Abrir/cerrar: el dueño o quien tenga permiso de vender (access_pos o
 * process_sales). Ver el historial: el dueño o view_reports / view_sales_history.
 */

import { Hono } from 'hono';
import type { AppEnv, APIResponse, Env } from '../types';
import { generateId } from '../utils/db-helpers';
import { escapeTelegramHtml, getTenantChatIds, sendToChats } from '../utils/telegram';

export interface MethodTotal {
  count: number;
  total: number;
}

export interface CashMovement {
  id: string;
  kind: 'salida' | 'entrada';
  amount: number;
  reason: string;
  created_by_name: string | null;
  created_at: string;
}

export interface CashSummary {
  /** Ventas del turno por medio de pago (efectivo, nequi, credito, ...). */
  sales: Record<string, MethodTotal>;
  /** Abonos de fiado recibidos en el turno, por medio de pago. */
  payments: Record<string, MethodTotal>;
  sales_count: number;
  cash_sales: number;
  cash_payments: number;
  /** Efectivo que entró / salió del cajón durante el turno (no son ventas). */
  cash_in: number;
  cash_out: number;
  movements: CashMovement[];
  expected_cash: number;
}

export interface CashSession {
  id: string;
  status: 'open' | 'closed';
  opened_at: string;
  opened_by_name: string | null;
  opening_amount: number;
  closed_at: string | null;
  closed_by_name: string | null;
  cash_sales: number | null;
  cash_payments: number | null;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  sales_count: number | null;
  totals: {
    sales: Record<string, MethodTotal>;
    payments: Record<string, MethodTotal>;
    /** Entradas y salidas del turno, congeladas al cerrar. */
    movements?: CashMovement[];
    cash_in?: number;
    cash_out?: number;
  } | null;
  notes: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Lee un monto en pesos: número finito, >= 0. Si llega como texto se lee en
 * formato colombiano ("$ 50.000" = cincuenta mil, "1.500,50" = mil quinientos
 * con cincuenta).
 */
export function parseAmount(value: unknown): number | null {
  let n = value;
  if (typeof value === 'string') {
    const clean = value.replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
    n = /^-?\d+(\.\d+)?$/.test(clean) ? Number(clean) : NaN;
  }
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
  return round(n);
}

/**
 * Totales del turno [from, to). Se compara con julianday() porque hay fechas
 * guardadas como ISO ("2026-11-05T14:00:00.000Z") y otras con el formato de
 * SQLite ("2026-11-05 14:00:00"), y como texto no se ordenan igual.
 */
export async function summarizeCash(
  db: D1Database,
  tenantId: string,
  fromIso: string,
  toIso: string,
  openingAmount: number,
  sessionId: string
): Promise<CashSummary> {
  const sales = await db
    .prepare(
      `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
       FROM sales
       WHERE tenant_id = ? AND status != 'cancelada'
         AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)
       GROUP BY payment_method`
    )
    .bind(tenantId, fromIso, toIso)
    .all<{ method: string; count: number; total: number }>();

  const payments = await db
    .prepare(
      `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
       FROM credit_payments
       WHERE tenant_id = ?
         AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)
       GROUP BY payment_method`
    )
    .bind(tenantId, fromIso, toIso)
    .all<{ method: string; count: number; total: number }>();

  const moves = await db
    .prepare(
      `SELECT id, kind, amount, reason, created_by_name, created_at
       FROM cash_movements WHERE tenant_id = ? AND session_id = ? ORDER BY created_at`
    )
    .bind(tenantId, sessionId)
    .all<CashMovement>();
  const movements = (moves.results ?? []).map((m) => ({ ...m, amount: round(Number(m.amount)) }));
  const cashIn = round(movements.filter((m) => m.kind === 'entrada').reduce((n, m) => n + m.amount, 0));
  const cashOut = round(movements.filter((m) => m.kind === 'salida').reduce((n, m) => n + m.amount, 0));

  const toMap = (rows: { method: string; count: number; total: number }[] | undefined) => {
    const map: Record<string, MethodTotal> = {};
    for (const r of rows ?? []) map[r.method] = { count: Number(r.count), total: round(Number(r.total)) };
    return map;
  };

  const salesMap = toMap(sales.results);
  const paymentsMap = toMap(payments.results);
  const cashSales = salesMap.efectivo?.total ?? 0;
  const cashPayments = paymentsMap.efectivo?.total ?? 0;

  return {
    sales: salesMap,
    payments: paymentsMap,
    sales_count: Object.values(salesMap).reduce((n, m) => n + m.count, 0),
    cash_sales: cashSales,
    cash_payments: cashPayments,
    cash_in: cashIn,
    cash_out: cashOut,
    movements,
    expected_cash: round(openingAmount + cashSales + cashPayments + cashIn - cashOut),
  };
}

type Access = { canOperate: boolean; canViewHistory: boolean; isOwner: boolean; name: string | null };

async function access(db: D1Database, tenantId: string, clerkUserId: string): Promise<Access> {
  const none: Access = { canOperate: false, canViewHistory: false, isOwner: false, name: null };
  if (clerkUserId === 'internal-webhook') return none;

  const owner = await db
    // SELECT *: clerk_user_id_test (cuenta de prueba en dev) existe en producción pero no en el esquema base.
    .prepare('SELECT * FROM user_profiles WHERE id = ?')
    .bind(tenantId)
    .first<{ clerk_user_id: string; clerk_user_id_test?: string | null; full_name?: string | null; email?: string }>();
  if (owner && (owner.clerk_user_id === clerkUserId || owner.clerk_user_id_test === clerkUserId)) {
    return { canOperate: true, canViewHistory: true, isOwner: true, name: owner.full_name || owner.email || 'Dueño' };
  }

  const member = await db
    .prepare(
      `SELECT permissions, full_name, email FROM team_members
       WHERE owner_id = ? AND clerk_user_id = ? AND status = 'active' AND invitation_status = 'accepted'`
    )
    .bind(tenantId, clerkUserId)
    .first<{ permissions: string; full_name: string | null; email: string }>();
  if (!member) return none;

  let perms: string[] = [];
  try {
    perms = JSON.parse(member.permissions || '[]');
  } catch {
    perms = [];
  }
  return {
    canOperate: perms.includes('access_pos') || perms.includes('process_sales'),
    canViewHistory: perms.includes('view_reports') || perms.includes('view_sales_history'),
    isOwner: false,
    name: member.full_name || member.email,
  };
}

function parseRow(row: Record<string, unknown>): CashSession {
  let totals: CashSession['totals'] = null;
  if (typeof row.totals === 'string') {
    try {
      totals = JSON.parse(row.totals);
    } catch {
      totals = null;
    }
  }
  return {
    id: String(row.id),
    status: row.status as CashSession['status'],
    opened_at: String(row.opened_at),
    opened_by_name: (row.opened_by_name as string) ?? null,
    opening_amount: Number(row.opening_amount ?? 0),
    closed_at: (row.closed_at as string) ?? null,
    closed_by_name: (row.closed_by_name as string) ?? null,
    cash_sales: row.cash_sales == null ? null : Number(row.cash_sales),
    cash_payments: row.cash_payments == null ? null : Number(row.cash_payments),
    expected_cash: row.expected_cash == null ? null : Number(row.expected_cash),
    counted_cash: row.counted_cash == null ? null : Number(row.counted_cash),
    difference: row.difference == null ? null : Number(row.difference),
    sales_count: row.sales_count == null ? null : Number(row.sales_count),
    totals,
    notes: (row.notes as string) ?? null,
  };
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const HOUR = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Fiado',
};

/** Mensaje del cierre para Telegram (HTML). */
export function buildCloseMessage(storeName: string, s: CashSession): string {
  const diff = s.difference ?? 0;
  const moves = s.totals?.movements ?? [];
  const cashIn = s.totals?.cash_in ?? 0;
  const cashOut = s.totals?.cash_out ?? 0;
  const diffLine =
    diff === 0
      ? '✅ La caja cuadra exacto'
      : diff > 0
        ? `⬆️ Sobran ${COP.format(diff)}`
        : `⚠️ Faltan ${COP.format(Math.abs(diff))}`;
  const others = Object.entries(s.totals?.sales ?? {})
    .filter(([m]) => m !== 'efectivo')
    .map(([m, t]) => `• ${METHOD_LABEL[m] ?? m}: ${COP.format(t.total)}`);

  return [
    `🧾 <b>Cierre de caja — ${escapeTelegramHtml(storeName)}</b>`,
    `${HOUR.format(new Date(s.opened_at))} a ${HOUR.format(new Date(s.closed_at ?? Date.now()))}` +
      (s.closed_by_name ? ` · cerró ${escapeTelegramHtml(s.closed_by_name)}` : ''),
    '',
    `Base: ${COP.format(s.opening_amount)}`,
    `Ventas en efectivo: ${COP.format(s.cash_sales ?? 0)}`,
    `Abonos en efectivo: ${COP.format(s.cash_payments ?? 0)}`,
    ...(cashIn > 0 ? [`Entradas de efectivo: +${COP.format(cashIn)}`] : []),
    ...(cashOut > 0 ? [`Salidas de efectivo: -${COP.format(cashOut)}`] : []),
    `<b>Esperado en caja: ${COP.format(s.expected_cash ?? 0)}</b>`,
    `<b>Contado: ${COP.format(s.counted_cash ?? 0)}</b>`,
    diffLine,
    ...(moves.length
      ? [
          '',
          'Movimientos de efectivo:',
          ...moves.map(
            (m) => `• ${m.kind === 'salida' ? '−' : '+'}${COP.format(m.amount)} ${escapeTelegramHtml(m.reason)}`
          ),
        ]
      : []),
    ...(others.length ? ['', 'Otros medios (no van al cajón):', ...others] : []),
    ...(s.notes ? ['', `Nota: ${escapeTelegramHtml(s.notes)}`] : []),
  ].join('\n');
}

async function notifyClose(env: Env, tenantId: string, session: CashSession): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const store = await env.DB
    .prepare('SELECT store_name, full_name, telegram_chat_id, telegram_enabled FROM user_profiles WHERE id = ?')
    .bind(tenantId)
    .first<{ store_name: string | null; full_name: string | null; telegram_chat_id: string | null; telegram_enabled: number | null }>();
  if (!store || store.telegram_enabled === 0) return;
  const chatIds = await getTenantChatIds(env.DB, tenantId, store.telegram_chat_id);
  if (chatIds.length === 0) return;
  await sendToChats(chatIds, buildCloseMessage(store.store_name || store.full_name || 'tu tienda', session), env.TELEGRAM_BOT_TOKEN);
}

const app = new Hono<AppEnv>();

app.get('/current', async (c) => {
  const tenant = c.get('tenant');
  try {
    const who = await access(c.env.DB, tenant.id, c.get('clerkUserId'));
    if (!who.canOperate) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso para la caja', data: null }, 403);
    }
    const row = await c.env.DB
      .prepare(`SELECT * FROM cash_sessions WHERE tenant_id = ? AND status = 'open'`)
      .bind(tenant.id)
      .first<Record<string, unknown>>();
    if (!row) {
      return c.json<APIResponse<{ session: null; summary: null; is_owner: boolean }>>({
        success: true,
        data: { session: null, summary: null, is_owner: who.isOwner },
      });
    }
    const session = parseRow(row);
    const summary = await summarizeCash(c.env.DB, tenant.id, session.opened_at, new Date().toISOString(), session.opening_amount, session.id);
    return c.json<APIResponse<{ session: CashSession; summary: CashSummary; is_owner: boolean }>>({
      success: true,
      data: { session, summary, is_owner: who.isOwner },
    });
  } catch (error) {
    console.error('[cash-sessions] Error leyendo la caja:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo leer la caja', data: null }, 500);
  }
});

app.post('/open', async (c) => {
  const tenant = c.get('tenant');
  try {
    const who = await access(c.env.DB, tenant.id, c.get('clerkUserId'));
    if (!who.canOperate) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso para abrir la caja', data: null }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { opening_amount?: unknown };
    const opening = parseAmount(body.opening_amount ?? 0);
    if (opening === null) {
      return c.json<APIResponse<null>>({ success: false, error: 'Escribe la base en pesos (0 o más)', data: null }, 400);
    }

    const now = new Date().toISOString();
    const id = generateId('cash');
    try {
      await c.env.DB
        .prepare(
          `INSERT INTO cash_sessions (id, tenant_id, status, opened_at, opened_by, opened_by_name, opening_amount, created_at, updated_at)
           VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, tenant.id, now, c.get('clerkUserId'), who.name, opening, now, now)
        .run();
    } catch (error) {
      // El índice único idx_cash_sessions_one_open: ya había una caja abierta.
      if (String(error).includes('UNIQUE')) {
        return c.json<APIResponse<null>>({ success: false, error: 'Ya hay una caja abierta', code: 'CASH_ALREADY_OPEN', data: null } as APIResponse<null>, 409);
      }
      throw error;
    }

    const row = await c.env.DB.prepare('SELECT * FROM cash_sessions WHERE id = ?').bind(id).first<Record<string, unknown>>();
    return c.json<APIResponse<CashSession>>({ success: true, data: parseRow(row!) }, 201);
  } catch (error) {
    console.error('[cash-sessions] Error abriendo la caja:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo abrir la caja', data: null }, 500);
  }
});

app.post('/:id/close', async (c) => {
  const tenant = c.get('tenant');
  const id = c.req.param('id');
  try {
    const who = await access(c.env.DB, tenant.id, c.get('clerkUserId'));
    if (!who.canOperate) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso para cerrar la caja', data: null }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { counted_cash?: unknown; notes?: unknown };
    const counted = parseAmount(body.counted_cash);
    if (counted === null) {
      return c.json<APIResponse<null>>({ success: false, error: 'Escribe cuánto dinero contaste en la caja', data: null }, 400);
    }
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;

    const row = await c.env.DB
      .prepare(`SELECT * FROM cash_sessions WHERE id = ? AND tenant_id = ?`)
      .bind(id, tenant.id)
      .first<Record<string, unknown>>();
    if (!row) return c.json<APIResponse<null>>({ success: false, error: 'Caja no encontrada', data: null }, 404);
    if (row.status !== 'open') {
      return c.json<APIResponse<null>>({ success: false, error: 'Esta caja ya se cerró', code: 'CASH_ALREADY_CLOSED', data: null } as APIResponse<null>, 409);
    }

    const open = parseRow(row);
    const now = new Date().toISOString();
    const summary = await summarizeCash(c.env.DB, tenant.id, open.opened_at, now, open.opening_amount, open.id);
    const difference = round(counted - summary.expected_cash);

    // status = 'open' en el WHERE: si dos cierres llegan a la vez, solo uno aplica.
    const result = await c.env.DB
      .prepare(
        `UPDATE cash_sessions SET status = 'closed', closed_at = ?, closed_by = ?, closed_by_name = ?,
           cash_sales = ?, cash_payments = ?, expected_cash = ?, counted_cash = ?, difference = ?,
           sales_count = ?, totals = ?, notes = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'open'`
      )
      .bind(
        now, c.get('clerkUserId'), who.name,
        summary.cash_sales, summary.cash_payments, summary.expected_cash, counted, difference,
        summary.sales_count,
        JSON.stringify({ sales: summary.sales, payments: summary.payments, movements: summary.movements, cash_in: summary.cash_in, cash_out: summary.cash_out }),
        notes, now,
        id, tenant.id
      )
      .run();
    if (!result.meta?.changes) {
      return c.json<APIResponse<null>>({ success: false, error: 'Esta caja ya se cerró', code: 'CASH_ALREADY_CLOSED', data: null } as APIResponse<null>, 409);
    }

    const closedRow = await c.env.DB.prepare('SELECT * FROM cash_sessions WHERE id = ?').bind(id).first<Record<string, unknown>>();
    const closed = parseRow(closedRow!);

    // Aviso por Telegram al dueño (y destinatarios). No debe tumbar el cierre.
    const notify = notifyClose(c.env, tenant.id, closed).catch((e) => console.error('[cash-sessions] Telegram:', e));
    try {
      c.executionCtx.waitUntil(notify);
    } catch {
      await notify; // sin executionCtx (pruebas)
    }

    return c.json<APIResponse<CashSession>>({ success: true, data: closed });
  } catch (error) {
    console.error('[cash-sessions] Error cerrando la caja:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo cerrar la caja', data: null }, 500);
  }
});

app.post('/:id/movements', async (c) => {
  const tenant = c.get('tenant');
  const id = c.req.param('id');
  try {
    const who = await access(c.env.DB, tenant.id, c.get('clerkUserId'));
    if (!who.canOperate) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso para mover efectivo de la caja', data: null }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; amount?: unknown; reason?: unknown };
    const kind = body.kind === 'salida' || body.kind === 'entrada' ? body.kind : null;
    const amount = parseAmount(body.amount);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : '';
    if (!kind) return c.json<APIResponse<null>>({ success: false, error: 'Elige si el efectivo sale o entra', data: null }, 400);
    if (amount === null || amount <= 0) {
      return c.json<APIResponse<null>>({ success: false, error: 'Escribe el valor en pesos (mayor a 0)', data: null }, 400);
    }
    if (!reason) return c.json<APIResponse<null>>({ success: false, error: 'Escribe para qué es (por ejemplo: pago a proveedor)', data: null }, 400);

    const session = await c.env.DB
      .prepare('SELECT status FROM cash_sessions WHERE id = ? AND tenant_id = ?')
      .bind(id, tenant.id)
      .first<{ status: string }>();
    if (!session) return c.json<APIResponse<null>>({ success: false, error: 'Caja no encontrada', data: null }, 404);
    if (session.status !== 'open') {
      return c.json<APIResponse<null>>({ success: false, error: 'Esta caja ya se cerró', code: 'CASH_ALREADY_CLOSED', data: null } as APIResponse<null>, 409);
    }

    const movement: CashMovement = {
      id: generateId('mov'),
      kind,
      amount,
      reason,
      created_by_name: who.name,
      created_at: new Date().toISOString(),
    };
    await c.env.DB
      .prepare(
        `INSERT INTO cash_movements (id, tenant_id, session_id, kind, amount, reason, created_by, created_by_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(movement.id, tenant.id, id, kind, amount, reason, c.get('clerkUserId'), who.name, movement.created_at)
      .run();
    return c.json<APIResponse<CashMovement>>({ success: true, data: movement }, 201);
  } catch (error) {
    console.error('[cash-sessions] Error registrando el movimiento:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo registrar el movimiento', data: null }, 500);
  }
});

// Solo el dueño borra un movimiento: así una salida de efectivo no se puede
// esconder desde la caja (borrarla subiría el "esperado" y el faltante se vería).
app.delete('/:id/movements/:movementId', async (c) => {
  const tenant = c.get('tenant');
  try {
    const who = await access(c.env.DB, tenant.id, c.get('clerkUserId'));
    if (!who.isOwner) {
      return c.json<APIResponse<null>>({ success: false, error: 'Solo el dueño puede borrar un movimiento', data: null }, 403);
    }
    const result = await c.env.DB
      .prepare(
        `DELETE FROM cash_movements
         WHERE id = ? AND tenant_id = ? AND session_id = ?
           AND session_id IN (SELECT id FROM cash_sessions WHERE tenant_id = ? AND status = 'open')`
      )
      .bind(c.req.param('movementId'), tenant.id, c.req.param('id'), tenant.id)
      .run();
    if (!result.meta?.changes) {
      return c.json<APIResponse<null>>({ success: false, error: 'Movimiento no encontrado o la caja ya se cerró', data: null }, 404);
    }
    return c.json<APIResponse<null>>({ success: true, data: null });
  } catch (error) {
    console.error('[cash-sessions] Error borrando el movimiento:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudo borrar el movimiento', data: null }, 500);
  }
});

app.get('/', async (c) => {
  const tenant = c.get('tenant');
  try {
    const who = await access(c.env.DB, tenant.id, c.get('clerkUserId'));
    if (!who.canViewHistory) {
      return c.json<APIResponse<null>>({ success: false, error: 'Sin permiso para ver los cierres', data: null }, 403);
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 30, 1), 200);
    const rows = await c.env.DB
      .prepare(`SELECT * FROM cash_sessions WHERE tenant_id = ? ORDER BY opened_at DESC LIMIT ?`)
      .bind(tenant.id, limit)
      .all<Record<string, unknown>>();
    return c.json<APIResponse<CashSession[]>>({ success: true, data: (rows.results ?? []).map(parseRow) });
  } catch (error) {
    console.error('[cash-sessions] Error leyendo los cierres:', error);
    return c.json<APIResponse<null>>({ success: false, error: 'No se pudieron leer los cierres', data: null }, 500);
  }
});

export default app;
