/**
 * Sales API Routes
 * Todas las ventas están aisladas por tenant automáticamente
 */

import { Hono } from 'hono';
import type { Env, Tenant, APIResponse, AppEnv } from '../types';
import { TenantDB, generateId } from '../utils/db-helpers';
import { isUniqueViolation, normalizePaymentReference } from '../utils/payment-reference';
import { sendEmail, logEmail } from '../utils/email';
import { buildWebOrderInvoiceEmail, parseWebOrderNotes } from '../utils/web-order-invoice';

const app = new Hono<AppEnv>();

interface Sale {
  amount_pending?: number;
  id: string;
  tenant_id: string;
  sale_number: string;
  cashier_id: string;
  customer_id?: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  status: string;
  payment_reference?: string | null;
  points_earned?: number;
  created_at: string;
  updated_at: string;
}

interface SaleItem {
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

// GET /api/sales - Get all sales with items and product names
app.get('/', async (c) => {
  const tenant: Tenant = c.get('tenant');

  try {
    const db = c.env.DB;
    const sales = await db
      .prepare('SELECT * FROM sales WHERE tenant_id = ? ORDER BY created_at DESC')
      .bind(tenant.id)
      .all();

    // Get all sale_items with product info using JOIN
    const itemsResult = await db
      .prepare(`
        SELECT
          si.id,
          si.tenant_id,
          si.sale_id,
          si.product_id,
          si.quantity,
          si.unit_price,
          si.discount,
          si.subtotal,
          si.created_at,
          p.name as product_name,
          p.barcode as product_barcode
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id AND si.tenant_id = p.tenant_id
        WHERE si.tenant_id = ?
      `)
      .bind(tenant.id)
      .all();

    // Group items by sale_id
    const itemsMap = new Map<string, any[]>();
    (itemsResult.results || []).forEach((item: any) => {
      if (!itemsMap.has(item.sale_id)) {
        itemsMap.set(item.sale_id, []);
      }
      // Agregar objeto product con el nombre
      itemsMap.get(item.sale_id)!.push({
        id: item.id,
        tenant_id: item.tenant_id,
        sale_id: item.sale_id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount,
        subtotal: item.subtotal,
        created_at: item.created_at,
        product: {
          name: item.product_name || 'Producto desconocido',
          barcode: item.product_barcode
        }
      });
    });

    // Add items to each sale
    const salesWithItems = (sales.results || []).map((sale: any) => {
      const { order_token: _orderToken, ...publicSale } = sale;
      return { ...publicSale, items: itemsMap.get(sale.id) || [] };
    });

    return c.json<APIResponse<any[]>>({
      success: true,
      data: salesWithItems,
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch sales',
    }, 500);
  }
});

// GET /api/sales/:id - Get single sale with items and product names
app.get('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const saleId = c.req.param('id');

  try {
    const db = c.env.DB;

    // Get sale
    const sale = await db
      .prepare('SELECT * FROM sales WHERE id = ? AND tenant_id = ?')
      .bind(saleId, tenant.id)
      .first();

    if (!sale) {
      return c.json<APIResponse>({
        success: false,
        error: 'Sale not found',
      }, 404);
    }

    // Get sale items with product info using JOIN
    const itemsResult = await db
      .prepare(`
        SELECT
          si.id,
          si.tenant_id,
          si.sale_id,
          si.product_id,
          si.quantity,
          si.unit_price,
          si.discount,
          si.subtotal,
          si.created_at,
          p.name as product_name,
          p.barcode as product_barcode
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id AND si.tenant_id = p.tenant_id
        WHERE si.sale_id = ? AND si.tenant_id = ?
      `)
      .bind(saleId, tenant.id)
      .all();

    // Format items with product object
    const items = (itemsResult.results || []).map((item: any) => ({
      id: item.id,
      tenant_id: item.tenant_id,
      sale_id: item.sale_id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount,
      subtotal: item.subtotal,
      created_at: item.created_at,
      product: {
        name: item.product_name || 'Producto desconocido',
        barcode: item.product_barcode
      }
    }));

    const { order_token: _orderToken, ...publicSale } = sale as Record<string, unknown>;

    return c.json<APIResponse<any>>({
      success: true,
      data: { ...publicSale, items },
    });
  } catch (error) {
    console.error('Error fetching sale:', error);
    return c.json<APIResponse>({
      success: false,
      error: 'Failed to fetch sale',
    }, 500);
  }
});

