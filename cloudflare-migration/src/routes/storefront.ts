/**
 * Storefront API Routes
 * Gestiona la configuración pública de tiendas y catálogo de productos
 */

import { Hono } from 'hono';
import type { Env, Tenant, APIResponse, AppEnv } from '../types';
import { TenantDB, generateId } from '../utils/db-helpers';
import { findActiveStore, hasValidNequiNumber, type StoreAccessRow } from '../utils/storefront-access';
import { escapeTelegramHtml, getTenantChatIds, sendToChats } from '../utils/telegram';
import { hashOrderToken, isUniqueViolation, normalizePaymentReference } from '../utils/payment-reference';
import {
  bearerToken,
  createStorefrontSession,
  customerOrderStatus,
  deleteStorefrontSession,
  findStorefrontAccount,
} from '../utils/storefront-session';

const app = new Hono<AppEnv>();

const MAX_ORDER_LINES = 50;
const MAX_LINE_QUANTITY = 999;

const formatCOP = (amount: number) => `$${Math.round(amount).toLocaleString('es-CO')}`;

interface OrderSummaryLine {
  name: string;
  quantity: number;
  lineTotal: number;
}

// Detalle de productos con precio + envío + total, para que el tendero pueda
// contrastarlo con lo que le llegó a Nequi.
function buildOrderSummaryText(lines: OrderSummaryLine[], shippingCost: number, total: number): string {
  const itemsText = lines
    .map((l) => `• ${escapeTelegramHtml(l.name)} x${l.quantity} — ${formatCOP(l.lineTotal)}`)
    .join('\n');
  const shippingText = shippingCost > 0 ? `\n🛵 Envío: ${formatCOP(shippingCost)}` : '';
  return `${itemsText}${shippingText}\n<b>Total a recibir:</b> ${formatCOP(total)}`;
}

/**
 * Formas de entrega que ofrece la tienda (Configuración de la tienda → Envío /
 * Recogida). Domicilio solo si el tendero lo activó (la columna nace en 0);
 * recogida salvo que la apague. Si apagó las dos, se permite recoger para que
 * la tienda no quede sin poder recibir pedidos. El checkout usa la misma regla.
 */
export function allowedDeliveryMethods(store: {
  store_shipping_enabled?: number | null;
  store_pickup_enabled?: number | null;
}): { shipping: boolean; pickup: boolean } {
  const shipping = Number(store.store_shipping_enabled) === 1;
  const pickup = store.store_pickup_enabled == null || Number(store.store_pickup_enabled) !== 0;
  return { shipping, pickup: pickup || !shipping };
}

interface StoreConfig {
  id: string;
  store_slug?: string;
  store_name?: string;
  store_description?: string;
  store_logo_url?: string;
  store_banner_url?: string;
  store_banner_images?: string;
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
}

// GET /api/storefront/config/:slug - Obtener configuración pública de una tienda por slug
app.get('/config/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    // Buscar tienda por slug (validando suscripción/addon)
    const store = await findActiveStore<StoreAccessRow & StoreConfig>(
      c.env.DB,
      slug,
      `store_slug, store_name, store_description,
       store_logo_url, store_banner_url, store_banner_images,
       store_primary_color, store_secondary_color,
       store_whatsapp, store_facebook, store_instagram,
       store_address, store_city, store_phone, store_email,
       store_enabled, store_terms,
       store_shipping_enabled, store_pickup_enabled, store_min_order,
       store_nequi_number, payment_qr_url, store_maps_url`
    );

    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Store not found or disabled',
      }, 404);
    }

    // No exponer los campos de suscripción en la respuesta pública
    const {
      is_superadmin: _sa,
      subscription_status: _ss,
      trial_end_date: _te,
      has_store_addon: _ha,
      store_addon_expires_at: _ae,
      ...config
    } = store;

    return c.json<APIResponse<StoreConfig>>({
      success: true,
      data: config as StoreConfig,
    });
  } catch (error) {
    console.error('Error fetching store config:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch store configuration',
    }, 500);
  }
});

