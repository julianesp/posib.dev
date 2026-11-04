/**
 * API functions for public storefront (no authentication required)
 */

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://tienda-pos-api.julii1295.workers.dev';

interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface StoreConfig {
  id: string;
  store_slug?: string;
  store_name?: string;
  store_description?: string;
  store_logo_url?: string;
  store_banner_url?: string;
  store_banner_images?: string; // JSON array de URLs para el carrusel
  store_primary_color?: string;
  store_secondary_color?: string;
  store_whatsapp?: string;
  store_facebook?: string;
  store_instagram?: string;
  store_address?: string;
  store_city?: string;
  store_phone?: string;
  store_email?: string;
  store_enabled?: number;
  store_terms?: string;
  store_shipping_enabled?: number;
  store_pickup_enabled?: number;
  store_min_order?: number;
  store_nequi_number?: string;
  payment_qr_url?: string;
  store_maps_url?: string;
  epayco_public_key?: string;
  epayco_customer_id?: string;
  epayco_enabled?: number;
}

export interface StoreProduct {
  id: string;
  name: string;
  description?: string;
  sale_price: number;
  stock: number;
  images?: string;
  category_id?: string;
  category_name?: string;
  discount_percentage?: number;
  offer_id?: string;
}

export interface StoreCategory {
  id: string;
  name: string;
  description?: string;
  product_count: number;
}

async function fetchStorefrontAPI<T>(endpoint: string): Promise<T> {
  const url = `${WORKER_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error ${response.status}`);
  }

  const data: APIResponse<T> = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'API request failed');
  }

  return data.data as T;
}

/**
 * Get store configuration by slug
 *
 * Cacheada en memoria por slug: el layout y cada página la piden por separado
 * al navegar, y sin el cache cada vista dispara 2+ fetches del mismo config.
 */
const CONFIG_CACHE_TTL_MS = 60_000;
const configCache = new Map<string, { promise: Promise<StoreConfig>; timestamp: number }>();

export function getStoreConfig(slug: string): Promise<StoreConfig> {
  const cached = configCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = fetchStorefrontAPI<StoreConfig>(`/api/storefront/config/${slug}`);
  configCache.set(slug, { promise, timestamp: Date.now() });
  // No cachear errores para poder reintentar
  promise.catch(() => configCache.delete(slug));
  return promise;
}

/**
 * Get store products
 */
export async function getStoreProducts(slug: string, categoryId?: string): Promise<StoreProduct[]> {
  const params = categoryId ? `?category=${categoryId}` : '';
  return fetchStorefrontAPI<StoreProduct[]>(`/api/storefront/products/${slug}${params}`);
}

/**
 * Get single product details
 */
export async function getStoreProduct(slug: string, productId: string): Promise<StoreProduct> {
  return fetchStorefrontAPI<StoreProduct>(`/api/storefront/product/${slug}/${productId}`);
}

/**
 * Get store categories
 */
export async function getStoreCategories(slug: string): Promise<StoreCategory[]> {
  return fetchStorefrontAPI<StoreCategory[]>(`/api/storefront/categories/${slug}`);
}

/**
 * Calculate price with discount
 */
export function calculateDiscountedPrice(originalPrice: number, discountPercentage: number): number {
  return originalPrice - (originalPrice * discountPercentage / 100);
}

/**
 * Totales de una línea del carrito. El descuento se redondea a pesos enteros
 * igual que en el servidor, para que el total mostrado coincida con el cobrado.
 */
export function calculateLineTotals(
  price: number,
  quantity: number,
  discountPercentage?: number
): { gross: number; discount: number; net: number } {
  const gross = price * quantity;
  const discount =
    discountPercentage && discountPercentage > 0
      ? Math.round((gross * discountPercentage) / 100)
      : 0;
  return { gross, discount, net: gross - discount };
}

/**
 * Format product images (parse JSON string to array)
 */
export function parseProductImages(images?: string): string[] {
  if (!images) return [];
  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Create order from storefront
 */
export interface CreateOrderData {
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  delivery_method: 'pickup' | 'shipping';
  delivery_address?: string;
  shipping_zone_id?: string;
  notes?: string;
  // El servidor recalcula precios, ofertas y envío: solo importan producto y cantidad.
  items: Array<{
    product_id: string;
    quantity: number;
  }>;
}

export interface OrderResponseItem {
  name: string;
  quantity: number;
  line_total: number;
}

export interface OrderResponse {
  order_id: string;
  order_number: string;
  order_token: string;
  total: number;
  subtotal: number;
  shipping_cost: number;
  items: OrderResponseItem[];
  store_whatsapp?: string;
  epayco_enabled?: boolean;
}

/**
 * Registra el código de referencia del pago por Nequi. El pedido queda "por
 * verificar" hasta que el tendero lo contraste con su app y confirme el pago.
 */
export async function submitPaymentReference(
  slug: string,
  orderNumber: string,
  token: string,
  reference: string
): Promise<{ payment_reference: string }> {
  const response = await fetch(
    `${WORKER_URL}/api/storefront/orders/${slug}/${encodeURIComponent(orderNumber)}/reference`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, reference }),
    }
  );

  const data: APIResponse<{ payment_reference: string }> = await response
    .json()
    .catch(() => ({ success: false }));

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Error ${response.status}`);
  }

  return data.data as { payment_reference: string };
}

export async function createOrder(
  slug: string,
  orderData: CreateOrderData,
  /** Sesión del cliente: el pedido queda en su "Mis compras". */
  sessionToken?: string | null
): Promise<OrderResponse> {
  const url = `${WORKER_URL}/api/storefront/orders/${slug}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify(orderData),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error ${response.status}`);
  }

  const data: APIResponse<OrderResponse> = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to create order');
  }

  return data.data as OrderResponse;
}

/**
 * Get active shipping zones for a store
 */
export interface ShippingZonePublic {
  id: string;
  zone_name: string;
  shipping_cost: number;
}

export async function getStoreShippingZones(slug: string): Promise<ShippingZonePublic[]> {
  return fetchStorefrontAPI<ShippingZonePublic[]>(`/api/storefront/shipping-zones/${slug}`);
}


/** "Mis compras" del cliente con sesión (GET /api/storefront/me/:slug/orders). */
export type CustomerOrderStatus = 'pagado' | 'por_verificar' | 'pendiente' | 'cancelado';

export interface CustomerOrder {
  order_number: string;
  created_at: string;
  subtotal: number;
  shipping_cost: number;
  total: number;
  payment_reference: string | null;
  payment_method: string;
  status: CustomerOrderStatus;
  items: { name: string; quantity: number; unit_price: number; subtotal: number }[];
}

export class SessionExpiredError extends Error {}

export async function getMyOrders(
  slug: string,
  sessionToken: string
): Promise<{ store: { name: string | null; phone: string | null; address: string | null }; orders: CustomerOrder[] }> {
  const response = await fetch(`${WORKER_URL}/api/storefront/me/${slug}/orders`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (response.status === 401) throw new SessionExpiredError('Inicia sesión de nuevo');
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar tus compras');
  return data.data;
}
