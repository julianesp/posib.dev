/**
 * Service Worker para funcionalidad offline
 * Permite que el POS funcione sin conexión a internet
 */

const CACHE_NAME = 'posib-pos-v3';
const OFFLINE_CACHE = 'posib-offline-v3';
// Copia de la página del POS para abrirla sin internet (p. ej. tras un corte de luz).
const PAGES_CACHE = 'posib-pages-v1';
const POS_PATH = '/dashboard/pos';
// Fotos de productos (Cloudinary) para verlas sin internet. Se guardan con CORS
// (no opacas) y se limitan para no llenar el disco.
const IMAGES_CACHE = 'posib-images-v1';
const IMAGES_MAX = 600;

// Recursos críticos que siempre deben estar disponibles offline
const CRITICAL_RESOURCES = [
  '/offline.html',
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching recursos críticos');
      // Solo pre-cachear offline.html para evitar errores de instalación
      return cache.addAll(CRITICAL_RESOURCES).catch((err) => {
        console.error('[Service Worker] Error pre-caching:', err);
        // No fallar la instalación por errores de cache
        return Promise.resolve();
      });
    })
  );

  // Activar inmediatamente
  self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activando...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== OFFLINE_CACHE && cacheName !== PAGES_CACHE && cacheName !== IMAGES_CACHE) {
            console.log('[Service Worker] Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Tomar control inmediatamente
  return self.clients.claim();
});

// Interceptar peticiones de red
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method === 'GET' &&
    url.hostname === 'res.cloudinary.com' &&
    request.destination === 'image'
  ) {
    event.respondWith(handleProductImage(request));
    return;
  }

  // Ignorar peticiones a dominios externos (APIs de terceros, etc)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Solo interceptar peticiones POST/PUT/DELETE para guardarlas offline
  if (request.method !== 'GET') {
    // Para peticiones POST/PUT/DELETE, intentar enviar y si falla guardar offline
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async () => {
          // Si falla la red, guardar en IndexedDB
          console.log('[Service Worker] Guardando petición offline:', request.method, request.url);
          return await handleOfflineRequest(request);
        })
    );
    return;
  }

  // Navegaciones (abrir una página): red primero. Si no hay red y este equipo
  // dejó guardado el POS, se abre el POS desde la copia local.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  // Para peticiones GET, solo cachear recursos estáticos (JS, CSS, imágenes)
  // No cachear HTML ni APIs para evitar problemas de navegación
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2|ico)$/)
  ) {
    // Los archivos de /_next/static llevan hash en el nombre: se ignora la
    // query (?dpl=...) para que la copia guardada sirva sin internet.
    const matchOpts = url.pathname.startsWith('/_next/static/') ? { ignoreSearch: true } : undefined;
    event.respondWith(
      caches.match(request, matchOpts).then((cached) => {
        // Cache First para recursos estáticos
        if (cached) {
          return cached;
        }

        // Si no está en cache, intentar descargar
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        }).catch(() => {
          // Si falla, simplemente falla (no bloquear navegación)
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  // Para todo lo demás (HTML, APIs, etc), dejar que pase sin interceptar
  // Esto permite que Next.js maneje las rutas normalmente
  return;

  // Estrategia Cache First para recursos estáticos
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Para API calls, intentar red primero
  event.respondWith(
    fetch(request)
      .then((response) => response)
      .catch(() => {
        return new Response(
          JSON.stringify({
            error: 'Sin conexión',
            offline: true,
            message: 'Esta petición se sincronizará cuando recuperes la conexión'
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
  );
});

// ── Fotos de productos: red primero, copia si no hay internet ───────────
async function handleProductImage(request) {
  const cache = await caches.open(IMAGES_CACHE);
  try {
    const response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (response.ok) {
      await cache.put(request.url, response.clone());
      trimImages(cache);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request.url);
    return cached || new Response('', { status: 504 });
  }
}

let trimming = false;
async function trimImages(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const extra = keys.length - IMAGES_MAX;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}

// ── Navegación con respaldo al POS guardado ─────────────────────────────
async function handleNavigation(request, url) {
  try {
    const response = await fetch(request);
    // Cada vez que el POS abre con internet se refresca su copia.
    if (
      url.pathname === POS_PATH &&
      response.ok &&
      !response.redirected &&
      response.type === 'basic'
    ) {
      const copy = response.clone();
      caches.open(PAGES_CACHE).then((cache) => cache.put(POS_PATH, copy));
    }
    return response;
  } catch (err) {
    const cache = await caches.open(PAGES_CACHE);
    const cachedPos = await cache.match(POS_PATH);
    if (cachedPos) {
      if (url.pathname === POS_PATH) return cachedPos;
      // Cualquier otra página (inicio, panel...) lleva al POS guardado.
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>posib.dev</title>' +
          '<script>location.replace("' + POS_PATH + '")</script>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    const offline = await caches.match('/offline.html');
    return offline || new Response('Sin conexión', { status: 503 });
  }
}

// Guarda la página del POS y todo lo que necesita para arrancar (JS, CSS,
// fuentes). Lo pide la app con el botón "Preparar sin internet" y al abrir el POS.
async function cachePosPage() {
  const response = await fetch(POS_PATH, { credentials: 'include', cache: 'no-store' });
  if (!response.ok || response.redirected) return false;
  const html = await response.clone().text();
  const pages = await caches.open(PAGES_CACHE);
  await pages.put(POS_PATH, response);

  const assets = new Set();
  const re = /(?:src|href)="(\/[^"]+?\.(?:js|css|woff2?|svg|png|ico)(?:\?[^"]*)?)"/g;
  let m;
  while ((m = re.exec(html))) assets.add(m[1].replace(/&amp;/g, '&'));
  // Chunks que Next referencia dentro de los scripts inline.
  const chunkRe = /(\/_next\/static\/[^"'\\\s]+\.(?:js|css))/g;
  while ((m = chunkRe.exec(html))) assets.add(m[1]);
  assets.add('/offline.html');

  const cache = await caches.open(CACHE_NAME);
  const cssFiles = [];
  await Promise.all(
    [...assets].map(async (path) => {
      try {
        if (await cache.match(path, { ignoreSearch: true })) {
          if (path.split('?')[0].endsWith('.css')) cssFiles.push(path);
          return;
        }
        const res = await fetch(path);
        if (res.ok) {
          await cache.put(path, res.clone());
          if (path.split('?')[0].endsWith('.css')) cssFiles.push(path);
        }
      } catch (e) {
        // Un recurso suelto que falle no impide el resto.
      }
    })
  );

  // Fuentes referenciadas desde el CSS.
  const fontPaths = new Set();
  for (const css of cssFiles) {
    try {
      const res = await cache.match(css, { ignoreSearch: true });
      const text = res ? await res.text() : '';
      const urlRe = /url\((\/_next\/static\/media\/[^)]+)\)/g;
      let f;
      while ((f = urlRe.exec(text))) fontPaths.add(f[1]);
    } catch (e) {}
  }
  await Promise.all(
    [...fontPaths].map(async (path) => {
      try {
        if (await cache.match(path, { ignoreSearch: true })) return;
        const res = await fetch(path);
        if (res.ok) await cache.put(path, res);
      } catch (e) {}
    })
  );
  return true;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_POS_PAGE') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      cachePosPage()
        .then((ok) => port && port.postMessage({ ok }))
        .catch(() => port && port.postMessage({ ok: false }))
    );
  }
});

// Manejar peticiones offline (POST/PUT/DELETE)
async function handleOfflineRequest(request) {
  const requestData = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.clone().text(),
    timestamp: Date.now(),
  };

  // Guardar en IndexedDB para sincronizar después
  await saveToIndexedDB('pending-requests', requestData);

  return new Response(
    JSON.stringify({
      success: true,
      offline: true,
      message: 'Guardado localmente. Se sincronizará cuando recuperes la conexión.',
      timestamp: requestData.timestamp,
    }),
    {
      status: 202, // Accepted
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// Guardar en IndexedDB
async function saveToIndexedDB(storeName, data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('posib-offline-db', 2); // Versión 2 con keyPath correcto

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const addRequest = store.add(data);

      addRequest.onsuccess = () => resolve(addRequest.result);
      addRequest.onerror = () => reject(addRequest.error);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Eliminar store antiguo si existe
      if (db.objectStoreNames.contains(storeName)) {
        db.deleteObjectStore(storeName);
      }

      // Crear nuevo store con keyPath correcto
      db.createObjectStore(storeName, { keyPath: 'timestamp' });
    };
  });
}

// Escuchar mensajes para sincronización manual
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_OFFLINE_DATA') {
    syncOfflineData();
  }
});

// Sincronización automática cuando se recupera la conexión
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-data') {
    event.waitUntil(syncOfflineData());
  }
});

