'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { getSales, updateSale, deleteSale, getUserProfile } from '@/lib/cloudflare-api';
import { Sale, SaleItemWithProduct, UserProfile } from '@/lib/types';
import { InvoiceModal } from '@/components/sales/invoice-modal';

type InvoiceEmailResult =
  | { status: 'sent'; to: string }
  | { status: 'no_email' }
  | { status: 'failed'; to: string; error: string };
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ShoppingCart,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Phone,
  User,
  MapPin,
  Package,
  Trash2,
  Truck,
  Receipt,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasStorefrontAccess,
  getStorefrontBlockMessage,
} from '@/lib/storefront-access';
import Swal from 'sweetalert2';

interface WebOrderItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  subtotal: number;
  product?: { name?: string };
}

type WebOrder = Sale & { items?: WebOrderItem[] };

const REFERENCE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,29}$/;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Pedido pendiente cuyo cliente ya digitó la referencia: el tendero debe contrastarla con su app de Nequi.
const isPendingVerification = (order: WebOrder) =>
  order.status === 'pendiente' && !!order.payment_reference;

const buildItemsHtml = (order: WebOrder) => {
  const rows = (order.items || [])
    .map((item) => {
      const name = escapeHtml(item.product?.name || 'Producto');
      const discount =
        item.discount > 0
          ? `<span style="color:#dc2626"> (desc. -${formatCurrency(item.discount)})</span>`
          : '';
      return `<tr>
        <td style="text-align:left;padding:2px 0">${item.quantity} × ${name}${discount}</td>
        <td style="text-align:right;padding:2px 0 2px 12px;white-space:nowrap">${formatCurrency(item.subtotal)}</td>
      </tr>`;
    })
    .join('');

  const shipping = order.shipping_cost || 0;
  const shippingRow =
    shipping > 0
      ? `<tr>
          <td style="text-align:left;padding:2px 0">Envío a domicilio</td>
          <td style="text-align:right;padding:2px 0 2px 12px;white-space:nowrap">${formatCurrency(shipping)}</td>
        </tr>`
      : '';

  return `<table style="width:100%;font-size:14px">${rows}${shippingRow}
    <tr style="border-top:1px solid #d1d5db">
      <td style="text-align:left;padding-top:6px;font-weight:700">Total a recibir en Nequi</td>
      <td style="text-align:right;padding-top:6px;font-weight:700;white-space:nowrap">${formatCurrency(order.total)}</td>
    </tr>
  </table>`;
};

