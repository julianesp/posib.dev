/**
 * Advanced Analytics Helpers
 * Métricas avanzadas: ROI, Margen, LTV, CAC, Segmentación, etc.
 */

import { Sale, SaleItemWithProduct, Customer, Product } from './types';

type SaleWithFetchedItems = Sale & { items: SaleItemWithProduct[] };

export interface AdvancedMetrics {
  // Métricas de rentabilidad
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  profit_margin_percentage: number;
  roi_percentage: number;

  // Métricas de clientes
  total_customers: number;
  /** Clientes registrados que compraron en el período (ventas con cliente). */
  buying_customers: number;
  new_customers: number;
  returning_customers: number;
  average_order_value: number;
  customer_lifetime_value: number;
  customer_acquisition_cost: number;

  // Métricas de productos
  total_products_sold: number;
  average_items_per_sale: number;
  best_profit_margin_product: {
    name: string;
    margin_percentage: number;
  } | null;
}

export interface TemporalComparison {
  current: {
    period: string;
    revenue: number;
    sales: number;
    customers: number;
    profit: number;
  };
  previous: {
    period: string;
    revenue: number;
    sales: number;
    customers: number;
    profit: number;
  };
  growth: {
    revenue_percentage: number;
    sales_percentage: number;
    customers_percentage: number;
    profit_percentage: number;
  };
}

export interface SalesSegmentation {
  by_category: Array<{
    category_name: string;
    total_sales: number;
    total_revenue: number;
    percentage: number;
  }>;
  by_payment_method: Array<{
    payment_method: string;
    total_sales: number;
    total_revenue: number;
    percentage: number;
  }>;
  by_time_of_day: Array<{
    hour_range: string;
    total_sales: number;
    total_revenue: number;
  }>;
  by_day_of_week: Array<{
    day: string;
    total_sales: number;
    total_revenue: number;
  }>;
}

export interface ProactiveAlert {
  id: string;
  type: 'trending_product' | 'low_stock' | 'high_value_customer' | 'exceptional_sales_day';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data: Record<string, unknown>;
  created_at: string;
}

/**
 * Calculate advanced metrics for a period
 */
