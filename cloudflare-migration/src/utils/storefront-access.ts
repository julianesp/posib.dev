/**
 * Validación de acceso de la tienda pública (storefront).
 *
 * La tienda solo opera si el dueño está en trial vigente o pagó el addon de
 * Tienda Online (misma regla que hasStoreAccess en el front). Sin esto, una
 * tienda seguiría vendiendo con la suscripción vencida.
 */

import type { Env } from '../types';

export interface StoreAccessRow {
  id: string;
  is_superadmin: number;
  subscription_status: string;
  trial_end_date: string | null;
  has_store_addon: number;
  store_addon_expires_at: string | null;
}

const STORE_ACCESS_FIELDS =
  'id, is_superadmin, subscription_status, trial_end_date, has_store_addon, store_addon_expires_at';

export function storeSubscriptionAllowsStorefront(store: StoreAccessRow): boolean {
  if (store.is_superadmin) return true;

  const now = new Date();

  if (store.subscription_status === 'trial') {
    return !store.trial_end_date || now < new Date(store.trial_end_date);
  }

  if (store.subscription_status === 'active' && store.has_store_addon) {
    return !store.store_addon_expires_at || now < new Date(store.store_addon_expires_at);
  }

  return false;
}

/**
 * Busca una tienda habilitada por slug y valida su suscripción/addon.
 * `extraFields` permite pedir columnas adicionales del perfil.
 * Devuelve null si no existe, está deshabilitada o no tiene acceso vigente.
 */
export async function findActiveStore<T extends StoreAccessRow = StoreAccessRow>(
  db: Env['DB'],
  slug: string,
  extraFields = ''
): Promise<T | null> {
  const store = await db
    .prepare(
      `SELECT ${STORE_ACCESS_FIELDS}${extraFields ? `, ${extraFields}` : ''}
       FROM user_profiles
       WHERE store_slug = ? AND store_enabled = 1`
    )
    .bind(slug)
    .first<T>();

  if (!store || !storeSubscriptionAllowsStorefront(store)) {
    return null;
  }

  return store;
}

/**
 * Número de Nequi (o cuenta) válido para cobrar en la tienda: al menos 10
 * dígitos (un celular colombiano). Es requisito para encender la tienda y para
 * recibir pedidos: sin él el cliente no tiene a dónde pagar.
 */
export function hasValidNequiNumber(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\D/g, '').length >= 10
    : false;
}
