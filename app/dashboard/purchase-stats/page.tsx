"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Package,
  AlertTriangle,
  BarChart3,
  PieChart as PieChartIcon,
  Zap,
  Clock,
  Star,
  X,
  RefreshCw,
  Target,
} from "lucide-react";
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
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { getPurchaseOrders, getSales, getProducts, getCategories } from "@/lib/cloudflare-api";
import type { PurchaseOrderWithItems, Sale, SaleItem, SaleWithRelations, Product, Category } from "@/lib/types";

interface ProductAnalysis {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  sold: number;
  revenue: number;
  invested: number;
  profit: number;
  profitMargin: number;
  rotationDays: number;
  category: string;
  needsRestock: boolean;
  isSlowMoving: boolean;
  isFastMoving: boolean;
}

interface PurchaseStats {
  totalInvestment: number;
  totalOrders: number;
  averageOrderValue: number;
  totalProducts: number;
  monthlyInvestment: { month: string; amount: number }[];
  supplierStats: { supplier: string; total: number; orders: number }[];
  productStats: ProductAnalysis[];
  profitMargin: number;
  totalRevenue: number;
  totalProfit: number;
  averageInventoryDays: number;
  categoryPerformance: {
    category: string;
    revenue: number;
    profit: number;
    margin: number;
    products: number;
  }[];
  topPerformers: ProductAnalysis[];
  slowMovers: ProductAnalysis[];
  restockNeeded: ProductAnalysis[];
  highMarginProducts: ProductAnalysis[];
}

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
  "#82CA9D",
];