// POST /api/sales - Create new sale (POS transaction)
app.post('/', async (c) => {
  const tenant: Tenant = c.get('tenant');

  try {
    const body = await c.req.json();

    if (!body.total || !body.payment_method || !body.items || body.items.length === 0) {
      return c.json<APIResponse>({
        success: false,
        error: 'Missing required fields: total, payment_method, items',
      }, 400);
    }

    // Validar cada item para evitar que se inserten valores undefined en D1
    for (const item of body.items) {
      if (!item.product_id || typeof item.quantity !== 'number' || item.quantity <= 0 || typeof item.unit_price !== 'number' || typeof item.subtotal !== 'number') {
        return c.json<APIResponse>({
          success: false,
          error: 'Invalid item data: each item must include product_id (string), quantity (number > 0), unit_price (number) and subtotal (number)',
        }, 400);
      }
    }

    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    // Generate sale number
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const saleCount = await tenantDB.count('sales');
    const saleNumber = `VTA-${dateStr}-${String(saleCount + 1).padStart(6, '0')}`;

    const saleData: any = {
      id: generateId('sale'),
      sale_number: saleNumber,
      cashier_id: body.cashier_id || tenant.id,
      customer_id: body.customer_id ?? null,
      subtotal: body.subtotal ?? 0,
      tax: body.tax ?? 0,
      discount: body.discount ?? 0,
      total: body.total,
      payment_method: body.payment_method,
      // IMPORTANTE: Las ventas a crédito se marcan como 'pendiente', no como 'completada'
      // Esto hace que NO cuenten en las estadísticas de ventas hasta que se paguen
      status: body.payment_method === 'credito' ? 'pendiente' : (body.status || 'completada'),
      points_earned: body.points_earned ?? 0,
      notes: body.notes ?? null,
    };

    // Add credit sale fields only if payment method is credit
    if (body.payment_method === 'credito') {
      saleData.payment_status = body.payment_status ?? 'pendiente';
      saleData.amount_paid = body.amount_paid ?? 0;
      saleData.amount_pending = body.amount_pending ?? body.total;
      saleData.due_date = body.due_date ?? null;
    } else {
      saleData.payment_status = null;
      saleData.amount_paid = null;
      saleData.amount_pending = null;
      saleData.due_date = null;
    }

    // Insert sale
    await tenantDB.insert('sales', saleData);

    // Insert sale items
    const itemsToInsert = body.items.map((item: any) => ({
      id: generateId('item'),
      sale_id: saleData.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount || 0,
      subtotal: item.subtotal,
    }));

    await tenantDB.batchInsert('sale_items', itemsToInsert);

    // Update product stock for each item
    for (const item of body.items) {
      // Get current product
      const product = await tenantDB.getById<any>('products', item.product_id);
      // track_inventory = 0: producto sin control de inventario (se vende sin stock)
      if (product && product.track_inventory !== 0) {
        const newStock = product.stock - item.quantity;
        await tenantDB.update('products', item.product_id, {
          stock: newStock
        });
      }
    }

    // Get complete sale with items
    const sale = await tenantDB.getById<Sale>('sales', saleData.id);
    const items = await tenantDB.query<SaleItem>('sale_items', 'sale_id = ?', [saleData.id]);

    return c.json<APIResponse<Sale & { items: SaleItem[] }>>({
      success: true,
      data: { ...sale!, items },
      message: 'Sale created successfully',
    }, 201);
  } catch (error: any) {
    console.error('Error creating sale:', error);
    return c.json<APIResponse>({
      success: false,
      error: error.message || 'Failed to create sale',
    }, 500);
  }
});

