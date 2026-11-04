"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getStoreConfig,
  StoreConfig,
  createOrder,
  CreateOrderData,
  calculateDiscountedPrice,
  calculateLineTotals,
  getStoreShippingZones,
  ShippingZonePublic,
  submitPaymentReference,
} from "@/lib/storefront-api";
import { allowedDeliveryMethods } from "@/lib/storefront-delivery";
import { detectNequiPlatform, nequiAppLink } from "@/lib/nequi-app-link";
import { formatCurrency } from "@/lib/utils";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import {
  clearPendingOrder,
  readCart,
  readPendingOrder,
  writeCart,
  writePendingOrder,
  type PendingOrder,
  type StoreCartItem,
} from "@/lib/storefront-cart";
import {
  ArrowLeft,
  ShoppingCart,
  User,
  Loader2,
  CheckCircle2,
  Store,
  Truck,
  MessageSquare,
  QrCode,
  Download,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// El dispositivo del cliente no cambia mientras está en la página.
const noopSubscribe = () => () => {};

type CartItem = StoreCartItem;

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shippingZones, setShippingZones] = useState<ShippingZonePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);

  // Datos del formulario
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "shipping">(
    "pickup"
  );
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [notes, setNotes] = useState("");

  // Datos del pedido completado
  const [orderNumber, setOrderNumber] = useState("");
  const [orderTotal, setOrderTotal] = useState(0);
  const [storeWhatsApp, setStoreWhatsApp] = useState("");
  const [storeNequiNumber, setStoreNequiNumber] = useState("");
  // Celular del cliente (Android / iPhone) para el botón "Abrir Nequi"; en el
  // servidor y en computador no hay botón.
  const nequiPlatform = useSyncExternalStore(
    noopSubscribe,
    () => detectNequiPlatform(navigator.userAgent, navigator.maxTouchPoints),
    () => "desktop" as const,
  );
  const nequiLink = nequiAppLink(nequiPlatform);
  // Items del pedido confirmado, preservados para el PDF (el carrito se vacía)
  const [orderItems, setOrderItems] = useState<CartItem[]>([]);
  const [orderShippingCost, setOrderShippingCost] = useState(0);

  // Referencia de pago de Nequi: el pedido no se factura como pagado hasta que
  // el cliente la registra y el tendero la verifica en su app.
  const [orderToken, setOrderToken] = useState("");
  const [referenceInput, setReferenceInput] = useState("");
  const [referenceSent, setReferenceSent] = useState<string | null>(null);
  const [editingReference, setEditingReference] = useState(false);
  const [submittingReference, setSubmittingReference] = useState(false);

  useEffect(() => {
    loadConfigAndCart();
  }, [slug]);

  const restorePendingOrder = (pending: PendingOrder, nequiNumber: string) => {
    setOrderNumber(pending.orderNumber);
    setOrderToken(pending.token);
    setOrderTotal(pending.total);
    setOrderShippingCost(pending.shippingCost);
    setStoreWhatsApp(pending.storeWhatsApp);
    setStoreNequiNumber(nequiNumber);
    setOrderItems(pending.items);
    setCustomerName(pending.customerName);
    setCustomerPhone(pending.customerPhone);
    setDeliveryMethod(pending.deliveryMethod);
    setDeliveryAddress(pending.deliveryAddress);
    setNotes(pending.notes);
    setReferenceSent(pending.paymentReference);
    setOrderCompleted(true);
  };

  const loadConfigAndCart = async () => {
    try {
      setLoading(true);
      const [configData, zonesData] = await Promise.all([
        getStoreConfig(slug),
        getStoreShippingZones(slug),
      ]);
      setConfig(configData);
      setShippingZones(zonesData);

      // Método de entrega por defecto: el único que ofrezca la tienda.
      const delivery = allowedDeliveryMethods(configData);
      if (!delivery.shipping) {
        setDeliveryMethod("pickup");
      } else if (!delivery.pickup) {
        setDeliveryMethod("shipping");
      }

      // Cargar carrito desde localStorage
      const parsedCart = readCart(slug);
      if (parsedCart.length === 0) {
        // Carrito vacío: si hay un pedido esperando el pago (recarga o regreso
        // del cliente), se retoma; si no, se vuelve al carrito.
        const pending = readPendingOrder(slug);
        if (pending) {
          restorePendingOrder(pending, configData.store_nequi_number || "");
          return;
        }
        router.push(`/store/${slug}/cart`);
        return;
      }
      setCart(parsedCart);
    } catch (err) {
      console.error("Error loading checkout:", err);
      toast.error("Error al cargar el checkout");
    } finally {
      setLoading(false);
    }
  };

  const sendOrderByWhatsApp = () => {
    if (!storeWhatsApp) return;

    let message = `Hola! Acabo de realizar el pedido *${orderNumber}* por ${formatCurrency(orderTotal)}.\n`;
    message += `Mi nombre es ${customerName}.\n\n`;

    // Detalle de los productos pedidos con su precio, más envío y total, para
    // que el tendero pueda contrastarlo con el pago que le llegó a Nequi.
    message += `*Productos:*\n`;
    orderItems.forEach((item) => {
      const line = calculateLineTotals(
        item.price,
        item.quantity,
        item.discount_percentage
      );
      message += `• ${item.name} x${item.quantity} - ${formatCurrency(line.net)}\n`;
    });
    if (orderShippingCost > 0) {
      message += `• Envío a domicilio - ${formatCurrency(orderShippingCost)}\n`;
    }
    message += `*Total pagado:* ${formatCurrency(orderTotal)}\n\n`;

    message +=
      deliveryMethod === "pickup"
        ? "Recogeré el pedido en la tienda."
        : `Entrega a domicilio: ${deliveryAddress}.`;
    message += `\nPagué por Nequi.`;
    if (referenceSent) {
      message += ` *Referencia:* ${referenceSent}`;
    }
    message += `\nAdjunto el comprobante. 📎`;

    const url = buildWhatsAppLink(storeWhatsApp, message);
    if (url) window.open(url, "_blank");
  };

  // Descarga la imagen del QR de Nequi de la tienda, útil para quien paga
  // desde el mismo celular y no puede escanear su propia pantalla.
  const handleDownloadQr = async () => {
    if (!config?.payment_qr_url) return;
    try {
      const res = await fetch(config.payment_qr_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `QR-Nequi-${config.store_name || "tienda"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error descargando el QR:", err);
      toast.error("No se pudo descargar el QR");
    }
  };

  const calculateItemTotal = (item: CartItem): number =>
    calculateLineTotals(item.price, item.quantity, item.discount_percentage)
      .net;

  // Subtotal SIN descuentos (precio original) y total de descuentos, con el
  // mismo redondeo que el servidor
  const subtotalOriginal = cart.reduce(
    (sum, item) =>
      sum +
      calculateLineTotals(item.price, item.quantity, item.discount_percentage)
        .gross,
    0
  );
  const totalDiscount = cart.reduce(
    (sum, item) =>
      sum +
      calculateLineTotals(item.price, item.quantity, item.discount_percentage)
        .discount,
    0
  );

  // Subtotal con descuentos aplicados
  const subtotal = subtotalOriginal - totalDiscount;

  const selectedZone = shippingZones.find((z) => z.id === selectedZoneId);
  const shippingAmount =
    deliveryMethod === "shipping" && selectedZone
      ? selectedZone.shipping_cost
      : 0;
  const total = subtotal + shippingAmount;

  // ¿Están todos los datos obligatorios listos para confirmar el pedido?
  // Mientras esto sea false, el botón "Confirmar Pedido" queda deshabilitado
  // (gris); cuando se completa todo, se habilita (azul).
  // Solo se ofrecen las formas de entrega que la tienda tiene activas.
  const deliveryOptions = allowedDeliveryMethods(config ?? {});
  const meetsMinOrder = !(
    config?.store_min_order &&
    config.store_min_order > 0 &&
    subtotal < config.store_min_order
  );
  const shippingDataReady =
    deliveryMethod === "pickup" ||
    (deliveryAddress.trim().length > 0 && Boolean(selectedZoneId));
  const isFormValid =
    customerName.trim().length > 0 &&
    customerPhone.trim().length > 0 &&
    shippingDataReady &&
    meetsMinOrder;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validaciones
    if (!customerName.trim()) {
      toast.error("Por favor ingresa tu nombre");
      return;
    }

    if (!customerPhone.trim()) {
      toast.error("Por favor ingresa tu teléfono");
      return;
    }

    if (deliveryMethod === "shipping") {
      if (!deliveryAddress.trim()) {
        toast.error("Por favor ingresa la dirección de entrega");
        return;
      }
      if (!selectedZoneId) {
        toast.error("Por favor selecciona una zona de envío");
        return;
      }
    }

    // Validar pedido mínimo solo si está configurado (sobre el subtotal de
    // productos: el costo de envío no debe "completar" el mínimo)
    if (config?.store_min_order && config.store_min_order > 0 && subtotal < config.store_min_order) {
      toast.error(
        `El pedido mínimo es de ${formatCurrency(config.store_min_order)}`
      );
      return;
    }

    try {
      setSubmitting(true);

      // Preparar datos del pedido
      const orderData: CreateOrderData = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_email: customerEmail.trim() || undefined,
        delivery_method: deliveryMethod,
        delivery_address:
          deliveryMethod === "shipping" ? deliveryAddress.trim() : undefined,
        shipping_zone_id:
          deliveryMethod === "shipping" ? selectedZoneId : undefined,
        notes: notes.trim() || undefined,
        items: cart.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
        })),
      };

      // Crear pedido (el servidor calcula precios, ofertas y envío)
      const response = await createOrder(slug, orderData);
      const whatsapp = response.store_whatsapp || config?.store_whatsapp || "";

      // Guardar datos del pedido
      setOrderNumber(response.order_number);
      setOrderToken(response.order_token);
      setOrderTotal(response.total);
      setStoreWhatsApp(whatsapp);
      setStoreNequiNumber(config?.store_nequi_number || "");

      // Preservar los items y el envío para el PDF antes de vaciar el carrito
      setOrderItems(cart);
      setOrderShippingCost(response.shipping_cost);

      // Guardar el pedido pendiente: si el cliente recarga, puede seguir
      // ingresando la referencia de su pago
      writePendingOrder(slug, {
        orderNumber: response.order_number,
        token: response.order_token,
        total: response.total,
        shippingCost: response.shipping_cost,
        storeWhatsApp: whatsapp,
        items: cart,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        deliveryMethod,
        deliveryAddress: deliveryMethod === "shipping" ? deliveryAddress.trim() : "",
        notes: notes.trim(),
        paymentReference: null,
        createdAt: Date.now(),
      });

      // Limpiar carrito
      writeCart(slug, []);
      setCart([]);

      // Marcar como completado
      setOrderCompleted(true);

      toast.success("¡Pedido realizado con éxito!");
    } catch (err) {
      console.error("Error creating order:", err);
      toast.error(err instanceof Error ? err.message : "Error al crear el pedido");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReference = async (e: React.FormEvent) => {
    e.preventDefault();

    const reference = referenceInput.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{3,29}$/.test(reference)) {
      toast.error(
        "Revisa el código de referencia: son de 4 a 30 letras o números, como aparece en tu comprobante de Nequi"
      );
      return;
    }

    try {
      setSubmittingReference(true);
      const result = await submitPaymentReference(
        slug,
        orderNumber,
        orderToken,
        reference
      );

      setReferenceSent(result.payment_reference);
      setEditingReference(false);
      setReferenceInput("");

      const pending = readPendingOrder(slug);
      if (pending && pending.orderNumber === orderNumber) {
        writePendingOrder(slug, {
          ...pending,
          paymentReference: result.payment_reference,
        });
      }

      toast.success("Referencia enviada. El tendero verificará tu pago.");
    } catch (err) {
      console.error("Error enviando la referencia:", err);
      toast.error(
        err instanceof Error ? err.message : "No se pudo enviar la referencia"
      );
    } finally {
      setSubmittingReference(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto mb-4"></div>
          <p className="text-black">Cargando checkout...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md p-8">
          <ShoppingCart className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Tienda no encontrada
          </h1>
          <Link href="/">
            <Button>Volver al inicio</Button>
          </Link>
        </div>
      </div>
    );
  }

  const primaryColor = config.store_primary_color || "#3B82F6";
  const secondaryColor = config.store_secondary_color || "#10B981";

  // Vista de pedido completado
  if (orderCompleted) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header
          className="sticky top-16 z-40 bg-white shadow-md"
          style={{ borderBottom: `4px solid ${primaryColor}` }}
        >
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-center">
              <h1 className="text-xl font-bold">
                {referenceSent
                  ? "Pago en verificación"
                  : "Pedido Registrado - Paga con Nequi"}
              </h1>
            </div>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 py-12">
          <Card>
            <CardContent className="pt-8 text-center">
              <div
                className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center"
                style={{ backgroundColor: `${secondaryColor}20` }}
              >
                <CheckCircle2
                  className="h-12 w-12"
                  style={{ color: secondaryColor }}
                />
              </div>

              <h2 className="text-3xl font-bold mb-2">¡Pedido Registrado!</h2>
              <p className="text-black mb-6">
                {referenceSent
                  ? "Recibimos la referencia de tu pago."
                  : "Tu pedido ha sido creado. Ahora debes completar el pago."}
              </p>

              <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <p className="text-sm text-black mb-1">Número de pedido</p>
                <p
                  className="text-2xl font-bold"
                  style={{ color: primaryColor }}
                >
                  {orderNumber}
                </p>

                {/* Detalle de lo pedido: productos, envío y total */}
                <div className="mt-4 space-y-1.5 text-left text-sm border-t pt-4">
                  {orderItems.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <span className="text-black">
                        {item.name} x{item.quantity}
                      </span>
                      <span className="font-medium text-black whitespace-nowrap">
                        {formatCurrency(calculateItemTotal(item))}
                      </span>
                    </div>
                  ))}
                  {orderShippingCost > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-black">Envío a domicilio</span>
                      <span className="font-medium text-black whitespace-nowrap">
                        {formatCurrency(orderShippingCost)}
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-sm text-black mt-4">Total a pagar</p>
                <p className="text-3xl font-bold">
                  {formatCurrency(orderTotal)}
                </p>
              </div>

              <div className="space-y-4">
                {referenceSent ? (
                  <div className="p-4 bg-green-50 border border-green-500 rounded-lg text-left">
                    <p className="text-sm text-green-900">
                      ✅ <strong>Referencia recibida:</strong>{" "}
                      <span className="font-mono">{referenceSent}</span>. El
                      tendero verificará en su Nequi que llegó tu pago de{" "}
                      {formatCurrency(orderTotal)} y confirmará tu pedido.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 border border-yellow-500 rounded-lg text-left">
                    <p className="text-sm text-yellow-900">
                      ⚠️ <strong>¡IMPORTANTE!</strong> Tu pedido está registrado
                      pero aún NO está pagado. Paga con Nequi escaneando el
                      código de abajo y luego escribe el código de referencia de
                      tu pago para que el tendero lo verifique.
                    </p>
                  </div>
                )}

                {/* Pago con Nequi: QR de la tienda (preferido) y número */}
                {(config.payment_qr_url || storeNequiNumber) && (
                  <div className="p-5 bg-purple-50 border border-purple-200 rounded-lg">
                    <p className="text-sm font-semibold text-purple-900 mb-3 flex items-center justify-center gap-2">
                      <QrCode className="h-5 w-5" />
                      Paga con Nequi
                    </p>

                    {/* En el celular: un toque copia el número y abre Nequi */}
                    {nequiLink && storeNequiNumber && (
                      <a
                        href={nequiLink}
                        onClick={() => {
                          navigator.clipboard?.writeText(storeNequiNumber).catch(() => {});
                          toast.success("Número copiado. Pégalo en Nequi → Enviar plata", {
                            duration: 6000,
                          });
                        }}
                        className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 py-4 text-base font-bold text-white shadow-md transition-colors hover:bg-purple-800 active:scale-[0.98]"
                      >
                        <Smartphone className="h-5 w-5" />
                        Abrir Nequi y pagar {formatCurrency(orderTotal)}
                      </a>
                    )}
                    {nequiLink && storeNequiNumber && (
                      <p className="mb-4 text-center text-xs text-purple-800">
                        {nequiPlatform === "ios"
                          ? "Se abre Nequi en App Store: toca \"Abrir\". "
                          : ""}
                        El número ya queda copiado: en Nequi ve a <strong>Enviar plata</strong>,
                        pégalo y envía el monto exacto. Luego vuelve aquí y escribe la referencia.
                      </p>
                    )}

                    {config.payment_qr_url && (
                      <div className="flex flex-col items-center mb-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={config.payment_qr_url}
                          alt="Código QR de Nequi para pagar"
                          className="w-52 h-52 object-contain bg-white rounded-lg p-2 border"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleDownloadQr}
                          className="mt-2 text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                        >
                          <Download className="h-4 w-4 mr-1.5" />
                          Descargar QR
                        </Button>
                      </div>
                    )}

                    {storeNequiNumber && (
                      <div className="flex items-center justify-between bg-white px-4 py-3 rounded-lg">
                        <div className="text-left">
                          <p className="text-xs text-purple-700">Número Nequi</p>
                          <p className="text-xl font-bold text-purple-700">
                            {storeNequiNumber}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(storeNequiNumber);
                            toast.success("Número copiado");
                          }}
                          className="text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                        >
                          Copiar
                        </Button>
                      </div>
                    )}

                    <p className="text-sm text-purple-700 mt-3 text-center">
                      Monto a pagar:{" "}
                      <strong>{formatCurrency(orderTotal)}</strong>
                    </p>
                  </div>
                )}

                {/* Referencia del pago: sin ella el tendero no puede verificar
                    ni confirmar el pedido */}
                {(!referenceSent || editingReference) && (
                  <form
                    onSubmit={handleSubmitReference}
                    className="p-5 border-2 rounded-lg text-left"
                    style={{ borderColor: primaryColor }}
                  >
                    <Label
                      htmlFor="payment-reference"
                      className="text-base font-semibold"
                    >
                      Código de referencia de tu pago en Nequi *
                    </Label>
                    <p className="text-sm text-gray-600 mt-1 mb-3">
                      Después de pagar, Nequi te muestra un comprobante con una
                      referencia (por ejemplo M1234567). Escríbela aquí para que
                      el tendero pueda verificar tu pago.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        id="payment-reference"
                        value={referenceInput}
                        onChange={(e) => setReferenceInput(e.target.value)}
                        placeholder="Ej: M1234567"
                        autoComplete="off"
                        autoCapitalize="characters"
                        maxLength={40}
                        className="font-mono uppercase"
                      />
                      <Button
                        type="submit"
                        disabled={submittingReference || !referenceInput.trim()}
                        className="text-white sm:w-auto"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {submittingReference ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                        )}
                        {editingReference ? "Corregir referencia" : "Enviar referencia"}
                      </Button>
                    </div>
                  </form>
                )}

                {referenceSent && !editingReference && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-gray-600"
                    onClick={() => setEditingReference(true)}
                  >
                    ¿Te equivocaste de referencia? Corregirla
                  </Button>
                )}

                <div className="grid grid-cols-1 gap-3">
                  {/* Sin "Descargar PDF": antes de que el tendero confirme el pago,
                      un documento descargable parecía una factura válida. La
                      factura (con sello PAGADA) le llega al cliente al confirmar. */}
                  {/* Aviso opcional por WhatsApp, ya con la referencia registrada */}
                  {storeWhatsApp && referenceSent && (
                    <Button
                      type="button"
                      size="lg"
                      className="w-full text-lg text-white"
                      style={{ backgroundColor: "#25D366" }}
                      onClick={sendOrderByWhatsApp}
                    >
                      <MessageSquare className="h-5 w-5 mr-2" />
                      Enviar comprobante por WhatsApp
                    </Button>
                  )}

                  {/* Botón volver a la tienda: con la referencia ya enviada el
                      pedido deja de estar pendiente de acción del cliente */}
                  <Link href={`/store/${slug}`}>
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full"
                      onClick={() => {
                        if (referenceSent) clearPendingOrder(slug);
                      }}
                    >
                      Volver a la tienda
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="mt-8 p-4 bg-gray-50 rounded-lg text-left text-sm text-black">
                <p className="font-semibold mb-2">¿Cómo completo mi pedido?</p>
                <ul className="space-y-1 list-decimal list-inside">
                  <li>
                    Paga el total exacto escaneando el código QR de Nequi con tu
                    celular.
                  </li>
                  <li>
                    Escribe arriba el código de referencia que te muestra el
                    comprobante de Nequi.
                  </li>
                  <li>
                    El tendero verifica tu pago en su Nequi y confirma tu
                    pedido. Ahí se genera tu factura con el sello PAGADA y, si dejaste tu correo, te llega por email.
                  </li>
                  <li>
                    {deliveryMethod === "pickup"
                      ? "Recoge tu pedido en la tienda una vez confirmado el pago."
                      : "El domicilio ya está incluido en el total. Una vez confirmado el pago coordinamos la entrega."}
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Formulario de checkout
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header contextual: debajo del navbar del layout (h-16), no encima */}
      <header
        className="sticky top-16 z-40 bg-white shadow-md"
        style={{ borderBottom: `4px solid ${primaryColor}` }}
      >
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href={`/store/${slug}/cart`}>
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-5 w-5 text-black" />
                <p className="text-black">Volver al carrito</p>
              </Button>
            </Link>

            <h1 className="text-xl text-black font-bold">Finalizar Pedido</h1>

            <div className="w-32"></div>
          </div>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Formulario */}
            <div className="lg:col-span-2 space-y-6">
              {/* Datos del cliente */}
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <User className="h-5 w-5" style={{ color: primaryColor }} />
                    Tus Datos
                  </h2>

                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">Nombre completo *</Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder="Ej: Nicola Tesla"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="phone">Teléfono *</Label>
                      <Input
                        id="phone"
                        type="tel"
                        inputMode="numeric"
                        placeholder="Ej: 3001234567"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="email">Email (opcional)</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="Ej: correo@ejemplo.com"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-gray-600">
                        Ahí te llega tu factura cuando la tienda confirme el pago.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Método de entrega */}
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Truck
                      className="h-5 w-5"
                      style={{ color: primaryColor }}
                    />
                    Método de Entrega
                  </h2>

                  <RadioGroup
                    value={deliveryMethod}
                    onValueChange={(value) =>
                      setDeliveryMethod(value as "pickup" | "shipping")
                    }
                  >
                    {deliveryOptions.pickup && (
                    <div className="flex items-center space-x-3 p-4 border rounded-lg">
                      <RadioGroupItem value="pickup" id="pickup" />
                      <Label htmlFor="pickup" className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <Store className="h-5 w-5" />
                          <div>
                            <p className="font-semibold">Recogida en tienda</p>
                            <p className="text-sm text-black">
                              Recoge tu pedido en la tienda
                            </p>
                            {config.store_address && (
                              <p className="text-xs text-black mt-1">
                                {config.store_address}
                              </p>
                            )}
                          </div>
                        </div>
                      </Label>
                    </div>
                    )}

                    {deliveryOptions.shipping && (
                    <div className="flex items-center space-x-3 p-4 border rounded-lg">
                      <RadioGroupItem value="shipping" id="shipping" />
                      <Label
                        htmlFor="shipping"
                        className="flex-1 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Truck className="h-5 w-5" />
                          <div>
                            <p className="font-semibold">Envío a domicilio</p>
                            <p className="text-sm text-black">
                              Te lo enviamos a tu dirección (costo adicional)
                            </p>
                          </div>
                        </div>
                      </Label>
                    </div>
                    )}
                  </RadioGroup>

                  {deliveryMethod === "shipping" && (
                    <div className="mt-4 space-y-4">
                      <div>
                        <Label htmlFor="address">Dirección de entrega *</Label>
                        <Textarea
                          id="address"
                          placeholder="Ej: Calle 123 #45-67, Barrio Centro, Apartamento 301"
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          required={deliveryMethod === "shipping"}
                          rows={3}
                        />
                        <p className="text-xs text-black mt-1">
                          Incluye todos los detalles necesarios para la entrega
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="shipping-zone">Zona de envío *</Label>
                        {shippingZones.length > 0 ? (
                          <Select
                            value={selectedZoneId}
                            onValueChange={setSelectedZoneId}
                          >
                            <SelectTrigger className="bg-white text-black">
                              <SelectValue placeholder="Selecciona tu zona" />
                            </SelectTrigger>
                            <SelectContent className="bg-white text-black">
                              {shippingZones.map((zone) => (
                                <SelectItem
                                  key={zone.id}
                                  value={zone.id}
                                  className="bg-white cursor-pointer text-black"
                                >
                                  {zone.zone_name} -{" "}
                                  {formatCurrency(zone.shipping_cost)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-sm text-yellow-800">
                              No hay zonas de envío configuradas. Contacta a la
                              tienda por WhatsApp.
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-black mt-1">
                          El costo de envío se agregará al total de tu pedido
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notas adicionales */}
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <MessageSquare
                      className="h-5 w-5"
                      style={{ color: primaryColor }}
                    />
                    Notas Adicionales
                  </h2>

                  <Textarea
                    placeholder="¿Alguna indicación especial para tu pedido?"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Resumen del pedido */}
            <div className="lg:col-span-1">
              <Card className="sticky top-24">
                <CardContent className="pt-6">
                  <h2 className="text-xl font-bold mb-4">Resumen del Pedido</h2>

                  {/* Productos */}
                  <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                    {cart.map((item) => {
                      const hasOffer = Boolean(
                        item.discount_percentage &&
                        item.discount_percentage > 0
                      );
                      const finalPrice = hasOffer
                        ? calculateDiscountedPrice(
                            item.price,
                            item.discount_percentage!
                          )
                        : item.price;

                      return (
                        <div
                          key={item.id}
                          className="flex justify-between text-sm"
                        >
                          <div className="flex-1">
                            <p className="font-medium">{item.name}</p>
                            <p className="text-black">
                              {item.quantity} x {formatCurrency(finalPrice)}
                              {hasOffer && (
                                <span className="ml-2 text-xs italic line-through text-gray-400">
                                  {formatCurrency(item.price)}
                                </span>
                              )}
                            </p>
                            {hasOffer && (
                              <span
                                className="text-xs font-bold"
                                style={{ color: secondaryColor }}
                              >
                                {item.discount_percentage}% OFF
                              </span>
                            )}
                          </div>
                          <p className="font-semibold">
                            {formatCurrency(calculateItemTotal(item))}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    {totalDiscount > 0 ? (
                      <>
                        <div className="flex justify-between text-black">
                          <span>Subtotal:</span>
                          <span>{formatCurrency(subtotalOriginal)}</span>
                        </div>
                        {totalDiscount > 0 && (
                          <div
                            className="flex justify-between font-semibold"
                            style={{ color: secondaryColor }}
                          >
                            <span>Descuentos:</span>
                            <span>-{formatCurrency(totalDiscount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-black font-medium">
                          <span>Subtotal con descuentos:</span>
                          <span>{formatCurrency(subtotal)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-black">
                        <span>Subtotal:</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                    )}

                    {shippingAmount > 0 && (
                      <div className="flex justify-between text-black">
                        <span>Envío:</span>
                        <span>{formatCurrency(shippingAmount)}</span>
                      </div>
                    )}

                    <div className="border-t pt-2">
                      <div className="flex justify-between text-xl font-bold">
                        <span>Total:</span>
                        <span style={{ color: primaryColor }}>
                          {formatCurrency(total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {config.store_min_order && config.store_min_order > 0 && (
                    <div className="mt-4 p-3 bg-brand-light/50 rounded-lg">
                      <p className="text-sm text-black">
                        Pedido mínimo: {formatCurrency(config.store_min_order)}
                      </p>
                      {subtotal < config.store_min_order && (
                        <p className="text-sm font-semibold text-orange-600 mt-1">
                          Faltan{" "}
                          {formatCurrency(config.store_min_order - subtotal)}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-black text-center mt-4">
                    Al confirmar, se creará tu pedido y podrás pagar con Nequi y
                    enviar tu comprobante por WhatsApp
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Barra fija inferior con el botón de confirmar. Queda deshabilitado
            (gris) mientras falten datos y se habilita (azul) al completarlos.
            El padding inferior del contenido evita que la barra tape el resumen. */}
        <div className="h-24" aria-hidden="true" />
        <div className="fixed bottom-0 inset-x-0 z-50 bg-white border-t shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <Button
              type="submit"
              size="lg"
              className="w-full text-lg transition-colors disabled:opacity-100 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              style={
                isFormValid && !submitting
                  ? { backgroundColor: primaryColor }
                  : undefined
              }
              disabled={submitting || !isFormValid}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <ShoppingCart className="h-5 w-5 mr-2" />
                  {isFormValid ? "Confirmar Pedido" : "Completa tus datos"}
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
