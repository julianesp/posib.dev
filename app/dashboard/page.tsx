"use client";

import { useState, useEffect } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  ShoppingCart,
  Package,
  TrendingUp,
  Users,
  AlertTriangle,
  Store,
  Activity,
  Crown,
  Calendar,
  Database,
  Plus,
  HandCoins,
  ArrowRight,
  PiggyBank,
} from "lucide-react";
import { getUserProfileByClerkId } from "@/lib/cloudflare-subscription-helpers";
import { getAllUserProfiles } from "@/lib/cloudflare-api";
import { getDebtorCustomers } from "@/lib/cloudflare-credit-helpers";
import { Customer, UserProfile } from "@/lib/types";
import { useTenant } from "@/lib/tenant-context";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  getDashboardMetrics,
  getDailyProfit,
  getTopProducts,
  getExpiringProducts,
  getExpiringProductsList,
  DashboardMetrics,
  DailyProfit,
  TopProduct,
} from "@/lib/dashboard-helpers";
import { Product } from "@/lib/cloudflare-api";
import { differenceInDays } from "date-fns";
import Link from "next/link";
import { PageGlossary } from "@/components/dashboard/page-glossary";
import { DianThresholdsCard } from "@/components/dashboard/dian-thresholds-card";
import { AutoHelpToggle } from "@/components/help/AutoHelpToggle";
import { PlanPaymentRow } from "@/components/subscription/plan-payment-row";