export async function calculateAdvancedMetrics(
  apiUrl: string,
  token: string,
  startDate: string,
  endDate: string
): Promise<AdvancedMetrics> {
  try {
    // Obtener ventas del período
    const salesRes = await fetch(
      `${apiUrl}/api/sales?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const salesData = await salesRes.json();
    const sales: Sale[] = salesData.data || [];

    // Obtener items de ventas para calcular costos
    const salesWithItems: SaleWithFetchedItems[] = await Promise.all(
      sales.map(async (sale) => {
        const itemsRes = await fetch(`${apiUrl}/api/sales/${sale.id}/items`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const itemsData = await itemsRes.json();
        return { ...sale, items: (itemsData.data || []) as SaleItemWithProduct[] };
      })
    );

    // Calcular revenue y cost
    let totalRevenue = 0;
    let totalCost = 0;
    let totalProductsSold = 0;
    let totalItems = 0;

    salesWithItems.forEach((sale) => {
      if (sale.status === 'completada') {
        totalRevenue += sale.total;

        sale.items.forEach((item) => {
          const costPrice = item.product?.cost_price || 0;
          totalCost += costPrice * item.quantity;
          totalProductsSold += item.quantity;
          totalItems += 1;
        });
      }
    });

    const grossProfit = totalRevenue - totalCost;
    const profitMarginPercentage = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const roiPercentage = totalCost > 0 ? (grossProfit / totalCost) * 100 : 0;

    // Métricas de clientes
    const customersRes = await fetch(`${apiUrl}/api/customers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const customersData = await customersRes.json();
    const customers: Customer[] = customersData.data || [];

    const uniqueCustomerIds = new Set(
      sales.filter((s) => s.customer_id).map((s) => s.customer_id)
    );

    const completedSales = sales.filter((s) => s.status === 'completada');
    const averageOrderValue =
      completedSales.length > 0 ? totalRevenue / completedSales.length : 0;

    // LTV simplificado: promedio de ventas por cliente
    const customerLifetimeValue =
      uniqueCustomerIds.size > 0 ? totalRevenue / uniqueCustomerIds.size : 0;

    // CAC simplificado (asume costo fijo de marketing)
    const estimatedMarketingCost = totalRevenue * 0.05; // 5% del revenue
    const newCustomers = customers.filter((c) => {
      const createdAt = new Date(c.created_at);
      return createdAt >= new Date(startDate) && createdAt <= new Date(endDate);
    }).length;

    const customerAcquisitionCost =
      newCustomers > 0 ? estimatedMarketingCost / newCustomers : 0;

    // Producto con mejor margen
    const productProfits = new Map<string, { name: string; profit: number; revenue: number }>();

    salesWithItems.forEach((sale) => {
      sale.items.forEach((item) => {
        const productId = item.product_id;
        const productName = item.product?.name || 'Producto desconocido';
        const costPrice = item.product?.cost_price || 0;
        const revenue = item.subtotal;
        const profit = revenue - costPrice * item.quantity;

        const existing = productProfits.get(productId);
        if (existing) {
          existing.profit += profit;
          existing.revenue += revenue;
        } else {
          productProfits.set(productId, {
            name: productName,
            profit,
            revenue,
          });
        }
      });
    });

    let bestProduct: AdvancedMetrics['best_profit_margin_product'] = null;
    let bestMargin = 0;

    productProfits.forEach((data) => {
      if (data.revenue > 0) {
        const margin = (data.profit / data.revenue) * 100;
        if (margin > bestMargin) {
          bestMargin = margin;
          bestProduct = {
            name: data.name,
            margin_percentage: margin,
          };
        }
      }
    });

    return {
      total_revenue: totalRevenue,
      total_cost: totalCost,
      gross_profit: grossProfit,
      profit_margin_percentage: profitMarginPercentage,
      roi_percentage: roiPercentage,

      total_customers: customers.length,
      buying_customers: uniqueCustomerIds.size,
      new_customers: newCustomers,
      returning_customers: Math.max(uniqueCustomerIds.size - newCustomers, 0),
      average_order_value: averageOrderValue,
      customer_lifetime_value: customerLifetimeValue,
      customer_acquisition_cost: customerAcquisitionCost,

      total_products_sold: totalProductsSold,
      average_items_per_sale: completedSales.length > 0 ? totalItems / completedSales.length : 0,
      best_profit_margin_product: bestProduct,
    };
  } catch (error) {
    console.error('Error calculating advanced metrics:', error);
    throw error;
  }
}

/**
 * Compare current period with previous period
 */
export async function calculateTemporalComparison(
  apiUrl: string,
  token: string,
  periodType: 'week' | 'month' | 'year' = 'month'
): Promise<TemporalComparison> {
  const now = new Date();
  let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;

  if (periodType === 'week') {
    // Semana actual vs semana anterior
    currentEnd = now;
    currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 7);

    previousEnd = new Date(currentStart);
    previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 7);
  } else if (periodType === 'month') {
    // Mes actual vs mes anterior
    currentEnd = now;
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);

    previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);
    previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), 1);
  } else {
    // Año actual vs año anterior
    currentEnd = now;
    currentStart = new Date(now.getFullYear(), 0, 1);

    previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);
    previousStart = new Date(previousEnd.getFullYear(), 0, 1);
  }

  const currentMetrics = await calculateAdvancedMetrics(
    apiUrl,
    token,
    currentStart.toISOString(),
    currentEnd.toISOString()
  );

  const previousMetrics = await calculateAdvancedMetrics(
    apiUrl,
    token,
    previousStart.toISOString(),
    previousEnd.toISOString()
  );

  const calculateGrowth = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  return {
    current: {
      period: `${currentStart.toLocaleDateString('es-CO')} - ${currentEnd.toLocaleDateString('es-CO')}`,
      revenue: currentMetrics.total_revenue,
      sales: 0, // Se obtiene del helper
      customers: currentMetrics.new_customers,
      profit: currentMetrics.gross_profit,
    },
    previous: {
      period: `${previousStart.toLocaleDateString('es-CO')} - ${previousEnd.toLocaleDateString('es-CO')}`,
      revenue: previousMetrics.total_revenue,
      sales: 0,
      customers: previousMetrics.new_customers,
      profit: previousMetrics.gross_profit,
    },
    growth: {
      revenue_percentage: calculateGrowth(currentMetrics.total_revenue, previousMetrics.total_revenue),
      sales_percentage: 0,
      customers_percentage: calculateGrowth(currentMetrics.new_customers, previousMetrics.new_customers),
      profit_percentage: calculateGrowth(currentMetrics.gross_profit, previousMetrics.gross_profit),
    },
  };
}

/**
 * Generate proactive alerts based on sales data
 */
export async function generateProactiveAlerts(
  apiUrl: string,
  token: string
): Promise<ProactiveAlert[]> {
  const alerts: ProactiveAlert[] = [];

  try {
    // Obtener ventas de los últimos 7 días
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const salesRes = await fetch(
      `${apiUrl}/api/sales?start_date=${last7Days.toISOString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const salesData = await salesRes.json();
    const sales: Sale[] = salesData.data || [];

    // Alerta: Día excepcional de ventas
    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter((s) => s.created_at.startsWith(today));
    const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);

    const otherDaysRevenue =
      sales
        .filter((s) => !s.created_at.startsWith(today))
        .reduce((sum, s) => sum + s.total, 0) / 6;

    if (todayRevenue > otherDaysRevenue * 1.5) {
      alerts.push({
        id: crypto.randomUUID(),
        type: 'exceptional_sales_day',
        title: 'Día Excepcional de Ventas',
        message: `Hoy has vendido un 50% más que el promedio de los últimos 7 días. ¡Excelente trabajo!`,
        severity: 'info',
        data: { revenue: todayRevenue, average: otherDaysRevenue },
        created_at: new Date().toISOString(),
      });
    }

    // Alerta: Productos trending
    const productsRes = await fetch(`${apiUrl}/api/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const productsData = await productsRes.json();
    const products: Product[] = productsData.data || [];

    // Alerta: Stock bajo crítico
    const lowStockProducts = products.filter(
      (p) => p.stock <= p.min_stock && p.stock > 0
    );

    if (lowStockProducts.length > 0) {
      alerts.push({
        id: crypto.randomUUID(),
        type: 'low_stock',
        title: 'Stock Bajo Crítico',
        message: `Tienes ${lowStockProducts.length} productos con stock bajo. Considera hacer un pedido pronto.`,
        severity: 'warning',
        data: { products: lowStockProducts },
        created_at: new Date().toISOString(),
      });
    }

    return alerts;
  } catch (error) {
    console.error('Error generating alerts:', error);
    return [];
  }
}