// GET /api/storefront/products/:slug - Obtener productos públicos de una tienda
app.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug');
  const category = c.req.query('category'); // Filtro opcional por categoría

  try {
    // Primero obtener el tenant_id de la tienda
    const store = await findActiveStore(c.env.DB, slug);

    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Store not found or disabled',
      }, 404);
    }

    // Construir query con filtro opcional de categoría
    let query = `
      SELECT
        p.id, p.name, p.description, p.sale_price, p.stock,
        p.images, p.category_id,
        c.name as category_name,
        o.discount_percentage, o.id as offer_id
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id AND p.tenant_id = c.tenant_id
      LEFT JOIN offers o ON p.id = o.product_id
        AND o.is_active = 1
        AND datetime(o.start_date) <= datetime('now')
        AND datetime(o.end_date) >= datetime('now')
      WHERE p.tenant_id = ? AND p.stock > 0
    `;

    const bindings: any[] = [store.id];

    if (category === '__uncategorized__') {
      // Productos sin categoría real (nula o apuntando a una inexistente).
      query += ` AND (
        p.category_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM categories c2
          WHERE c2.id = p.category_id AND c2.tenant_id = p.tenant_id
        )
      )`;
    } else if (category) {
      query += ' AND p.category_id = ?';
      bindings.push(category);
    }

    query += ' ORDER BY p.name ASC';

    const result = await c.env.DB.prepare(query)
      .bind(...bindings)
      .all();

    return c.json<APIResponse>({
      success: true,
      data: result.results,
    });
  } catch (error) {
    console.error('Error fetching store products:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch products',
    }, 500);
  }
});

// GET /api/storefront/product/:slug/:productId - Obtener detalle de un producto
app.get('/product/:slug/:productId', async (c) => {
  const slug = c.req.param('slug');
  const productId = c.req.param('productId');

  try {
    // Verificar que la tienda existe y está activa
    const store = await findActiveStore(c.env.DB, slug);

    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Store not found or disabled',
      }, 404);
    }

    // Solo columnas públicas: nunca p.* (expondría el precio de compra,
    // proveedor, código de barras, etc. a cualquiera que abra la tienda).
    const product = await c.env.DB.prepare(
      `SELECT
        p.id, p.name, p.description, p.sale_price, p.stock,
        p.images, p.image_url, p.category_id,
        c.name as category_name,
        o.discount_percentage, o.id as offer_id, o.reason as offer_reason
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id AND p.tenant_id = c.tenant_id
      LEFT JOIN offers o ON p.id = o.product_id
        AND o.is_active = 1
        AND datetime(o.start_date) <= datetime('now')
        AND datetime(o.end_date) >= datetime('now')
      WHERE p.id = ? AND p.tenant_id = ?`
    )
      .bind(productId, store.id)
      .first();

    if (!product) {
      return c.json<APIResponse>({
        success: false,
        error: 'Product not found',
      }, 404);
    }

    return c.json<APIResponse>({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch product',
    }, 500);
  }
});

// GET /api/storefront/categories/:slug - Obtener categorías de una tienda
app.get('/categories/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    // Verificar que la tienda existe y está activa
    const store = await findActiveStore(c.env.DB, slug);

    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Store not found or disabled',
      }, 404);
    }

    // Obtener categorías con count de productos
    const result = await c.env.DB.prepare(
      `SELECT
        c.id, c.name, c.description,
        COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND c.tenant_id = p.tenant_id AND p.stock > 0
      WHERE c.tenant_id = ?
      GROUP BY c.id, c.name, c.description
      HAVING product_count > 0
      ORDER BY c.name ASC`
    )
      .bind(store.id)
      .all();

    const categories = (result.results || []) as any[];

    // Categoría virtual "Sin categoría": agrupa los productos disponibles que
    // no tienen category_id (o apuntan a una categoría inexistente). Sin esto,
    // esos productos aparecen en "Todos los productos" pero no suman en ninguna
    // categoría, dejando el conteo total incoherente con la barra lateral.
    const uncategorized = await c.env.DB.prepare(
      `SELECT COUNT(*) as product_count
       FROM products p
       WHERE p.tenant_id = ?
         AND p.stock > 0
         AND (
           p.category_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM categories c
             WHERE c.id = p.category_id AND c.tenant_id = p.tenant_id
           )
         )`
    )
      .bind(store.id)
      .first<{ product_count: number }>();

    const uncategorizedCount = uncategorized?.product_count ?? 0;
    if (uncategorizedCount > 0) {
      categories.push({
        id: '__uncategorized__',
        name: 'Sin categoría',
        description: null,
        product_count: uncategorizedCount,
      });
    }

    return c.json<APIResponse>({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch categories',
    }, 500);
  }
});

