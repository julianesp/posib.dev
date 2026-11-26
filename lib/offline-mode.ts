/**
 * Modo "sin internet" del POS (p. ej. tras un corte de luz).
 *
 * Cuando el portátil arranca sin internet, Clerk no puede cargar (su script
 * vive en otro dominio) y el dashboard se quedaría cargando para siempre. Si
 * este equipo ya dejó el POS listo (snapshot guardado), entramos en modo sin
 * internet: el POS abre desde la copia local (service worker + IndexedDB) y
 * solo permite ventas que se encolan para subirlas al volver la conexión.
 *
 * Estado compartido entre el layout y el POS con useSyncExternalStore.
 */

import { useMemo, useSyncExternalStore } from 'react';

export const OFFLINE_READY_KEY = 'posib-offline-ready';
/** La copia local deja entrar sin sesión durante este tiempo como máximo. */
const READY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfflineReadyInfo {
  at: number;
  tenantId: string | null;
  products: number;
  customers: number;
}

export function readOfflineReady(): OfflineReadyInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(OFFLINE_READY_KEY);
    if (!raw) return null;
    const info = JSON.parse(raw) as OfflineReadyInfo;
    if (!info?.at || Date.now() - info.at > READY_MAX_AGE_MS) return null;
    return info;
  } catch {
    return null;
  }
}

export function writeOfflineReady(info: OfflineReadyInfo): void {
  try {
    localStorage.setItem(OFFLINE_READY_KEY, JSON.stringify(info));
  } catch {
    // Cuota llena: no es crítico.
  }
  emit();
}

// ── Estado "estamos en modo sin internet" ────────────────────────────────
let offlineMode = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setOfflineMode(value: boolean): void {
  if (offlineMode === value) return;
  offlineMode = value;
  emit();
}

export function isOfflineMode(): boolean {
  return offlineMode;
}

/** true si no hay red según el navegador o si arrancamos en modo sin internet. */
export function isOfflineNow(): boolean {
  if (offlineMode) return true;
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useOfflineMode(): boolean {
  return useSyncExternalStore(subscribe, () => offlineMode, () => false);
}

/**
 * Snapshot para la interfaz ("listo · hora"). Se lee como texto crudo para que
 * useSyncExternalStore compare strings estables, y en la hidratación devuelve
 * null igual que el servidor (si no, el HTML no coincide: error #418).
 */
function readReadyRaw(): string | null {
  try {
    return localStorage.getItem(OFFLINE_READY_KEY);
  } catch {
    return null;
  }
}
export function useOfflineReady(): OfflineReadyInfo | null {
  const raw = useSyncExternalStore(subscribe, readReadyRaw, () => null);
  return useMemo(() => (raw ? readOfflineReady() : null), [raw]);
}

/**
 * Comprueba si de verdad hay internet. navigator.onLine dice "true" si el
 * router está prendido aunque el proveedor siga caído (típico tras un corte
 * de luz), así que se hace una petición real con tiempo límite.
 */
export async function hasRealInternet(timeoutMs = 5000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const url = process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL;
  if (!url) return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${url}/health?t=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Pide al service worker que guarde la página del POS para abrirla sin red. */
export async function cachePosPageForOffline(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.active;
    if (!sw) return false;
    return await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 20000);
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(!!e.data?.ok);
      };
      sw.postMessage({ type: 'CACHE_POS_PAGE' }, [channel.port2]);
    });
  } catch {
    return false;
  }
}

/** Evita que el navegador borre la copia local cuando le falte espacio. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // No soportado: seguimos igual.
  }
}
