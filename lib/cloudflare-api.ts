/**
 * Cloudflare Workers API Client
 *
 * Este módulo reemplaza las llamadas directas a Firebase/Firestore
 * por llamadas HTTP a nuestra API de Cloudflare Workers.
 *
 * Uso:
 * import { getProducts, createProduct } from '@/lib/cloudflare-api';
 *
 * const products = await getProducts(getToken);
 */

import type { PurchaseOrderWithItems } from '@/lib/types';
import type { BusinessTypeId } from '@/lib/business-types';

// URL base de la API de Cloudflare Workers
const API_BASE_URL = process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL || 'https://tienda-pos-api.julii1295.workers.dev';

/**
 * Tipo para la función que obtiene el token de Clerk
 */
export type GetTokenFn = () => Promise<string | null>;

/**
 * Response estándar de la API
 */
interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Error de la API que conserva el código de estado HTTP. Permite a quien llama
 * distinguir, por ejemplo, un 402 (suscripción requerida) de un fallo de red o
 * de autenticación, en lugar de tratar toda excepción por igual.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Get the selected tenant ID from localStorage
 */
export function getSelectedTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('selected_tenant_id');
}

/** Cabeceras para las rutas propias de Next (/api/ai/...): JSON + tienda activa. */
export function tenantHeaders(): Record<string, string> {
  const tenantId = getSelectedTenantId();
  return {
    'Content-Type': 'application/json',
    ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
  };
}

/**
 * Set the selected tenant ID in localStorage
 */
export function setSelectedTenantId(tenantId: string | null) {
  if (typeof window === 'undefined') return;
  const previous = localStorage.getItem('selected_tenant_id');
  if (tenantId) {
    localStorage.setItem('selected_tenant_id', tenantId);
  } else {
    localStorage.removeItem('selected_tenant_id');
  }
  // Al cambiar de tenant, el perfil cacheado ya no aplica.
  if (previous !== tenantId) {
    invalidateUserProfileCache();
  }
}

/**
 * Realizar petición HTTP a la API
 */
async function fetchAPI<T = unknown>(
  endpoint: string,
  getToken: GetTokenFn,
  options: RequestInit = {},
  skipTenant = false
): Promise<T> {
  try {
    // Obtener token JWT de Clerk
    const token = await getToken();

    if (!token) {
      throw new Error('No se pudo obtener el token de autenticación');
    }

    // Configurar headers
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');

    // Agregar tenant ID si está seleccionado (omitir en operaciones globales de superadmin)
    if (!skipTenant) {
      const tenantId = getSelectedTenantId();
      if (tenantId) {
        headers.set('X-Tenant-ID', tenantId);
      }
    }

    // Realizar petición
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Intentar parsear JSON - si falla, obtener texto para mensaje de error
    let data: APIResponse<T> | undefined;
    try {
      data = await response.json();
    } catch (err) {
      // respuesta no JSON (p. ej. vacío), construir un mensaje legible
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        throw new ApiError(text || `Error ${response.status}: ${response.statusText || response.status}`, response.status);
      }
      // Si está todo ok pero no hay JSON (común en DELETE), retornar vacío
      // Para operaciones como DELETE que devuelven void
      return undefined as unknown as T;
    }

    // Para DELETE y otras operaciones que retornan void, data puede ser undefined
    // Solo validar si la operación falló
    if (!response.ok) {
      // Si no hay data pero falló, construir error
      if (!data) {
        throw new ApiError(`Error ${response.status}: ${response.statusText || response.status}`, response.status);
      }
    }

    // Si no hay data pero response.ok es true, es una operación exitosa sin body
    if (!data && response.ok) {
      return undefined as unknown as T;
    }

    // Manejar errores: construir mensaje seguro incluso si data.error es undefined o un objeto
    if (!response.ok || (data && !data.success)) {
      let msg = '';
      if (data && typeof data.error === 'string' && data.error.trim()) msg = data.error;
      else if (data && typeof data.message === 'string' && data.message.trim()) msg = data.message;
      else if (data) msg = JSON.stringify(data);
      msg = msg || `Error ${response.status}: ${response.statusText || response.status}`;
      throw new ApiError(msg, response.status);
    }

    return data?.data as T;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
}

// ============================================
// CACHÉ DE LECTURAS (reduce consumo de D1)
// ============================================
//
// Varias pantallas y el panel de notificaciones piden las MISMAS listas
// (productos, ventas, clientes) varias veces en la misma carga o dentro de una
// misma tanda de notificaciones. Sin caché, cada llamada lee la tabla completa
// en D1 y agota el cupo diario del plan gratuito. Cacheamos por TENANT con un
// TTL corto y deduplicamos las peticiones en vuelo, así las llamadas casi
// simultáneas comparten una sola ida al Worker. El TTL es corto a propósito:
// tras crear/editar/borrar se invalida la caché correspondiente (ver más abajo),
// y aun sin invalidar, los datos se refrescan en segundos.
const LIST_CACHE_TTL_MS = 30_000;

interface ListCacheEntry<T> {
  tenantId: string | null;
  data: T;
  at: number;
}

