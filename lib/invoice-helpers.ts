import type jsPDF from 'jspdf';
import { Sale, SaleItemWithProduct, Customer, UserProfile } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { normalizeColombianPhone } from '@/lib/whatsapp';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface InvoiceData {
  sale: Sale;
  saleItems: SaleItemWithProduct[];
  customer?: Customer | null;
  storeInfo: UserProfile;
  cashierName?: string;
}

/**
 * Formato de la factura: hoja carta o tira para impresora térmica
 * (58 mm es la de los datáfonos/POS con impresora integrada; 80 mm la de mostrador).
 */
export type InvoiceFormat = 'carta' | 'tira58' | 'tira80';

export const INVOICE_FORMATS: { id: InvoiceFormat; label: string }[] = [
  { id: 'carta', label: 'Carta' },
  { id: 'tira58', label: 'Tira 58 mm' },
  { id: 'tira80', label: 'Tira 80 mm' },
];

/** Ancho del papel en mm para los formatos de tira (null para carta) */
export function getTicketWidthMm(invoiceFormat: InvoiceFormat): number | null {
  if (invoiceFormat === 'tira58') return 58;
  if (invoiceFormat === 'tira80') return 80;
  return null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  nequi: 'Nequi',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
};

/** Cantidad legible de un ítem (paquetes o unidades sueltas) */
function getQuantityText(item: SaleItemWithProduct): string {
  if (item.product?.sell_by_unit && item.product?.units_per_package) {
    if (item.quantity < 1) {
      // Venta vieja: convertir de paquetes a unidades
      return `${item.quantity * item.product.units_per_package} ${item.product.unit_name || 'und'}`;
    }
    const unitsPerPackage = item.product.units_per_package;
    if (item.quantity >= unitsPerPackage && item.quantity % unitsPerPackage === 0) {
      const packages = item.quantity / unitsPerPackage;
      return `${packages} ${item.product.package_name || 'paquete'}${packages > 1 ? 's' : ''}`;
    }
    return `${item.quantity} ${item.product.unit_name || 'unidad'}${item.quantity > 1 ? 'es' : ''}`;
  }
  return item.quantity.toString();
}

/**
 * Dibuja la factura en formato tira (ancho de impresora térmica) y devuelve
 * la altura usada, para luego crear el documento con el largo exacto.
 */