// POST /api/storefront/orders/:slug - Crear pedido desde storefront (sin autenticación)
app.post('/orders/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    const body = await c.req.json();

    // Validar campos requeridos
    if (!body.customer_name || !body.customer_phone || !body.items || body.items.length === 0 || !body.delivery_method) {
      return c.json<APIResponse>({
        success: false,
        error: 'Missing required fields: customer_name, customer_phone, items, delivery_method',
      }, 400);
    }

    // Verificar que la tienda existe y está activa
    const store = await findActiveStore<
      StoreAccessRow & {
        store_name?: string;
        store_whatsapp?: string;
        epayco_enabled: number;
        telegram_chat_id?: string | null;
        telegram_enabled?: number;
        store_min_order?: number | null;
        store_shipping_enabled?: number | null;
        store_pickup_enabled?: number | null;
        store_nequi_number?: string | null;
      }
    >(
      c.env.DB,
      slug,
      'store_name, store_whatsapp, epayco_enabled, telegram_chat_id, telegram_enabled, store_min_order, store_shipping_enabled, store_pickup_enabled, store_nequi_number'
    );

    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Store not found or disabled',
      }, 404);
    }

    const tenantDB = new TenantDB(c.env.DB, store.id);

    // Sin número de Nequi el cliente no tiene a dónde pagar: no se recibe el pedido.
    if (!hasValidNequiNumber(store.store_nequi_number)) {
      return c.json<APIResponse>({
        success: false,
        error: 'Esta tienda todavía no recibe pagos en línea. Escríbele por WhatsApp para hacer tu pedido.',
        code: 'STORE_NEQUI_REQUIRED',
      } as APIResponse, 400);
    }

    // Forma de entrega permitida por la tienda (no solo por el navegador).
    const isShipping = body.delivery_method !== 'pickup';
    const delivery = allowedDeliveryMethods(store);
    if (isShipping ? !delivery.shipping : !delivery.pickup) {
      return c.json<APIResponse>({
        success: false,
        error: isShipping
          ? 'Esta tienda no hace envíos a domicilio. Elige recoger en la tienda.'
          : 'Esta tienda no tiene recogida en tienda. Elige envío a domicilio.',
      }, 400);
    }

    // Número de pedido: siguiente del día después del MAYOR ya usado (no
    // "ventas + 1": al borrar una venta ese conteo baja y repetía números).
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `WEB-${dateStr}-`;
    const last = await c.env.DB.prepare(
      `SELECT sale_number FROM sales
       WHERE tenant_id = ? AND sale_number LIKE ?
       ORDER BY sale_number DESC LIMIT 1`
    )
      .bind(store.id, `${prefix}%`)
      .first<{ sale_number: string }>();
    const lastSeq = last ? parseInt(last.sale_number.slice(prefix.length), 10) || 0 : 0;
    const orderNumber = `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;

    // Los precios, descuentos y el envío se calculan aquí con los datos de la
    // tienda; del cliente solo se aceptan producto, cantidad y zona de envío.
    const requested = new Map<string, number>();
    if (!Array.isArray(body.items)) {
      return c.json<APIResponse>({ success: false, error: 'Los productos del pedido no son válidos' }, 400);
    }
    for (const raw of body.items) {
      const productId = typeof raw?.product_id === 'string' ? raw.product_id : '';
      const quantity = Number(raw?.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
        return c.json<APIResponse>({ success: false, error: 'Producto o cantidad no válidos en el pedido' }, 400);
      }
      requested.set(productId, (requested.get(productId) ?? 0) + quantity);
    }
    if (requested.size > MAX_ORDER_LINES) {
      return c.json<APIResponse>({ success: false, error: 'El pedido tiene demasiados productos' }, 400);
    }

    const productIds = [...requested.keys()];
    const { results: products } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.sale_price, p.stock,
        (SELECT MAX(o.discount_percentage) FROM offers o
          WHERE o.product_id = p.id
            AND o.is_active = 1
            AND datetime(o.start_date) <= datetime('now')
            AND datetime(o.end_date) >= datetime('now')) AS discount_percentage
       FROM products p
       WHERE p.tenant_id = ? AND p.id IN (${productIds.map(() => '?').join(',')})`
    )
      .bind(store.id, ...productIds)
      .all<{ id: string; name: string; sale_price: number; stock: number; discount_percentage: number | null }>();

    if (products.length !== productIds.length) {
      return c.json<APIResponse>({
        success: false,
        error: 'Uno de los productos ya no está disponible. Actualiza tu carrito e inténtalo de nuevo.',
      }, 400);
    }

    const summaryLines: OrderSummaryLine[] = [];
    const itemsToInsert: Record<string, any>[] = [];
    const saleId = generateId('sale');
    let subtotal = 0;

    for (const product of products) {
      const quantity = requested.get(product.id)!;
      if (product.stock < quantity) {
        return c.json<APIResponse>({
          success: false,
          error: `No hay stock suficiente de "${product.name}" (disponible: ${product.stock}).`,
        }, 400);
      }

      const unitPrice = Number(product.sale_price) || 0;
      const discountPct = Math.min(Math.max(Number(product.discount_percentage) || 0, 0), 100);
      const gross = unitPrice * quantity;
      const lineDiscount = Math.round(gross * discountPct / 100);
      const lineTotal = gross - lineDiscount;

      subtotal += lineTotal;
      summaryLines.push({ name: product.name, quantity, lineTotal });
      itemsToInsert.push({
        id: generateId('item'),
        sale_id: saleId,
        product_id: product.id,
        quantity,
        unit_price: unitPrice,
        discount: lineDiscount,
        subtotal: lineTotal,
      });
    }

    // Pedido mínimo de la tienda: sobre el subtotal con ofertas, sin envío
    // (igual que el checkout).
    const minOrder = Number(store.store_min_order) || 0;
    if (minOrder > 0 && subtotal < minOrder) {
      return c.json<APIResponse>({
        success: false,
        error: `El pedido mínimo de esta tienda es de ${formatCOP(minOrder)}.`,
      }, 400);
    }

    // Envío: el costo sale de la zona elegida, nunca del cliente.
    let shippingCost = 0;
    let shippingZoneName: string | null = null;
    if (isShipping) {
      const { results: zones } = await c.env.DB.prepare(
        `SELECT id, zone_name, shipping_cost FROM shipping_zones WHERE tenant_id = ? AND is_active = 1`
      )
        .bind(store.id)
        .all<{ id: string; zone_name: string; shipping_cost: number }>();

      if (zones.length > 0) {
        const zone = zones.find((z) => z.id === body.shipping_zone_id);
        if (!zone) {
          return c.json<APIResponse>({ success: false, error: 'Selecciona una zona de envío válida' }, 400);
        }
        shippingCost = Number(zone.shipping_cost) || 0;
        shippingZoneName = zone.zone_name;
      }
    }

    // Las ofertas ya van descontadas en cada línea (subtotal = neto), así que
    // el descuento a nivel de venta queda en 0 para no descontar dos veces.
    const total = subtotal + shippingCost;

    const orderToken = crypto.randomUUID();
    const orderTokenHash = await hashOrderToken(orderToken);

    // Con la sesión iniciada, el pedido queda en "Mis compras" del cliente.
    const account = await findStorefrontAccount(c.env.DB, bearerToken(c.req.header('Authorization')), store.id);

    // Crear venta/pedido
    const saleData: any = {
      id: saleId,
      sale_number: orderNumber,
      cashier_id: store.id, // El dueño de la tienda como "cajero"
      customer_id: null, // Sin customer_id porque no está registrado
      subtotal: subtotal,
      tax: 0,
      discount: 0,
      total: total,
      payment_method: 'transferencia', // Pago por transferencia (Nequi, etc.)
      status: 'pendiente', // Estado inicial del pedido
      points_earned: 0,
      notes: `Pedido web - Cliente: ${body.customer_name}\nTeléfono: ${body.customer_phone}\n${body.customer_email ? `Email: ${body.customer_email}\n` : ''}Entrega: ${isShipping ? 'Envío a domicilio' : 'Recogida en tienda'}\n${body.delivery_address ? `Dirección: ${body.delivery_address}\n` : ''}${shippingCost > 0 ? `Costo de envío: $${shippingCost.toFixed(0)}\n` : ''}${shippingZoneName ? `Zona de envío: ${shippingZoneName}\n` : ''}${body.notes ? `Notas: ${body.notes}` : ''}`,
      payment_status: 'pendiente',
      amount_paid: 0,
      amount_pending: total,
      due_date: null,
      shipping_cost: shippingCost,
      order_token: orderTokenHash,
      ...(account ? { storefront_user_id: account.id } : {}),
    };

    await tenantDB.insert('sales', saleData);
    await tenantDB.batchInsert('sale_items', itemsToInsert);

    // NO descontar inventario todavía - esperamos confirmación de pago del dueño
    // El inventario se descontará cuando el dueño confirme el pago en el dashboard

    // Avisar al tendero (y destinatarios adicionales) por Telegram del pedido
    // nuevo. No bloquea la respuesta: si Telegram falla, el pedido igual queda
    // creado. El pago sigue siendo manual — este aviso solo evita el punto
    // ciego de no enterarse de que entró un pedido.
    if (store.telegram_enabled && c.env.TELEGRAM_BOT_TOKEN) {
      const deliveryText = isShipping
        ? `🛵 Envío a domicilio${body.delivery_address ? `\n📍 ${escapeTelegramHtml(String(body.delivery_address))}` : ''}`
        : '🏪 Recogida en tienda';

      const msg =
        `🛒 <b>Nuevo pedido web</b>\n\n` +
        `<b>Pedido:</b> ${orderNumber}\n` +
        `<b>Cliente:</b> ${escapeTelegramHtml(String(body.customer_name))}\n` +
        `<b>Teléfono:</b> ${escapeTelegramHtml(String(body.customer_phone))}\n\n` +
        `${buildOrderSummaryText(summaryLines, shippingCost, total)}\n\n` +
        `${deliveryText}\n\n` +
        `⏳ Esperando que el cliente ingrese el código de referencia de su pago por Nequi. Te avisaré cuando lo envíe para que lo verifiques.`;

      const chatIds = await getTenantChatIds(c.env.DB, store.id, store.telegram_chat_id ?? null);
      c.executionCtx.waitUntil(sendToChats(chatIds, msg, c.env.TELEGRAM_BOT_TOKEN));
    }

    // Retornar pedido creado
    return c.json<APIResponse>({
      success: true,
      data: {
        order_id: saleData.id,
        order_number: orderNumber,
        order_token: orderToken,
        total: total,
        subtotal: subtotal,
        shipping_cost: shippingCost,
        items: summaryLines.map((l) => ({ name: l.name, quantity: l.quantity, line_total: l.lineTotal })),
        store_whatsapp: store.store_whatsapp,
        epayco_enabled: !!store.epayco_enabled,
      },
      message: 'Order created successfully',
    }, 201);
  } catch (error: any) {
    console.error('Error creating order:', error);
    return c.json<APIResponse>({
      success: false,
      error: error.message || 'Failed to create order',
    }, 500);
  }
});

