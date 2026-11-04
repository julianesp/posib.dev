"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useStorefrontUser } from "@/lib/storefront-user-context";
import {
  getMyOrders,
  SessionExpiredError,
  type CustomerOrder,
  type CustomerOrderStatus,
} from "@/lib/storefront-api";
import { formatCurrency } from "@/lib/utils";
import type { Sale, SaleItemWithProduct, UserProfile } from "@/lib/types";

const STATUS: Record<CustomerOrderStatus, { label: string; className: string; hint: string }> = {
  pendiente: {
    label: "Pendiente de pago",
    className: "bg-amber-100 text-amber-900",
    hint: "Aún no has enviado la referencia de tu pago por Nequi.",
  },
  por_verificar: {
    label: "Pago por verificar",
    className: "bg-blue-100 text-blue-900",
    hint: "La tienda está revisando tu pago en su Nequi.",
  },
  pagado: { label: "Pagado", className: "bg-green-100 text-green-900", hint: "" },
  cancelado: { label: "Cancelado", className: "bg-gray-200 text-gray-700", hint: "" },
};

const dateText = (iso: string) =>
  new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * "Mis compras" del cliente con cuenta en la tienda: sus pedidos, el estado del
 * pago y, cuando la tienda confirmó el pago, la factura con sello PAGADA. La
 * factura NO se puede descargar antes de pagar.
 */
export default function MyOrdersPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { user, token, loading: sessionLoading, logout } = useStorefrontUser();
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [store, setStore] = useState<{ name: string | null; phone: string | null; address: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading || !token) return;
    let cancelled = false;
    getMyOrders(slug, token)
      .then((data) => {
        if (cancelled) return;
        setOrders(data.orders);
        setStore(data.store);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) logout();
        setError(err instanceof Error ? err.message : "No se pudieron cargar tus compras");
      });
    return () => {
      cancelled = true;
    };
    // logout cambia en cada render del contexto; basta con la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token, sessionLoading]);

  const downloadInvoice = async (order: CustomerOrder) => {
    setDownloading(order.order_number);
    try {
      const { generateInvoicePDF } = await import("@/lib/invoice-helpers");
      const sale = {
        id: order.order_number,
        sale_number: order.order_number,
        cashier_id: "",
        subtotal: order.subtotal,
        tax: 0,
        discount: 0,
        total: order.total,
        shipping_cost: order.shipping_cost,
        payment_method: order.payment_method,
        payment_reference: order.payment_reference ?? undefined,
        status: "completada",
        payment_status: "pagado",
        created_at: order.created_at,
        updated_at: order.created_at,
      } as unknown as Sale;
      const items = order.items.map((item, i) => ({
        id: `${order.order_number}-${i}`,
        sale_id: order.order_number,
        product_id: "",
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: 0,
        subtotal: item.subtotal,
        product: { name: item.name },
      })) as unknown as SaleItemWithProduct[];
      const storeInfo = { full_name: store?.name || "Tienda", phone: store?.phone || undefined } as UserProfile;
      const doc = await generateInvoicePDF({
        sale,
        saleItems: items,
        storeInfo,
        customer: user ? ({ name: user.name, phone: user.phone ?? undefined } as never) : null,
      });
      doc.save(`Factura-${order.order_number}.pdf`);
    } catch (err) {
      console.error("Error generando la factura:", err);
      toast.error("No se pudo generar la factura");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href={`/store/${slug}`} className="mb-4 inline-flex items-center gap-2 text-sm text-gray-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Volver a la tienda
        </Link>
        <h1 className="mb-1 text-2xl font-bold text-black">Mis compras</h1>
        {user && <p className="mb-6 text-sm text-gray-600">{user.name} · {user.email}</p>}

        {sessionLoading ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-400" />
        ) : !token ? (
          <Card>
            <CardContent className="space-y-3 pt-6 text-center">
              <Receipt className="mx-auto h-10 w-10 text-gray-400" />
              <p className="text-gray-800">
                Toca <strong>Entrar</strong> arriba para ver tus compras. Los pedidos que hagas con tu cuenta
                quedan guardados aquí, con su factura cuando la tienda confirme el pago.
              </p>
            </CardContent>
          </Card>
        ) : error ? (
          <p className="text-red-700">{error}</p>
        ) : orders === null ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-400" />
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 pt-6 text-center">
              <Receipt className="mx-auto h-10 w-10 text-gray-400" />
              <p className="text-gray-800">Todavía no tienes compras con esta cuenta.</p>
              <Link href={`/store/${slug}`}>
                <Button>Ver productos</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => {
              const status = STATUS[order.status];
              return (
                <li key={order.order_number}>
                  <Card>
                    <CardContent className="space-y-3 pt-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-sm font-semibold text-black">{order.order_number}</p>
                          <p className="text-xs text-gray-600">{dateText(order.created_at)}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                      <ul className="space-y-1 text-sm text-gray-800">
                        {order.items.map((item, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{item.name} x{item.quantity}</span>
                            <span>{formatCurrency(item.subtotal)}</span>
                          </li>
                        ))}
                        {order.shipping_cost > 0 && (
                          <li className="flex justify-between gap-3 text-gray-600">
                            <span>Envío a domicilio</span>
                            <span>{formatCurrency(order.shipping_cost)}</span>
                          </li>
                        )}
                      </ul>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                        <p className="font-bold text-black">Total {formatCurrency(order.total)}</p>
                        {order.status === "pagado" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadInvoice(order)}
                            disabled={downloading === order.order_number}
                          >
                            {downloading === order.order_number ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="mr-1.5 h-4 w-4" />
                            )}
                            Descargar factura
                          </Button>
                        ) : (
                          status.hint && <p className="text-xs text-gray-600">{status.hint}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