export default function WebOrdersPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<WebOrder | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [activeTab, setActiveTab] = useState('pendiente');
  // Factura del pedido recién confirmado, para enviarla por WhatsApp.
  const [invoiceOrder, setInvoiceOrder] = useState<WebOrder | null>(null);

  useEffect(() => {
    checkAccessAndLoadOrders();

    // Auto-refresh cada 30 segundos para mostrar cambios de estado de pago
    const interval = setInterval(() => {
      if (hasAccess) {
        loadOrders();
      }
    }, 30000); // 30 segundos

    return () => clearInterval(interval);
  }, [hasAccess]);

  const checkAccessAndLoadOrders = async () => {
    try {
      const data = await getUserProfile(getToken);
      setProfile(data);

      // Verificar acceso a Tienda Online / Pedidos Web
      const accessCheck = hasStorefrontAccess(data);
      setHasAccess(accessCheck.hasAccess);

      // Si no tiene acceso, mostrar alerta y redirigir
      if (!accessCheck.hasAccess) {
        const message = getStorefrontBlockMessage(accessCheck.reason);

        Swal.fire({
          icon: 'warning',
          title: message.title,
          html: message.html,
          showCancelButton: true,
          confirmButtonText: 'Ver Planes de Suscripción',
          cancelButtonText: 'Volver al panel de control',
          confirmButtonColor: '#8B5CF6',
          cancelButtonColor: '#6B7280',
          allowOutsideClick: false,
        }).then((result) => {
          if (result.isConfirmed) {
            router.push('/dashboard/subscription');
          } else {
            router.push('/dashboard');
          }
        });

        setLoading(false);
        return;
      }

      // Si tiene acceso, cargar pedidos
      await loadOrders();
    } catch (error) {
      console.error('Error checking access:', error);
      toast.error('Error al verificar acceso');
      setLoading(false);
    }
  };

  const loadOrders = async () => {
    try {
      setLoading(true);
      const allSales = await getSales(getToken);

      // Filtrar solo pedidos web (que tienen sale_number que empieza con "WEB-")
      const webOrders = allSales.filter(sale =>
        sale.sale_number.startsWith('WEB-')
      );

      // Ordenar por fecha (más recientes primero)
      webOrders.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setOrders(webOrders);
    } catch (error) {
      console.error('Error loading orders:', error);
      toast.error('Error al cargar pedidos');
    } finally {
      setLoading(false);
    }
  };

  const confirmPayment = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const existingReference = order.payment_reference;

    const referenceBlock = existingReference
      ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin:12px 0;text-align:left">
          <p style="font-size:12px;color:#1d4ed8;margin:0">Referencia que ingresó el cliente</p>
          <p style="font-family:monospace;font-size:20px;font-weight:700;margin:2px 0 0">${escapeHtml(existingReference)}</p>
        </div>
        <p style="font-size:13px;color:#4b5563;text-align:left">
          Abre tu app de Nequi y confirma que existe un pago por
          <strong>${formatCurrency(order.total)}</strong> con esa referencia.
        </p>`
      : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin:12px 0;text-align:left">
          <p style="font-size:13px;color:#92400e;margin:0">
            El cliente aún no registró la referencia. Pídela (o tómala del comprobante que te envió)
            y escríbela abajo después de verificarla en tu app de Nequi.
          </p>
        </div>`;

    const result = await Swal.fire({
      title: existingReference ? '¿El pago llegó a tu Nequi?' : 'Registra la referencia del pago',
      html: `
        <p style="font-size:13px;color:#6b7280;margin:0 0 8px">Pedido ${escapeHtml(order.sale_number)}</p>
        ${buildItemsHtml(order)}
        ${referenceBlock}
        <p style="font-size:13px;color:#c2410c;text-align:left">⚠️ Al confirmar se descuenta el inventario y se habilita la factura pagada.</p>
      `,
      input: existingReference ? undefined : 'text',
      inputPlaceholder: 'Referencia de Nequi (ej. M1234567)',
      inputAttributes: { autocapitalize: 'characters', maxlength: '30' },
      inputValidator: existingReference
        ? undefined
        : (value: string) => {
            const normalized = (value || '').replace(/\s+/g, '').toUpperCase();
            return REFERENCE_PATTERN.test(normalized)
              ? undefined
              : 'Escribe la referencia del comprobante (4 a 30 letras, números o guiones)';
          },
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#16a34a',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, ya verifiqué el pago',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    const typedReference =
      !existingReference && typeof result.value === 'string'
        ? result.value.replace(/\s+/g, '').toUpperCase()
        : undefined;

    try {
      const updated = (await updateSale(orderId, {
        status: 'completada',
        payment_status: 'pagado',
        amount_paid: order.total,
        amount_pending: 0,
        ...(typedReference ? { payment_reference: typedReference } : {}),
      } as Partial<Sale>, getToken)) as Sale & { invoice_email?: InvoiceEmailResult };

      // La factura (con sello PAGADA) le llega sola al cliente si dejó correo;
      // por WhatsApp se envía con un toque, porque el teléfono siempre está.
      const mail = updated.invoice_email;
      const phone = order ? extractCustomerInfo(order.notes || '').phone : undefined;
      const mailText =
        mail?.status === 'sent'
          ? `📧 La factura se envió a <strong>${escapeHtml(mail.to)}</strong>.`
          : mail?.status === 'failed'
            ? `⚠️ No se pudo enviar la factura a ${escapeHtml(mail.to)}. Envíala por WhatsApp.`
            : 'El cliente no dejó correo: envíale la factura por WhatsApp.';

      const done = await Swal.fire({
        title: '¡Pago confirmado!',
        html: `<p>El stock se actualizó y la factura quedó con el sello <strong style="color:#dc2626">PAGADA</strong>.</p><p style="margin-top:10px">${mailText}</p>`,
        icon: 'success',
        showCancelButton: !!phone,
        confirmButtonText: phone ? 'Enviar factura por WhatsApp' : 'Listo',
        cancelButtonText: 'Listo',
        confirmButtonColor: '#16a34a',
      });

      if (done.isConfirmed && phone && order) {
        setInvoiceOrder({ ...order, ...updated, items: order.items });
      }

      loadOrders();
    } catch (error) {
      console.error('Error confirming payment:', error);
      await Swal.fire({
        title: 'Error',
        text: error instanceof Error ? error.message : 'Error al confirmar pago',
        icon: 'error',
        confirmButtonColor: '#dc2626',
      });
    }
  };

  const rejectOrder = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);

    const result = await Swal.fire({
      title: '¿Rechazar este pedido?',
      html: `
        <p class="text-gray-600 mb-4">Vas a rechazar el pedido:</p>
        <div class="bg-red-50 p-4 rounded-lg mb-4">
          <p class="font-bold text-lg text-red-900">${order?.sale_number}</p>
          <p class="text-sm text-gray-600 mt-1">${formatCurrency(order?.total || 0)}</p>
        </div>
        <p class="text-sm text-gray-600">El pedido se marcará como cancelado</p>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, rechazar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    try {
      await updateSale(orderId, {
        status: 'cancelada',
        payment_status: 'pendiente', // Mantener como pendiente ya que no se pagó
      } as Partial<Sale>, getToken);

      await Swal.fire({
        title: 'Pedido rechazado',
        text: 'El pedido ha sido cancelado',
        icon: 'success',
        confirmButtonColor: '#16a34a',
        timer: 2000,
      });

      loadOrders();
    } catch (error) {
      console.error('Error rejecting order:', error);
      await Swal.fire({
        title: 'Error',
        text: error instanceof Error ? error.message : 'Error al rechazar pedido',
        icon: 'error',
        confirmButtonColor: '#dc2626',
      });
    }
  };

  const deleteOrder = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);

    const result = await Swal.fire({
      title: '¿Eliminar este pedido?',
      html: `
        <p class="text-gray-600 mb-4">Vas a <strong>eliminar permanentemente</strong> el pedido:</p>
        <div class="bg-red-50 p-4 rounded-lg mb-4">
          <p class="font-bold text-lg text-red-900">${order?.sale_number}</p>
          <p class="text-sm text-gray-600 mt-1">${formatCurrency(order?.total || 0)}</p>
        </div>
        <p class="text-sm text-red-600">⚠️ Esta acción no se puede deshacer</p>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    try {
      await deleteSale(orderId, getToken);

      await Swal.fire({
        title: 'Pedido eliminado',
        text: 'El pedido ha sido eliminado de la base de datos',
        icon: 'success',
        confirmButtonColor: '#16a34a',
        timer: 2000,
      });

      loadOrders();
    } catch (error) {
      console.error('Error deleting order:', error);
      await Swal.fire({
        title: 'Error',
        text: error instanceof Error ? error.message : 'Error al eliminar pedido',
        icon: 'error',
        confirmButtonColor: '#dc2626',
      });
    }
  };

  const viewOrderDetails = (order: WebOrder) => {
    setSelectedOrder(order);
    setShowDetailsDialog(true);
  };

  const getStatusBadge = (order: WebOrder) => {
    const status = order.status;
    switch (status) {
      case 'pendiente':
        if (isPendingVerification(order)) {
          return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300"><Receipt className="h-3 w-3 mr-1" />Por verificar</Badge>;
        }
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300"><Clock className="h-3 w-3 mr-1" />Esperando referencia</Badge>;
      case 'completada':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300"><CheckCircle className="h-3 w-3 mr-1" />Confirmado</Badge>;
      case 'cancelada':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300"><XCircle className="h-3 w-3 mr-1" />Cancelado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const extractCustomerInfo = (notes: string) => {
    const info: {
      name?: string;
      phone?: string;
      email?: string;
      delivery?: string;
      address?: string;
      shippingCost?: string;
      customerNotes?: string;
    } = {};

    const nameMatch = notes.match(/Cliente: (.+)/);
    if (nameMatch) info.name = nameMatch[1].trim();

    const phoneMatch = notes.match(/Teléfono: (.+)/);
    if (phoneMatch) info.phone = phoneMatch[1].trim();

    const emailMatch = notes.match(/Email: (.+)/);
    if (emailMatch) info.email = emailMatch[1].trim();

    const deliveryMatch = notes.match(/Entrega: (.+)/);
    if (deliveryMatch) info.delivery = deliveryMatch[1].trim();

    const addressMatch = notes.match(/Dirección: (.+)/);
    if (addressMatch) info.address = addressMatch[1].trim();

    const shippingMatch = notes.match(/Costo de envío: \$(.+)/);
    if (shippingMatch) info.shippingCost = shippingMatch[1].trim();

    const customerNotesMatch = notes.match(/Notas: (.+)/);
    if (customerNotesMatch) info.customerNotes = customerNotesMatch[1].trim();

    return info;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  // Filtrar pedidos por estado
  // Los pedidos con referencia por verificar van primero: son los que el tendero puede resolver ya.
  const pendingOrders = orders
    .filter(o => o.status === 'pendiente')
    .sort((a, b) => Number(isPendingVerification(b)) - Number(isPendingVerification(a)));
  const toVerifyCount = pendingOrders.filter(isPendingVerification).length;
  const completedOrders = orders.filter(o => o.status === 'completada');
  const canceledOrders = orders.filter(o => o.status === 'cancelada');

  const renderOrderCard = (order: WebOrder) => {
            const customerInfo = extractCustomerInfo(order.notes || '');
            const shippingCost = order.shipping_cost || 0;

            return (
              <Card
                key={order.id}
                className={
                  isPendingVerification(order)
                    ? 'border-blue-300 border-2'
                    : order.status === 'pendiente'
                      ? 'border-yellow-300 border-2'
                      : ''
                }
              >
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold">{order.sale_number}</h3>
                        {getStatusBadge(order)}
                      </div>
                      <p className="text-sm text-gray-500">
                        {new Date(order.created_at).toLocaleString('es-CO', {
                          dateStyle: 'full',
                          timeStyle: 'short'
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-brand">
                        {formatCurrency(order.total)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      {customerInfo.name && (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4 text-gray-400" />
                          <span>{customerInfo.name}</span>
                        </div>
                      )}
                      {customerInfo.phone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-4 w-4 text-gray-400" />
                          <span>{customerInfo.phone}</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      {customerInfo.delivery && (
                        <div className="flex items-center gap-2 text-sm">
                          <Package className="h-4 w-4 text-gray-400" />
                          <span>{customerInfo.delivery}</span>
                        </div>
                      )}
                      {customerInfo.address && (
                        <div className="flex items-center gap-2 text-sm">
                          <MapPin className="h-4 w-4 text-gray-400" />
                          <span className="line-clamp-1">{customerInfo.address}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {order.items && order.items.length > 0 && (
                    <div className="mb-4 rounded-lg border bg-gray-50 p-3 text-sm">
                      <ul className="space-y-1">
                        {order.items.map((item) => (
                          <li key={item.id} className="flex justify-between gap-3">
                            <span>
                              {item.quantity} × {item.product?.name || 'Producto'}
                              {item.discount > 0 && (
                                <span className="ml-2 text-xs text-red-600">
                                  (desc. -{formatCurrency(item.discount)})
                                </span>
                              )}
                            </span>
                            <span className="whitespace-nowrap font-medium">
                              {formatCurrency(item.subtotal)}
                            </span>
                          </li>
                        ))}
                        {shippingCost > 0 && (
                          <li className="flex justify-between gap-3">
                            <span className="flex items-center gap-1">
                              <Truck className="h-3.5 w-3.5 text-gray-400" />
                              Envío a domicilio
                            </span>
                            <span className="whitespace-nowrap font-medium">
                              {formatCurrency(shippingCost)}
                            </span>
                          </li>
                        )}
                        <li className="flex justify-between gap-3 border-t pt-1 font-bold">
                          <span>Total a recibir en Nequi</span>
                          <span className="whitespace-nowrap">{formatCurrency(order.total)}</span>
                        </li>
                      </ul>
                    </div>
                  )}

                  {order.status === 'pendiente' && (
                    <div
                      className={`mb-4 rounded-lg border p-3 text-sm ${
                        isPendingVerification(order)
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-yellow-200 bg-yellow-50'
                      }`}
                    >
                      {order.payment_reference ? (
                        <>
                          <p className="text-xs text-blue-700">
                            Referencia de Nequi ingresada por el cliente
                          </p>
                          <p className="font-mono text-lg font-bold">{order.payment_reference}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            Verifica en tu app de Nequi que llegó {formatCurrency(order.total)} con esta referencia antes de confirmar.
                          </p>
                        </>
                      ) : (
                        <p className="text-yellow-800">
                          El cliente todavía no ha ingresado la referencia de su pago. No confirmes hasta verificarla en tu app de Nequi.
                        </p>
                      )}
                    </div>
                  )}

                  {order.status === 'completada' && order.payment_reference && (
                    <p className="mb-4 text-sm text-gray-600">
                      Referencia de Nequi: <span className="font-mono font-semibold">{order.payment_reference}</span>
                    </p>
                  )}

                  <div data-guide="orders-actions" className="flex flex-wrap gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewOrderDetails(order)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver detalles
                    </Button>

                    {order.status === 'pendiente' && (
                      <>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => confirmPayment(order.id)}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          {order.payment_reference ? 'Confirmar Pago' : 'Registrar referencia y confirmar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => rejectOrder(order.id)}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Rechazar
                        </Button>
                      </>
                    )}

                    {order.status === 'cancelada' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteOrder(order.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Eliminar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Pedidos Web</h1>
          <p className="text-gray-500">Gestiona los pedidos de tu tienda online</p>
        </div>
        <div className="flex gap-2">
          {toVerifyCount > 0 && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
              <Receipt className="h-4 w-4 mr-1" />
              {toVerifyCount} por verificar
            </Badge>
          )}
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            <Clock className="h-4 w-4 mr-1" />
            {pendingOrders.length} Pendientes
          </Badge>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ShoppingCart className="h-16 w-16 text-gray-300 mb-4" />
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              No hay pedidos web
            </h3>
            <p className="text-gray-500">
              Los pedidos de tu tienda online aparecerán aquí
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList data-guide="orders-tabs" className="grid w-full grid-cols-3">
            <TabsTrigger value="pendiente" className="relative">
              Pendientes
              {pendingOrders.length > 0 && (
                <Badge className="ml-2 bg-yellow-600">{pendingOrders.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completada" className="relative">
              Completados
              {completedOrders.length > 0 && (
                <Badge className="ml-2 bg-green-600">{completedOrders.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="cancelada" className="relative">
              Cancelados
              {canceledOrders.length > 0 && (
                <Badge className="ml-2 bg-red-600">{canceledOrders.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pendiente" className="space-y-4 mt-6">
            {pendingOrders.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <Clock className="h-16 w-16 text-gray-300 mb-4" />
                  <h3 className="text-xl font-semibold text-gray-700 mb-2">
                    No hay pedidos pendientes
                  </h3>
                  <p className="text-gray-500">
                    Los nuevos pedidos aparecerán aquí
                  </p>
                </CardContent>
              </Card>
            ) : (
              pendingOrders.map(renderOrderCard)
            )}
          </TabsContent>

          <TabsContent value="completada" className="space-y-4 mt-6">
            {completedOrders.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <CheckCircle className="h-16 w-16 text-gray-300 mb-4" />
                  <h3 className="text-xl font-semibold text-gray-700 mb-2">
                    No hay pedidos completados
                  </h3>
                  <p className="text-gray-500">
                    Los pedidos confirmados aparecerán aquí
                  </p>
                </CardContent>
              </Card>
            ) : (
              completedOrders.map(renderOrderCard)
            )}
          </TabsContent>

          <TabsContent value="cancelada" className="space-y-4 mt-6">
            {canceledOrders.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <XCircle className="h-16 w-16 text-gray-300 mb-4" />
                  <h3 className="text-xl font-semibold text-gray-700 mb-2">
                    No hay pedidos cancelados
                  </h3>
                  <p className="text-gray-500">
                    Los pedidos rechazados aparecerán aquí
                  </p>
                </CardContent>
              </Card>
            ) : (
              canceledOrders.map(renderOrderCard)
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Dialog de detalles */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalles del Pedido</DialogTitle>
            <DialogDescription>
              {selectedOrder?.sale_number}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Información del Cliente</h4>
                <div className="space-y-1 text-sm">
                  <pre className="whitespace-pre-wrap text-gray-700">
                    {selectedOrder.notes}
                  </pre>
                </div>
              </div>

              <div className="bg-brand-light/50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Productos y Total</h4>
                <div className="space-y-1 text-sm">
                  {(selectedOrder.items || []).map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <span>
                        {item.quantity} × {item.product?.name || 'Producto'}{' '}
                        <span className="text-gray-500">
                          ({formatCurrency(item.unit_price)} c/u)
                        </span>
                        {item.discount > 0 && (
                          <span className="ml-2 text-xs text-red-600">
                            desc. -{formatCurrency(item.discount)}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap">{formatCurrency(item.subtotal)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(selectedOrder.subtotal)}</span>
                  </div>
                  {selectedOrder.discount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Descuento:</span>
                      <span>-{formatCurrency(selectedOrder.discount)}</span>
                    </div>
                  )}
                  {(selectedOrder.shipping_cost || 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Envío a domicilio:</span>
                      <span>{formatCurrency(selectedOrder.shipping_cost || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base pt-2 border-t">
                    <span>Total:</span>
                    <span>{formatCurrency(selectedOrder.total)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Pago por Nequi</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Referencia:</span>
                    {selectedOrder.payment_reference ? (
                      <span className="font-mono font-bold">{selectedOrder.payment_reference}</span>
                    ) : (
                      <span className="text-yellow-700">Sin registrar</span>
                    )}
                  </div>
                  {selectedOrder.payment_reference_at && (
                    <div className="flex justify-between text-gray-500">
                      <span>Registrada:</span>
                      <span>
                        {new Date(selectedOrder.payment_reference_at).toLocaleString('es-CO', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Estado</h4>
                <div className="flex gap-2">
                  {getStatusBadge(selectedOrder)}
                  {selectedOrder.payment_status && (
                    <Badge variant="outline">
                      Pago: {selectedOrder.payment_status}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Factura del pedido confirmado: imprimir, descargar o enviar por WhatsApp */}
      {invoiceOrder && profile && (
        <InvoiceModal
          open
          onOpenChange={(open) => !open && setInvoiceOrder(null)}
          sale={invoiceOrder}
          saleItems={(invoiceOrder.items ?? []) as unknown as SaleItemWithProduct[]}
          storeInfo={profile}
          defaultPhone={extractCustomerInfo(invoiceOrder.notes || '').phone}
        />
      )}
    </div>
  );
}