// POST /api/storefront/orders/:slug/:orderNumber/reference - El cliente registra la
// referencia de su pago por Nequi. El pedido queda "por verificar": el tendero la
// contrasta con su app y solo entonces confirma el pago (no se marca pagado aquí).
app.post('/orders/:slug/:orderNumber/reference', async (c) => {
  const slug = c.req.param('slug');
  const orderNumber = c.req.param('orderNumber');

  try {
    const body = await c.req.json<{ token?: string; reference?: string }>().catch(() => ({} as { token?: string; reference?: string }));

    const reference = normalizePaymentReference(body.reference);
    if (!reference) {
      return c.json<APIResponse>({
        success: false,
        error: 'El código de referencia no es válido. Revisa el comprobante de Nequi (4 a 30 letras o números).',
      }, 400);
    }

    const store = await findActiveStore<
      StoreAccessRow & {
        store_name?: string;
        telegram_chat_id?: string | null;
        telegram_enabled?: number;
      }
    >(c.env.DB, slug, 'store_name, telegram_chat_id, telegram_enabled');

    if (!store) {
      return c.json<APIResponse>({ success: false, error: 'Store not found or disabled' }, 404);
    }

    // Se busca por número Y por el hash del código secreto: aunque existieran
    // dos pedidos con el mismo número (antes de corregir la numeración), la
    // referencia solo cae en el pedido de quien tiene el código.
    const tokenHash = typeof body.token === 'string' && body.token ? await hashOrderToken(body.token) : null;
    const sale = !tokenHash ? null : await c.env.DB.prepare(
      `SELECT id, total, status, payment_status, shipping_cost, order_token, payment_reference, notes
       FROM sales
       WHERE tenant_id = ? AND sale_number = ? AND order_token = ?`
    )
      .bind(store.id, orderNumber, tokenHash)
      .first<{
        id: string;
        total: number;
        status: string;
        payment_status: string | null;
        shipping_cost: number | null;
        order_token: string | null;
        payment_reference: string | null;
        notes: string | null;
      }>();

    // Mismo 404 para "no existe" y "token incorrecto": no revelar qué pedidos hay.
    if (!sale) {
      return c.json<APIResponse>({ success: false, error: 'Order not found' }, 404);
    }

    if (sale.status !== 'pendiente' || sale.payment_status === 'pagado') {
      return c.json<APIResponse>({
        success: false,
        error: 'Este pedido ya fue procesado y no admite cambios en el pago.',
      }, 409);
    }

    if (sale.payment_reference === reference) {
      return c.json<APIResponse>({
        success: true,
        data: { order_number: orderNumber, payment_reference: reference, verification_status: 'por_verificar' },
      });
    }

    try {
      await c.env.DB.prepare(
        `UPDATE sales
         SET payment_reference = ?, payment_reference_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'pendiente'`
      )
        .bind(reference, new Date().toISOString(), new Date().toISOString(), sale.id, store.id)
        .run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return c.json<APIResponse>({
          success: false,
          error: 'Ese código de referencia ya fue usado en otro pedido. Revisa que sea el de tu pago.',
        }, 409);
      }
      throw error;
    }

    if (store.telegram_enabled && c.env.TELEGRAM_BOT_TOKEN) {
      const { results: rows } = await c.env.DB.prepare(
        `SELECT p.name AS name, si.quantity AS quantity, si.subtotal AS line_total
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = si.tenant_id
         WHERE si.sale_id = ? AND si.tenant_id = ?`
      )
        .bind(sale.id, store.id)
        .all<{ name: string | null; quantity: number; line_total: number }>();

      const customerName = sale.notes?.match(/Cliente: (.+)/)?.[1]?.trim() ?? '';
      const customerPhone = sale.notes?.match(/Teléfono: (.+)/)?.[1]?.trim() ?? '';
      const lines: OrderSummaryLine[] = rows.map((r) => ({
        name: r.name ?? 'Producto',
        quantity: r.quantity,
        lineTotal: r.line_total,
      }));

      const msg =
        `💳 <b>Pago por verificar</b>${sale.payment_reference ? ' (referencia corregida)' : ''}\n\n` +
        `<b>Pedido:</b> ${escapeTelegramHtml(orderNumber)}\n` +
        (customerName ? `<b>Cliente:</b> ${escapeTelegramHtml(customerName)}\n` : '') +
        (customerPhone ? `<b>Teléfono:</b> ${escapeTelegramHtml(customerPhone)}\n` : '') +
        `\n${buildOrderSummaryText(lines, Number(sale.shipping_cost) || 0, sale.total)}\n\n` +
        `<b>Referencia Nequi:</b> <code>${escapeTelegramHtml(reference)}</code>\n\n` +
        `Revisa en tu app de Nequi que te llegó un pago de ${formatCOP(sale.total)} con esa referencia y luego confírmalo en Pedidos Web.`;

      const chatIds = await getTenantChatIds(c.env.DB, store.id, store.telegram_chat_id ?? null);
      c.executionCtx.waitUntil(sendToChats(chatIds, msg, c.env.TELEGRAM_BOT_TOKEN));
    }

    return c.json<APIResponse>({
      success: true,
      data: { order_number: orderNumber, payment_reference: reference, verification_status: 'por_verificar' },
    });
  } catch (error: any) {
    console.error('Error saving payment reference:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'No se pudo registrar la referencia. Inténtalo de nuevo.',
    }, 500);
  }
});