// POST /api/sales/import - Importar ventas históricas en lote (ej. facturas de Siigo)
//
// A diferencia de POST /, este endpoint:
//   - Recibe VARIAS facturas ya normalizadas en `invoices[]`.
//   - Resuelve productos/clientes por match (código/NIT) y los CREA si no existen.
//   - NO descuenta stock: son ventas pasadas, el inventario ya está cuadrado.
//   - Deduplica por `document_number` (guardado en notes) para poder reimportar
//     el mismo archivo sin duplicar ventas.
app.post('/import', async (c) => {
  const tenant: Tenant = c.get('tenant');

  try {
    const body = await c.req.json();
    const invoices: any[] = body.invoices;

    if (!Array.isArray(invoices) || invoices.length === 0) {
      return c.json<APIResponse>({
        success: false,
        error: 'Missing required field: invoices (non-empty array)',
      }, 400);
    }

    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    // Precargar productos y clientes existentes para resolver matches en memoria.
    const existingProducts = await tenantDB.getAll<any>('products');
    const existingCustomers = await tenantDB.getAll<any>('customers');

    const productByCode = new Map<string, any>();
    const productByName = new Map<string, any>();
    for (const p of existingProducts) {
      if (p.barcode) productByCode.set(String(p.barcode).trim().toLowerCase(), p);
      if (p.name) productByName.set(String(p.name).trim().toLowerCase(), p);
    }
    const customerByIdNumber = new Map<string, any>();
    const customerByName = new Map<string, any>();
    for (const cu of existingCustomers) {
      if (cu.id_number) customerByIdNumber.set(String(cu.id_number).trim().toLowerCase(), cu);
      if (cu.name) customerByName.set(String(cu.name).trim().toLowerCase(), cu);
    }

    // Documentos ya importados (evita duplicados al reimportar el mismo archivo).
    const importedDocs = new Set<string>();
    const priorSales = await tenantDB.query<any>(
      'sales',
      "notes LIKE ?",
      ['%[siigo:%'],
    );
    for (const s of priorSales) {
      const m = String(s.notes || '').match(/\[siigo:([^\]]+)\]/);
      if (m) importedDocs.add(m[1]);
    }

    const result = {
      imported: 0,
      skipped: 0,
      productsCreated: 0,
      customersCreated: 0,
      errors: [] as Array<{ document: string; error: string }>,
    };

    let saleCount = await tenantDB.count('sales');

    for (const inv of invoices) {
      const docNumber: string = String(inv.document_number || '').trim();
      try {
        if (!docNumber) {
          result.errors.push({ document: '(sin número)', error: 'Factura sin número de documento' });
          continue;
        }
        if (importedDocs.has(docNumber)) {
          result.skipped++;
          continue;
        }
        if (!Array.isArray(inv.items) || inv.items.length === 0) {
          result.errors.push({ document: docNumber, error: 'Factura sin items' });
          continue;
        }

        // --- Resolver / crear cliente ---
        let customerId: string | null = null;
        const idNumber = inv.customer_id_number ? String(inv.customer_id_number).trim() : '';
        const custName = inv.customer_name ? String(inv.customer_name).trim() : '';
        if (idNumber || custName) {
          let customer =
            (idNumber && customerByIdNumber.get(idNumber.toLowerCase())) ||
            (custName && customerByName.get(custName.toLowerCase())) ||
            null;
          if (!customer) {
            const newCustomer: any = {
              id: generateId('cust'),
              name: custName || `Cliente ${idNumber}`,
              id_number: idNumber || null,
              loyalty_points: 0,
              credit_limit: 0,
              current_debt: 0,
            };
            await tenantDB.insert('customers', newCustomer);
            if (idNumber) customerByIdNumber.set(idNumber.toLowerCase(), newCustomer);
            if (custName) customerByName.set(custName.toLowerCase(), newCustomer);
            customer = newCustomer;
            result.customersCreated++;
          }
          customerId = customer.id;
        }

        // --- Resolver / crear productos de cada item ---
        const saleItems: any[] = [];
        for (const item of inv.items) {
          const code = item.code ? String(item.code).trim() : '';
          const name = item.name ? String(item.name).trim() : '';
          let product =
            (code && productByCode.get(code.toLowerCase())) ||
            (name && productByName.get(name.toLowerCase())) ||
            null;
          if (!product) {
            const newProduct: any = {
              id: generateId('prod'),
              barcode: code || null,
              name: name || `Producto ${code || 'importado'}`,
              description: 'Importado desde Siigo',
              cost_price: 0,
              // Precio de venta de referencia = precio unitario de la factura.
              sale_price: Number(item.unit_price) || 0,
              stock: 0,
              min_stock: 0,
            };
            await tenantDB.insert('products', newProduct);
            if (code) productByCode.set(code.toLowerCase(), newProduct);
            if (name) productByName.set(name.toLowerCase(), newProduct);
            product = newProduct;
            result.productsCreated++;
          }
          saleItems.push({
            id: generateId('item'),
            product_id: product.id,
            quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
            unit_price: Number(item.unit_price) || 0,
            discount: Number(item.discount) || 0,
            subtotal: Number(item.subtotal) || 0,
          });
        }

        // --- Crear la venta ---
        saleCount++;
        const importDate: string = inv.date && /^\d{4}-\d{2}-\d{2}$/.test(inv.date)
          ? `${inv.date} 12:00:00`
          : new Date().toISOString();
        const dateStr = (inv.date || new Date().toISOString().split('T')[0]).replace(/-/g, '');
        const saleNumber = `IMP-${dateStr}-${String(saleCount).padStart(6, '0')}`;
        const paymentMethod: string = inv.payment_method || 'efectivo';
        const total = Number(inv.total) || 0;

        // Marca de origen para dedupe + nota original del usuario.
        const notes = `${inv.notes ? String(inv.notes) + ' ' : ''}[siigo:${docNumber}]`.trim();

        const saleData: any = {
          id: generateId('sale'),
          sale_number: saleNumber,
          cashier_id: tenant.id,
          customer_id: customerId,
          subtotal: Number(inv.subtotal) || 0,
          tax: Number(inv.tax) || 0,
          discount: Number(inv.discount) || 0,
          total,
          payment_method: paymentMethod,
          status: paymentMethod === 'credito' ? 'pendiente' : 'completada',
          points_earned: 0,
          notes,
          created_at: importDate,
        };

        if (paymentMethod === 'credito') {
          saleData.payment_status = 'pendiente';
          saleData.amount_paid = 0;
          saleData.amount_pending = total;
          saleData.due_date = inv.date || null;
        } else {
          saleData.payment_status = null;
          saleData.amount_paid = null;
          saleData.amount_pending = null;
          saleData.due_date = null;
        }

        await tenantDB.insert('sales', saleData);
        await tenantDB.batchInsert(
          'sale_items',
          saleItems.map((it) => ({ ...it, sale_id: saleData.id })),
        );
        // NOTA: NO se actualiza stock — son ventas históricas.

        importedDocs.add(docNumber);
        result.imported++;
      } catch (itemErr: any) {
        result.errors.push({ document: docNumber || '(desconocido)', error: itemErr.message || 'Error desconocido' });
      }
    }

    return c.json<APIResponse<typeof result>>({
      success: true,
      data: result,
      message: `Importación completada: ${result.imported} ventas, ${result.skipped} omitidas (duplicadas)`,
    });
  } catch (error: any) {
    console.error('Error importing sales:', error);
    return c.json<APIResponse>({
      success: false,
      error: error.message || 'Failed to import sales',
    }, 500);
  }
});

