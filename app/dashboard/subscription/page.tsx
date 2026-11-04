"use client";

import { useState, useEffect, useRef } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import {
  Check,
  Loader2,
  CreditCard,
  Sparkles,
  Mail,
  Store,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  getUserProfile,
  getBusinessTypePrices,
  updateUserProfile,
} from "@/lib/cloudflare-api";
import { UserProfile } from "@/lib/types";
import { useTenant } from "@/lib/tenant-context";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { BUSINESS_TYPES, getBusinessType } from "@/lib/business-types";

interface EpaycoWindow {
  ePayco?: {
    checkout: {
      configure: (options: { sessionId: string }) => { open: () => void };
    };
  };
}
import Link from "next/link";
import Image from "next/image";

// Funcionalidades incluidas en todos los planes (todo incluido, un solo precio).
const PLAN_FEATURES = [
  "Gestión completa de inventario",
  "Punto de venta (POS)",
  "Gestión de clientes y proveedores",
  "Reportes y estadísticas básicas",
  "Sistema de créditos y deudores",
  "Ofertas y promociones",
  "Soporte técnico por email",
  "Actualizaciones automáticas",
];

// Addons disponibles
const ADDONS = [
  {
    id: "ai-addon-monthly",
    type: "ai" as const,
    name: "Análisis con IA",
    icon: Sparkles,
    price: 5000,
    color: "purple",
    features: [
      "Predicciones de ventas automáticas",
      "Análisis de tendencias y patrones",
      "Recomendaciones de inventario inteligentes",
      "Insights y alertas automáticas",
      "Detección de anomalías en ventas",
    ],
  },
  {
    id: "email-addon-monthly",
    type: "email" as const,
    name: "Email Marketing",
    icon: Mail,
    price: 5000,
    color: "green",
    features: [
      "Carritos abandonados (3 emails automáticos)",
      "Reportes diarios por email",
      "Alertas de stock para clientes",
      "Campañas personalizadas",
      "Segmentación de clientes",
      "Analytics de emails enviados",
    ],
  },
];