// GET /api/storefront/shipping-zones/:slug - Obtener zonas de envío activas de una tienda
app.get('/shipping-zones/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    // Verificar que la tienda existe y está activa
    const store = await findActiveStore(c.env.DB, slug);

    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Store not found or disabled',
      }, 404);
    }

    // Obtener zonas de envío activas
    const result = await c.env.DB.prepare(
      `SELECT id, zone_name, shipping_cost
       FROM shipping_zones
       WHERE tenant_id = ? AND is_active = 1
       ORDER BY zone_name ASC`
    )
      .bind(store.id)
      .all();

    return c.json<APIResponse>({
      success: true,
      data: result.results,
    });
  } catch (error) {
    console.error('Error fetching shipping zones:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch shipping zones',
    }, 500);
  }
});

// POST /api/storefront/wompi/create-payment-link/:slug
// DESACTIVADA (410): tomaba el monto del navegador sin compararlo con el total
// del pedido y el webhook de Wompi lo daba por pagado. La tienda cobra por
// Nequi con referencia; Wompi en la tienda quedó descartado (2026-11-04).
app.post('/wompi/create-payment-link/:slug', (c) =>
  c.json<APIResponse>(
    { success: false, error: 'El pago con Wompi desde la tienda no está disponible. Paga por Nequi.' },
    410
  )
);

