'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingBag, Sparkles, RefreshCw, TrendingUp, Tag, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';

interface ProductRecommendationsSectionProps {
  currentInventory: Array<{
    name: string;
    category: string;
    stock: number;
    salesVelocity: number;
  }>;
  storeType?: string;
  storeCity?: string;
}

interface ParsedProduct {
  name: string;
  emoji: string;
  category: string;
  trend: string;
  margin: string;
}

interface ParsedRecommendations {
  intro: string;
  products: ParsedProduct[];
  tip: string;
}

function parseRecommendations(text: string): ParsedRecommendations {
  const result: ParsedRecommendations = { intro: '', products: [], tip: '' };

  // Extraer introducción (primer párrafo antes de los productos numerados)
  const introMatch = text.match(/^([\s\S]*?)(?=\n\d+\.|\n##\s*\d)/);
  if (introMatch) {
    result.intro = introMatch[1]
      .replace(/^##\s*.+\n?/m, '')
      .replace(/\*\*/g, '')
      .trim();
  }

  // Extraer consejo final
  const tipMatch = text.match(/##\s*💡\s*Consejo[^\n]*\n([\s\S]*?)$/i);
  if (tipMatch) {
    result.tip = tipMatch[1].replace(/\*\*/g, '').trim();
  }

  // Extraer cada producto numerado
  const productBlocks = text.matchAll(
    /\d+\.\s+\*\*([^*]+)\*\*\s*([^\n]*)\n([\s\S]*?)(?=\n\d+\.|\n##\s*💡|$)/g
  );

  for (const match of productBlocks) {
    const nameLine = match[1].trim();
    const emojiLine = match[2].trim();
    const body = match[3];

    const categoryMatch = body.match(/\*\*Categor[íi]a:\*\*\s*([^\n*]+)/i);
    const trendMatch = body.match(/\*\*Tendencia:\*\*\s*([^\n*]+)/i);
    const marginMatch = body.match(/\*\*Margen estimado:\*\*\s*([^\n*]+)/i);

    result.products.push({
      name: nameLine,
      emoji: emojiLine,
      category: categoryMatch?.[1].trim() ?? '',
      trend: trendMatch?.[1].trim() ?? '',
      margin: marginMatch?.[1].trim() ?? '',
    });
  }

  return result;
}

const MARGIN_COLORS: Record<string, string> = {
  // Solo el color de la tienda: más fuerte cuanto mejor el margen.
  low: 'bg-gray-100 text-gray-700',
  mid: 'bg-brand-light text-brand',
  high: 'bg-brand text-white',
};

function marginColor(margin: string) {
  const num = parseInt(margin);
  if (num >= 35) return MARGIN_COLORS.high;
  if (num >= 20) return MARGIN_COLORS.mid;
  return MARGIN_COLORS.low;
}

export function ProductRecommendationsSection({
  currentInventory,
  storeType,
  storeCity,
}: ProductRecommendationsSectionProps) {
  const [raw, setRaw] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const generateRecommendations = async () => {
    try {
      setLoading(true);
      toast.loading('Analizando tendencias del mercado colombiano...');

      const response = await fetch('/api/ai/product-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentInventory,
          storeType: storeType || 'Tienda general',
          storeCity,
        }),
      });

      toast.dismiss();

      if (!response.ok) throw new Error('Error al generar recomendaciones');

      const data = await response.json();
      setRaw(data.recommendations);
      toast.success('Recomendaciones generadas');
    } catch {
      toast.dismiss();
      toast.error('Error al generar recomendaciones');
    } finally {
      setLoading(false);
    }
  };

  const parsed = raw ? parseRecommendations(raw) : null;

  return (
    <Card className="border-2 border-brand/20 bg-brand-light/60">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-brand" />
            <span className="text-brand-hover">Productos Tendencia en Colombia</span>
          </div>
          <Button
            onClick={generateRecommendations}
            disabled={loading}
            size="sm"
            className="bg-brand hover:bg-brand-hover"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Analizando...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                {raw ? 'Actualizar' : 'Ver Tendencias'}
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {parsed ? (
          <div className="space-y-4">
            {/* Introducción */}
            {parsed.intro && (
              <p className="text-sm text-gray-600 bg-white rounded-lg px-4 py-3 border border-brand/20">
                {parsed.intro}
              </p>
            )}

            {/* Tarjetas de productos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {parsed.products.map((product, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-brand/20 shadow-sm p-4 flex flex-col gap-2 hover:shadow-md transition-shadow"
                >
                  {/* Número + nombre */}
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm leading-tight">
                        {product.name} {product.emoji}
                      </p>
                    </div>
                  </div>

                  {/* Categoría */}
                  {product.category && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Tag className="h-3 w-3" />
                      {product.category}
                    </div>
                  )}

                  {/* Tendencia */}
                  {product.trend && (
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {product.trend}
                    </p>
                  )}

                  {/* Margen */}
                  {product.margin && (
                    <span className={`self-start text-xs font-semibold px-2 py-0.5 rounded-full ${marginColor(product.margin)}`}>
                      Margen: {product.margin}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Consejo final */}
            {parsed.tip && (
              <div className="flex gap-3 bg-brand-light/60 border border-brand/20 rounded-xl p-4">
                <Lightbulb className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-brand-hover mb-1">Consejo de Promoción</p>
                  <p className="text-sm text-brand">{parsed.tip}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <ShoppingBag className="h-16 w-16 mx-auto mb-4 text-brand/40" />
            <p className="text-gray-600 mb-2">
              Descubre qué productos están en tendencia en Colombia
            </p>
            <p className="text-sm text-gray-500">
              La IA analizará tu inventario y recomendará productos populares que complementen tu catálogo
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
