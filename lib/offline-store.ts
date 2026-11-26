/**
 * Capa de almacenamiento offline sobre IndexedDB para el POS.
 *
 * Cubre dos necesidades:
 *  1. Cachear catálogo (productos, clientes, categorías) para poder
 *     consultarlos sin conexión.
 *  2. Encolar las ventas realizadas sin red para sincronizarlas con el
 *     backend cuando se recupere la conexión.
 *
 * Importante: todo el acceso a IndexedDB ocurre solo en el navegador.
 */

const DB_NAME = 'posib-offline-db';
// La versión 2 ya la usaba el hook useOfflineSync con el store
// 'pending-requests'. Subimos a 3 para añadir los stores de catálogo y
// la cola de ventas sin perder lo existente.
const DB_VERSION = 3;

export const STORE_CACHE = 'catalog-cache';
export const STORE_SALES_QUEUE = 'sales-queue';
const STORE_PENDING_REQUESTS = 'pending-requests';

export interface QueuedSale {
  // Clave local temporal mientras no se sincroniza con el servidor.
  localId: string;
  // Payload tal cual se enviaría a createSale().
  payload: unknown;
  tenantId: string | null;
  createdAt: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB no disponible'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Conservar el store usado por useOfflineSync.
      if (!db.objectStoreNames.contains(STORE_PENDING_REQUESTS)) {
        db.createObjectStore(STORE_PENDING_REQUESTS, { keyPath: 'timestamp' });
      }

      // Caché de catálogo: clave simple por nombre de colección.
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      }

      // Cola de ventas pendientes de sincronizar.
      if (!db.objectStoreNames.contains(STORE_SALES_QUEUE)) {
        db.createObjectStore(STORE_SALES_QUEUE, { keyPath: 'localId' });
      }
    };
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction([storeName], mode);
        const store = transaction.objectStore(storeName);
        const req = run(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

// ============================================
// CACHÉ DE CATÁLOGO
// ============================================

/** Guarda una colección (ej: 'products') en caché para uso offline. */
export async function cacheCollection<T>(key: string, data: T[]): Promise<void> {
  if (!isBrowser()) return;
  try {
    await tx(STORE_CACHE, 'readwrite', (store) =>
      store.put({ key, data, cachedAt: Date.now() })
    );
  } catch (error) {
    console.warn(`[offline] No se pudo cachear "${key}":`, error);
  }
}

/** Lee una colección cacheada. Devuelve [] si no hay nada. */
export async function readCachedCollection<T>(key: string): Promise<T[]> {
  if (!isBrowser()) return [];
  try {
    const record = await tx<{ data: T[] } | undefined>(
      STORE_CACHE,
      'readonly',
      (store) => store.get(key)
    );
    return record?.data ?? [];
  } catch (error) {
    console.warn(`[offline] No se pudo leer caché "${key}":`, error);
    return [];
  }
}

// ============================================
// COLA DE VENTAS
// ============================================

/** Evento que avisa a la interfaz que cambió la cola de ventas sin conexión. */
export const SALES_QUEUE_EVENT = 'posib-sales-queue-changed';

function notifyQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SALES_QUEUE_EVENT));
}

/** Encola una venta hecha sin conexión. */
export async function queueSale(sale: QueuedSale): Promise<void> {
  await tx(STORE_SALES_QUEUE, 'readwrite', (store) => store.put(sale));
  notifyQueueChanged();
}

/** Devuelve todas las ventas en cola, ordenadas por fecha de creación. */
export async function getQueuedSales(): Promise<QueuedSale[]> {
  if (!isBrowser()) return [];
  try {
    const sales = await tx<QueuedSale[]>(STORE_SALES_QUEUE, 'readonly', (store) =>
      store.getAll()
    );
    return sales.sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.warn('[offline] No se pudo leer la cola de ventas:', error);
    return [];
  }
}

/** Elimina una venta de la cola tras sincronizarla. */
export async function removeQueuedSale(localId: string): Promise<void> {
  await tx(STORE_SALES_QUEUE, 'readwrite', (store) => store.delete(localId));
  notifyQueueChanged();
}

/** Cuenta las ventas pendientes de sincronizar. */
export async function countQueuedSales(): Promise<number> {
  if (!isBrowser()) return 0;
  try {
    return await tx<number>(STORE_SALES_QUEUE, 'readonly', (store) => store.count());
  } catch {
    return 0;
  }
}