export type InvoiceEmailResult =
  | { status: 'sent'; to: string }
  | { status: 'no_email' }
  | { status: 'failed'; to: string; error: string };

/** Envía al cliente la factura de un pedido web ya pagado. Ver utils/web-order-invoice.ts. */
async function sendWebOrderInvoice(env: Env, tenantId: string, sale: Sale, items: SaleItem[]): Promise<InvoiceEmailResult> {
  const customer = parseWebOrderNotes((sale as Sale & { notes?: string | null }).notes);
  if (!customer.email) return { status: 'no_email' };

  try {
    const store = await env.DB.prepare(
      'SELECT store_name, full_name, store_whatsapp, store_address FROM user_profiles WHERE id = ?'
    )
      .bind(tenantId)
      .first<{ store_name: string | null; full_name: string | null; store_whatsapp: string | null; store_address: string | null }>();

    const ids = items.map((i) => i.product_id);
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { results } = await env.DB.prepare(
        `SELECT id, name FROM products WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(',')})`
      )
        .bind(tenantId, ...ids)
        .all<{ id: string; name: string }>();
      for (const p of results) names.set(p.id, p.name);
    }

    const storeName = store?.store_name || store?.full_name || 'Tu tienda';
    const email = buildWebOrderInvoiceEmail({
      storeName,
      storeWhatsapp: store?.store_whatsapp,
      storeAddress: store?.store_address,
      orderNumber: sale.sale_number,
      date: new Date(),
      customer,
      items: items.map((i) => ({
        name: names.get(i.product_id) ?? 'Producto',
        quantity: i.quantity,
        unitPrice: i.unit_price,
        subtotal: i.subtotal,
      })),
      shippingCost: Number((sale as any).shipping_cost) || 0,
      total: sale.total,
      paymentReference: (sale as any).payment_reference ?? null,
    });

    const result = await sendEmail(
      {
        to: customer.email,
        toName: customer.name ?? undefined,
        from: 'noreply@posib.dev',
        fromName: storeName,
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      env.RESEND_API_KEY
    );
    await logEmail(env.DB, tenantId, 'general', customer.email, email.subject, result.success ? 'sent' : 'failed', result.error, {
      kind: 'web_order_invoice',
      sale_id: sale.id,
    }).catch(() => {});

    return result.success
      ? { status: 'sent', to: customer.email }
      : { status: 'failed', to: customer.email, error: result.error ?? 'Error desconocido' };
  } catch (error) {
    console.error('[sales] No se pudo enviar la factura del pedido web:', error);
    return { status: 'failed', to: customer.email, error: error instanceof Error ? error.message : String(error) };
  }
}