function drawTicket(doc: jsPDF, data: InvoiceData, widthMm: number): number {
  const { sale, saleItems, customer, storeInfo, cashierName } = data;
  const margin = 3;
  const right = widthMm - margin;
  const center = widthMm / 2;
  const contentWidth = widthMm - margin * 2;
  // En 58 mm la letra va un punto más pequeña para que quepan los precios
  const base = widthMm <= 58 ? 7.5 : 8.5;
  const lineHeight = base * 0.45;
  let y = margin + 3;

  const separator = () => {
    y += 1;
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(margin, y, right, y);
    doc.setLineDashPattern([], 0);
    y += lineHeight + 0.5;
  };
  const centered = (text: string, size = base, bold = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines: string[] = doc.splitTextToSize(text, contentWidth);
    lines.forEach((line) => {
      doc.text(line, center, y, { align: 'center' });
      y += size * 0.45;
    });
  };
  // Etiqueta a la izquierda y valor a la derecha; si no caben juntos (p. ej. un
  // nombre largo), el valor baja a las líneas siguientes alineado a la derecha.
  const row = (label: string, value: string, size = base, bold = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, margin, y);
    const labelWidth = doc.getTextWidth(label) + 2;
    if (labelWidth + doc.getTextWidth(value) <= contentWidth) {
      doc.text(value, right, y, { align: 'right' });
      y += size * 0.45;
      return;
    }
    y += size * 0.45;
    const valueLines: string[] = doc.splitTextToSize(value, contentWidth);
    valueLines.forEach((line) => {
      doc.text(line, right, y, { align: 'right' });
      y += size * 0.45;
    });
  };

  // Encabezado de la tienda
  centered(storeInfo.full_name || 'TIENDA POS', base + 3, true);
  y += 0.5;
  if (storeInfo.phone) centered(`Tel: ${storeInfo.phone}`);
  separator();

  // Datos de la factura
  row('Factura', `#${sale.sale_number}`, base, true);
  row('Fecha', format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm'));
  if (cashierName) row('Atendió', cashierName);
  if (customer) {
    row('Cliente', customer.name);
    if (customer.phone) row('Tel', customer.phone);
    if (customer.id_number) row('ID', customer.id_number);
  }
  separator();

  // Productos: nombre en su línea y debajo "cantidad x precio ... subtotal"
  saleItems.forEach((item) => {
    doc.setFontSize(base);
    doc.setFont('helvetica', 'bold');
    const nameLines: string[] = doc.splitTextToSize(item.product?.name || 'Producto', contentWidth);
    nameLines.forEach((line) => {
      doc.text(line, margin, y);
      y += lineHeight;
    });
    row(`${getQuantityText(item)} x ${formatCurrency(item.unit_price)}`, formatCurrency(item.subtotal));
    if (item.discount > 0) row('  Descuento', `- ${formatCurrency(item.discount)}`, base - 1);
    y += 0.8;
  });
  separator();

  // Totales
  const subtotalAmount = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  row('Subtotal', formatCurrency(subtotalAmount));
  if (sale.discount > 0) row('Descuento', `- ${formatCurrency(sale.discount)}`);
  if (sale.tax > 0) row('IVA', formatCurrency(sale.tax));
  if (sale.shipping_cost && sale.shipping_cost > 0) row('Envío', formatCurrency(sale.shipping_cost));
  y += 0.8;
  row('TOTAL', formatCurrency(sale.total), base + 3, true);
  separator();

  // Pago
  row('Pago', PAYMENT_METHOD_LABELS[sale.payment_method] || sale.payment_method);
  if (sale.payment_reference) row('Ref.', sale.payment_reference);
  if (sale.payment_method === 'credito' && sale.amount_pending && sale.amount_pending > 0) {
    row('Abonado', formatCurrency(sale.amount_paid || 0));
    row('Saldo pendiente', formatCurrency(sale.amount_pending), base, true);
    if (sale.due_date) row('Vence', format(new Date(sale.due_date), 'dd/MM/yyyy'));
  }
  if (sale.points_earned && sale.points_earned > 0) {
    y += 0.8;
    centered(`¡Ganaste ${sale.points_earned} puntos!`, base, true);
  }

  // Notas
  if (sale.notes) {
    separator();
    doc.setFontSize(base - 0.5);
    doc.setFont('helvetica', 'normal');
    const notesLines: string[] = doc.splitTextToSize(sale.notes, contentWidth);
    notesLines.forEach((line) => {
      doc.text(line, margin, y);
      y += lineHeight;
    });
  }

  // Pie
  separator();
  centered('¡Gracias por su compra!', base, true);
  centered('Comprobante de compra', base - 1);

  return y + margin;
}

/**
 * ¿La venta ya está pagada? Solo entonces la factura lleva el sello PAGADA.
 * Un pedido web sin confirmar (status 'pendiente') o un fiado con saldo
 * (payment_status 'pendiente' / 'parcial') no lo llevan.
 */
export function isSalePaid(sale: Pick<Sale, 'status' | 'payment_method' | 'payment_status'>): boolean {
  if (sale.payment_status === 'pagado') return true;
  if (sale.payment_status === 'pendiente' || sale.payment_status === 'parcial') return false;
  return sale.status === 'completada' && sale.payment_method !== 'credito';
}

/**
 * Sello "PAGADA" en rojo, en diagonal y semitransparente sobre cada página,
 * para que el contenido siga leyéndose debajo.
 */