function createCachedList<T>(endpoint: string, ttlMs = LIST_CACHE_TTL_MS) {
  let cache: ListCacheEntry<T> | null = null;
  let inflight: { tenantId: string | null; promise: Promise<T> } | null = null;
  // Sube en cada invalidate(): una lectura que empezó antes (p. ej. la lista con
  // la venta que se acaba de borrar) no debe guardar sus datos viejos en caché.
  let generation = 0;

  const load = async (
    getToken: GetTokenFn,
    options: { force?: boolean } = {}
  ): Promise<T> => {
    const tenantId = getSelectedTenantId();
    const now = Date.now();

    if (
      !options.force &&
      cache &&
      cache.tenantId === tenantId &&
      now - cache.at < ttlMs
    ) {
      return cache.data;
    }

    if (!options.force && inflight && inflight.tenantId === tenantId) {
      return inflight.promise;
    }

    const startedAt = generation;
    const promise = fetchAPI<T>(endpoint, getToken)
      .then((data) => {
        if (startedAt === generation) cache = { tenantId, data, at: Date.now() };
        return data;
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });

    inflight = { tenantId, promise };
    return promise;
  };

  const invalidate = () => {
    generation++;
    cache = null;
    inflight = null;
  };

  return { load, invalidate };
}

const _productsCache = createCachedList<Product[]>('/api/products');
const _salesCache = createCachedList<Sale[]>('/api/sales');
const _customersCache = createCachedList<Customer[]>('/api/customers');

// ============================================
// PRODUCTOS
// ============================================

export interface Product {
  id: string;
  tenant_id: string;
  barcode?: string;
  name: string;
  description?: string;
  category_id?: string;
  supplier_id?: string;
  cost_price: number;
  sale_price: number;
  stock: number;
  min_stock: number;
  expiration_date?: string;
  image_url?: string;
  images?: string;

  // Campos para venta por unidades (ej: huevos sueltos de una cubeta)
  sell_by_unit?: boolean;  // Permite venta por unidad
  units_per_package?: number;  // Unidades por paquete (ej: 30 huevos por cubeta)
  unit_name?: string;  // Nombre de la unidad (ej: 'huevo', 'gramo')
  package_name?: string;  // Nombre del paquete (ej: 'cubeta', 'caja')
  price_per_unit?: number;  // Precio por unidad suelta

  // Campos tipo Siigo / facturación electrónica (migración 027)
  tax_rate?: number;  // % de impuesto (0, 5, 19; 8 = INC). El precio de venta YA lo incluye
  tax_label?: string;  // Texto del impuesto tal como viene de Siigo (ej. "IVA 19%")
  sale_price_2?: number;  // Segundo precio de venta (lista 2 de Siigo, ej. mayorista)
  factory_reference?: string;  // Referencia de fábrica
  track_inventory?: number | boolean;  // 0 = se vende aunque no tenga stock (no se controla inventario)
  is_active?: number | boolean;  // 0 = inactivo (no aparece en el POS)

  created_at: string;
  updated_at: string;
}

export async function getProducts(
  getToken: GetTokenFn,
  options: { force?: boolean } = {}
): Promise<Product[]> {
  return _productsCache.load(getToken, options);
}

/** Invalida la caché de productos (llamar tras crear/editar/borrar/mover stock). */
export function invalidateProductsCache() {
  _productsCache.invalidate();
}

export async function getProductById(id: string, getToken: GetTokenFn): Promise<Product> {
  return fetchAPI<Product>(`/api/products/${id}`, getToken);
}