// PUT /api/sales/:id - Update sale (mainly for confirming web orders)
app.put('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const saleId = c.req.param('id');

  try {
    const body = await c.req.json();
    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    // Obtener la venta actual
    const existingSale = await tenantDB.getById<Sale>('sales', saleId);
    if (!existingSale) {
      return c.json<APIResponse>({
        success: false,
        error: 'Sale not found',
      }, 404);
    }

    // Verificar si es un pedido web que se está confirmando
    const isWebOrder = existingSale.sale_number.startsWith('WEB-');
    const isConfirmingPayment = body.status === 'completada' && existingSale.status === 'pendiente';
    const isMarkingPaid = body.payment_status === 'pagado' && (existingSale as any).payment_status !== 'pagado';

    // Un pedido web pagado por Nequi solo se da por pagado con el código de
    // referencia del pago (el del cliente o el que digita el tendero desde el
    // comprobante). Se valida antes de tocar el inventario.
    let referenceToSave: string | null = null;
    if (isWebOrder && (isConfirmingPayment || isMarkingPaid)) {
      const reference =
        body.payment_reference !== undefined && body.payment_reference !== null && body.payment_reference !== ''
          ? normalizePaymentReference(body.payment_reference)
          : existingSale.payment_reference ?? null;

      if (!reference) {
        const provided = body.payment_reference !== undefined && body.payment_reference !== null && body.payment_reference !== '';
        return c.json<APIResponse>({
          success: false,
          error: provided
            ? 'El código de referencia no es válido (4 a 30 letras o números).'
            : 'Falta el código de referencia del pago. Pídelo al cliente o cópialo del comprobante de Nequi.',
          code: 'PAYMENT_REFERENCE_REQUIRED',
        } as APIResponse, 400);
      }

      if (reference !== existingSale.payment_reference) {
        const duplicate = await c.env.DB.prepare(
          `SELECT sale_number FROM sales WHERE tenant_id = ? AND payment_reference = ? AND id != ?`
        )
          .bind(tenant.id, reference, saleId)
          .first<{ sale_number: string }>();

        if (duplicate) {
          return c.json<APIResponse>({
            success: false,
            error: `Esa referencia ya se usó en el pedido ${duplicate.sale_number}.`,
          }, 409);
        }
        referenceToSave = reference;
      }
    }

    // Si es un pedido web que se está confirmando, descontar inventario
    if (isWebOrder && isConfirmingPayment) {
      // Obtener los items del pedido
      const items = await tenantDB.query<SaleItem>('sale_items', 'sale_id = ?', [saleId]);

      // Descontar stock de cada producto
      for (const item of items) {
        const product = await tenantDB.getById<any>('products', item.product_id);
        if (product && product.track_inventory !== 0) {
          const newStock = product.stock - item.quantity;

          // Validar que hay suficiente stock
          if (newStock < 0) {
            return c.json<APIResponse>({
              success: false,
              error: `No hay suficiente stock para el producto ${product.name}. Stock actual: ${product.stock}, requerido: ${item.quantity}`,
            }, 400);
          }

          await tenantDB.update('products', item.product_id, {
            stock: newStock
          });
        }
      }
    }

    // Actualizar la venta
    const updateData: any = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.payment_status !== undefined) updateData.payment_status = body.payment_status;
    if (body.amount_paid !== undefined) updateData.amount_paid = body.amount_paid;
    if (body.amount_pending !== undefined) updateData.amount_pending = body.amount_pending;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (referenceToSave) {
      updateData.payment_reference = referenceToSave;
      updateData.payment_reference_at = new Date().toISOString();
    }

    try {
      await tenantDB.update('sales', saleId, updateData);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return c.json<APIResponse>({
          success: false,
          error: 'Esa referencia de pago ya está registrada en otro pedido.',
        }, 409);
      }
      throw error;
    }

    // Obtener venta actualizada
    const updatedSale = await tenantDB.getById<Sale>('sales', saleId);
    const items = await tenantDB.query<SaleItem>('sale_items', 'sale_id = ?', [saleId]);

    // Pedido web recién pagado: la factura le llega sola al cliente por correo
    // (si lo dejó). Un fallo del correo no deshace la confirmación del pago.
    let invoiceEmail: InvoiceEmailResult | undefined;
    if (isWebOrder && isConfirmingPayment && updatedSale) {
      invoiceEmail = await sendWebOrderInvoice(c.env, tenant.id, updatedSale, items);
    }

    return c.json<APIResponse<Sale & { items: SaleItem[]; invoice_email?: InvoiceEmailResult }>>({
      success: true,
      data: { ...updatedSale!, items, ...(invoiceEmail ? { invoice_email: invoiceEmail } : {}) },
      message: 'Sale updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating sale:', error);
    return c.json<APIResponse>({
      success: false,
      error: error.message || 'Failed to update sale',
    }, 500);
  }
});