export default function DashboardPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { tenantReady } = useTenant();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saasMetrics, setSaasMetrics] = useState({
    totalStores: 0,
    activeStores: 0,
    trialStores: 0,
    monthlyRevenue: 0,
    newStoresToday: 0,
    conversionRate: 0,
  });
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    dailySales: 0,
    todayOrders: 0,
    totalProducts: 0,
    lowStockProducts: 0,
    activeCustomers: 0,
    monthlyGrowth: 0,
  });
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [dailyProfit, setDailyProfit] = useState<DailyProfit | null>(null);
  const [expiringProductsCount, setExpiringProductsCount] = useState(0);
  const [expiringProducts, setExpiringProducts] = useState<Product[]>([]);
  const [debtors, setDebtors] = useState<Customer[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Perfil del dueño (para la fila "Mi plan"); null si quien entra es del equipo.
  const [ownerProfile, setOwnerProfile] = useState<{ profile: UserProfile; loadedAt: number } | null>(null);

  useEffect(() => {
    async function checkUserAndFetchMetrics() {
      if (user && tenantReady) {
        setError(null);
        try {
          const profile = await getUserProfileByClerkId(getToken);
          const isSuper = profile?.is_superadmin || false;
          setIsSuperAdmin(isSuper);
          if (
            profile &&
            (profile.clerk_user_id === user.id || profile.clerk_user_id_test === user.id)
          ) {
            setOwnerProfile({ profile, loadedAt: Date.now() });
          }

          if (isSuper) {
            // Fetch SaaS metrics for super admin
            const allProfiles = await getAllUserProfiles(getToken);
            const stores = allProfiles.filter((p) => !p.is_superadmin);

            const now = new Date();
            const startOfToday = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
            );

            const totalStores = stores.length;
            const activeStores = stores.filter(
              (s) => s.subscription_status === "active",
            ).length;
            const trialStores = stores.filter(
              (s) => s.subscription_status === "trial",
            ).length;
            const monthlyRevenue = activeStores * 50000;
            const newStoresToday = stores.filter(
              (s) => new Date(s.created_at) >= startOfToday,
            ).length;
            const conversionRate =
              trialStores > 0
                ? (activeStores / (activeStores + trialStores)) * 100
                : 0;

            setSaasMetrics({
              totalStores,
              activeStores,
              trialStores,
              monthlyRevenue,
              newStoresToday,
              conversionRate,
            });
          } else {
            // Fetch store metrics for regular users.
            // Cada fuente se resuelve por separado para que un fallo aislado
            // (p. ej. deudores) no tumbe todo el dashboard.
            const [
              dashboardMetrics,
              profit,
              products,
              expiringCount,
              expiringProductsList,
              debtorCustomers,
            ] = await Promise.all([
              getDashboardMetrics(getToken),
              getDailyProfit(getToken),
              getTopProducts(4, getToken),
              getExpiringProducts(getToken),
              getExpiringProductsList(getToken),
              getDebtorCustomers(getToken).catch(() => [] as Customer[]),
            ]);

            setMetrics(dashboardMetrics);
            setDailyProfit(profit);
            setTopProducts(products);
            setExpiringProductsCount(expiringCount);
            setExpiringProducts(expiringProductsList.slice(0, 5)); // Primeros 5
            setDebtors(debtorCustomers);
          }
        } catch (err) {
          console.error("Error cargando el dashboard:", err);
          setError(
            "No pudimos cargar los datos de tu tienda. Revisa tu conexión e inténtalo de nuevo.",
          );
        } finally {
          setLoading(false);
        }
      }
    }
    checkUserAndFetchMetrics();
  }, [user, tenantReady]);

  const handleSeedProducts = async () => {
    if (
      !confirm(
        "¿Quieres crear productos de muestra para tu tienda? Esto creará aproximadamente 27 productos variados.",
      )
    ) {
      return;
    }

    try {
      setSeeding(true);
      const response = await fetch("/api/seed-products", {
        method: "POST",
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message);
        // Recargar métricas
        if (!isSuperAdmin && user) {
          const [dashboardMetrics, products, expiringCount] = await Promise.all(
            [
              getDashboardMetrics(getToken),
              getTopProducts(4, getToken),
              getExpiringProducts(getToken),
            ],
          );

          setMetrics(dashboardMetrics);
          setTopProducts(products);
          setExpiringProductsCount(expiringCount);
        }
      } else {
        toast.error(data.error || "Error al crear productos");
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("Error al crear productos de muestra");
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500" />
        <p className="text-gray-600 max-w-md">{error}</p>
        <Button onClick={() => window.location.reload()} variant="outline">
          Reintentar
        </Button>
      </div>
    );
  }

  // Super Admin Dashboard
  if (isSuperAdmin) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <div className="flex items-center gap-2 md:gap-3">
            <Crown className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                Panel de control del SaaS
              </h1>
              <p className="text-gray-500 text-sm md:text-base">
                Vista general del negocio multi-tenant
              </p>
            </div>
          </div>
        </div>

        {/* Métricas principales del SaaS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Tiendas
              </CardTitle>
              <Store className="h-4 w-4 text-brand" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {saasMetrics.totalStores}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Registradas en el sistema
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Tiendas Activas
              </CardTitle>
              <Activity className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {saasMetrics.activeStores}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Suscripciones pagando
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Ingresos Mensuales
              </CardTitle>
              <DollarSign className="h-4 w-4 text-brand" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-brand">
                {formatCurrency(saasMetrics.monthlyRevenue)}
              </div>
              <p className="text-xs text-gray-500 mt-1">Recurrentes</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                En Período de Prueba
              </CardTitle>
              <Calendar className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {saasMetrics.trialStores}
              </div>
              <p className="text-xs text-gray-500 mt-1">Potenciales clientes</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Nuevas Hoy</CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {saasMetrics.newStoresToday}
              </div>
              <p className="text-xs text-gray-500 mt-1">Registros hoy</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Tasa de Conversión
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {saasMetrics.conversionRate.toFixed(1)}%
              </div>
              <p className="text-xs text-gray-500 mt-1">Trial → Activo</p>
            </CardContent>
          </Card>
        </div>

        {/* Acceso rápido */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg">
                Accesos Rápidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Botones cuadrados: más fáciles de tocar en el celular */}
              <div className="grid grid-cols-2 gap-3">
                <a
                  href="/dashboard/superadmin"
                  className="flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl bg-brand-light/50 p-3 text-center transition-colors hover:bg-brand-light active:scale-[0.97]"
                >
                  <Store className="h-9 w-9 text-brand flex-shrink-0" />
                  <span className="text-sm font-semibold leading-tight text-gray-900">
                    Gestión de Tiendas
                  </span>
                </a>
                <a
                  href="/dashboard/admin/users"
                  className="flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl bg-purple-50 p-3 text-center transition-colors hover:bg-purple-100 active:scale-[0.97]"
                >
                  <Users className="h-9 w-9 text-purple-600 flex-shrink-0" />
                  <span className="text-sm font-semibold leading-tight text-gray-900">
                    Usuarios del Sistema
                  </span>
                </a>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg">
                Estado del Sistema
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 md:space-y-3">
                <div className="flex items-center justify-between p-2 md:p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2 md:gap-3">
                    <Activity className="h-4 w-4 md:h-5 md:w-5 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-xs md:text-sm">
                        Sistema Operativo
                      </p>
                      <p className="text-xs text-gray-500 hidden sm:block">
                        Todos los servicios funcionando
                      </p>
                    </div>
                  </div>
                </div>
                {saasMetrics.trialStores > 0 && (
                  <div className="flex items-center justify-between p-2 md:p-3 bg-yellow-50 rounded-lg">
                    <div className="flex items-center gap-2 md:gap-3">
                      <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 text-yellow-600 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-xs md:text-sm">
                          {saasMetrics.trialStores} tiendas en trial
                        </p>
                        <p className="text-xs text-gray-500 hidden sm:block">
                          Enviar seguimiento para conversión
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Sin título: el menú lateral ya indica en qué sección se está */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Avisos de primera vez de la guía de uso (misma preferencia que en la guía) */}
        <AutoHelpToggle />
        {metrics.totalProducts === 0 && (
          <Button
            onClick={handleSeedProducts}
            disabled={seeding}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Database className="h-4 w-4" />
            {seeding ? "Creando..." : "Crear Productos Demo"}
          </Button>
        )}
      </div>

      {/* Accesos rápidos — acciones que el tendero hace a diario */}
      <div data-guide="dash-shortcuts" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/dashboard/pos" className="group">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-brand text-white shadow-sm hover:bg-brand-hover transition-colors h-full">
            <ShoppingCart className="h-6 w-6 flex-shrink-0" />
            <span className="font-semibold text-sm md:text-base">
              Nueva venta
            </span>
          </div>
        </Link>
        <Link href="/dashboard/products" className="group">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-white border-2 border-gray-200 hover:border-brand transition-colors h-full">
            <Plus className="h-6 w-6 flex-shrink-0 text-brand" />
            <span className="font-semibold text-sm md:text-base text-gray-800">
              Agregar producto
            </span>
          </div>
        </Link>
        <Link href="/dashboard/debtors" className="group">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-white border-2 border-gray-200 hover:border-brand transition-colors h-full">
            <HandCoins className="h-6 w-6 flex-shrink-0 text-brand" />
            <span className="font-semibold text-sm md:text-base text-gray-800">
              Cobrar fiado
            </span>
          </div>
        </Link>
        <Link href="/dashboard/sales" className="group">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-white border-2 border-gray-200 hover:border-brand transition-colors h-full">
            <Activity className="h-6 w-6 flex-shrink-0 text-brand" />
            <span className="font-semibold text-sm md:text-base text-gray-800">
              Ver ventas
            </span>
          </div>
        </Link>
      </div>

      {/* Hasta cuándo está pagado el plan, con acceso directo al pago (solo el dueño) */}
      {ownerProfile && (
        <PlanPaymentRow profile={ownerProfile.profile} now={ownerProfile.loadedAt} />
      )}

      {/* Ventas del año frente al tope de facturación electrónica de la DIAN */}
      <DianThresholdsCard />

      {/* Ganancia de hoy — cuánto ganó realmente el tendero (venta − costo) */}
      <Link href="/dashboard/rentabilidad" data-guide="dash-profit" className="block group">
        <Card className="border-2 border-brand/25 bg-brand-light hover:border-brand/50 hover:shadow-md transition-all">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-brand rounded-xl flex-shrink-0">
                  <PiggyBank className="h-7 w-7 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-brand">
                    Ganancia de hoy
                  </p>
                  <p
                    className={`font-num text-3xl md:text-4xl font-bold ${
                      (dailyProfit?.profit ?? 0) >= 0
                        ? "text-brand"
                        : "text-red-600"
                    }`}
                  >
                    {formatCurrency(dailyProfit?.profit ?? 0)}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Vendiste {formatCurrency(dailyProfit?.revenue ?? 0)} y te
                    costó {formatCurrency(dailyProfit?.cost ?? 0)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-sm font-medium text-brand sm:self-center">
                Ver detalle
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
            {dailyProfit?.hasMissingCost && (
              <div className="mt-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>
                  Algunos productos vendidos hoy no tienen precio de costo
                  registrado, así que la ganancia real podría ser menor. Agrega
                  el costo a esos productos para verla exacta.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </Link>

      {/* Métricas principales: cada tarjeta lleva a su detalle */}
      {/* Una sola hoja tipo "cuadre de caja": celdas separadas por filetes, no seis tarjetas sueltas. */}
      <div data-guide="dash-stats" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[var(--shell-line)] bg-[var(--shell-line)] shadow-[var(--shell-shadow)]">
        <Link href="/dashboard/sales?filter=today" title="Ver las ventas de hoy" className="group block">
          <Card className="h-full rounded-none border-0 shadow-none transition-colors group-hover:bg-gray-50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Ventas de Hoy</CardTitle>
              <DollarSign className="h-4 w-4 text-gray-400 transition-colors group-hover:text-brand" />
            </CardHeader>
            <CardContent>
              <div className="font-num text-3xl font-semibold">
                {new Intl.NumberFormat("es-CO", {
                  style: "currency",
                  currency: "COP",
                  minimumFractionDigits: 0,
                }).format(metrics.dailySales)}
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">
                {metrics.dailySales > 0 ? "Ventas del día" : "Sin ventas hoy"}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales?filter=today" title="Ver las ventas de hoy" className="group block">
          <Card className="h-full rounded-none border-0 shadow-none transition-colors group-hover:bg-gray-50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Órdenes Hoy</CardTitle>
              <ShoppingCart className="h-4 w-4 text-gray-400 transition-colors group-hover:text-brand" />
            </CardHeader>
            <CardContent>
              <div className="font-num text-3xl font-semibold">{metrics.todayOrders}</div>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">
                {metrics.todayOrders > 0
                  ? "Órdenes completadas"
                  : "Sin órdenes hoy"}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory" title="Ver el inventario" className="group block">
          <Card className="h-full rounded-none border-0 shadow-none transition-colors group-hover:bg-gray-50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Total Productos
              </CardTitle>
              <Package className="h-4 w-4 text-gray-400 transition-colors group-hover:text-brand" />
            </CardHeader>
            <CardContent>
              <div className="font-num text-3xl font-semibold">{metrics.totalProducts}</div>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">
                {metrics.lowStockProducts > 0
                  ? `${metrics.lowStockProducts} con cantidad baja`
                  : "Inventario saludable"}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/inventory?lowStock=true" title="Ver los productos con cantidad baja" className="group block">
          <Card className="h-full rounded-none border-0 shadow-none transition-colors group-hover:bg-gray-50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Cantidad Baja</CardTitle>
              <AlertTriangle className="h-4 w-4 text-gray-400 transition-colors group-hover:text-brand" />
            </CardHeader>
            <CardContent>
              <div className="font-num text-3xl font-semibold">{metrics.lowStockProducts}</div>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">Requieren reposición  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/customers" title="Ver los clientes" className="group block">
          <Card className="h-full rounded-none border-0 shadow-none transition-colors group-hover:bg-gray-50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Clientes Activos
              </CardTitle>
              <Users className="h-4 w-4 text-gray-400 transition-colors group-hover:text-brand" />
            </CardHeader>
            <CardContent>
              <div className="font-num text-3xl font-semibold">{metrics.activeCustomers}</div>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">Este mes  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales?filter=month" title="Ver las ventas de este mes" className="group block">
          <Card className="h-full rounded-none border-0 shadow-none transition-colors group-hover:bg-gray-50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Crecimiento Mensual
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-gray-400 transition-colors group-hover:text-brand" />
            </CardHeader>
            <CardContent>
              <div
                className={`font-num text-3xl font-semibold ${metrics.monthlyGrowth >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {metrics.monthlyGrowth >= 0 ? "+" : ""}
                {metrics.monthlyGrowth}%
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">
                Comparado al mes pasado
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Fiado / Deudores — dolor #1 de la tienda de barrio */}
      {debtors.length > 0 && (
        <Card className="border-2 border-amber-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <HandCoins className="h-5 w-5 text-amber-700" />
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg">
                    Te deben{" "}
                    {formatCurrency(
                      debtors.reduce((sum, c) => sum + (c.current_debt || 0), 0),
                    )}
                  </CardTitle>
                  <p className="text-xs md:text-sm text-gray-500">
                    {debtors.length}{" "}
                    {debtors.length === 1
                      ? "cliente con fiado"
                      : "clientes con fiado"}
                  </p>
                </div>
              </div>
              <Link href="/dashboard/debtors">
                <Button variant="outline" size="sm" className="gap-1">
                  Ver todos
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {debtors.slice(0, 3).map((customer) => (
                <Link
                  key={customer.id}
                  href={`/dashboard/customers/${customer.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-amber-50/60 hover:bg-amber-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Users className="h-4 w-4 text-amber-700 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {customer.name}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-amber-800 flex-shrink-0">
                    {formatCurrency(customer.current_debt || 0)}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Productos Próximos a Vencer - Alerta Destacada */}
      {expiringProducts.length > 0 && (
        <Card className="border-2 border-red-300 bg-gradient-to-r from-red-50 via-orange-50 to-yellow-50 shadow-lg">
          <CardHeader className="pb-3 bg-gradient-to-r from-red-100 to-orange-100 border-b-2 border-red-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-600 rounded-lg animate-pulse">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg md:text-xl font-bold text-red-900">
                    ⚠️ Productos Próximos a Vencer
                  </CardTitle>
                  <p className="text-sm text-red-700 mt-1">
                    {expiringProducts.length} productos vencen en los próximos
                    30 días
                  </p>
                </div>
              </div>
              <Link href="/dashboard/offers">
                <Button
                  variant="destructive"
                  size="sm"
                  className="hidden md:flex"
                >
                  Ver Ofertas
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {expiringProducts.map((product) => {
                const daysToExpire = differenceInDays(
                  new Date(product.expiration_date!),
                  new Date(),
                );

                // Determinar color según días restantes
                let bgColor = "bg-yellow-50 border-yellow-300";
                let textColor = "text-yellow-900";
                let badgeColor = "bg-yellow-600";

                if (daysToExpire <= 7) {
                  bgColor = "bg-red-50 border-red-300";
                  textColor = "text-red-900";
                  badgeColor = "bg-red-600";
                } else if (daysToExpire <= 15) {
                  bgColor = "bg-orange-50 border-orange-300";
                  textColor = "text-orange-900";
                  badgeColor = "bg-orange-600";
                }

                return (
                  <div
                    key={product.id}
                    className={`flex flex-col md:flex-row md:items-center justify-between p-4 border-2 rounded-lg ${bgColor} hover:shadow-md transition-all`}
                  >
                    <div className="flex-1 mb-2 md:mb-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-bold ${textColor}`}>
                          {product.name}
                        </h3>
                        <span
                          className={`px-2 py-1 ${badgeColor} text-white text-xs font-bold rounded-full`}
                        >
                          {daysToExpire} {daysToExpire === 1 ? "día" : "días"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-gray-700">
                        <span>
                          📦 Stock: <strong>{product.stock}</strong> unidades
                        </span>
                        <span>
                          💰 Precio:{" "}
                          <strong>{formatCurrency(product.sale_price)}</strong>
                        </span>
                        <span>
                          📅 Vence:{" "}
                          <strong>
                            {new Date(
                              product.expiration_date!,
                            ).toLocaleDateString("es-CO")}
                          </strong>
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 md:ml-4">
                      <Link href="/dashboard/offers">
                        <Button size="sm" variant="outline" className="text-xs">
                          Crear Oferta
                        </Button>
                      </Link>
                      <Link href={`/dashboard/products/${product.id}`}>
                        <Button size="sm" variant="default" className="text-xs">
                          Ver Producto
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {expiringProductsCount > 5 && (
              <div className="mt-4 text-center">
                <Link href="/dashboard/offers">
                  <Button variant="destructive" className="w-full md:w-auto">
                    Ver todos los {expiringProductsCount} productos próximos a
                    vencer →
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Alertas y acciones rápidas */}
      <div data-guide="dash-alerts" className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base md:text-lg">
              Alertas de Inventario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 md:space-y-3">
              {metrics.lowStockProducts > 0 ? (
                <div className="flex items-center justify-between p-2 md:p-3 bg-orange-50 border-2 border-orange-200 rounded-lg">
                  <div className="flex items-center gap-2 md:gap-3">
                    <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 text-orange-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-xs md:text-sm">
                        {metrics.lowStockProducts} productos con cantidad baja
                      </p>
                      <p className="text-xs text-gray-500 hidden sm:block">
                        Revisar inventario
                      </p>
                    </div>
                  </div>
                  <Link href="/dashboard/inventory?lowStock=true">
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white hover:bg-orange-100 border-orange-300 text-orange-700 font-semibold"
                    >
                      VER PRODUCTOS
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex items-center justify-between p-2 md:p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2 md:gap-3">
                    <Package className="h-4 w-4 md:h-5 md:w-5 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-xs md:text-sm">
                        Inventario saludable
                      </p>
                      <p className="text-xs text-gray-500 hidden sm:block">
                        Sin alertas de cantidad
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {expiringProductsCount > 0 ? (
                <div className="flex items-center justify-between p-2 md:p-3 bg-red-50 border-2 border-red-200 rounded-lg">
                  <div className="flex items-center gap-2 md:gap-3">
                    <Package className="h-4 w-4 md:h-5 md:w-5 text-red-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-xs md:text-sm">
                        {expiringProductsCount} productos próximos a vencer
                      </p>
                      <p className="text-xs text-gray-500 hidden sm:block">
                        Crear ofertas
                      </p>
                    </div>
                  </div>
                  <Link href="/dashboard/offers">
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white hover:bg-red-100 border-red-300 text-red-700 font-semibold"
                    >
                      CREAR OFERTAS
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex items-center justify-between p-2 md:p-3 bg-brand-light/50 rounded-lg">
                  <div className="flex items-center gap-2 md:gap-3">
                    <Package className="h-4 w-4 md:h-5 md:w-5 text-brand flex-shrink-0" />
                    <div>
                      <p className="font-medium text-xs md:text-sm">
                        Sin productos próximos a vencer
                      </p>
                      <p className="text-xs text-gray-500 hidden sm:block">
                        Inventario fresco
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base md:text-lg">
              Productos Más Vendidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 md:space-y-3">
              {topProducts.length > 0 ? (
                topProducts.map((product) => (
                  <div
                    key={product.name}
                    className="flex items-center justify-between"
                  >
                    <span className="text-xs md:text-sm truncate mr-2">
                      {product.name}
                    </span>
                    <span className="text-xs md:text-sm font-medium text-gray-500 flex-shrink-0">
                      {product.quantity} und
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs md:text-sm text-gray-500">
                    No hay ventas registradas
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Los productos más vendidos aparecerán aquí
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Explicación en palabras sencillas de los datos de esta página */}
      <PageGlossary
        storageKey="dashboard"
        items={[
          {
            term: "Ganancia de hoy",
            meaning:
              "Lo vendido hoy menos lo que te costó. Es lo que de verdad ganaste.",
          },
          {
            term: "Ventas de hoy",
            meaning: "Toda la plata vendida hoy, sin restar costos.",
          },
          {
            term: "Órdenes hoy",
            meaning: "Cuántas ventas hiciste hoy.",
          },
          {
            term: "Clientes activos",
            meaning: "Clientes registrados que compraron este mes.",
          },
          {
            term: "Crecimiento mensual",
            meaning:
              "Este mes contra todo el mes pasado. Al inicio del mes suele salir negativo.",
          },
        ]}
      />
    </div>
  );
}

/**
 * Esqueleto de carga del dashboard: imita el layout real (header, accesos
 * rápidos y grid de métricas) para que la transición no "salte" ni se sienta
 * como una pantalla congelada.
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-48 bg-gray-200 rounded" />
        <div className="h-4 w-64 bg-gray-100 rounded" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 bg-gray-100 rounded-xl border" />
        ))}
      </div>
    </div>
  );
}
