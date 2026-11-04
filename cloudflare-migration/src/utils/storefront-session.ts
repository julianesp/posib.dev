/**
 * Sesiones de clientes de la tienda online (migración 033). El navegador
 * guarda un código secreto aleatorio y la base solo su SHA-256, igual que el
 * código de cada pedido web (utils/payment-reference.ts).
 */

import { hashOrderToken } from './payment-reference';

export const SESSION_DAYS = 90;

export interface StorefrontAccount {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  created_at: string;
}

/** Crea una sesión y devuelve el código para el navegador. */
export async function createStorefrontSession(db: D1Database, userId: string, tenantId: string): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db
    .prepare('INSERT INTO storefront_sessions (token_hash, user_id, tenant_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await hashOrderToken(token), userId, tenantId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

/** Código de sesión de la cabecera `Authorization: Bearer …`, o null. */
export function bearerToken(header: string | undefined | null): string | null {
  const m = header?.match(/^Bearer\s+([A-Za-z0-9]{32,128})$/);
  return m ? m[1] : null;
}

/** Cliente de ESTA tienda dueño de la sesión, si está vigente. */
export async function findStorefrontAccount(
  db: D1Database,
  token: string | null,
  tenantId: string
): Promise<StorefrontAccount | null> {
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.phone, u.created_at
       FROM storefront_sessions s
       JOIN storefront_users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
       WHERE s.token_hash = ? AND s.tenant_id = ? AND s.expires_at > ?`
    )
    .bind(await hashOrderToken(token), tenantId, new Date().toISOString())
    .first<StorefrontAccount>();
}

export async function deleteStorefrontSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM storefront_sessions WHERE token_hash = ?').bind(await hashOrderToken(token)).run();
}

/**
 * Estado del pedido como lo entiende el cliente:
 * pendiente de pago, pago por verificar, pagado o cancelado.
 */
export function customerOrderStatus(sale: {
  status: string;
  payment_status: string | null;
  payment_reference: string | null;
}): 'pagado' | 'por_verificar' | 'pendiente' | 'cancelado' {
  if (sale.status === 'cancelada') return 'cancelado';
  if (sale.payment_status === 'pagado' || sale.status === 'completada') return 'pagado';
  return sale.payment_reference ? 'por_verificar' : 'pendiente';
}
