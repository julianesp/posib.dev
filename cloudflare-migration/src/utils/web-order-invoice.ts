/**
 * Factura de un pedido de la tienda online, enviada al cliente por correo
 * cuando el tendero confirma el pago (PUT /api/sales/:id). Funciones puras
 * para poder probarlas sin Resend.
 *
 * Es el comprobante del sistema, NO una factura electrónica de la DIAN.
 */

export interface WebOrderCustomer {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

/** Los datos del cliente del pedido web viven en `sales.notes` (ver POST /orders/:slug). */
export function parseWebOrderNotes(notes: string | null | undefined): WebOrderCustomer {
  const field = (label: string) => notes?.match(new RegExp(`^${label}: (.+)$`, 'm'))?.[1]?.trim() || null;
  const email = field('Email');
  return {
    name: field('Pedido web - Cliente') ?? field('Cliente'),
    phone: field('Teléfono'),
    // Solo un correo con forma de correo: el campo lo escribe el cliente.
    email: email && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? email : null,
    address: field('Dirección'),
  };
}

export interface WebOrderInvoiceData {
  storeName: string;
  storeWhatsapp?: string | null;
  storeAddress?: string | null;
  orderNumber: string;
  date: Date;
  customer: WebOrderCustomer;
  items: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
  shippingCost: number;
  total: number;
  paymentReference: string | null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

export function buildWebOrderInvoiceEmail(d: WebOrderInvoiceData): { subject: string; html: string; text: string } {
  const store = escapeHtml(d.storeName);
  const date = d.date.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' });
  const rows = d.items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(i.name)}<br><span style="color:#6b7280;font-size:13px">${i.quantity} x ${cop(i.unitPrice)}</span></td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${cop(i.subtotal)}</td>
      </tr>`
    )
    .join('');
  const shipping =
    d.shippingCost > 0
      ? `<tr><td style="padding:6px 0">Envío a domicilio</td><td style="padding:6px 0;text-align:right">${cop(d.shippingCost)}</td></tr>`
      : '';
  const contact = [
    d.storeAddress ? escapeHtml(d.storeAddress) : '',
    d.storeWhatsapp ? `WhatsApp ${escapeHtml(d.storeWhatsapp)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:24px">
      <h1 style="margin:0 0 4px;font-size:22px">${store}</h1>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px">Factura del pedido <strong>${escapeHtml(d.orderNumber)}</strong> · ${date}</p>
      <div style="text-align:center;margin:4px 0 18px">
        <span style="display:inline-block;border:4px solid #dc2626;border-radius:8px;color:#dc2626;font-size:34px;font-weight:bold;letter-spacing:6px;padding:4px 20px;transform:rotate(-12deg);-webkit-transform:rotate(-12deg)">PAGADA</span>
      </div>
      <p style="margin:0 0 16px;font-size:15px">Hola${d.customer.name ? ` ${escapeHtml(d.customer.name)}` : ''}, ${store} confirmó tu pago. Este es el detalle de tu compra:</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}${shipping}
        <tr><td style="padding:10px 0;font-weight:bold;font-size:17px">Total pagado</td><td style="padding:10px 0;text-align:right;font-weight:bold;font-size:17px">${cop(d.total)}</td></tr>
      </table>
      <p style="margin:12px 0 0;font-size:14px;color:#44403c">Pago: Nequi${d.paymentReference ? ` · Referencia <strong>${escapeHtml(d.paymentReference)}</strong>` : ''}</p>
      ${d.customer.address ? `<p style="margin:6px 0 0;font-size:14px;color:#44403c">Entrega en: ${escapeHtml(d.customer.address)}</p>` : ''}
      ${contact ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${contact}</p>` : ''}
    </div>
    <p style="margin:12px 0 0;text-align:center;font-size:11px;color:#a8a29e">Comprobante de compra (no es factura electrónica DIAN). Enviado por posib.dev</p>
  </div>
</body></html>`;

  const text = [
    `${d.storeName} - Pago confirmado`,
    `Factura del pedido ${d.orderNumber}`,
    ...d.items.map((i) => `${i.name} x${i.quantity}: ${cop(i.subtotal)}`),
    d.shippingCost > 0 ? `Envío: ${cop(d.shippingCost)}` : '',
    `Total pagado: ${cop(d.total)}`,
    d.paymentReference ? `Referencia Nequi: ${d.paymentReference}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: `Tu factura de ${d.storeName} - Pedido ${d.orderNumber}`, html, text };
}