export async function createProduct(data: Partial<Product>, getToken: GetTokenFn): Promise<Product> {
  const result = await fetchAPI<Product>('/api/products', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  invalidateProductsCache();
  return result;
}

export async function updateProduct(id: string, data: Partial<Product>, getToken: GetTokenFn): Promise<Product> {
  const result = await fetchAPI<Product>(`/api/products/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  invalidateProductsCache();
  return result;
}

export interface ImportProductRow {
  barcode?: string | null;
  name: string;
  description?: string | null;
  category_name?: string | null;
  sale_price: number;
  sale_price_2?: number | null;
  cost_price?: number;
  stock?: number;
  min_stock?: number;
  tax_rate?: number;
  tax_label?: string | null;
  factory_reference?: string | null;
  track_inventory?: boolean;
  is_active?: boolean;
}

export interface ImportProductsResult {
  created: number;
  updated: number;
  skipped: number;
  categoriesCreated: number;
  errors: Array<{ code: string; name: string; error: string }>;
}

/**
 * Meses ('YYYY-MM') cuyo informe mensual de ventas ya descargó la tienda.
 * Devuelve null si no se pudo consultar (el llamador usa lo guardado en el navegador).
 */
export async function getMonthlyReportDownloads(getToken: GetTokenFn): Promise<string[] | null> {
  try {
    const data = await fetchAPI<{ months: string[] }>('/api/monthly-reports/downloads', getToken);
    return data.months ?? [];
  } catch {
    return null;
  }
}

/** Registra que la tienda descargó el informe de ese mes (no falla si no se puede). */
export async function markMonthlyReportDownloaded(month: string, getToken: GetTokenFn): Promise<void> {
  try {
    await fetchAPI('/api/monthly-reports/downloads', getToken, {
      method: 'POST',
      body: JSON.stringify({ month }),
    });
  } catch (error) {
    console.warn('No se pudo registrar la descarga del informe:', error);
  }
}

/** Importa una tanda (máx. 500) de productos. Ver POST /api/products/import del Worker. */
export async function importProducts(
  products: ImportProductRow[],
  updateExisting: boolean,
  getToken: GetTokenFn
): Promise<ImportProductsResult> {
  const result = await fetchAPI<ImportProductsResult>('/api/products/import', getToken, {
    method: 'POST',
    body: JSON.stringify({ products, update_existing: updateExisting }),
  });
  invalidateProductsCache();
  return result;
}

export async function deleteProduct(id: string, getToken: GetTokenFn): Promise<void> {
  await fetchAPI<void>(`/api/products/${id}`, getToken, {
    method: 'DELETE',
  });
  invalidateProductsCache();
}

export async function checkProductHasSales(id: string, getToken: GetTokenFn): Promise<{ hasSales: boolean; salesCount: number }> {
  return fetchAPI<{ hasSales: boolean; salesCount: number }>(`/api/products/${id}/has-sales`, getToken);
}

/**
 * Fusiona productos repetidos: suma el stock de los duplicados al principal,
 * reasigna el historial (ventas, movimientos, órdenes) hacia el principal y
 * elimina los duplicados. Ver `POST /api/products/merge` en el Worker.
 */
export async function mergeProducts(
  primaryId: string,
  duplicateIds: string[],
  getToken: GetTokenFn
): Promise<{ product: Product | null; mergedCount: number }> {
  return fetchAPI<{ product: Product | null; mergedCount: number }>(
    '/api/products/merge',
    getToken,
    {
      method: 'POST',
      body: JSON.stringify({ primaryId, duplicateIds }),
    }
  );
}

export async function searchProducts(query: string, getToken: GetTokenFn): Promise<Product[]> {
  return fetchAPI<Product[]>(`/api/products/search?q=${encodeURIComponent(query)}`, getToken);
}

export async function getLowStockProducts(getToken: GetTokenFn): Promise<Product[]> {
  return fetchAPI<Product[]>('/api/products/low-stock', getToken);
}

// ============================================
// CLIENTES
// ============================================

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  id_number?: string;
  loyalty_points: number;
  current_debt?: number;
  credit_limit?: number;
  created_at: string;
  updated_at: string;
}

export async function getCustomers(
  getToken: GetTokenFn,
  options: { force?: boolean } = {}
): Promise<Customer[]> {
  return _customersCache.load(getToken, options);
}

/** Invalida la caché de clientes (llamar tras crear/editar/borrar cliente o al cambiar su deuda). */
export function invalidateCustomersCache() {
  _customersCache.invalidate();
}

export async function getCustomerById(id: string, getToken: GetTokenFn): Promise<Customer> {
  return fetchAPI<Customer>(`/api/customers/${id}`, getToken);
}

export async function createCustomer(data: Partial<Customer>, getToken: GetTokenFn): Promise<Customer> {
  const result = await fetchAPI<Customer>('/api/customers', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  invalidateCustomersCache();
  return result;
}

export async function updateCustomer(id: string, data: Partial<Customer>, getToken: GetTokenFn): Promise<Customer> {
  const result = await fetchAPI<Customer>(`/api/customers/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  invalidateCustomersCache();
  return result;
}

export async function deleteCustomer(id: string, getToken: GetTokenFn): Promise<void> {
  await fetchAPI<void>(`/api/customers/${id}`, getToken, {
    method: 'DELETE',
  });
  invalidateCustomersCache();
}

// ============================================
// CATEGORÍAS
// ============================================

export interface Category {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export async function getCategories(getToken: GetTokenFn): Promise<Category[]> {
  return fetchAPI<Category[]>('/api/categories', getToken);
}

export async function getCategoryById(id: string, getToken: GetTokenFn): Promise<Category> {
  return fetchAPI<Category>(`/api/categories/${id}`, getToken);
}

export async function createCategory(data: Partial<Category>, getToken: GetTokenFn): Promise<Category> {
  return fetchAPI<Category>('/api/categories', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCategory(id: string, data: Partial<Category>, getToken: GetTokenFn): Promise<Category> {
  return fetchAPI<Category>(`/api/categories/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCategory(id: string, getToken: GetTokenFn): Promise<void> {
  return fetchAPI<void>(`/api/categories/${id}`, getToken, {
    method: 'DELETE',
  });
}

// ============================================
// PROVEEDORES
// ============================================

export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  notes?: string;
  tax_id?: string;
  payment_type: 'contado' | 'credito';
  credit_days: number;
  credit_limit: number;
  current_debt: number;
  default_discount: number;
  visit_day?: string;
  website?: string;
  whatsapp?: string;
  business_hours?: string;
  rating?: number;
  status: 'activo' | 'inactivo' | 'suspendido';
  delivery_days: number;
  minimum_order: number;
  total_purchased: number;
  last_purchase_date?: string;
  created_at: string;
  updated_at: string;
}

export async function getSuppliers(getToken: GetTokenFn): Promise<Supplier[]> {
  return fetchAPI<Supplier[]>('/api/suppliers', getToken);
}

export async function getSupplierById(id: string, getToken: GetTokenFn): Promise<Supplier> {
  return fetchAPI<Supplier>(`/api/suppliers/${id}`, getToken);
}

export async function createSupplier(data: Partial<Supplier>, getToken: GetTokenFn): Promise<Supplier> {
  return fetchAPI<Supplier>('/api/suppliers', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSupplier(id: string, data: Partial<Supplier>, getToken: GetTokenFn): Promise<Supplier> {
  return fetchAPI<Supplier>(`/api/suppliers/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSupplier(id: string, getToken: GetTokenFn): Promise<void> {
  return fetchAPI<void>(`/api/suppliers/${id}`, getToken, {
    method: 'DELETE',
  });
}

export interface SupplierStats {
  supplier_name: string;
  total_products: number;
  total_purchased: number;
  current_debt: number;
  credit_available: number;
  purchase_orders_count: number;
  last_purchase_date?: string;
  status: string;
  rating?: number;
}

// export async function getSuppliers(getToken: GetTokenFn): Promise<Supplier[]> {
//   return fetchAPI<Supplier[]>('/api/suppliers', getToken);
// }

// export async function getSupplierById(id: string, getToken: GetTokenFn): Promise<Supplier> {
//   return fetchAPI<Supplier>(`/api/suppliers/${id}`, getToken);
// }

// export async function createSupplier(data: Partial<Supplier>, getToken: GetTokenFn): Promise<Supplier> {
//   return fetchAPI<Supplier>('/api/suppliers', getToken, {
//     method: 'POST',
//     body: JSON.stringify(data),
//   });
// }

// export async function updateSupplier(id: string, data: Partial<Supplier>, getToken: GetTokenFn): Promise<Supplier> {
//   return fetchAPI<Supplier>(`/api/suppliers/${id}`, getToken, {
//     method: 'PUT',
//     body: JSON.stringify(data),
//   });
// }

// export async function deleteSupplier(id: string, getToken: GetTokenFn): Promise<void> {
//   return fetchAPI<void>(`/api/suppliers/${id}`, getToken, {
//     method: 'DELETE',
//   });
// }

export async function getSupplierProducts(id: string, getToken: GetTokenFn): Promise<Product[]> {
  return fetchAPI<Product[]>(`/api/suppliers/${id}/products`, getToken);
}

export async function getSupplierStats(id: string, getToken: GetTokenFn): Promise<SupplierStats> {
  return fetchAPI<SupplierStats>(`/api/suppliers/${id}/stats`, getToken);
}

// ============================================
// PURCHASE ORDERS
// ============================================

export interface PurchaseOrderItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  subtotal?: number;
}

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  user_profile_id: string;
  supplier_id: string;
  order_number: string;
  status: 'pendiente' | 'recibida' | 'cancelada';
  order_date: string;
  expected_date?: string;
  received_date?: string;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  items?: PurchaseOrderItem[];
}

export async function getPurchaseOrders(getToken: GetTokenFn): Promise<PurchaseOrderWithItems[]> {
  return fetchAPI<PurchaseOrderWithItems[]>('/api/purchase-orders', getToken);
}

export async function getPurchaseOrderById(id: string, getToken: GetTokenFn): Promise<PurchaseOrder> {
  return fetchAPI<PurchaseOrder>(`/api/purchase-orders/${id}`, getToken);
}

export async function getPurchaseOrdersBySupplier(supplierId: string, getToken: GetTokenFn): Promise<PurchaseOrderWithItems[]> {
  return fetchAPI<PurchaseOrderWithItems[]>(`/api/purchase-orders/supplier/${supplierId}`, getToken);
}

export async function createPurchaseOrder(data: Partial<PurchaseOrder>, getToken: GetTokenFn): Promise<PurchaseOrder> {
  return fetchAPI<PurchaseOrder>('/api/purchase-orders', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePurchaseOrder(id: string, data: Partial<PurchaseOrder>, getToken: GetTokenFn): Promise<PurchaseOrder> {
  return fetchAPI<PurchaseOrder>(`/api/purchase-orders/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function receivePurchaseOrder(id: string, getToken: GetTokenFn): Promise<PurchaseOrder> {
  return fetchAPI<PurchaseOrder>(`/api/purchase-orders/${id}/receive`, getToken, {
    method: 'PUT',
  });
}

export async function deletePurchaseOrder(id: string, getToken: GetTokenFn): Promise<void> {
  return fetchAPI<void>(`/api/purchase-orders/${id}`, getToken, {
    method: 'DELETE',
  });
}

// ============================================
// VENTAS
// ============================================

export interface SaleItem {
  id: string;
  tenant_id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  subtotal: number;
  created_at: string;
}

export interface Sale {
  id: string;
  tenant_id: string;
  sale_number: string;
  cashier_id: string;
  customer_id?: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: 'efectivo' | 'nequi' | 'tarjeta' | 'transferencia' | 'credito';
  payment_status?: 'pagado' | 'pendiente' | 'parcial';
  status: 'completada' | 'cancelada' | 'pendiente';
  points_earned?: number;
  notes?: string;
  amount_paid?: number;
  amount_pending?: number;
  shipping_cost?: number;
  payment_reference?: string;
  payment_reference_at?: string;
  created_at: string;
  updated_at: string;
  items?: SaleItem[];
}

export interface UserProfile {
  id: string;
  clerk_user_id: string;
  email: string;
  role: 'admin' | 'cajero';
  full_name?: string;
  phone?: string;
  // QR de pagos del tendero (Nequi/Daviplata/Bre-B) para cobrar en el POS
  payment_qr_url?: string;
  // Color del sistema elegido por el tendero (id de lib/accent.ts). Migración 029.
  ui_accent?: string;
  is_superadmin?: boolean;
  // Clasificación de tienda (ver lib/business-types.ts)
  business_type?: BusinessTypeId;
  subscription_status: 'trial' | 'active' | 'expired' | 'canceled';
  trial_start_date?: string;
  trial_end_date?: string;
  subscription_id?: string;
  last_payment_date?: string;
  next_billing_date?: string;
  plan_id?: string;
  has_ai_addon?: boolean;
  has_store_addon?: boolean;
  has_email_addon?: boolean;
  ai_addon_expires_at?: string;
  store_addon_expires_at?: string;
  email_addon_expires_at?: string;
  auto_reports_enabled?: boolean;
  auto_reports_time?: string;
  auto_reports_email?: string;

  // Configuración del Storefront (Tienda Online)
  store_slug?: string;
  store_name?: string;
  store_description?: string;
  store_logo_url?: string;
  store_banner_url?: string;
  store_banner_images?: string; // JSON array de URLs para el carrusel
  gemini_api_key?: string; // API Key personal de Gemini del usuario
  store_primary_color?: string;
  store_secondary_color?: string;
  store_whatsapp?: string;
  store_facebook?: string;
  store_instagram?: string;
  store_address?: string;
  store_city?: string;
  store_maps_url?: string;
  store_phone?: string;
  store_email?: string;
  store_enabled?: boolean;
  store_terms?: string;
  store_shipping_enabled?: boolean;
  store_pickup_enabled?: boolean;
  store_min_order?: number;
  store_nequi_number?: string;

  // Configuración de ePayco (tienda online)
  epayco_public_key?: string;
  epayco_private_key?: string;
  epayco_customer_id?: string;
  epayco_enabled?: boolean;

  created_at: string;
  updated_at: string;
}

export async function getSales(
  getToken: GetTokenFn,
  options: { force?: boolean } = {}
): Promise<Sale[]> {
  return _salesCache.load(getToken, options);
}

/** Invalida la caché de ventas (llamar tras registrar una venta o un abono). */
export function invalidateSalesCache() {
  _salesCache.invalidate();
}

export async function getSaleById(id: string, getToken: GetTokenFn): Promise<Sale> {
  return fetchAPI<Sale>(`/api/sales/${id}`, getToken);
}

export async function createSale(data: Partial<Sale>, getToken: GetTokenFn): Promise<Sale> {
  const result = await fetchAPI<Sale>('/api/sales', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  // Una venta cambia ventas, descuenta stock (productos) y puede crear deuda
  // (clientes): invalidar las tres cachés.
  invalidateSalesCache();
  invalidateProductsCache();
  invalidateCustomersCache();
  return result;
}

// Resultado de una importación en lote de ventas (ej. facturas de Siigo).
export interface ImportSalesResult {
  imported: number;
  skipped: number;
  productsCreated: number;
  customersCreated: number;
  errors: Array<{ document: string; error: string }>;
}

/**
 * Importa ventas históricas en lote. Las facturas deben venir ya normalizadas
 * (ver lib/siigo-import.ts). Crea productos/clientes faltantes y NO toca stock.
 */
export async function importSales(
  invoices: unknown[],
  getToken: GetTokenFn,
): Promise<ImportSalesResult> {
  const result = await fetchAPI<ImportSalesResult>('/api/sales/import', getToken, {
    method: 'POST',
    body: JSON.stringify({ invoices }),
  });
  // Puede crear ventas, productos y clientes.
  invalidateSalesCache();
  invalidateProductsCache();
  invalidateCustomersCache();
  return result;
}

export async function updateSale(id: string, data: Partial<Sale>, getToken: GetTokenFn): Promise<Sale> {
  const result = await fetchAPI<Sale>(`/api/sales/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  invalidateSalesCache();
  return result;
}

export async function deleteSale(id: string, getToken: GetTokenFn): Promise<void> {
  await fetchAPI<void>(`/api/sales/${id}`, getToken, {
    method: 'DELETE',
  });
  // Borrar una venta puede reponer stock y ajustar deuda.
  invalidateSalesCache();
  invalidateProductsCache();
  invalidateCustomersCache();
}

// ============================================
// USER PROFILES
// ============================================

// Caché en memoria del perfil del usuario. El dashboard monta muchos componentes
// que piden el perfil por su cuenta (sidebar, header, banners, POS, etc.); sin
// caché, una sola carga dispara 10+ lecturas a /api/user-profiles y agota el cupo
// diario de D1 (que se manifiesta como falsos "Unauthorized"). Cacheamos el
// resultado por TENANT durante un tiempo corto y deduplicamos las peticiones en
// vuelo para que las llamadas concurrentes compartan una sola ida al Worker.
const PROFILE_CACHE_TTL_MS = 60_000; // 1 minuto: suficiente para una carga de página
let _profileCache: { tenantId: string | null; data: UserProfile; at: number } | null = null;
let _profileInflight: { tenantId: string | null; promise: Promise<UserProfile> } | null = null;

/**
 * Invalida la caché del perfil. Llamar tras actualizar el perfil (updateUserProfile
 * ya lo hace) o al cambiar de tenant, para que la próxima lectura sea fresca.
 */
export function invalidateUserProfileCache() {
  _profileCache = null;
  _profileInflight = null;
}

export async function getUserProfile(
  getToken: GetTokenFn,
  options: { force?: boolean } = {}
): Promise<UserProfile> {
  const tenantId = getSelectedTenantId();
  const now = Date.now();

  // Servir de caché si es fresca y del mismo tenant.
  if (
    !options.force &&
    _profileCache &&
    _profileCache.tenantId === tenantId &&
    now - _profileCache.at < PROFILE_CACHE_TTL_MS
  ) {
    return _profileCache.data;
  }

  // Deduplicar peticiones concurrentes del mismo tenant.
  if (!options.force && _profileInflight && _profileInflight.tenantId === tenantId) {
    return _profileInflight.promise;
  }

  const promise = fetchAPI<UserProfile>('/api/user-profiles', getToken)
    .then((data) => {
      _profileCache = { tenantId, data, at: Date.now() };
      return data;
    })
    .finally(() => {
      if (_profileInflight && _profileInflight.tenantId === tenantId) {
        _profileInflight = null;
      }
    });

  _profileInflight = { tenantId, promise };
  return promise;
}

export async function getAllUserProfiles(getToken: GetTokenFn): Promise<UserProfile[]> {
  return fetchAPI<UserProfile[]>('/api/user-profiles/all', getToken, {}, true);
}

export interface SiteVisitGroup {
  label: string;
  devices: number;
  visits: number;
}

export interface SiteVisitStats {
  days: number;
  tracking_started_at: string | null;
  totals: {
    visits: number;
    devices: number;
    new_devices: number;
    returning_devices: number;
    anonymous_devices: number;
    signed_in_devices: number;
  };
  today: { visits: number; devices: number };
  daily: Array<{ day: string; visits: number; devices: number }>;
  device_types: SiteVisitGroup[];
  os: SiteVisitGroup[];
  browsers: SiteVisitGroup[];
  countries: SiteVisitGroup[];
  sources: SiteVisitGroup[];
  pages: SiteVisitGroup[];
}

export async function getSiteVisitStats(days: number, getToken: GetTokenFn): Promise<SiteVisitStats> {
  return fetchAPI<SiteVisitStats>(`/api/admin/visits?days=${days}`, getToken, {}, true);
}

export type StoreHealthLevel = 'bien' | 'atencion' | 'riesgo';
export type StoreHealthSeverity = 'critical' | 'warning' | 'info';

export interface StoreHealthIssue {
  code: string;
  severity: StoreHealthSeverity;
  title: string;
  advice: string;
}

export interface StoreHealth {
  storeId: string;
  storeName: string;
  email: string;
  phone: string | null;
  businessType: string | null;
  subscriptionStatus: string;
  createdAt: string | null;
  lastSaleAt: string | null;
  sales7d: number;
  sales30d: number;
  revenue30d: number;
  activeProducts: number;
  score: number;
  level: StoreHealthLevel;
  daysSinceLastSale: number | null;
  trialDaysLeft: number | null;
  issues: StoreHealthIssue[];
}

export type DianLevel = 'ok' | 'aviso' | 'importante' | 'obligado';

/** Topes DIAN de la tienda según sus ventas del año (ver Worker routes/dian-thresholds.ts). */
export interface DianThresholds {
  year: number;
  uvt: number;
  uvtEstimated: boolean;
  eInvoiceCap: number;
  incomeTaxCap: number;
  yearSales: number;
  remaining: number;
  percent: number;
  previousYear: { year: number; sales: number; cap: number; exceeded: boolean };
  projectedYearSales: number | null;
  projectedCapDate: string | null;
  incomeTaxExceeded: boolean;
  level: DianLevel;
  alreadyInvoicing: boolean;
}

/** 403 si el usuario es del equipo y no tiene permiso para ver reportes. */
export async function getDianThresholds(getToken: GetTokenFn): Promise<DianThresholds> {
  return fetchAPI<DianThresholds>('/api/dian-thresholds', getToken);
}

export async function setDianAlreadyInvoicing(alreadyInvoicing: boolean, getToken: GetTokenFn): Promise<void> {
  await fetchAPI('/api/dian-thresholds/ack', getToken, {
    method: 'PUT',
    body: JSON.stringify({ already_invoicing: alreadyInvoicing }),
  });
}

/** Negocio de varios socios (Configuración). Ver routes/partnership.ts del Worker. */
export interface Partner {
  name: string;
  /** Porcentaje de participación (0-100); entre todos suman 100. */
  share: number;
}

export interface Partnership {
  enabled: boolean;
  partners: Partner[];
}

export async function getPartnership(getToken: GetTokenFn): Promise<Partnership> {
  return fetchAPI('/api/partnership', getToken);
}

export async function savePartnership(data: Partnership, getToken: GetTokenFn): Promise<Partnership> {
  return fetchAPI('/api/partnership', getToken, { method: 'PUT', body: JSON.stringify(data) });
}

/** Apertura y cierre de caja (Punto de Venta). Ver routes/cash-sessions.ts del Worker. */
export interface CashMethodTotal {
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
  sales: Record<string, CashMethodTotal>;
  payments: Record<string, CashMethodTotal>;
  sales_count: number;
  cash_sales: number;
  cash_payments: number;
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
    sales: Record<string, CashMethodTotal>;
    payments: Record<string, CashMethodTotal>;
    movements?: CashMovement[];
    cash_in?: number;
    cash_out?: number;
  } | null;
  notes: string | null;
}

export async function getCurrentCashSession(
  getToken: GetTokenFn,
): Promise<{ session: CashSession | null; summary: CashSummary | null; is_owner: boolean }> {
  return fetchAPI('/api/cash-sessions/current', getToken);
}

export async function openCashSession(openingAmount: number, getToken: GetTokenFn): Promise<CashSession> {
  return fetchAPI('/api/cash-sessions/open', getToken, {
    method: 'POST',
    body: JSON.stringify({ opening_amount: openingAmount }),
  });
}

export async function closeCashSession(
  id: string,
  countedCash: number,
  notes: string,
  getToken: GetTokenFn,
): Promise<CashSession> {
  return fetchAPI(`/api/cash-sessions/${id}/close`, getToken, {
    method: 'POST',
    body: JSON.stringify({ counted_cash: countedCash, notes }),
  });
}

export async function addCashMovement(
  sessionId: string,
  movement: { kind: 'salida' | 'entrada'; amount: number; reason: string },
  getToken: GetTokenFn,
): Promise<CashMovement> {
  return fetchAPI(`/api/cash-sessions/${sessionId}/movements`, getToken, {
    method: 'POST',
    body: JSON.stringify(movement),
  });
}

export async function deleteCashMovement(
  sessionId: string,
  movementId: string,
  getToken: GetTokenFn,
): Promise<void> {
  await fetchAPI(`/api/cash-sessions/${sessionId}/movements/${movementId}`, getToken, { method: 'DELETE' });
}

export async function getCashSessions(getToken: GetTokenFn, limit = 60): Promise<CashSession[]> {
  return fetchAPI(`/api/cash-sessions?limit=${limit}`, getToken);
}

export async function getStoresHealth(
  getToken: GetTokenFn
): Promise<{ generatedAt: string; stores: StoreHealth[] }> {
  return fetchAPI(`/api/admin/health`, getToken, {}, true);
}

export async function createUserProfile(data: Partial<UserProfile>, getToken: GetTokenFn): Promise<UserProfile> {
  // Note: User profiles are usually auto-created by the auth middleware
  // This function exists for manual profile creation if needed
  const profileId = `usr_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const now = new Date().toISOString();

  const profile = {
    id: profileId,
    created_at: now,
    updated_at: now,
    ...data,
  };

  // Use PUT to create/update - the backend handles this via middleware
  // For now, this will just return the profile data
  // The actual creation happens in the middleware on first API call
  return profile as UserProfile;
}

export async function updateUserProfile(id: string, data: Partial<UserProfile>, getToken: GetTokenFn): Promise<UserProfile> {
  const result = await fetchAPI<UserProfile>(`/api/user-profiles/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  // El perfil cambió: invalidar la caché para que la próxima lectura sea fresca.
  invalidateUserProfileCache();
  return result;
}

// ============================================
// CREDIT PAYMENTS - Pagos de Crédito
// ============================================

export interface CreditPaymentData {
  id?: string; // Opcional al crear, presente cuando se retorna
  sale_id: string;
  customer_id: string;
  amount: number;
  payment_method: 'efectivo' | 'tarjeta' | 'transferencia';
  cashier_id: string;
  notes?: string;
  created_at?: string; // Opcional al crear, presente cuando se retorna
}

export async function getCreditPaymentHistory(saleId: string, getToken: GetTokenFn): Promise<CreditPaymentData[]> {
  return fetchAPI<CreditPaymentData[]>(`/api/credit-payments/sale/${saleId}`, getToken);
}

export async function getCustomerCreditPayments(customerId: string, getToken: GetTokenFn): Promise<CreditPaymentData[]> {
  return fetchAPI<CreditPaymentData[]>(`/api/credit-payments/customer/${customerId}`, getToken);
}

export async function registerCreditPayment(data: CreditPaymentData, getToken: GetTokenFn): Promise<{ payment: CreditPaymentData; sale: Sale }> {
  const result = await fetchAPI<{ payment: CreditPaymentData; sale: Sale }>('/api/credit-payments', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  // Un abono reduce el pendiente de la venta y la deuda del cliente.
  invalidateSalesCache();
  invalidateCustomersCache();
  return result;
}

// ============================================
// OFFERS - Ofertas y Promociones
// ============================================

export interface Offer {
  id: string;
  tenant_id: string;
  product_id: string;
  discount_percentage: number;
  discount_amount?: number;
  start_date: string;
  end_date: string;
  is_active: number;
  reason?: 'proximoAVencer' | 'promocion' | 'liquidacion';
  created_at: string;
  updated_at: string;
}

export async function getOffers(getToken: GetTokenFn): Promise<Offer[]> {
  return fetchAPI<Offer[]>('/api/offers', getToken);
}

export async function getOfferById(id: string, getToken: GetTokenFn): Promise<Offer> {
  return fetchAPI<Offer>(`/api/offers/${id}`, getToken);
}

export async function createOffer(data: Partial<Offer>, getToken: GetTokenFn): Promise<Offer> {
  return fetchAPI<Offer>('/api/offers', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateOffer(id: string, data: Partial<Offer>, getToken: GetTokenFn): Promise<Offer> {
  return fetchAPI<Offer>(`/api/offers/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteOffer(id: string, getToken: GetTokenFn): Promise<void> {
  return fetchAPI<void>(`/api/offers/${id}`, getToken, {
    method: 'DELETE',
  });
}

export async function getProductOffers(productId: string, getToken: GetTokenFn): Promise<Offer[]> {
  return fetchAPI<Offer[]>(`/api/offers/product/${productId}`, getToken);
}

export async function getActiveOffers(getToken: GetTokenFn): Promise<Offer[]> {
  return fetchAPI<Offer[]>('/api/offers/active', getToken);
}

// ============================================
// PAYMENT TRANSACTIONS - Transacciones de Pago
// ============================================

export interface PaymentTransaction {
  id: string;
  user_profile_id: string;
  epayco_transaction_id?: string;
  epayco_ref_payco?: string;
  amount: number;
  currency: string;
  status: 'APPROVED' | 'DECLINED' | 'PENDING' | 'ERROR' | 'Aceptada' | 'Rechazada' | 'Pendiente';
  payment_method_type?: string;
  reference?: string;
  approval_code?: string;
  created_at: string;
}

export async function getAllPaymentTransactions(getToken: GetTokenFn): Promise<PaymentTransaction[]> {
  return fetchAPI<PaymentTransaction[]>('/api/payment-transactions', getToken);
}

export async function getMyPaymentTransactions(getToken: GetTokenFn): Promise<PaymentTransaction[]> {
  return fetchAPI<PaymentTransaction[]>('/api/payment-transactions/my', getToken);
}

export async function getUserPaymentTransactions(userId: string, getToken: GetTokenFn): Promise<PaymentTransaction[]> {
  return fetchAPI<PaymentTransaction[]>(`/api/payment-transactions/user/${userId}`, getToken);
}

export async function getPaymentTransactionById(id: string, getToken: GetTokenFn): Promise<PaymentTransaction> {
  return fetchAPI<PaymentTransaction>(`/api/payment-transactions/${id}`, getToken);
}

export async function createPaymentTransaction(data: Partial<PaymentTransaction>, getToken: GetTokenFn): Promise<PaymentTransaction> {
  return fetchAPI<PaymentTransaction>('/api/payment-transactions', getToken, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePaymentTransaction(id: string, data: Partial<PaymentTransaction>, getToken: GetTokenFn): Promise<PaymentTransaction> {
  return fetchAPI<PaymentTransaction>(`/api/payment-transactions/${id}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ============================================
// UTILIDADES
// ============================================

/**
 * Hook personalizado para usar con React
 * (Para usar en componentes)
 */
export function useCloudflareAPI() {
  // Este hook se puede expandir según necesidades
  return {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    searchProducts,
    getLowStockProducts,
    getCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
    getSuppliers,
    getSupplierById,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    getSupplierProducts,
    getSupplierStats,
    getSales,
    getSaleById,
    createSale,
  };
}

/**
 * Configurar URL base de la API (útil para desarrollo local)
 */
export function setAPIBaseURL(url: string) {
  // Esta función permite cambiar la URL base dinámicamente si es necesario
  console.warn('Changing API base URL to:', url);
  // Nota: En producción, usar siempre la variable de entorno
}

// ============================================
// POS REVIEWS - Reseñas del sistema POS
// ============================================

export interface PosReview {
  rating: number;
  comment: string;
  storeName: string;
  storeCity: string;
  isApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Obtiene la reseña de la tienda autenticada (null si aún no ha reseñado). */
export async function getMyPosReview(
  getToken: GetTokenFn
): Promise<PosReview | null> {
  return fetchAPI<PosReview | null>('/api/pos-reviews/me', getToken);
}

/** Crea o actualiza la reseña de la tienda autenticada. */
export async function saveMyPosReview(
  data: { rating: number; comment: string },
  getToken: GetTokenFn
): Promise<PosReview> {
  return fetchAPI<PosReview>('/api/pos-reviews/me', getToken, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** Elimina la reseña de la tienda autenticada. */
export async function deleteMyPosReview(getToken: GetTokenFn): Promise<void> {
  return fetchAPI<void>('/api/pos-reviews/me', getToken, { method: 'DELETE' });
}

export interface AdminPosReview extends PosReview {
  userProfileId: string;
}

/** (Superadmin) Lista todas las reseñas para moderación. */
export async function getAllPosReviews(
  getToken: GetTokenFn
): Promise<AdminPosReview[]> {
  return fetchAPI<AdminPosReview[]>(
    '/api/pos-reviews/admin/all',
    getToken,
    {},
    true, // omitir X-Tenant-ID: operación global de superadmin
  );
}

/** (Superadmin) Aprueba o rechaza una reseña. */
export async function moderatePosReview(
  userProfileId: string,
  isApproved: boolean,
  getToken: GetTokenFn,
): Promise<void> {
  return fetchAPI<void>(
    `/api/pos-reviews/admin/${userProfileId}`,
    getToken,
    { method: 'PUT', body: JSON.stringify({ isApproved }) },
    true,
  );
}

/** (Superadmin) Elimina cualquier reseña. */
export async function deletePosReviewAsAdmin(
  userProfileId: string,
  getToken: GetTokenFn,
): Promise<void> {
  return fetchAPI<void>(
    `/api/pos-reviews/admin/${userProfileId}`,
    getToken,
    { method: 'DELETE' },
    true,
  );
}

// ============================================
// BUSINESS TYPE PRICES - Precios editables por tipo de negocio
// ============================================

export interface BusinessTypePrice {
  businessType: BusinessTypeId | string;
  price: number;
  updatedAt: string;
}

/** Lista los precios vigentes por tipo de negocio (lectura para cualquier usuario autenticado). */
export async function getBusinessTypePrices(
  getToken: GetTokenFn
): Promise<BusinessTypePrice[]> {
  return fetchAPI<BusinessTypePrice[]>(
    '/api/business-type-prices',
    getToken,
    {},
    true, // omitir X-Tenant-ID: precios son globales, no por tienda
  );
}

/** (Superadmin) Actualiza el precio mensual de un tipo de negocio. */
export async function updateBusinessTypePrice(
  businessType: BusinessTypeId | string,
  price: number,
  getToken: GetTokenFn,
): Promise<void> {
  return fetchAPI<void>(
    `/api/business-type-prices/${businessType}`,
    getToken,
    { method: 'PUT', body: JSON.stringify({ price }) },
    true,
  );
}

// ============================================
// RECORDATORIOS DE FIADO
// ============================================

/** ¿La tienda envía recordatorios de fiado por correo a sus clientes? */
export async function getDebtRemindersEnabled(getToken: GetTokenFn): Promise<boolean> {
  const data = await fetchAPI<{ enabled: boolean }>('/api/email/preferences/debt-reminders', getToken);
  return data?.enabled !== false;
}

export async function setDebtRemindersEnabled(enabled: boolean, getToken: GetTokenFn): Promise<void> {
  await fetchAPI('/api/email/preferences/debt-reminders', getToken, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}
