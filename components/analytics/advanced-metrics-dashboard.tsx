'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  ShoppingCart,
  Package,
  AlertTriangle,
  Info,
} from 'lucide-react';
import {
  calculateAdvancedMetrics,
  calculateTemporalComparison,
  generateProactiveAlerts,
  type AdvancedMetrics,
  type TemporalComparison,
  type ProactiveAlert,
} from '@/lib/advanced-analytics-helpers';
import { formatCurrency } from "@/lib/utils";
import { BRAND, BRAND_LIGHT, BRAND_CHART_COLORS } from "@/lib/brand-chart-colors";
import { PageGlossary } from "@/components/dashboard/page-glossary";

// Tonos del color de la tienda (no colores fijos): ver lib/brand-chart-colors.ts
const COLORS = BRAND_CHART_COLORS;

// Eje de las gráficas: "$4,6 M" en vez de cortar "4614600".
const compactCOP = (value: number) =>
  `$${new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  format?: 'currency' | 'percentage' | 'number';
}

function MetricCard({ title, value, change, icon, format = 'number' }: MetricCardProps) {
  const formatValue = (val: string | number) => {
    if (typeof val === 'string') return val;

    switch (format) {
      case 'currency':
        return `$${val.toLocaleString('es-CO')}`;
      case 'percentage':
        return `${val.toFixed(2)}%`;
      default:
        return val.toLocaleString('es-CO');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatValue(value)}</div>
        {change !== undefined && (
          <p
            className={`text-xs flex items-center gap-1 mt-1 ${
              change >= 0 ? 'text-brand' : 'text-brand-hover'
            }`}
          >
            {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(change).toFixed(1)}% vs período anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdvancedMetricsDashboard() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<AdvancedMetrics | null>(null);
  const [comparison, setComparison] = useState<TemporalComparison | null>(null);
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const apiUrl = process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL!;

      // Obtener métricas del período actual
      const now = new Date();
      const start =
        period === 'week'
          ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          : period === 'month'
          ? new Date(now.getFullYear(), now.getMonth(), 1)
          : new Date(now.getFullYear(), 0, 1);

      const metricsData = await calculateAdvancedMetrics(
        apiUrl,
        token,
        start.toISOString(),
        now.toISOString()
      );
      setMetrics(metricsData);

      // Obtener comparación temporal
      const comparisonData = await calculateTemporalComparison(apiUrl, token, period);
      setComparison(comparisonData);

      // Obtener alertas proactivas
      const alertsData = await generateProactiveAlerts(apiUrl, token);
      setAlerts(alertsData);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !metrics || !comparison) {
    return <div className="flex items-center justify-center p-12">Cargando métricas...</div>;
  }

  // Datos para gráfico de margen de ganancia
  const profitData = [
    { name: 'Ingresos', value: metrics.total_revenue },
    { name: 'Costos', value: metrics.total_cost },
    { name: 'Ganancia', value: metrics.gross_profit },
  ];

  // Datos para comparación temporal
  const temporalData = [
    {
      name: 'Período Anterior',
      Ingresos: comparison.previous.revenue,
      Ganancia: comparison.previous.profit,
    },
    {
      name: 'Período Actual',
      Ingresos: comparison.current.revenue,
      Ganancia: comparison.current.profit,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Alertas Proactivas */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <Card
              key={alert.id}
              className={`border-l-4 ${
                alert.severity === 'critical'
                  ? 'border-l-brand-hover'
                  : alert.severity === 'warning'
                  ? 'border-l-brand'
                  : 'border-l-brand/40'
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {alert.severity === 'critical' ? (
                    <AlertTriangle className="h-5 w-5 text-brand-hover" />
                  ) : alert.severity === 'warning' ? (
                    <AlertTriangle className="h-5 w-5 text-brand" />
                  ) : (
                    <Info className="h-5 w-5 text-brand" />
                  )}
                  <CardTitle className="text-base">{alert.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{alert.message}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs para períodos */}
      <Tabs value={period} onValueChange={(v) => setPeriod(v as 'week' | 'month' | 'year')}>
        <TabsList>
          <TabsTrigger value="week">Última Semana</TabsTrigger>
          <TabsTrigger value="month">Este Mes</TabsTrigger>
          <TabsTrigger value="year">Este Año</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Métricas principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Margen de Ganancia"
          value={metrics.profit_margin_percentage}
          change={comparison.growth.profit_percentage}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          format="percentage"
        />
        <MetricCard
          title="ROI"
          value={metrics.roi_percentage}
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          format="percentage"
        />
        <MetricCard
          title="Compra promedio"
          value={metrics.average_order_value}
          icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
          format="currency"
        />
        <MetricCard
          title="Lo que compra cada cliente"
          value={metrics.customer_lifetime_value}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          format="currency"
        />
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Ingresos vs Costos vs Ganancia */}
        <Card>
          <CardHeader>
            <CardTitle>Análisis de Rentabilidad</CardTitle>
            <CardDescription>Desglose de ingresos, costos y ganancias</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={profitData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis width={64} tickFormatter={compactCOP} />
                <Tooltip formatter={(value) => `$${Number(value).toLocaleString('es-CO')}`} />
                <Bar dataKey="value" fill={BRAND}>
                  {profitData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Comparación Temporal */}
        <Card>
          <CardHeader>
            <CardTitle>Comparación Temporal</CardTitle>
            <CardDescription>Período actual vs anterior</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={temporalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis width={64} tickFormatter={compactCOP} />
                <Tooltip formatter={(value) => `$${Number(value).toLocaleString('es-CO')}`} />
                <Legend />
                <Line type="monotone" dataKey="Ingresos" stroke={BRAND} strokeWidth={2.5} />
                <Line type="monotone" dataKey="Ganancia" stroke={BRAND_LIGHT} strokeWidth={2.5} strokeDasharray="6 4" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Clientes: en frases sencillas, sin siglas (antes LTV / CAC) */}
      <Card>
        <CardHeader>
          <CardTitle>Tus clientes</CardTitle>
          <CardDescription>
            Solo cuenta las ventas en las que elegiste un cliente. Las ventas de mostrador sin
            cliente no entran aquí.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-num text-3xl font-bold text-gray-900">{metrics.buying_customers}</p>
              <p className="mt-1 text-sm text-gray-600">
                clientes te compraron en este período (tienes {metrics.total_customers} registrados)
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-num text-3xl font-bold text-brand">{metrics.new_customers}</p>
              <p className="mt-1 text-sm text-gray-600">
                clientes nuevos
                {comparison.growth.customers_percentage !== 0 && (
                  <>
                    {" "}({comparison.growth.customers_percentage > 0 ? "+" : ""}
                    {comparison.growth.customers_percentage.toFixed(0)} % frente al período anterior)
                  </>
                )}
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-num text-3xl font-bold text-brand">{metrics.returning_customers}</p>
              <p className="mt-1 text-sm text-gray-600">clientes que volvieron a comprar</p>
            </div>
          </div>

          {metrics.buying_customers > 0 && (
            <ul className="space-y-2 text-sm text-gray-800">
              <li>
                Cada cliente te compró en promedio{" "}
                <strong className="font-num">{formatCurrency(metrics.customer_lifetime_value)}</strong> en este período.
              </li>
              <li>
                Cada compra deja en promedio{" "}
                <strong className="font-num">{formatCurrency(metrics.average_order_value)}</strong>.
              </li>
              <li>
                {(() => {
                  const ofTen = Math.round((metrics.returning_customers / metrics.buying_customers) * 10);
                  return (
                    <>
                      <strong>{ofTen} de cada 10</strong> clientes volvieron.{" "}
                      {ofTen >= 6
                        ? "Muy bien: tu clientela es fiel."
                        : ofTen >= 3
                          ? "Vas bien. Un trato amable, los puntos y las ofertas ayudan a que vuelvan más."
                          : "Pocos vuelven. Prueba con puntos, ofertas o recordándoles por WhatsApp."}
                    </>
                  );
                })()}
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Métricas de Productos */}
      {metrics.best_profit_margin_product && (
        <Card>
          <CardHeader>
            <CardTitle>Mejor Producto por Margen</CardTitle>
            <CardDescription>Producto más rentable del período</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">{metrics.best_profit_margin_product.name}</p>
                <p className="text-sm text-muted-foreground">Producto estrella</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-brand">
                  {metrics.best_profit_margin_product.margin_percentage.toFixed(1)}%
                </p>
                <p className="text-sm text-muted-foreground">Margen de ganancia</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Explicación en palabras sencillas de los datos de esta página */}
      <PageGlossary
        storageKey="analytics-advanced"
        items={[
          {
            term: "Margen",
            meaning: "De cada $100 vendidos, cuánto es ganancia.",
          },
          {
            term: "ROI",
            meaning: "Lo que ganas por cada $100 invertidos en mercancía.",
          },
          {
            term: "Compra promedio",
            meaning: "Lo que deja, en promedio, cada venta.",
          },
          {
            term: "Lo que compra cada cliente",
            meaning: "Lo que te compró cada cliente registrado en el período, en promedio.",
          },
          {
            term: "Clientes recurrentes",
            meaning: "Los que volvieron a comprar.",
          },
        ]}
      />
    </div>
  );
}
