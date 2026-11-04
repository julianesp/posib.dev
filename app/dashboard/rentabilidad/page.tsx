'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  PiggyBank,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  DollarSign,
  Receipt,
  Percent,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getSales, getProducts, getPurchaseOrders, Product } from '@/lib/cloudflare-api';
import { PurchaseOrderWithItems, SaleWithRelations } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { getItemCost, getItemRevenue, startOfDay } from '@/lib/profit-helpers';
import { PageGlossary } from '@/components/dashboard/page-glossary';
import { PartnersSplitCard } from '@/components/profit/partners-split-card';
import { InvestmentSection } from '@/components/dashboard/investment-section';

type Period = 'today' | 'week' | 'month' | '3months' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: '3months', label: 'Últimos 3 meses' },
  { id: 'all', label: 'Todo' },
];

interface ProductProfit {
  productId: string;
  name: string;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
}

export default function RentabilidadPage() {
  const { getToken } = useAuth();
  const [sales, setSales] = useState<SaleWithRelations[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('month');
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [salesData, productsData, ordersData] = await Promise.all([
          getSales(getToken) as Promise<SaleWithRelations[]>,
          getProducts(getToken),
          // Si fallan las compras, el resto de la página igual debe mostrarse
          getPurchaseOrders(getToken).catch((error) => {
            console.error('Error cargando compras a proveedores:', error);
            return [] as PurchaseOrderWithItems[];
          }),
        ]);
        setSales(salesData || []);
        setProducts(productsData || []);
        setPurchaseOrders(ordersData || []);
      } catch (error) {
        console.error('Error cargando datos de rentabilidad:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Ventas válidas (excluye canceladas)
  const validSales = useMemo(
    () => sales.filter((s) => s.status !== 'cancelada'),
    [sales]
  );

  // ── Comparativo HOY vs AYER (independiente del período elegido) ──
  const todayVsYesterday = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    let todayTotal = 0;
    let yesterdayTotal = 0;

    for (const sale of validSales) {
      const d = new Date(sale.created_at);
      if (d >= todayStart) {
        todayTotal += sale.total || 0;
      } else if (d >= yesterdayStart && d < todayStart) {
        yesterdayTotal += sale.total || 0;
      }
    }

    const diff = todayTotal - yesterdayTotal;
    const pct = yesterdayTotal > 0 ? (diff / yesterdayTotal) * 100 : null;
    return { todayTotal, yesterdayTotal, diff, pct };
  }, [validSales]);

  // ── Ventas del período seleccionado ──
  const periodSales = useMemo(() => {
    if (period === 'all') return validSales;
    const now = new Date();
    let from: Date;
    switch (period) {
      case 'today':
        from = startOfDay(now);
        break;
      case 'week':
        from = startOfDay(now);
        from.setDate(from.getDate() - 6);
        break;
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case '3months':
        from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        break;
    }
    return validSales.filter((s) => new Date(s.created_at) >= from);
  }, [validSales, period]);

  // ── Rentabilidad por producto en el período ──
  const analysis = useMemo(() => {
    const byProduct = new Map<string, ProductProfit>();
    let totalRevenue = 0;
    let totalCost = 0;

    for (const sale of periodSales) {
      for (const item of sale.items || []) {
        const product = productsById.get(item.product_id);
        const revenue = getItemRevenue(item);
        const cost = getItemCost(item, product);
        totalRevenue += revenue;
        totalCost += cost;

        const existing = byProduct.get(item.product_id);
        if (existing) {
          existing.units += item.quantity;
          existing.revenue += revenue;
          existing.cost += cost;
          existing.profit += revenue - cost;
        } else {
          byProduct.set(item.product_id, {
            productId: item.product_id,
            name: product?.name || 'Producto eliminado',
            units: item.quantity,
            revenue,
            cost,
            profit: revenue - cost,
          });
        }
      }
    }

    const ranking = Array.from(byProduct.values()).sort(
      (a, b) => b.profit - a.profit
    );
    const totalProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return { ranking, totalRevenue, totalCost, totalProfit, margin };
  }, [periodSales, productsById]);

  // Productos vendiéndose por debajo del costo (o sin margen)
  const belowCostProducts = useMemo(
    () =>
      products.filter(
        (p) => (p.cost_price || 0) > 0 && p.sale_price <= p.cost_price
      ),
    [products]
  );

  // Ganancia por unidad según los precios ACTUALES de cada producto:
  // lo que el tendero gana por cada unidad tras el aumento que le puso
  // al precio del proveedor.
  const unitProfits = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    const list = products
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .map((p) => {
        const cost = p.cost_price || 0;
        const profit = p.sale_price - cost;
        const margin = p.sale_price > 0 ? (profit / p.sale_price) * 100 : 0;
        return { product: p, cost, profit, margin, hasCost: cost > 0 };
      });
    // Primero los que tienen costo registrado (ordenados por ganancia);
    // los que no tienen costo van al final (no se puede calcular ganancia)
    return list.sort((a, b) => {
      if (a.hasCost !== b.hasCost) return a.hasCost ? -1 : 1;
      return b.profit - a.profit;
    });
  }, [products, productSearch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Calculando rentabilidad...</div>
      </div>
    );
  }

  const { todayTotal, yesterdayTotal, diff, pct } = todayVsYesterday;
  const isUp = diff > 0;
  const isFlat = diff === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <PiggyBank className="h-8 w-8 text-brand" />
          Rentabilidad
        </h1>
        <p className="text-gray-500 mt-1">
          Cuánto ganas realmente con lo que vendes
        </p>
      </div>

      {/* Hoy vs Ayer */}
      <Card
        data-guide="profit-today"
        className={
          isFlat
            ? 'border-gray-200'
            : isUp
              ? 'border-green-300 bg-green-50/50'
              : 'border-red-300 bg-red-50/50'
        }
      >
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-600">
                Ventas de hoy vs ayer
              </p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-3xl font-bold">
                  {formatCurrency(todayTotal)}
                </span>
                <span className="text-sm text-gray-500">
                  ayer: {formatCurrency(yesterdayTotal)}
                </span>
              </div>
            </div>
            <div
              className={`flex items-center gap-2 text-lg font-semibold ${
                isFlat ? 'text-gray-600' : isUp ? 'text-green-700' : 'text-red-700'
              }`}
            >
              {isFlat ? (
                <Minus className="h-6 w-6" />
              ) : isUp ? (
                <TrendingUp className="h-6 w-6" />
              ) : (
                <TrendingDown className="h-6 w-6" />
              )}
              <span>
                {isFlat
                  ? 'Igual que ayer'
                  : `${isUp ? '+' : ''}${formatCurrency(diff)}${
                      pct !== null ? ` (${isUp ? '+' : ''}${pct.toFixed(1)}%)` : ''
                    } ${isUp ? 'más que ayer' : 'menos que ayer'}`}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inversión en mercancía y calculadora de compra (no depende del período) */}
      <InvestmentSection products={products} purchaseOrders={purchaseOrders} />

      {/* Selector de período */}
      <div data-guide="profit-period" className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.id}
            variant={period === p.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Tarjetas de totales */}
      <div data-guide="profit-totals" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1">
              <DollarSign className="h-4 w-4" /> Ingresos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(analysis.totalRevenue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1">
              <Receipt className="h-4 w-4" /> Costo estimado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-700">
              {formatCurrency(analysis.totalCost)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-brand/25 bg-brand-light">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-brand flex items-center gap-1">
              <PiggyBank className="h-4 w-4" /> Ganancia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`font-num text-2xl font-bold ${
                analysis.totalProfit >= 0 ? 'text-brand' : 'text-red-600'
              }`}
            >
              {formatCurrency(analysis.totalProfit)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1">
              <Percent className="h-4 w-4" /> Margen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{analysis.margin.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerta: productos por debajo del costo */}
      {belowCostProducts.length > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-orange-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {belowCostProducts.length === 1
                ? '1 producto se está vendiendo sin ganancia'
                : `${belowCostProducts.length} productos se están vendiendo sin ganancia`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-orange-700 mb-2">
              El precio de venta es igual o menor que el costo. Revisa si el
              proveedor subió el precio y no se actualizó:
            </p>
            <ul className="text-sm space-y-1">
              {belowCostProducts.slice(0, 10).map((p) => (
                <li key={p.id} className="flex justify-between gap-4">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-orange-800">
                    costo {formatCurrency(p.cost_price)} · venta{' '}
                    {formatCurrency(p.sale_price)}
                  </span>
                </li>
              ))}
              {belowCostProducts.length > 10 && (
                <li className="text-orange-600">
                  ...y {belowCostProducts.length - 10} más
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Negocio con socios: cuánto de la ganancia le toca a cada uno */}
      <PartnersSplitCard
        profit={analysis.totalProfit}
        periodLabel={PERIODS.find((p) => p.id === period)?.label ?? ''}
      />

      {/* Ranking de productos por ganancia */}
      <Card data-guide="profit-ranking">
        <CardHeader>
          <CardTitle className="text-lg">
            Qué productos te dejan más plata
          </CardTitle>
          <p className="text-sm text-gray-500">
            Ordenados por ganancia en el período. El costo se calcula con el
            precio de costo actual de cada producto.
          </p>
        </CardHeader>
        <CardContent>
          {analysis.ranking.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No hay ventas en este período
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">Producto</th>
                    <th className="py-2 pr-4 text-right">Unidades</th>
                    <th className="py-2 pr-4 text-right">Ingresos</th>
                    <th className="py-2 pr-4 text-right">Costo</th>
                    <th className="py-2 pr-4 text-right">Ganancia</th>
                    <th className="py-2 text-right">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.ranking.map((row, i) => {
                    const rowMargin =
                      row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0;
                    return (
                      <tr key={row.productId} className="border-b hover:bg-gray-50">
                        <td className="py-2 pr-4 text-gray-400">{i + 1}</td>
                        <td className="py-2 pr-4 font-medium">{row.name}</td>
                        <td className="py-2 pr-4 text-right">{row.units}</td>
                        <td className="py-2 pr-4 text-right">
                          {formatCurrency(row.revenue)}
                        </td>
                        <td className="py-2 pr-4 text-right text-gray-500">
                          {formatCurrency(row.cost)}
                        </td>
                        <td
                          className={`py-2 pr-4 text-right font-semibold ${
                            row.profit >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(row.profit)}
                        </td>
                        <td
                          className={`py-2 text-right ${
                            rowMargin < 10 ? 'text-orange-600' : 'text-gray-700'
                          }`}
                        >
                          {rowMargin.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ganancia por producto según precios actuales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Ganancia por producto (precios actuales)
          </CardTitle>
          <p className="text-sm text-gray-500">
            Lo que ganas por cada unidad: precio de venta menos lo que te
            cuesta comprarlo al proveedor.
          </p>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Buscar producto..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="max-w-sm mb-4"
          />
          {unitProfits.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {productSearch
                ? 'Ningún producto coincide con la búsqueda'
                : 'No hay productos registrados'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">Producto</th>
                    <th className="py-2 pr-4 text-right">Costo (proveedor)</th>
                    <th className="py-2 pr-4 text-right">Precio de venta</th>
                    <th className="py-2 pr-4 text-right">Ganancia por unidad</th>
                    <th className="py-2 text-right">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {unitProfits.map(({ product, cost, profit, margin, hasCost }) => (
                    <tr key={product.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 pr-4 font-medium">{product.name}</td>
                      <td className="py-2 pr-4 text-right text-gray-500">
                        {hasCost ? formatCurrency(cost) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatCurrency(product.sale_price)}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right font-semibold ${
                          !hasCost
                            ? 'text-gray-400'
                            : profit > 0
                              ? 'text-emerald-700'
                              : 'text-red-600'
                        }`}
                      >
                        {hasCost ? formatCurrency(profit) : 'Sin costo registrado'}
                      </td>
                      <td
                        className={`py-2 text-right ${
                          !hasCost
                            ? 'text-gray-400'
                            : margin <= 0
                              ? 'text-red-600 font-semibold'
                              : margin < 10
                                ? 'text-orange-600'
                                : 'text-gray-700'
                        }`}
                      >
                        {hasCost ? `${margin.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">
            💡 Los productos sin costo registrado no pueden mostrar ganancia.
            Edita el producto y agrega su precio de costo para verla.
          </p>
        </CardContent>
      </Card>
      {/* Explicación en palabras sencillas de los datos de esta página */}
      <PageGlossary
        storageKey="rentabilidad"
        items={[
          { term: 'Ingresos', meaning: 'Plata que entró por ventas.' },
          { term: 'Costo', meaning: 'Lo que te costó lo vendido.' },
          { term: 'Ganancia', meaning: 'Ingresos menos costo.' },
          { term: 'Margen', meaning: 'De cada $100 vendidos, cuánto es ganancia.' },
          {
            term: 'Inversión',
            meaning: 'Plata metida en la mercancía que tienes: unidades × costo.',
          },
          {
            term: '% sobre lo invertido',
            meaning: 'De cada $100 que le pagas al proveedor, cuánto ganas al venderlo.',
          },
          {
            term: 'Por debajo del costo',
            meaning: 'Lo vendes más barato de lo que te cuesta: pierdes plata.',
          },
        ]}
      />
    </div>
  );
}