// POST /api/storefront/auth/register/:slug - Registrar usuario en tienda
app.post('/auth/register/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    const body = await c.req.json<{
      name: string;
      email: string;
      password: string;
      phone?: string;
    }>();

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 20) : '';

    // Validar campos requeridos
    if (!slug || !name || !email || !password) {
      return c.json<APIResponse>({
        success: false,
        error: 'Faltan campos requeridos',
      }, 400);
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json<APIResponse>({
        success: false,
        error: 'Correo electrónico inválido',
      }, 400);
    }

    // Validar contraseña
    if (password.length < 6) {
      return c.json<APIResponse>({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres',
      }, 400);
    }

    // Verificar que la tienda existe y está activa
    const store = await findActiveStore(c.env.DB, slug);
    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Tienda no encontrada',
      }, 404);
    }

    // Verificar que el email no esté ya registrado en esta tienda
    const existing = await c.env.DB.prepare(
      `SELECT id FROM storefront_users WHERE tenant_id = ? AND lower(email) = ?`
    )
      .bind(store.id, email)
      .first();

    if (existing) {
      return c.json<APIResponse>({
        success: false,
        error: 'Este correo ya está registrado en la tienda',
      }, 400);
    }

    // Hash de la contraseña usando SubtleCrypto (Web Crypto API)
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 10000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const passwordHash = `${saltHex}:${hashHex}`;

    const userId = generateId('storefront_user');

    // Insertar usuario
    await c.env.DB.prepare(
      `INSERT INTO storefront_users (id, tenant_id, email, name, phone, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(userId, store.id, email, name, phone || null, passwordHash)
      .run();

    const token = await createStorefrontSession(c.env.DB, userId, store.id);
    return c.json<APIResponse>({
      success: true,
      data: {
        id: userId,
        email,
        name,
        phone: phone || null,
        createdAt: new Date().toISOString(),
        token,
      },
    }, 201);
  } catch (error: any) {
    console.error('Register error:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Error al registrarse',
    }, 500);
  }
});

// POST /api/storefront/auth/login/:slug - Iniciar sesión en tienda
app.post('/auth/login/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    const body = await c.req.json<{
      email: string;
      password: string;
    }>();

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // Validar campos requeridos
    if (!slug || !email || !password) {
      return c.json<APIResponse>({
        success: false,
        error: 'Faltan campos requeridos',
      }, 400);
    }

    // Verificar que la tienda existe y está activa
    const store = await findActiveStore(c.env.DB, slug);
    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Tienda no encontrada',
      }, 404);
    }

    // Buscar usuario
    const user = await c.env.DB.prepare(
      `SELECT id, email, name, phone, password_hash, created_at FROM storefront_users WHERE tenant_id = ? AND lower(email) = ?`
    )
      .bind(store.id, email)
      .first<{
        id: string;
        email: string;
        name: string;
        phone?: string;
        password_hash: string;
        created_at: string;
      }>();

    if (!user) {
      return c.json<APIResponse>({
        success: false,
        error: 'Correo o contraseña incorrectos',
      }, 401);
    }

    // Verificar contraseña
    const [saltHex, hash] = user.password_hash.split(':');
    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 10000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    const verifyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (hash !== verifyHash) {
      return c.json<APIResponse>({
        success: false,
        error: 'Correo o contraseña incorrectos',
      }, 401);
    }

    const token = await createStorefrontSession(c.env.DB, user.id, store.id);
    return c.json<APIResponse>({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone ?? null,
        createdAt: user.created_at,
        token,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Error al iniciar sesión',
    }, 500);
  }
});

// POST /api/storefront/auth/logout/:slug - Cerrar la sesión del cliente
app.post('/auth/logout/:slug', async (c) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (token) await deleteStorefrontSession(c.env.DB, token);
  return c.json<APIResponse>({ success: true });
});

// GET /api/storefront/me/:slug - Datos del cliente con sesión (para llenar el checkout)
app.get('/me/:slug', async (c) => {
  const store = await findActiveStore(c.env.DB, c.req.param('slug'));
  if (!store) return c.json<APIResponse>({ success: false, error: 'Tienda no encontrada' }, 404);
  const account = await findStorefrontAccount(c.env.DB, bearerToken(c.req.header('Authorization')), store.id);
  if (!account) return c.json<APIResponse>({ success: false, error: 'Inicia sesión de nuevo' }, 401);
  return c.json<APIResponse>({
    success: true,
    data: { id: account.id, email: account.email, name: account.name, phone: account.phone, createdAt: account.created_at },
  });
});

// GET /api/storefront/me/:slug/orders - "Mis compras": pedidos del cliente en esta tienda
app.get('/me/:slug/orders', async (c) => {
  try {
    const store = await findActiveStore<StoreAccessRow & { store_name?: string; store_phone?: string; store_address?: string }>(
      c.env.DB,
      c.req.param('slug'),
      'store_name, store_phone, store_address'
    );
    if (!store) return c.json<APIResponse>({ success: false, error: 'Tienda no encontrada' }, 404);
    const account = await findStorefrontAccount(c.env.DB, bearerToken(c.req.header('Authorization')), store.id);
    if (!account) return c.json<APIResponse>({ success: false, error: 'Inicia sesión de nuevo' }, 401);

    const { results: sales } = await c.env.DB.prepare(
      `SELECT id, sale_number, created_at, subtotal, shipping_cost, total, status, payment_status,
              payment_reference, payment_method
       FROM sales
       WHERE tenant_id = ? AND storefront_user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`
    )
      .bind(store.id, account.id)
      .all<{
        id: string; sale_number: string; created_at: string; subtotal: number; shipping_cost: number | null;
        total: number; status: string; payment_status: string | null; payment_reference: string | null; payment_method: string;
      }>();

    const ids = sales.map((s) => s.id);
    const itemsBySale = new Map<string, { name: string; quantity: number; unit_price: number; subtotal: number }[]>();
    if (ids.length > 0) {
      const { results: items } = await c.env.DB.prepare(
        `SELECT si.sale_id, COALESCE(p.name, 'Producto') AS name, si.quantity, si.unit_price, si.subtotal
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = si.tenant_id
         WHERE si.tenant_id = ? AND si.sale_id IN (${ids.map(() => '?').join(',')})`
      )
        .bind(store.id, ...ids)
        .all<{ sale_id: string; name: string; quantity: number; unit_price: number; subtotal: number }>();
      for (const it of items) {
        const list = itemsBySale.get(it.sale_id) ?? [];
        list.push({ name: it.name, quantity: it.quantity, unit_price: it.unit_price, subtotal: it.subtotal });
        itemsBySale.set(it.sale_id, list);
      }
    }

    return c.json<APIResponse>({
      success: true,
      data: {
        store: { name: store.store_name ?? null, phone: store.store_phone ?? null, address: store.store_address ?? null },
        orders: sales.map((s) => ({
          order_number: s.sale_number,
          created_at: s.created_at,
          subtotal: s.subtotal,
          shipping_cost: Number(s.shipping_cost) || 0,
          total: s.total,
          payment_reference: s.payment_reference,
          payment_method: s.payment_method,
          status: customerOrderStatus(s),
          items: itemsBySale.get(s.id) ?? [],
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    return c.json<APIResponse>({ success: false, error: 'No se pudieron cargar tus compras' }, 500);
  }
});

// GET /api/storefront/stats/:slug/users - Obtener estadísticas de usuarios registrados
app.get('/stats/:slug/users', async (c) => {
  const slug = c.req.param('slug');

  try {
    // Verificar que la tienda existe y está activa
    const store = await findActiveStore(c.env.DB, slug);
    if (!store) {
      return c.json<APIResponse>({
        success: false,
        error: 'Tienda no encontrada',
      }, 404);
    }

    // Obtener estadísticas de usuarios
    const stats = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN DATE(created_at) = DATE('now') THEN 1 END) as today_users,
        COUNT(CASE WHEN DATE(created_at) >= DATE('now', '-7 days') THEN 1 END) as week_users,
        COUNT(CASE WHEN DATE(created_at) >= DATE('now', '-30 days') THEN 1 END) as month_users
       FROM storefront_users
       WHERE tenant_id = ?`
    )
      .bind(store.id)
      .first<{
        total_users: number;
        today_users: number;
        week_users: number;
        month_users: number;
      }>();

    // Obtener registros por día en los últimos 30 días
    const registrationsByDay = await c.env.DB.prepare(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as count
       FROM storefront_users
       WHERE tenant_id = ? AND DATE(created_at) >= DATE('now', '-30 days')
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    )
      .bind(store.id)
      .all<{ date: string; count: number }>();

    return c.json<APIResponse>({
      success: true,
      data: {
        total_users: stats?.total_users || 0,
        today_users: stats?.today_users || 0,
        week_users: stats?.week_users || 0,
        month_users: stats?.month_users || 0,
        registrations_by_day: registrationsByDay.results || [],
      },
    });
  } catch (error: any) {
    console.error('Error fetching user stats:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Error al obtener estadísticas',
    }, 500);
  }
});

export default app;