function drawPaidWatermark(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    // jsPDF no centra el texto girado: se calcula a mano. La palabra ocupa el
    // 85 % del ancho en diagonal (35°) y su centro cae en el centro de la hoja
    // (en las tiras largas, en el primer tramo, donde están los productos).
    const angle = 35;
    const rad = (angle * Math.PI) / 180;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(100);
    const widthAt100 = doc.getTextWidth('PAGADA');
    const textWidth = (width * 0.85) / Math.cos(rad);
    const fontSize = (100 * textWidth) / widthAt100;
    const capHeight = fontSize * 0.3528 * 0.7; // pt → mm, alto de mayúsculas aprox.
    const cx = width / 2;
    const cy = Math.min(height / 2, width * 1.2);
    // Punto de inicio: medio texto hacia atrás sobre la diagonal, y medio alto
    // de letra hacia abajo para centrar también en vertical.
    const x = cx - (textWidth / 2) * Math.cos(rad) + (capHeight / 2) * Math.sin(rad);
    const y = cy + (textWidth / 2) * Math.sin(rad) + (capHeight / 2) * Math.cos(rad);
    doc.saveGraphicsState();
    // GState viene en la instancia (jspdf se carga diferido, sin import de valor).
    const GState = (doc as unknown as { GState: new (opts: { opacity: number }) => Parameters<jsPDF['setGState']>[0] }).GState;
    doc.setGState(new GState({ opacity: 0.22 }));
    doc.setTextColor(220, 38, 38);
    doc.setFontSize(fontSize);
    doc.text('PAGADA', x, y, { angle });
    doc.restoreGraphicsState();
  }
  doc.setTextColor(0, 0, 0);
}

/**
 * Genera un PDF de la factura en el formato elegido (carta por defecto).
 * Si la venta está pagada lleva el sello PAGADA (ver isSalePaid).
 */