export default function SubscriptionPageWompi() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { tenantReady } = useTenant();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  // Tipo de negocio elegido para la suscripción. Por defecto el primero
  // (abarrotes); si el perfil ya tiene uno, se preselecciona al cargar.
  const [selectedBusinessType, setSelectedBusinessType] = useState(
    BUSINESS_TYPES[0].id,
  );
  // Precios editables desde el panel superadmin. Si aún no cargaron (o el
  // tipo no tiene precio vivo), se usa el precio estático de business-types.ts.
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  // Guardando el tipo de negocio elegido como predeterminado del tenant.
  const [savingBusinessType, setSavingBusinessType] = useState(false);
  // Permite reabrir el selector de tipo de negocio aunque ya haya uno fijo.
  const [editingBusinessType, setEditingBusinessType] = useState(false);

  useEffect(() => {
    async function fetchProfile() {
      if (getToken && tenantReady) {
        try {
          const data = await getUserProfile(getToken);
          setProfile(data);
          if (data?.business_type) {
            setSelectedBusinessType(data.business_type);
          }
        } catch (error) {
          console.error("Error loading profile:", error);
        }
      }
    }
    fetchProfile();
  }, [getToken, tenantReady]);

  useEffect(() => {
    async function fetchPrices() {
      if (!getToken) return;
      try {
        const data = await getBusinessTypePrices(getToken);
        const map: Record<string, number> = {};
        (Array.isArray(data) ? data : []).forEach((p) => {
          map[p.businessType] = p.price;
        });
        setLivePrices(map);
      } catch (error) {
        console.error("Error loading live prices:", error);
      }
    }
    fetchPrices();
  }, [getToken]);

  const getPrice = (businessTypeId?: string | null) => {
    const resolvedType = getBusinessType(businessTypeId);
    return livePrices[resolvedType.id] ?? resolvedType.price;
  };

  const handleSubscribe = async (itemId: string) => {
    if (!user) return;

    try {
      setLoading(true);
      setSelectedItem(itemId);

      const token = await getToken();
      const response = await fetch('/api/subscription/create-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          planId: itemId,
          tenantId: localStorage.getItem('selected_tenant_id'),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.sessionId) {
        toast.error(data.error || 'Error al crear el pago. Intenta de nuevo.');
        return;
      }

      // Abrir ePayco Smart Checkout
      const epaycoWindow = window as unknown as EpaycoWindow;
      if (typeof window !== 'undefined' && epaycoWindow.ePayco) {
        epaycoWindow.ePayco.checkout.configure({ sessionId: data.sessionId }).open();
      } else {
        toast.error('No se pudo cargar la pasarela de pago. Recarga la página e intenta de nuevo.');
      }
    } catch (error) {
      console.error('Error creating payment:', error);
      toast.error('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setLoading(false);
      setSelectedItem(null);
    }
  };

  // Fija el tipo de negocio elegido como el predeterminado del tenant. Una vez
  // guardado, la página oculta los demás tipos y muestra solo su plan.
  const handleSaveBusinessType = async () => {
    if (!profile?.id) return;
    try {
      setSavingBusinessType(true);
      await updateUserProfile(
        profile.id,
        { business_type: selectedBusinessType },
        getToken,
      );
      const updatedProfile = { ...profile, business_type: selectedBusinessType };
      setProfile(updatedProfile);
      // Actualizar el caché del sidebar para que el menú se adapte sin recargar.
      // Se usa StorageEvent manual porque storage nativo no se dispara en la misma pestaña.
      try {
        const cached = localStorage.getItem("posib-profile-cache");
        const updated = cached
          ? JSON.stringify({ ...JSON.parse(cached), business_type: selectedBusinessType })
          : JSON.stringify({ business_type: selectedBusinessType });
        localStorage.setItem("posib-profile-cache", updated);
        window.dispatchEvent(
          new StorageEvent("storage", { key: "posib-profile-cache", newValue: updated }),
        );
      } catch { /* caché no crítico */ }
      setEditingBusinessType(false);
      toast.success("Tipo de negocio guardado. El sistema se adaptará a él.");
    } catch (error) {
      console.error("Error saving business type:", error);
      toast.error("No se pudo guardar el tipo de negocio. Intenta de nuevo.");
    } finally {
      setSavingBusinessType(false);
    }
  };

  const getDaysLeft = () => {
    if (!profile?.trial_end_date) return 0;
    const endDate = new Date(profile.trial_end_date);
    const today = new Date();
    const diffTime = endDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const getSubscriptionStatus = () => {
    if (!profile) return null;

    const daysLeft = getDaysLeft();
    const status = profile.subscription_status;

    return {
      status,
      daysLeft,
      nextBillingDate: profile.next_billing_date,
    };
  };

  const subscriptionStatus = getSubscriptionStatus();

  // El usuario ya tiene una suscripción activa (ya pagó y está al día).
  // En ese caso NO debemos mostrar banners de "prueba gratis" ni presionar
  // para pagar de nuevo: solo confirmar que está al día.
  const hasActiveSubscription = subscriptionStatus?.status === "active";

  // Ventana de renovación anticipada. El backend suma el mes al final del período
  // vigente (apply-payment), así que pagar unos días antes no pierde ningún día.
  const RENEWAL_WINDOW_DAYS = 7;
  const now = new Date();
  const daysUntil = (iso?: string | null) =>
    iso ? Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000) : null;
  const planDaysLeft = daysUntil(profile?.next_billing_date);
  const planCanRenew =
    hasActiveSubscription && planDaysLeft !== null && planDaysLeft <= RENEWAL_WINDOW_DAYS;
  // Acceso directo al pago (?pagar=plan): lo usan el correo de recordatorio y
  // la fila "Mi plan" del Panel de control. Abre ePayco apenas carga el perfil.
  const autoPayDone = useRef(false);
  const planPayable = !!profile && (!hasActiveSubscription || planCanRenew);
  useEffect(() => {
    if (autoPayDone.current || !profile) return;
    if (new URLSearchParams(window.location.search).get("pagar") !== "plan") return;
    // La marca y la limpieza de la URL van al disparar (no antes): en desarrollo
    // React monta el efecto dos veces y el primer intervalo se cancela.
    const finish = () => {
      autoPayDone.current = true;
      window.history.replaceState(null, "", window.location.pathname);
    };
    if (!planPayable) {
      finish();
      toast.info("Tu plan está al día. Podrás pagar el siguiente mes desde 7 días antes de que venza.");
      return;
    }
    // El script de ePayco (app/layout.tsx) puede tardar un poco en cargar.
    let tries = 0;
    const timer = window.setInterval(() => {
      const ready = !!(window as unknown as EpaycoWindow).ePayco;
      if (ready || ++tries >= 20) {
        window.clearInterval(timer);
        finish();
        handleSubscribe("plan-abarrotes-monthly");
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, planPayable]);

  const storeAddonDaysLeft = daysUntil(profile?.store_addon_expires_at);
  const storeAddonExpired =
    !!profile?.has_store_addon && storeAddonDaysLeft !== null && storeAddonDaysLeft <= 0;
  const storeAddonCanRenew =
    !!profile?.has_store_addon &&
    !storeAddonExpired &&
    hasActiveSubscription &&
    storeAddonDaysLeft !== null &&
    storeAddonDaysLeft <= RENEWAL_WINDOW_DAYS;
  const formatDate = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("es-CO", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

  // El tipo de negocio queda "fijo" cuando el perfil ya tiene uno guardado y el
  // usuario no está en modo edición. En ese estado ocultamos los demás tipos.
  const businessTypeFixed = !!profile?.business_type && !editingBusinessType;

  // Formatear la próxima fecha de pago de forma legible en español
  const formattedNextBilling = profile?.next_billing_date
    ? new Date(profile.next_billing_date).toLocaleDateString("es-CO", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const getColorClasses = (color: string) => {
    const colors: Record<
      string,
      { border: string; bg: string; text: string; button: string }
    > = {
      purple: {
        border: "border-purple-200",
        bg: "bg-purple-50",
        text: "text-purple-700",
        button: "bg-purple-600 hover:bg-purple-700",
      },
      blue: {
        border: "border-brand/40",
        bg: "bg-brand-light/50",
        text: "text-brand",
        button: "bg-brand hover:bg-brand-hover",
      },
      green: {
        border: "border-green-200",
        bg: "bg-green-50",
        text: "text-green-700",
        button: "bg-green-600 hover:bg-green-700",
      },
    };
    return colors[color] || colors.purple;
  };

  // La Tienda Online es un complemento del plan base. Solo se puede comprar si la
  // suscripción está activa, o gratis durante el trial (donde ya viene incluida).
  // Si la cuenta está expirada/cancelada, el plan base no funciona (no hay POS ni
  // productos que mostrar), así que bloqueamos la compra del add-on hasta que el
  // Plan Básico esté activo. Evita que el cliente pague por algo inservible.
  const storeAddonRequiresBasePlan =
    profile != null &&
    profile.subscription_status !== "active" &&
    profile.subscription_status !== "trial";

  return (
    <div className="">
      {/* Botón de WhatsApp flotante */}
      <Link
        href="https://wa.me/573174503604?text=Hola,%20tengo%20una%20pregunta%20sobre%20los%20planes%20de%20suscripción"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-[10px] right-6 z-50 transition-transform hover:scale-110"
        aria-label="Contactar por WhatsApp"
      >
        <Image
          src="https://pub-c0883d14d3e84a69bf84546fa108aa0b.r2.dev/socialmedia/social%20(1).png"
          alt="WhatsApp"
          className="w-14 h-14 md:w-16 md:h-16 drop-shadow-lg"
          width={50}
          height={50}
        />
      </Link>

      <div className="text-center">
        <h1 className="text-3xl font-bold">
          {hasActiveSubscription ? "Tu Suscripción" : "Planes y Addons"}
        </h1>
        <p className="text-gray-500 mt-2">
          {hasActiveSubscription
            ? "Tu plan está activo. Aquí puedes ver el estado de tu suscripción y tus complementos."
            : "Elige el plan base y agrega las funcionalidades que necesites"}
        </p>
        {/* El banner de prueba gratis solo tiene sentido para quien aún no ha pagado */}
        {!hasActiveSubscription && (
          <div className="mt-4 inline-block bg-gradient-to-r from-purple-100 to-pink-100 border border-purple-300 rounded-lg px-6 py-3">
            <p className="text-sm font-medium text-purple-900">
              ✨ <strong>Prueba Gratis por 30 Días:</strong> Acceso completo a
              todos los complementos
            </p>
          </div>
        )}
      </div>

      {/* Estado actual de suscripción */}
      {subscriptionStatus && (
        <Card className="border-brand/40 bg-brand-light/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-brand">
                  Estado de tu suscripción
                </p>
                <p className="text-sm text-brand mt-1">
                  {subscriptionStatus.status === "trial" && (
                    <>
                      Período de prueba - {subscriptionStatus.daysLeft} días
                      restantes
                    </>
                  )}
                  {subscriptionStatus.status === "active" && planCanRenew && (
                    <>
                      Tu plan vence el {formattedNextBilling}. Puedes renovarlo
                      ahora abajo: el nuevo mes se suma a partir de esa fecha.
                    </>
                  )}
                  {subscriptionStatus.status === "active" && !planCanRenew && (
                    <>
                      ✅ Tu plan está al día. No necesitas hacer nada más.
                      {formattedNextBilling && (
                        <> Tu próxima renovación es el {formattedNextBilling}.</>
                      )}
                    </>
                  )}
                  {subscriptionStatus.status === "expired" && (
                    <>Suscripción expirada - Renueva tu plan</>
                  )}
                </p>
              </div>
              <div
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  subscriptionStatus.status === "active"
                    ? "bg-green-100 text-green-800"
                    : subscriptionStatus.status === "trial"
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-red-100 text-red-800"
                }`}
              >
                {subscriptionStatus.status === "trial" && "Prueba Gratuita"}
                {subscriptionStatus.status === "active" && "Activa"}
                {subscriptionStatus.status === "expired" && "Expirada"}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Método de pago aceptado */}
      <Card data-guide="sub-payments">
        <CardHeader>
          <CardTitle className="text-lg">Métodos de pago aceptados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-center justify-center">
            <div className="flex items-center gap-3 bg-brand-light/50 border border-brand/40 rounded-lg px-6 py-4">
              <CreditCard className="h-8 w-8 text-brand" />
              <div>
                <p className="font-bold text-lg text-brand">Tarjeta crédito / débito</p>
                <p className="text-sm text-brand">Visa, Mastercard, Amex</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-6 py-4">
              <CreditCard className="h-8 w-8 text-green-600" />
              <div>
                <p className="font-bold text-lg text-green-900">PSE</p>
                <p className="text-sm text-green-700">Débito desde tu banco</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg px-6 py-4">
              <CreditCard className="h-8 w-8 text-purple-600" />
              <div>
                <p className="font-bold text-lg text-purple-900">Nequi / Daviplata</p>
                <p className="text-sm text-purple-700">Billeteras digitales</p>
              </div>
            </div>
          </div>
          <div className="mt-4 bg-brand-light/50 border border-brand/40 rounded-lg p-4">
            <p className="text-sm text-brand text-center">
              {hasActiveSubscription ? (
                <>
                  🔒 <strong>Pago seguro con ePayco:</strong> Estos son los
                  métodos con los que se cobra tu renovación mensual.
                </>
              ) : (
                <>
                  🔒 <strong>Pago seguro con ePayco:</strong> Al hacer clic en un
                  plan se abrirá la pasarela de pago donde puedes elegir tu
                  método preferido.
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card id="plan-basico" data-guide="sub-plan" className="border-brand/40 border-2 scroll-mt-24">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl flex items-center gap-2">
              🛒 Plan Tienda / Minimercado
            </CardTitle>
            <div className="text-right">
              <span className="text-3xl font-bold">
                {formatCurrency(getPrice('abarrotes'))}
              </span>
              <span className="text-gray-500 text-sm ml-1">/mes</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {PLAN_FEATURES.map((feature, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{feature}</span>
              </li>
            ))}
          </ul>
          <Button
            className={`w-full ${
              hasActiveSubscription && !planCanRenew
                ? "bg-green-600 hover:bg-green-600"
                : "bg-gray-800 hover:bg-gray-900"
            }`}
            size="lg"
            onClick={() => handleSubscribe('plan-abarrotes-monthly')}
            disabled={
              (hasActiveSubscription && !planCanRenew) ||
              (loading && selectedItem === 'plan-abarrotes-monthly')
            }
          >
            {loading && selectedItem === 'plan-abarrotes-monthly' ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Creando link de pago...
              </>
            ) : planCanRenew ? (
              `Renovar plan — ${formatCurrency(getPrice('abarrotes'))}/mes`
            ) : hasActiveSubscription ? (
              <>
                <Check className="mr-2 h-5 w-5" />
                Plan Activo
              </>
            ) : (
              "Activar plan — $24.900/mes"
            )}
          </Button>
          {planCanRenew && (
            <p className="text-xs text-gray-500 text-center">
              Vence el {formattedNextBilling}. Si pagas ahora, el nuevo mes se
              suma a partir de esa fecha: no pierdes ningún día.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Funcionalidades incluidas (antes eran addons de pago) */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Funcionalidades Incluidas</h2>
        <p className="text-gray-600 mb-6">
          Estas funcionalidades ya vienen con tu Plan Básico, sin costo adicional
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {ADDONS.map((addon) => {
            const colors = getColorClasses(addon.color);
            const Icon = addon.icon;

            return (
              <Card
                key={addon.id}
                className={`relative border-2 ${colors.border}`}
              >
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-medium">
                    ✓ Incluido
                  </span>
                </div>

                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${colors.bg}`}>
                      <Icon className={`h-6 w-6 ${colors.text}`} />
                    </div>
                    <CardTitle className="text-xl">{addon.name}</CardTitle>
                  </div>
                  <div className="mt-4">
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                      <Check className="h-4 w-4" />
                      Incluido en tu plan
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {addon.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Complemento de pago: Tienda Online (único addon que se cobra aparte) */}
      <div data-guide="sub-addons" className="mt-10">
        <h2 className="text-2xl font-bold mb-4">Complemento Opcional</h2>
        <p className="text-gray-600 mb-6">
          La Tienda Online es el único complemento que se paga aparte. Actívala
          para vender en internet las 24 horas.
        </p>

        <Card className="max-w-2xl mx-auto relative border-2 border-brand/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-brand-light/50">
                <Store className="h-6 w-6 text-brand" />
              </div>
              <CardTitle className="text-xl">Tienda Online</CardTitle>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold">{formatCurrency(14900)}</span>
              <span className="text-sm text-gray-600">/mes</span>
            </div>
            <CardDescription>
              {profile?.subscription_status === "trial"
                ? "Incluida gratis durante tu prueba. Al terminar, actívala por este valor."
                : "Se suma a tu plan mensual."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {[
                "Tienda online personalizable (vende 24/7)",
                "Catálogo público con búsqueda y categorías",
                "Carrito y checkout para tus clientes",
                "Pago por Nequi (QR) con comprobante en PDF",
                "Pedidos recibidos por WhatsApp y Telegram",
                "Zonas de envío configurables",
              ].map((feature, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-brand mt-0.5 flex-shrink-0" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>

            {profile?.has_store_addon && !storeAddonExpired ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                    <Check className="h-4 w-4" />
                    Complemento activo
                  </span>
                  {profile?.store_addon_expires_at && (
                    <p className="text-xs text-gray-500">
                      Activo hasta el {formatDate(profile.store_addon_expires_at)}.
                      {storeAddonCanRenew &&
                        " Si renuevas ahora, el nuevo mes se suma a partir de esa fecha."}
                    </p>
                  )}
                </div>
                {storeAddonCanRenew && (
                  <Button
                    className="w-full"
                    onClick={() => handleSubscribe("addon-store-monthly")}
                    disabled={loading}
                  >
                    {loading && selectedItem === "addon-store-monthly" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Procesando…
                      </>
                    ) : (
                      <>
                        <Store className="mr-2 h-4 w-4" />
                        Renovar Tienda Online — {formatCurrency(14900)}/mes
                      </>
                    )}
                  </Button>
                )}
              </div>
            ) : storeAddonRequiresBasePlan ? (
              // La Tienda Online es un complemento del plan base: solo funciona si
              // la suscripción está activa (o gratis durante el trial). Si la
              // cuenta está expirada/cancelada, NO dejamos comprar el add-on solo
              // — de lo contrario el cliente paga $14.900 por algo que no puede
              // usar (fue exactamente el problema que motivó este bloqueo).
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    La Tienda Online es un complemento de tu plan. Primero activa
                    tu <strong>Plan Básico</strong> y luego podrás agregarla.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    const el = document.getElementById("plan-basico");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  Ver Plan Básico
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                onClick={() => handleSubscribe("addon-store-monthly")}
                disabled={loading}
              >
                {loading && selectedItem === "addon-store-monthly" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando…
                  </>
                ) : (
                  <>
                    <Store className="mr-2 h-4 w-4" />
                    {storeAddonExpired ? "Renovar Tienda Online" : "Activar Tienda Online"}
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Información adicional */}
      <Card className="max-w-4xl mx-auto">
        <CardContent className="pt-6">
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              ✓ <strong>Pago seguro</strong> procesado por ePayco
            </p>
            <p>
              ✓ <strong>Activación automática</strong> - Tu plan se activa inmediatamente tras confirmar el pago
            </p>
            <p>
              ✓ <strong>Todo incluido</strong> - Un solo precio con IA y Email Marketing sin costo extra
            </p>
            <p>
              ✓ <strong>Cancela cuando quieras</strong> - Sin penalizaciones ni compromisos largos
            </p>
            <p>
              ✓ <strong>Soporte técnico incluido</strong> - Escríbenos por WhatsApp
            </p>
            <p className="text-xs text-gray-500 mt-4 pt-4 border-t">
              Los pagos se procesan automáticamente a través de ePayco. El Análisis con IA y el
              Email Marketing vienen incluidos en tu Plan Básico, sin cargos adicionales.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Costo mensual: un solo precio, con todo incluido */}
      {profile && subscriptionStatus?.status === "active" && (
        <Card className="max-w-2xl mx-auto bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
          <CardHeader>
            <CardTitle className="text-center">Tu Costo Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span>
                  Plan {getBusinessType(profile.business_type).name} (todo
                  incluido)
                </span>
                <span className="font-bold">
                  {formatCurrency(getPrice(profile.business_type))}
                </span>
              </div>
              <div className="border-t pt-2 mt-2 flex justify-between items-center text-lg font-bold">
                <span>Total</span>
                <span>
                  {formatCurrency(getPrice(profile.business_type))}
                  <span className="text-sm font-normal text-gray-600">
                    /mes
                  </span>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