// DELETE /api/sales/:id - Delete sale and restore inventory
app.delete('/:id', async (c) => {
  const tenant: Tenant = c.get('tenant');
  const saleId = c.req.param('id');

  try {
    const tenantDB = new TenantDB(c.env.DB, tenant.id);

    // Obtener la venta antes de eliminarla
    const sale = await tenantDB.getById<Sale>('sales', saleId);
    if (!sale) {
      return c.json<APIResponse>({
        success: false,
        error: 'Sale not found',
      }, 404);
    }

    // Obtener los items de la venta para restaurar el inventario
    const saleItems = await tenantDB.query<SaleItem>('sale_items', 'sale_id = ?', [saleId]);

    // Restaurar el stock de cada producto
    for (const item of saleItems) {
      const product = await tenantDB.getById<any>('products', item.product_id);
      if (product && product.track_inventory !== 0) {
        // Restaurar el stock (sumar la cantidad que se había vendido)
        const restoredStock = product.stock + item.quantity;
        await tenantDB.update('products', item.product_id, {
          stock: restoredStock
        });

        console.log(`📦 Stock restaurado para producto ${product.name}: ${product.stock} → ${restoredStock}`);
      }
    }

    // Si la venta tenía puntos ganados y un cliente, restar esos puntos
    if (sale.customer_id && sale.points_earned && sale.points_earned > 0) {
      const customer = await tenantDB.getById<any>('customers', sale.customer_id);
      if (customer) {
        const updatedPoints = Math.max(0, (customer.loyalty_points || 0) - sale.points_earned);
        await tenantDB.update('customers', sale.customer_id, {
          loyalty_points: updatedPoints
        });
        console.log(`🎯 Puntos descontados del cliente: ${customer.loyalty_points} → ${updatedPoints}`);
      }
    }

    // Si era una venta a crédito, actualizar la deuda del cliente
    if (sale.customer_id && sale.payment_method === 'credito' && sale.amount_pending && sale.amount_pending > 0) {
      const customer = await tenantDB.getById<any>('customers', sale.customer_id);
      if (customer && customer.current_debt) {
        const updatedDebt = Math.max(0, customer.current_debt - sale.amount_pending);
        await tenantDB.update('customers', sale.customer_id, {
          current_debt: updatedDebt
        });
        console.log(`💰 Deuda actualizada del cliente: ${customer.current_debt} → ${updatedDebt}`);
      }
    }

    // Eliminar los items de la venta
    await c.env.DB
      .prepare('DELETE FROM sale_items WHERE tenant_id = ? AND sale_id = ?')
      .bind(tenant.id, saleId)
      .run();

    // Eliminar la venta
    await tenantDB.delete('sales', saleId);

    return c.json<APIResponse>({
      success: true,
      message: 'Sale deleted successfully and inventory restored',
    });
  } catch (error: any) {
    console.error('Error deleting sale:', error);
    return c.json<APIResponse>({
      success: false,
      error: error.message || 'Failed to delete sale',
    }, 500);
  }
});

export default app;