export default function PurchaseStatsPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PurchaseStats | null>(null);
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">(
    "30d",
  );
  const [activeModal, setActiveModal] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, [dateRange]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const [orders, sales, products, categories] = await Promise.all([
        getPurchaseOrders(getToken),
        getSales(getToken),
        getProducts(getToken),
        getCategories(getToken),
      ]);

      // Crear mapa de categorías ID -> Nombre
      const categoriesMap = new Map(categories.map(c => [c.id, c.name]));

      // Filter by date range
      const cutoffDate = getCutoffDate(dateRange);
      const filteredOrders = orders.filter(
        (order) => new Date(order.order_date) >= cutoffDate,
      );
      const filteredSales = sales.filter(
        (sale) => new Date(sale.created_at) >= cutoffDate,
      );

      // Calculate total investment
      const totalInvestment = filteredOrders.reduce(
        (sum, order) => sum + order.total,
        0,
      );

      // Calculate average order value
      const averageOrderValue =
        filteredOrders.length > 0 ? totalInvestment / filteredOrders.length : 0;

      // Calculate total products purchased
      const totalProducts = filteredOrders.reduce(
        (sum, order) =>
          sum +
          order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
        0,
      );

      // Monthly investment
      const monthlyData = calculateMonthlyInvestment(filteredOrders);

      // Supplier stats
      const supplierMap = new Map<
        string,
        { total: number; orders: number; name: string }
      >();
      filteredOrders.forEach((order) => {
        const existing = supplierMap.get(order.supplier_id) || {
          total: 0,
          orders: 0,
          name: order.supplier?.name || "Proveedor desconocido",
        };
        supplierMap.set(order.supplier_id, {
          total: existing.total + order.total,
          orders: existing.orders + 1,
          name: existing.name,
        });
      });

      const supplierStats = Array.from(supplierMap.values())
        .map((s) => ({ supplier: s.name, total: s.total, orders: s.orders }))
        .sort((a, b) => b.total - a.total);

      // Enhanced product analysis
      const productMap = new Map<string, ProductAnalysis>();

      // Initialize with current products
      products.forEach((product) => {
        // Obtener el nombre de la categoría del mapa, o usar "Sin categoría" si no existe
        const categoryName = product.category_id
          ? (categoriesMap.get(product.category_id) || "Sin categoría")
          : "Sin categoría";

        productMap.set(product.id, {
          id: product.id,
          name: product.name,
          stock: product.stock,
          minStock: product.min_stock || 0,
          sold: 0,
          revenue: 0,
          invested: 0,
          profit: 0,
          profitMargin: 0,
          rotationDays: 0,
          category: categoryName,
          needsRestock: product.stock <= (product.min_stock || 0),
          isSlowMoving: false,
          isFastMoving: false,
        });
      });

      // Calculate investment per product from orders
      filteredOrders.forEach((order) => {
        order.items.forEach((item) => {
          const existing = productMap.get(item.product_id);
          if (existing) {
            productMap.set(item.product_id, {
              ...existing,
              invested: existing.invested + item.subtotal,
            });
          }
        });
      });

      // Calculate sales per product
      const allSales = await Promise.all(
        filteredSales.map(async (sale) => {
          try {
            const response = await fetch(`/api/cloudflare/sales/${sale.id}`, {
              headers: { Authorization: `Bearer ${await getToken()}` },
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data.data;
          } catch {
            return null;
          }
        }),
      );

      // Process sales data
      let totalDays = 0;
      if (filteredSales.length > 0) {
        const oldestSale = new Date(
          Math.min(...filteredSales.map((s) => new Date(s.created_at).getTime()))
        );
        const newestSale = new Date(
          Math.max(...filteredSales.map((s) => new Date(s.created_at).getTime()))
        );
        totalDays = Math.max(
          1,
          Math.ceil(
            (newestSale.getTime() - oldestSale.getTime()) / (1000 * 60 * 60 * 24)
          )
        );
      }

      allSales.filter(Boolean).forEach((sale: SaleWithRelations) => {
        if (sale?.items) {
          sale.items.forEach((item: SaleItem) => {
            const existing = productMap.get(item.product_id);
            if (existing) {
              const newSold = existing.sold + item.quantity;
              const newRevenue = existing.revenue + item.subtotal;
              const profit = newRevenue - existing.invested;
              const profitMargin =
                existing.invested > 0 ? (profit / existing.invested) * 100 : 0;

              // Calculate rotation days
              const rotationDays =
                newSold > 0 && existing.stock > 0
                  ? (existing.stock / (newSold / Math.max(totalDays, 1)))
                  : 999;

              productMap.set(item.product_id, {
                ...existing,
                sold: newSold,
                revenue: newRevenue,
                profit,
                profitMargin,
                rotationDays,
                isFastMoving: rotationDays > 0 && rotationDays < 15,
                isSlowMoving: rotationDays > 60 && existing.stock > existing.minStock,
              });
            }
          });
        }
      });

      const productStats = Array.from(productMap.values())
        .filter((p) => p.sold > 0 || p.stock > 0)
        .sort((a, b) => b.profit - a.profit);

      // Category performance
      const categoryMap = new Map<
        string,
        { revenue: number; profit: number; products: number }
      >();
      productStats.forEach((p) => {
        const existing = categoryMap.get(p.category) || {
          revenue: 0,
          profit: 0,
          products: 0,
        };
        categoryMap.set(p.category, {
          revenue: existing.revenue + p.revenue,
          profit: existing.profit + p.profit,
          products: existing.products + 1,
        });
      });

      const categoryPerformance = Array.from(categoryMap.entries())
        .map(([category, data]) => ({
          category,
          revenue: data.revenue,
          profit: data.profit,
          margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
          products: data.products,
        }))
        .sort((a, b) => b.profit - a.profit);

      // Calculate averages
      const totalRevenue = productStats.reduce((sum, p) => sum + p.revenue, 0);
      const totalProfit = productStats.reduce((sum, p) => sum + p.profit, 0);
      const profitMargin =
        totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

      const validRotationDays = productStats
        .filter((p) => p.rotationDays > 0 && p.rotationDays < 999)
        .map((p) => p.rotationDays);
      const averageInventoryDays =
        validRotationDays.length > 0
          ? validRotationDays.reduce((a, b) => a + b, 0) / validRotationDays.length
          : 0;

      // Top performers and insights
      const topPerformers = productStats
        .filter((p) => p.sold > 0)
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 10);

      const slowMovers = productStats
        .filter((p) => p.isSlowMoving)
        .sort((a, b) => b.rotationDays - a.rotationDays)
        .slice(0, 10);

      const restockNeeded = productStats
        .filter((p) => p.needsRestock && p.sold > 0)
        .sort((a, b) => (a.stock / a.sold) - (b.stock / b.sold))
        .slice(0, 10);

      const highMarginProducts = productStats
        .filter((p) => p.sold > 0 && p.profitMargin > 20)
        .sort((a, b) => b.profitMargin - a.profitMargin)
        .slice(0, 10);

      setStats({
        totalInvestment,
        totalOrders: filteredOrders.length,
        averageOrderValue,
        totalProducts,
        monthlyInvestment: monthlyData,
        supplierStats: supplierStats.slice(0, 10),
        productStats: productStats.slice(0, 10),
        profitMargin,
        totalRevenue,
        totalProfit,
        averageInventoryDays,
        categoryPerformance,
        topPerformers,
        slowMovers,
        restockNeeded,
        highMarginProducts,
      });
    } catch (error) {
      console.error("Error loading stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const getCutoffDate = (range: "7d" | "30d" | "90d" | "all"): Date => {
    const now = new Date();
    switch (range) {
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case "30d":
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case "90d":
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case "all":
        return new Date(0);
    }
  };

  const calculateMonthlyInvestment = (orders: PurchaseOrderWithItems[]) => {
    const monthMap = new Map<string, number>();

    orders.forEach((order) => {
      const date = new Date(order.order_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + order.total);
    });

    return Array.from(monthMap.entries())
      .map(([key, amount]) => {
        const [year, month] = key.split("-");
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return {
          month: date.toLocaleDateString("es-CO", {
            month: "short",
            year: "numeric",
          }),
          amount,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 animate-spin text-brand mx-auto mb-4" />
          <p className="text-gray-500">Analizando tu negocio...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">No hay datos disponibles</p>
      </div>
    );
  }

  const modalContent: Record<string, { title: string; description: string }> = {
    investment: {
      title: "Inversión Total",
      description:
        "Dinero invertido en compras a proveedores. Esta es tu inversión inicial para mantener tu inventario abastecido.",
    },
    profit: {
      title: "Ganancia Total",
      description:
        "Ganancia neta después de restar la inversión. El margen muestra qué porcentaje ganas por cada peso invertido. Ideal para tiendas de barrio: 20-40%.",
    },
    rotation: {
      title: "Días de Inventario",
      description:
        "Promedio de días que tarda en venderse tu inventario. Menos días = mejor rotación y menos dinero inmovilizado. Ideal para tiendas de barrio: 15-30 días.",
    },
    products: {
      title: "Productos Comprados",
      description:
        "Total de unidades adquiridas. Te ayuda a planificar tus compras y negociar mejores precios con tus proveedores.",
    },
  };

  const HelpButton = ({ modalKey }: { modalKey: string }) => (
    <button
      onClick={() => setActiveModal(modalKey)}
      className="px-2 py-1 rounded cursor-pointer transition-all hover:scale-105 hover:shadow-lg font-semibold"
      style={{ backgroundColor: "#FFE11F", color: "#000" }}
    >
      ¿Qué es esto?
    </button>
  );

  const Modal = ({ modalKey }: { modalKey: string }) => {
    const content = modalContent[modalKey];
    if (!content) return null;

    return (
      <div
        className="fixed inset-0 modal-backdrop flex items-center justify-center z-50"
        onClick={() => setActiveModal(null)}
      >
        <div
          className="bg-white rounded-lg p-6 max-w-md mx-4 relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setActiveModal(null)}
            className="absolute top-4 right-4 text-white border rounded-3xl p-2 bg-red-600 cursor-pointer transition-transform duration-200 hover:scale-125"
          >
            <X className="h-5 w-5" />
          </button>
          <h3 className="text-xl font-bold mb-4">{content.title}</h3>
          <p className="text-gray-700 leading-relaxed">{content.description}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Análisis de Tu Tienda</h1>
          <p className="text-gray-500">
            Estadísticas pensadas para tiendas de barrio
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={dateRange === "7d" ? "default" : "outline"}
            onClick={() => setDateRange("7d")}
            size="sm"
          >
            7 días
          </Button>
          <Button
            variant={dateRange === "30d" ? "default" : "outline"}
            onClick={() => setDateRange("30d")}
            size="sm"
          >
            30 días
          </Button>
          <Button
            variant={dateRange === "90d" ? "default" : "outline"}
            onClick={() => setDateRange("90d")}
            size="sm"
          >
            90 días
          </Button>
          <Button
            variant={dateRange === "all" ? "default" : "outline"}
            onClick={() => setDateRange("all")}
            size="sm"
          >
            Todo
          </Button>
        </div>
      </div>

      {/* Modals */}
      {activeModal && <Modal modalKey={activeModal} />}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Inversión Total
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.totalInvestment)}
            </div>
            <p className="text-xs text-muted-foreground">
              En {stats.totalOrders} compras
            </p>
            <div className="mt-3 text-center">
              <HelpButton modalKey="investment" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Ganancia Total
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(stats.totalProfit)}
            </div>
            <p className="text-xs text-muted-foreground">
              Margen: {stats.profitMargin.toFixed(1)}%
            </p>
            <div className="mt-3">
              <HelpButton modalKey="profit" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Días de Inventario
            </CardTitle>
            <Clock className="h-4 w-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">
              {stats.averageInventoryDays > 0
                ? Math.round(stats.averageInventoryDays)
                : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.averageInventoryDays > 0
                ? stats.averageInventoryDays < 20
                  ? "Excelente rotación"
                  : stats.averageInventoryDays < 40
                  ? "Buena rotación"
                  : "Rotación lenta"
                : "Sin datos suficientes"}
            </p>
            <div className="mt-3">
              <HelpButton modalKey="rotation" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Productos Activos
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.productStats.length}</div>
            <p className="text-xs text-muted-foreground">
              Con ventas o stock
            </p>
            <div className="mt-3">
              <HelpButton modalKey="products" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Section - Important for small stores */}
      {stats.restockNeeded.length > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-800">
              <AlertTriangle className="h-5 w-5" />
              ⚠️ Productos que necesitas reponer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {stats.restockNeeded.slice(0, 6).map((product, index) => (
                <div
                  key={index}
                  className="bg-white p-3 rounded-lg border border-orange-200"
                >
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-semibold text-sm">{product.name}</p>
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                      ¡Urgente!
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-gray-600">
                    <p>
                      Stock actual: <span className="font-semibold text-red-600">{Math.round(product.stock)}</span>
                    </p>
                    <p>
                      Stock mínimo: <span className="font-semibold">{product.minStock}</span>
                    </p>
                    <p>
                      Vendidos: <span className="font-semibold">{Math.round(product.sold)}</span> unidades
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Performers - What sells best */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              🔥 Productos más vendidos
            </CardTitle>
            <p className="text-sm text-gray-500">
              Tus campeones de ventas - Mantenlos siempre en stock
            </p>
          </CardHeader>
          <CardContent>
            {stats.topPerformers.length > 0 ? (
              <div className="space-y-3">
                {stats.topPerformers.slice(0, 5).map((product, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gradient-to-r from-green-50 to-white border border-green-200 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-600 text-white font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{product.name}</p>
                        <p className="text-xs text-gray-600">
                          {Math.round(product.sold)} vendidos • Stock: {Math.round(product.stock)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        {formatCurrency(product.revenue)}
                      </p>
                      <p className="text-xs text-gray-500">
                        Ganancia: {formatCurrency(product.profit)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Zap className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>Comienza a vender para ver tus campeones</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              💰 Productos con mejor margen
            </CardTitle>
            <p className="text-sm text-gray-500">
              Donde ganas más - Impulsa estos productos
            </p>
          </CardHeader>
          <CardContent>
            {stats.highMarginProducts.length > 0 ? (
              <div className="space-y-3">
                {stats.highMarginProducts.slice(0, 5).map((product, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gradient-to-r from-purple-50 to-white border border-purple-200 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-600 text-white font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{product.name}</p>
                        <p className="text-xs text-gray-600">
                          Vendidos: {Math.round(product.sold)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-purple-600">
                        {product.profitMargin.toFixed(0)}% margen
                      </p>
                      <p className="text-xs text-gray-500">
                        Ganancia: {formatCurrency(product.profit)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Star className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>Necesitas ventas para ver el análisis</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Slow movers - What's not selling */}
      {stats.slowMovers.length > 0 && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-800">
              <TrendingDown className="h-5 w-5" />
              🐌 Productos de venta lenta
            </CardTitle>
            <p className="text-sm text-gray-600">
              Considera hacer ofertas o dejar de comprarlos
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Producto</th>
                    <th className="text-right py-2 px-2">Stock</th>
                    <th className="text-right py-2 px-2">Vendidos</th>
                    <th className="text-right py-2 px-2">Días para vender</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.slowMovers.slice(0, 5).map((product, index) => (
                    <tr key={index} className="border-b hover:bg-yellow-100">
                      <td className="py-2 px-2 font-medium text-sm">
                        {product.name}
                      </td>
                      <td className="py-2 px-2 text-right">{Math.round(product.stock)}</td>
                      <td className="py-2 px-2 text-right">{Math.round(product.sold)}</td>
                      <td className="py-2 px-2 text-right font-semibold text-red-600">
                        {Math.round(product.rotationDays)} días
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Performance */}
      {stats.categoryPerformance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Rendimiento por Categoría
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.categoryPerformance.map((cat, index) => (
                <div
                  key={index}
                  className="p-4 bg-gradient-to-br from-brand-light/50 to-white border border-brand/40 rounded-lg"
                >
                  <h4 className="font-bold text-lg mb-2">{cat.category}</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Ventas:</span>
                      <span className="font-semibold">{formatCurrency(cat.revenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Ganancia:</span>
                      <span className="font-semibold text-green-600">
                        {formatCurrency(cat.profit)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Margen:</span>
                      <span className="font-semibold text-brand">
                        {cat.margin.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Productos:</span>
                      <span className="font-semibold">{cat.products}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Investment Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Inversión Mensual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.monthlyInvestment.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={stats.monthlyInvestment}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelStyle={{ color: "#000" }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#0088FE"
                    name="Inversión"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                <BarChart3 className="h-16 w-16 mb-4 opacity-20" />
                <p className="text-sm font-medium">Sin inversiones aún</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supplier Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Distribución por Proveedor
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.supplierStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={stats.supplierStats}
                    dataKey="total"
                    nameKey="supplier"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    {stats.supplierStats.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                <PieChartIcon className="h-16 w-16 mb-4 opacity-20" />
                <p className="text-sm font-medium">Sin proveedores aún</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product Profitability */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Productos por Rentabilidad</CardTitle>
          <p className="text-sm text-gray-500">
            Los productos que más dinero te generan
          </p>
        </CardHeader>
        <CardContent>
          {stats.productStats.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={stats.productStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={100}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelStyle={{ color: "#000" }}
                  />
                  <Legend />
                  <Bar dataKey="invested" fill="#FF8042" name="Invertido" />
                  <Bar dataKey="profit" fill="#00C49F" name="Ganancia" />
                </BarChart>
              </ResponsiveContainer>

              <div className="overflow-x-auto">
                <table className="w-full mt-6">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">Producto</th>
                      <th className="text-right py-3 px-4">Vendidos</th>
                      <th className="text-right py-3 px-4">Invertido</th>
                      <th className="text-right py-3 px-4">Ganancia</th>
                      <th className="text-right py-3 px-4">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.productStats.map((product, index) => {
                      const roi = product.profitMargin;
                      return (
                        <tr key={index} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4 font-medium">
                            {product.name}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {Math.round(product.sold)}
                          </td>
                          <td className="py-3 px-4 text-right text-red-600">
                            {formatCurrency(product.invested)}
                          </td>
                          <td className="py-3 px-4 text-right text-green-600 font-semibold">
                            {formatCurrency(product.profit)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`font-semibold ${roi > 0 ? "text-green-600" : "text-red-600"}`}
                            >
                              {roi > 0 ? "+" : ""}
                              {roi.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Package className="h-16 w-16 mb-4 opacity-20" />
              <p className="text-sm font-medium">Sin datos de rentabilidad</p>
              <p className="text-xs mt-2 text-center max-w-md">
                Registra compras y ventas para ver el análisis completo
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
