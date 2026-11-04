/**
 * Factura de un pedido web: al confirmar el pago (PUT /api/sales/:id) le llega
 * sola al cliente por correo, con el sello PAGADA. Rutas reales + D1 en memoria.
 */
import { Hono } from 'hono';
import salesRoutes from '../../cloudflare-migration/src/routes/sales';
import { buildWebOrderInvoiceEmail, parseWebOrderNotes } from '../../cloudflare-migration/src/utils/web-order-invoice';
import { D1DatabaseFake } from './helpers/d1-sqlite';

const NOTES = (email?: string) =>
  `Pedido web - Cliente: Ana <b>Ruiz</b>\nTeléfono: 3001112233\n${email ? `Email: ${email}\n` : ''}Entrega: Envío a domicilio\nDirección: Calle 8 # 4-15\nCosto de envío: $3000\n`;

describe('datos del cliente en las notas del pedido', () => {
  it('lee nombre, teléfono, correo y dirección', () => {
    expect(parseWebOrderNotes(NOTES('ana@correo.co'))).toEqual({
      name: 'Ana <b>Ruiz</b>',
      phone: '3001112233',
      email: 'ana@correo.co',
      address: 'Calle 8 # 4-15',
    });
  });

  it('ignora un correo mal escrito', () => {
    expect(parseWebOrderNotes(NOTES('no es correo')).email).toBeNull();
    expect(parseWebOrderNotes(NOTES()).email).toBeNull();
  });

  it('la factura del correo lleva el sello PAGADA y escapa lo que escribió el cliente', () => {
    const { html, subject } = buildWebOrderInvoiceEmail({
      storeName: 'La Esquina',
      orderNumber: 'WEB-20261104-000001',
      date: new Date('2026-11-04T15:00:00Z'),
      customer: parseWebOrderNotes(NOTES('ana@correo.co')),
      items: [{ name: 'Arroz', quantity: 2, unitPrice: 4800, subtotal: 9600 }],
      shippingCost: 3000,
      total: 12600,
      paymentReference: 'M7654321',
    });
    expect(subject).toBe('Tu factura de La Esquina - Pedido WEB-20261104-000001');
    expect(html).toContain('PAGADA');
    expect(html).toContain('$12.600');
    expect(html).toContain('M7654321');
    expect(html).toContain('Ana &lt;b&gt;Ruiz&lt;/b&gt;');
    expect(html).not.toContain('<b>Ruiz</b>');
  });
});

describe('PUT /api/sales/:id al confirmar un pedido web', () => {
  let db: D1DatabaseFake;
  const sent: { to: string; subject: string; html: string }[] = [];

  const confirm = async (saleId: string) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('tenant' as never, { id: 't_esquina' } as never);
      await next();
    });
    app.route('/api/sales', salesRoutes);
    const res = await app.request(
      `/api/sales/${saleId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completada', payment_status: 'pagado', amount_paid: 12600, amount_pending: 0 }),
      },
      { DB: db, RESEND_API_KEY: 're_test' }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };

  const order = (id: string, email?: string) => {
    db.insert('sales', {
      id,
      tenant_id: 't_esquina',
      sale_number: `WEB-20261104-${id}`,
      cashier_id: 't_esquina',
      subtotal: 9600,
      total: 12600,
      shipping_cost: 3000,
      payment_method: 'transferencia',
      status: 'pendiente',
      payment_status: 'pendiente',
      payment_reference: `REF${id}`,
      notes: NOTES(email),
    });
    db.insert('sale_items', { id: `it_${id}`, tenant_id: 't_esquina', sale_id: id, product_id: 'arroz', quantity: 2, unit_price: 4800, subtotal: 9600 });
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    sent.length = 0;
    global.fetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push({ to: String(body.to[0]), subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    }) as typeof fetch;

    db = new D1DatabaseFake();
    for (const col of ['store_name TEXT', 'store_whatsapp TEXT', 'store_address TEXT']) {
      db.sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN ${col}`);
    }
    db.insert('user_profiles', { id: 't_esquina', clerk_user_id: 'c1', email: 'dueno@esquina.co', role: 'admin', store_name: 'La Esquina' });
    db.insert('products', { id: 'arroz', tenant_id: 't_esquina', name: 'Arroz Diana 1 kg', sale_price: 4800, stock: 10 });
  });

  it('envía la factura con sello PAGADA al correo del cliente y lo informa al tendero', async () => {
    order('001', 'ana@correo.co');
    const res = await confirm('001');
    expect(res.status).toBe(200);
    expect(res.json.data.invoice_email).toEqual({ status: 'sent', to: 'ana@correo.co' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toContain('ana@correo.co');
    expect(sent[0].subject).toContain('La Esquina');
    expect(sent[0].html).toContain('PAGADA');
    expect(sent[0].html).toContain('Arroz Diana 1 kg');
  });

  it('sin correo no envía nada y avisa para mandarla por WhatsApp', async () => {
    order('002');
    const res = await confirm('002');
    expect(res.json.data.invoice_email).toEqual({ status: 'no_email' });
    expect(sent).toHaveLength(0);
  });

  it('si el correo falla, el pago igual queda confirmado', async () => {
    order('003', 'ana@correo.co');
    global.fetch = jest.fn(async () => new Response('caído', { status: 500 })) as typeof fetch;
    const res = await confirm('003');
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe('completada');
    expect(res.json.data.invoice_email.status).toBe('failed');
  });

  it('una venta del POS no envía factura por correo', async () => {
    db.insert('sales', { id: 'pos1', tenant_id: 't_esquina', sale_number: 'VTA-1', cashier_id: 't_esquina', total: 1000, payment_method: 'efectivo', status: 'pendiente', notes: NOTES('ana@correo.co') });
    const res = await confirm('pos1');
    expect(res.json.data.invoice_email).toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});