export async function generateInvoicePDF(
  data: InvoiceData,
  invoiceFormat: InvoiceFormat = 'carta'
): Promise<jsPDF> {
  const { sale, saleItems, customer, storeInfo, cashierName } = data;

  // Carga diferida de jspdf (~400KB): solo al generar una factura.
  const jsPDF = (await import('jspdf')).default;

  const ticketWidth = getTicketWidthMm(invoiceFormat);
  if (ticketWidth) {
    // Primero se mide el largo en una hoja muy alta y luego se crea la tira exacta
    const draft = new jsPDF({ unit: 'mm', format: [ticketWidth, 2000] });
    const height = drawTicket(draft, data, ticketWidth);
    const ticket = new jsPDF({ unit: 'mm', format: [ticketWidth, Math.max(height, ticketWidth + 1)] });
    drawTicket(ticket, data, ticketWidth);
    if (isSalePaid(sale)) drawPaidWatermark(ticket);
    return ticket;
  }

  // Crear documento PDF (tamaño carta)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });

  let yPos = 15;
  const margin = 20;
  const pageWidth = doc.internal.pageSize.getWidth();

  // Encabezado de la tienda
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(storeInfo.full_name || 'TIENDA POS', pageWidth / 2, yPos, { align: 'center' });

  yPos += 7;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (storeInfo.phone) {
    doc.text(`Tel: ${storeInfo.phone}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 5;
  }
  if (storeInfo.email) {
    doc.text(`Email: ${storeInfo.email}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 5;
  }

  yPos += 5;
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 7;

  // Información de la factura
  const saleDate = new Date(sale.created_at);
  const formattedDate = format(saleDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
  const formattedTime = format(saleDate, 'HH:mm:ss');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('FACTURA/RECIBO:', margin, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`#${sale.sale_number}`, margin + 50, yPos);
  yPos += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Fecha:', margin, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(formattedDate, margin + 50, yPos);
  yPos += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Hora:', margin, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(formattedTime, margin + 50, yPos);
  yPos += 6;

  if (cashierName) {
    doc.setFont('helvetica', 'bold');
    doc.text('Atendido por:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(cashierName, margin + 50, yPos);
    yPos += 6;
  }

  yPos += 3;
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 7;

  // Información del cliente
  if (customer) {
    doc.setFont('helvetica', 'bold');
    doc.text('CLIENTE:', margin, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'normal');
    doc.text(customer.name, margin, yPos);
    yPos += 5;

    if (customer.phone) {
      doc.text(`Tel: ${customer.phone}`, margin, yPos);
      yPos += 5;
    }

    if (customer.id_number) {
      doc.text(`ID: ${customer.id_number}`, margin, yPos);
      yPos += 5;
    }

    yPos += 3;
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;
  }

  // Detalles de los productos
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE LA COMPRA:', margin, yPos);
  yPos += 7;

  // Encabezados de la tabla
  doc.setFontSize(9);
  doc.text('Producto', margin, yPos);
  doc.text('Cant', pageWidth - margin - 80, yPos);
  doc.text('P.Unit', pageWidth - margin - 55, yPos);
  doc.text('Subtotal', pageWidth - margin - 25, yPos, { align: 'right' });
  yPos += 2;
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  // Items
  doc.setFont('helvetica', 'normal');
  saleItems.forEach((item) => {
    // Verificar si necesitamos nueva página
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    const productName = item.product?.name || 'Producto';
    // Limitar nombre del producto a 50 caracteres
    const truncatedName = productName.length > 50 ? productName.substring(0, 47) + '...' : productName;

    // Determinar cómo mostrar la cantidad
    let displayQuantity = item.quantity;
    let quantityText = item.quantity.toString();

    if (item.product?.sell_by_unit && item.product?.units_per_package) {
      if (item.quantity < 1) {
        // Venta vieja: convertir de paquetes a unidades
        displayQuantity = item.quantity * item.product.units_per_package;
        quantityText = `${displayQuantity} ${item.product.unit_name || 'und'}`;
      } else {
        // Venta nueva: determinar si es paquetes o unidades
        const unitsPerPackage = item.product.units_per_package;
        if (item.quantity >= unitsPerPackage && item.quantity % unitsPerPackage === 0) {
          const packages = item.quantity / unitsPerPackage;
          if (packages >= 1) {
            quantityText = `${packages} ${item.product.package_name || 'paq'}`;
          } else {
            quantityText = `${item.quantity} ${item.product.unit_name || 'und'}`;
          }
        } else {
          quantityText = `${item.quantity} ${item.product.unit_name || 'und'}`;
        }
      }
    }

    doc.text(truncatedName, margin, yPos);
    doc.text(quantityText, pageWidth - margin - 80, yPos);
    doc.text(formatCurrency(item.unit_price), pageWidth - margin - 55, yPos);
    doc.text(formatCurrency(item.subtotal), pageWidth - margin - 25, yPos, { align: 'right' });
    yPos += 6;

    if (item.discount > 0) {
      doc.setFontSize(8);
      doc.setTextColor(200, 0, 0);
      doc.text(`(Desc: ${formatCurrency(item.discount)})`, margin + 5, yPos);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      yPos += 5;
    }
  });

  yPos += 3;
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 7;

  // Totales
  doc.setFontSize(10);
  const subtotalAmount = saleItems.reduce((sum, item) => sum + item.subtotal, 0);

  doc.text('Subtotal:', pageWidth - margin - 60, yPos);
  doc.text(formatCurrency(subtotalAmount), pageWidth - margin - 25, yPos, { align: 'right' });
  yPos += 6;

  if (sale.discount > 0) {
    doc.setTextColor(200, 0, 0);
    doc.text('Descuento:', pageWidth - margin - 60, yPos);
    doc.text(`- ${formatCurrency(sale.discount)}`, pageWidth - margin - 25, yPos, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    yPos += 6;
  }

  if (sale.tax > 0) {
    doc.text('Impuesto (IVA):', pageWidth - margin - 60, yPos);
    doc.text(formatCurrency(sale.tax), pageWidth - margin - 25, yPos, { align: 'right' });
    yPos += 6;
  }

  if (sale.shipping_cost && sale.shipping_cost > 0) {
    doc.text('Envío:', pageWidth - margin - 60, yPos);
    doc.text(formatCurrency(sale.shipping_cost), pageWidth - margin - 25, yPos, { align: 'right' });
    yPos += 6;
  }

  yPos += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL:', pageWidth - margin - 60, yPos);
  doc.text(formatCurrency(sale.total), pageWidth - margin - 25, yPos, { align: 'right' });

  yPos += 10;
  doc.setFontSize(10);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 7;

  // Método de pago
  const paymentMethodLabels: Record<string, string> = {
    efectivo: 'Efectivo',
    nequi: 'Nequi',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia',
    credito: 'Crédito',
  };

  doc.setFont('helvetica', 'bold');
  doc.text('Método de pago:', margin, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(paymentMethodLabels[sale.payment_method] || sale.payment_method, margin + 50, yPos);
  yPos += 6;

  if (sale.payment_reference) {
    doc.setFont('helvetica', 'bold');
    doc.text('Referencia de pago:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(sale.payment_reference, margin + 50, yPos);
    yPos += 6;
  }

  // Puntos ganados
  if (sale.points_earned && sale.points_earned > 0) {
    yPos += 5;
    doc.setFillColor(220, 252, 231);
    doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text(`🎉 ¡Ganaste ${sale.points_earned} puntos de lealtad!`, pageWidth / 2, yPos, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    yPos += 10;
  }

  // Notas
  if (sale.notes) {
    yPos += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('NOTAS:', margin, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const notesLines = doc.splitTextToSize(sale.notes, pageWidth - 2 * margin);
    doc.text(notesLines, margin, yPos);
    yPos += notesLines.length * 5;
  }

  // Pie de página
  yPos = Math.max(yPos + 10, 260);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('¡Gracias por su compra!', pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Este documento es válido como comprobante de compra', pageWidth / 2, yPos, { align: 'center' });
  yPos += 4;

  if (storeInfo.phone) {
    doc.text(`Cualquier duda o reclamo, contáctenos al ${storeInfo.phone}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
  }

  yPos += 3;
  doc.setFontSize(7);
  doc.setTextColor(128, 128, 128);
  doc.text('Generado por Sistema POS', pageWidth / 2, yPos, { align: 'center' });
  yPos += 3;
  doc.text(format(new Date(), 'dd/MM/yyyy HH:mm:ss'), pageWidth / 2, yPos, { align: 'center' });

  if (isSalePaid(sale)) drawPaidWatermark(doc);
  return doc;
}

/**
 * Genera un mensaje de texto para compartir por WhatsApp
 */
export function generateWhatsAppMessage(data: InvoiceData): string {
  const { sale, saleItems, customer, storeInfo } = data;

  const saleDate = new Date(sale.created_at);
  const formattedDate = format(saleDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
  const formattedTime = format(saleDate, 'HH:mm:ss');

  const paymentMethodLabels: Record<string, string> = {
    efectivo: 'Efectivo',
    nequi: 'Nequi',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia',
    credito: 'Crédito',
  };

  let message = `🧾 *FACTURA DE COMPRA*\n\n`;
  message += `*${storeInfo.full_name || 'TIENDA POS'}*\n`;
  if (storeInfo.phone) message += `📞 ${storeInfo.phone}\n`;
  if (storeInfo.email) message += `📧 ${storeInfo.email}\n`;
  message += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `*Factura #${sale.sale_number}*\n`;
  message += `📅 Fecha: ${formattedDate}\n`;
  message += `🕐 Hora: ${formattedTime}\n\n`;

  if (customer) {
    message += `*Cliente:* ${customer.name}\n`;
    if (customer.phone) message += `📞 ${customer.phone}\n`;
    message += `\n`;
  }

  message += `*DETALLE DE LA COMPRA:*\n\n`;

  saleItems.forEach((item, index) => {
    // Determinar cómo mostrar la cantidad
    let quantityText = item.quantity.toString();

    if (item.product?.sell_by_unit && item.product?.units_per_package) {
      if (item.quantity < 1) {
        // Venta vieja: convertir de paquetes a unidades
        const displayQuantity = item.quantity * item.product.units_per_package;
        quantityText = `${displayQuantity} ${item.product.unit_name || 'unidades'}`;
      } else {
        // Venta nueva: determinar si es paquetes o unidades
        const unitsPerPackage = item.product.units_per_package;
        if (item.quantity >= unitsPerPackage && item.quantity % unitsPerPackage === 0) {
          const packages = item.quantity / unitsPerPackage;
          if (packages >= 1) {
            quantityText = `${packages} ${item.product.package_name || 'paquete'}${packages > 1 ? 's' : ''}`;
          } else {
            quantityText = `${item.quantity} ${item.product.unit_name || 'unidad'}${item.quantity > 1 ? 'es' : ''}`;
          }
        } else {
          quantityText = `${item.quantity} ${item.product.unit_name || 'unidad'}${item.quantity > 1 ? 'es' : ''}`;
        }
      }
    }

    message += `${index + 1}. *${item.product?.name || 'Producto'}*\n`;
    message += `   Cantidad: ${quantityText} x ${formatCurrency(item.unit_price)}\n`;
    if (item.discount > 0) {
      message += `   Descuento: -${formatCurrency(item.discount)}\n`;
    }
    message += `   Subtotal: ${formatCurrency(item.subtotal)}\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const subtotalAmount = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  message += `Subtotal: ${formatCurrency(subtotalAmount)}\n`;

  if (sale.discount > 0) {
    message += `Descuento: -${formatCurrency(sale.discount)}\n`;
  }

  if (sale.tax > 0) {
    message += `Impuesto (IVA): ${formatCurrency(sale.tax)}\n`;
  }

  if (sale.shipping_cost && sale.shipping_cost > 0) {
    message += `Envío a domicilio: ${formatCurrency(sale.shipping_cost)}\n`;
  }

  message += `\n*TOTAL: ${formatCurrency(sale.total)}*\n\n`;

  message += `*Método de pago:* ${paymentMethodLabels[sale.payment_method] || sale.payment_method}\n`;
  if (sale.payment_reference) {
    message += `*Referencia de pago:* ${sale.payment_reference}\n`;
  }

  if (sale.payment_method === 'credito' && sale.amount_pending && sale.amount_pending > 0) {
    message += `\n⚠️ *Saldo pendiente:* ${formatCurrency(sale.amount_pending)}\n`;
    if (sale.due_date) {
      message += `Vence: ${format(new Date(sale.due_date), 'dd/MM/yyyy')}\n`;
    }
  }

  if (sale.points_earned && sale.points_earned > 0) {
    message += `\n🎉 *¡Ganaste ${sale.points_earned} puntos de lealtad!*\n`;
  }

  if (sale.notes) {
    message += `\n*Notas:* ${sale.notes}\n`;
  }

  message += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `✨ ¡Gracias por su compra! ✨\n`;

  return message;
}

/**
 * Abre WhatsApp con el mensaje de la factura
 */
export function shareViaWhatsApp(phoneNumber: string | undefined, message: string) {
  // Normalizar el número al formato internacional (agrega el 57 a celulares
  // colombianos de 10 dígitos); sin indicativo WhatsApp rechaza el enlace.
  const normalizedPhone = phoneNumber ? normalizeColombianPhone(phoneNumber) : null;

  // Codificar el mensaje para URL
  const encodedMessage = encodeURIComponent(message);

  // Si no hay número válido, abrir WhatsApp con el selector de contacto
  const whatsappUrl = normalizedPhone
    ? `https://wa.me/${normalizedPhone}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;

  // Abrir en nueva pestaña
  window.open(whatsappUrl, '_blank');
}

/**
 * Comparte la factura por Facebook (usando Facebook Share Dialog)
 */
export function shareViaFacebook(message: string) {
  // Facebook no permite pre-llenar texto por políticas
  // Pero podemos abrir el diálogo de compartir
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`;

  window.open(facebookUrl, '_blank', 'width=600,height=400');

  // Nota: Para compartir con texto pre-llenado necesitarías usar la API de Facebook
  // que requiere una app ID y permisos especiales
}

/**
 * Genera el PDF, lo descarga localmente y abre WhatsApp con un mensaje
 * El usuario debe adjuntar manualmente el PDF descargado
 */
export async function shareInvoicePDFViaWhatsApp(data: InvoiceData, phoneNumber: string | undefined): Promise<boolean> {
  try {
    // Generar el PDF
    const doc = await generateInvoicePDF(data);

    // Descargar el PDF localmente
    doc.save(`Factura-${data.sale.sale_number}.pdf`);

    // Pequeño delay para que la descarga se complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generar mensaje de WhatsApp
    const message = `Hola! 👋\n\nTe enviamos tu factura de compra:\n\n*Factura #${data.sale.sale_number}*\n*Total: ${formatCurrency(data.sale.total)}*\n*Fecha: ${format(new Date(data.sale.created_at), "dd/MM/yyyy", { locale: es })}*\n\n📄 El archivo PDF se ha descargado en tu dispositivo.\n\nPor favor, adjunta el archivo *Factura-${data.sale.sale_number}.pdf* en este chat.\n\n✨ ¡Gracias por tu compra! ✨\n\n_${data.storeInfo.full_name || 'TIENDA POS'}_`;

    // Abrir WhatsApp con el mensaje
    shareViaWhatsApp(phoneNumber, message);

    return true;
  } catch (error) {
    console.error('Error sharing PDF via WhatsApp:', error);
    return false;
  }
}