// Función de sincronización
async function syncOfflineData() {
  console.log('[Service Worker] Sincronizando datos offline...');

  return new Promise((resolve, reject) => {
    const request = indexedDB.open('posib-offline-db', 2); // Versión 2

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result;
      const transaction = db.transaction(['pending-requests'], 'readonly');
      const store = transaction.objectStore('pending-requests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = async () => {
        const pendingRequests = getAllRequest.result;

        if (pendingRequests.length === 0) {
          console.log('[Service Worker] No hay datos pendientes de sincronizar');
          resolve();
          return;
        }

        console.log(`[Service Worker] Sincronizando ${pendingRequests.length} peticiones...`);

        // Enviar cada petición pendiente
        for (const reqData of pendingRequests) {
          try {
            await fetch(reqData.url, {
              method: reqData.method,
              headers: reqData.headers,
              body: reqData.body,
            });

            // Si tiene éxito, eliminar de IndexedDB
            await deleteFromIndexedDB('pending-requests', reqData);
          } catch (error) {
            console.error('[Service Worker] Error sincronizando:', error);
          }
        }

        resolve();
      };
    };
  });
}

// Eliminar de IndexedDB
async function deleteFromIndexedDB(storeName, data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('posib-offline-db', 2); // Versión 2

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      // Eliminar por timestamp (asumiendo que es único)
      const deleteRequest = store.delete(data.timestamp);

      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
  });
}
