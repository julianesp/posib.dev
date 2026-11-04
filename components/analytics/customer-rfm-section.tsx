'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Users,
  Trophy,
  AlertTriangle,
  Star,
  RefreshCw,
  TrendingUp,
  Heart,
  Sparkles,
  UserPlus,
  Repeat,
  DollarSign,
  Clock,
  Lightbulb,
  Target,
  Gift,
  PhoneCall,
  Mail,
  MessageCircle,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getCustomerInsights, RFMSegment } from '@/lib/customer-analytics-helpers';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface CustomerRFMSectionProps {
  getToken: () => Promise<string | null>;
  daysAnalyzed: number;
}

export function CustomerRFMSection({ getToken, daysAnalyzed }: CustomerRFMSectionProps) {
  const [loading, setLoading] = useState(false);
  const [champions, setChampions] = useState<RFMSegment[]>([]);
  const [atRisk, setAtRisk] = useState<RFMSegment[]>([]);
  const [segments, setSegments] = useState<{ [key: string]: number }>({});
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [newCustomers, setNewCustomers] = useState(0);
  const [returningCustomers, setReturningCustomers] = useState(0);
  const [avgFrequency, setAvgFrequency] = useState(0);
  const [topCustomers, setTopCustomers] = useState<RFMSegment[]>([]);

  const loadCustomerInsights = async () => {
    try {
      setLoading(true);
      const insights = await getCustomerInsights(daysAnalyzed, getToken);

      setChampions(insights.champions);
      setAtRisk(insights.atRiskCustomers);
      setSegments(insights.segments);
      setTotalCustomers(insights.totalCustomers);
      setNewCustomers(insights.newCustomers);
      setReturningCustomers(insights.returningCustomers);
      setAvgFrequency(insights.avgPurchaseFrequency);
      setTopCustomers(insights.topCustomers);

      toast.success('Análisis de clientes completado');
    } catch (error) {
      console.error('Error loading customer insights:', error);
      toast.error('Error al analizar clientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomerInsights();
  }, [daysAnalyzed]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin text-brand" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calcular métricas adicionales
  const retentionRate = totalCustomers > 0 ? (returningCustomers / totalCustomers) * 100 : 0;
  const totalRevenue = topCustomers.reduce((sum, c) => sum + c.monetary, 0);
  const avgTicket = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
  const championsPercentage = totalCustomers > 0 ? (champions.length / totalCustomers) * 100 : 0;
  const atRiskPercentage = totalCustomers > 0 ? (atRisk.length / totalCustomers) * 100 : 0;

  // Determinar el estado general del negocio
  const getBusinessHealth = () => {
    if (championsPercentage > 20 && retentionRate > 60) {
      return {
        status: 'excelente',
        icon: '🎉',
        color: 'green',
        message: '¡Tu negocio está excelente! Tienes muchos clientes leales.',
      };
    } else if (championsPercentage > 10 && retentionRate > 40) {
      return {
        status: 'bueno',
        icon: '👍',
        color: 'blue',
        message: 'Tu negocio va bien. Hay oportunidades de mejora.',
      };
    } else if (atRiskPercentage > 30) {
      return {
        status: 'alerta',
        icon: '⚠️',
        color: 'orange',
        message: 'Muchos clientes en riesgo. ¡Necesitas actuar pronto!',
      };
    } else {
      return {
        status: 'regular',
        icon: '💡',
        color: 'yellow',
        message: 'Hay espacio para crecer. Enfócate en retener clientes.',
      };
    }
  };

  const businessHealth = getBusinessHealth();

  // Función para obtener info de cada segmento
  const getSegmentInfo = (segmentName: string) => {
    const segmentMap: { [key: string]: { icon: string; color: string; explanation: string; action: string } } = {
      Champions: {
        icon: '🏆',
        color: 'yellow',
        explanation: 'Tus mejores clientes: compran mucho, gastan mucho y compraron hace poco.',
        action: '✅ Cuídalos mucho, ofréceles beneficios exclusivos y mantén contacto frecuente.',
      },
      Leales: {
        icon: '💙',
        color: 'blue',
        explanation: 'Clientes fieles que compran regularmente y confían en ti.',
        action: '✅ Agradéceles su lealtad, ofréceles descuentos especiales y programas de puntos.',
      },
      'Potencialmente Leales': {
        icon: '⭐',
        color: 'purple',
        explanation: 'Clientes nuevos que están empezando a comprar más seguido. ¡Buen potencial!',
        action: '✅ Dales seguimiento personalizado, ofrece incentivos para que vuelvan pronto.',
      },
      'En Riesgo': {
        icon: '⚠️',
        color: 'red',
        explanation: 'Clientes buenos que NO han comprado recientemente. ¡Pueden irse con la competencia!',
        action: '🚨 URGENTE: Llámales, envíales ofertas especiales, pregunta qué pasó.',
      },
      'Requieren Atención': {
        icon: '👀',
        color: 'orange',
        explanation: 'Clientes que compran poco y no muy seguido. Necesitan motivación.',
        action: '✅ Envía promociones atractivas, descuentos, comunica tus novedades.',
      },
      Nuevos: {
        icon: '🌟',
        color: 'green',
        explanation: 'Clientes que hicieron su primera compra hace poco. ¡Oportunidad de oro!',
        action: '✅ Primera impresión es clave: excelente servicio, bienvenida especial, descuento próxima compra.',
      },
      Prometedores: {
        icon: '🎯',
        color: 'cyan',
        explanation: 'Clientes con buenas señales: compran seguido aunque no mucho aún.',
        action: '✅ Incentívalos a comprar más: combos, ofertas, programa de lealtad.',
      },
      Inactivos: {
        icon: '😴',
        color: 'gray',
        explanation: 'Clientes que hace mucho no compran. Prácticamente perdidos.',
        action: '💭 Considera una campaña de "te extrañamos" con oferta irresistible, o déjalos ir.',
      },
      Ocasionales: {
        icon: '🔄',
        color: 'slate',
        explanation: 'Clientes que compran de vez en cuando, sin patrón claro.',
        action: '✅ Intenta descubrir qué los motiva: encuestas, ofertas personalizadas.',
      },
    };

    return (
      segmentMap[segmentName] || {
        icon: '👤',
        color: 'gray',
        explanation: 'Clientes sin segmento específico.',
        action: 'Analiza su comportamiento para tomar acción.',
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards - Métricas clave explicadas simplemente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-brand bg-brand">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="h-8 w-8 text-white/80" />
              <div className="text-right">
                <p className="text-3xl font-bold text-white">{totalCustomers}</p>
                <p className="text-xs text-white/80">últimos {daysAnalyzed} días</p>
              </div>
            </div>
            <p className="text-sm font-semibold text-white">Total de Clientes</p>
            <p className="text-xs text-white/80 mt-1">Personas que te compraron</p>
          </CardContent>
        </Card>

        <Card className="border-brand/30 bg-brand-light">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <UserPlus className="h-8 w-8 text-brand" />
              <div className="text-right">
                <p className="text-3xl font-bold text-brand-hover">{newCustomers}</p>
                <p className="text-xs text-brand">
                  {totalCustomers > 0 ? ((newCustomers / totalCustomers) * 100).toFixed(0) : 0}% del total
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold text-brand-hover">Clientes Nuevos</p>
            <p className="text-xs text-brand mt-1">Primera compra en este período</p>
          </CardContent>
        </Card>

        <Card className="border-brand bg-brand">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Repeat className="h-8 w-8 text-white/80" />
              <div className="text-right">
                <p className="text-3xl font-bold text-white">{returningCustomers}</p>
                <p className="text-xs text-white/80">{retentionRate.toFixed(0)}% retención</p>
              </div>
            </div>
            <p className="text-sm font-semibold text-white">Clientes que Regresan</p>
            <p className="text-xs text-white/80 mt-1">Compraron más de una vez</p>
          </CardContent>
        </Card>

        <Card className="border-brand/30 bg-brand-light">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="h-8 w-8 text-brand" />
              <div className="text-right">
                <p className="text-2xl font-bold text-brand-hover">{formatCurrency(avgTicket)}</p>
                <p className="text-xs text-brand">{avgFrequency.toFixed(1)} compras/cliente</p>
              </div>
            </div>
            <p className="text-sm font-semibold text-brand-hover">Ticket Promedio</p>
            <p className="text-xs text-brand mt-1">Cuánto gasta cada cliente</p>
          </CardContent>
        </Card>
      </div>

      {/* ¿Qué está pasando? - Insight Card */}
      <Card className="border-2 border-brand/30 bg-brand-light/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lightbulb className="h-5 w-5" />
            ¿Qué está pasando en tu negocio? {businessHealth.icon}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="font-semibold text-lg mb-2">{businessHealth.message}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex items-start gap-2">
                <Trophy className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {champions.length} Clientes Champions ({championsPercentage.toFixed(0)}%)
                  </p>
                  <p className="text-gray-600">Tus mejores clientes, cuídalos mucho</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-brand-hover flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {atRisk.length} Clientes en Riesgo ({atRiskPercentage.toFixed(0)}%)
                  </p>
                  <p className="text-gray-600">Clientes buenos que pueden irse, ¡reactivar!</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Heart className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{retentionRate.toFixed(0)}% de Retención</p>
                  <p className="text-gray-600">
                    {retentionRate > 60 ? 'Excelente' : retentionRate > 40 ? 'Bueno' : 'Mejorar'} -{' '}
                    {returningCustomers} clientes volvieron
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{avgFrequency.toFixed(1)} Compras por Cliente</p>
                  <p className="text-gray-600">
                    {avgFrequency > 3 ? 'Muy bueno' : avgFrequency > 2 ? 'Bueno' : 'Puede mejorar'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ¿Qué deberías hacer? - Action Card */}
      <Card className="border-brand/40 bg-brand-light/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-brand">
            <Target className="h-5 w-5" />
            ¿Qué deberías hacer HOY? (Recomendaciones)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {champions.length > 0 && (
              <div className="flex items-start gap-2 bg-white rounded p-3 border border-brand/40">
                <Gift className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Cuida a tus {champions.length} Champions</p>
                  <p className="text-gray-600">
                    Llámalos para agradecerles, ofréceles descuentos exclusivos o un regalo sorpresa
                  </p>
                </div>
              </div>
            )}
            {atRisk.length > 0 && (
              <div className="flex items-start gap-2 bg-white rounded p-3 border border-brand/50">
                <PhoneCall className="h-5 w-5 text-brand-hover flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-brand-hover">URGENTE: Recupera a {atRisk.length} clientes en riesgo</p>
                  <p className="text-gray-600">
                    Envíales un mensaje o llama: "Te extrañamos, tenemos {' '}
                    una oferta especial para ti"
                  </p>
                </div>
              </div>
            )}
            {newCustomers > 0 && (
              <div className="flex items-start gap-2 bg-white rounded p-3 border border-brand/20">
                <MessageCircle className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Dale bienvenida a {newCustomers} clientes nuevos</p>
                  <p className="text-gray-600">
                    Envíales un mensaje de bienvenida y un cupón de descuento para su próxima compra
                  </p>
                </div>
              </div>
            )}
            {retentionRate < 40 && (
              <div className="flex items-start gap-2 bg-white rounded p-3 border border-brand/20">
                <Mail className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Mejora tu retención (actualmente {retentionRate.toFixed(0)}%)</p>
                  <p className="text-gray-600">
                    Crea un programa de puntos, ofrece descuentos por volumen, mejora el servicio
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Segmentos Detallados con Explicaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand" />
            Tus Clientes por Segmento (Explicado Simple)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(segments)
              .sort((a, b) => b[1] - a[1]) // Ordenar por cantidad
              .map(([segment, count], i) => {
                const info = getSegmentInfo(segment);
                // Solo el color de la tienda: una tarjeta fuerte, la siguiente clara.
                const dark = i % 2 === 0;
                return (
                  <div
                    key={segment}
                    className={`rounded-lg p-4 border ${
                      dark ? "bg-brand border-brand text-white" : "bg-brand-light border-brand/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">{info.icon}</span>
                      <span className={`text-3xl font-bold ${dark ? "text-white" : "text-brand-hover"}`}>{count}</span>
                    </div>
                    <p className="font-semibold text-sm mb-1">{segment}</p>
                    <p className={`text-xs mb-2 ${dark ? "text-white/85" : "text-gray-700"}`}>{info.explanation}</p>
                    <div className="bg-white rounded p-2 mt-2 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-900">{info.action}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Champions - Tus Estrellas */}
      {champions.length > 0 && (
        <Card className="border-brand/20 bg-brand-light/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-brand-hover">
              <Trophy className="h-5 w-5" />
              🏆 Tus Clientes CHAMPIONS - ¡Las Estrellas de tu Negocio!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-white rounded-lg p-3 mb-4 border border-brand/20">
              <p className="text-sm font-semibold text-gray-900 mb-1">¿Qué significa esto?</p>
              <p className="text-sm text-gray-700">
                Estos {champions.length} clientes son tu tesoro: compran seguido, gastan mucho y compraron hace poco.{' '}
                <strong>¡Son el corazón de tu negocio!</strong> Si cuidas bien a estos clientes, tu negocio estará
                siempre bien.
              </p>
            </div>
            <div className="space-y-3">
              {champions.slice(0, 5).map((customer) => (
                <div key={customer.customer_id} className="bg-white p-4 rounded-lg border border-brand/20">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold text-lg flex items-center gap-2">
                        <Star className="h-4 w-4 text-brand fill-brand" />
                        {customer.customer_name}
                      </p>
                      <p className="text-sm text-gray-600">{customer.segment_description}</p>
                    </div>
                    <span className="bg-brand text-white px-3 py-1 rounded-full text-xs font-semibold">
                      {customer.rfm_score}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                    <div>
                      <span className="text-gray-500">Última compra:</span>
                      <p className="font-semibold">Hace {customer.recency_days} días</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Compras:</span>
                      <p className="font-semibold">{customer.frequency} veces</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Ha gastado:</span>
                      <p className="font-bold text-brand">{formatCurrency(customer.monetary)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="bg-brand-light/60 text-brand-hover px-2 py-1 rounded">💚 Cliente Valioso</span>
                    <span className="bg-brand-light text-brand px-2 py-1 rounded">⚡ Compra Frecuente</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* At Risk - ¡Alerta! */}
      {atRisk.length > 0 && (
        <Card className="border-brand/50 bg-brand-light">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-brand-hover">
              <AlertTriangle className="h-5 w-5" />
              ⚠️ Clientes en RIESGO - ¡Acción URGENTE Necesaria!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-white rounded-lg p-3 mb-4 border border-brand/50">
              <p className="text-sm font-semibold text-brand-hover mb-1">⚠️ ¡IMPORTANTE!</p>
              <p className="text-sm text-gray-700">
                Estos {atRisk.length} clientes eran BUENOS (gastaban bien), pero hace tiempo no compran.{' '}
                <strong>Pueden irse con la competencia.</strong> ¡Contáctalos HOY! Una llamada, un mensaje, una oferta
                especial... ¡lo que sea para recuperarlos!
              </p>
            </div>
            <div className="space-y-3">
              {atRisk.slice(0, 5).map((customer) => (
                <div key={customer.customer_id} className="bg-white p-4 rounded-lg border border-brand/50">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold">{customer.customer_name}</p>
                      <p className="text-sm text-brand-hover font-medium">
                        ⏰ Sin comprar {customer.recency_days} días - ¡Contáctalo YA!
                      </p>
                    </div>
                    <span className="bg-brand-hover text-white px-3 py-1 rounded-full text-xs font-semibold">
                      URGENTE
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                    <div>
                      <span className="text-gray-500">Sin comprar:</span>
                      <p className="font-semibold text-brand-hover">{customer.recency_days} días</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Compraba:</span>
                      <p className="font-semibold">{customer.frequency} veces</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Gastó antes:</span>
                      <p className="font-bold text-brand">{formatCurrency(customer.monetary)}</p>
                    </div>
                  </div>
                  <div className="bg-brand-light rounded p-2 text-xs text-brand-hover">
                    <p className="font-semibold">💡 Qué hacer:</p>
                    <p>
                      1) Llámalo o envía WhatsApp 2) Pregunta cómo está 3) Ofrece descuento especial "te extrañamos"
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Explicación Simple RFM */}
      <Card className="bg-brand-light/50 border-brand/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-brand">
            <Sparkles className="h-5 w-5" />
            ¿Cómo funciona esto?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-800 space-y-3">
          <div className="bg-white rounded-lg p-3 border border-brand/40">
            <p className="font-semibold mb-2">🤔 ¿Qué es RFM?</p>
            <p>
              RFM significa <strong>Recency</strong> (¿cuándo compró?), <strong>Frequency</strong> (¿cuántas veces?) y{' '}
              <strong>Monetary</strong> (¿cuánto gastó?). Es un método para saber quiénes son tus mejores clientes y
              quiénes necesitan atención.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-brand" />
                <p className="font-semibold">Recency (Reciente)</p>
              </div>
              <p className="text-xs text-gray-700">
                ¿Hace cuánto compró? Si fue hace poco = bueno. Si hace mucho = malo.
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Repeat className="h-4 w-4 text-brand" />
                <p className="font-semibold">Frequency (Frecuencia)</p>
              </div>
              <p className="text-xs text-gray-700">
                ¿Cuántas veces compró? Más veces = cliente más leal = mejor.
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-brand" />
                <p className="font-semibold">Monetary (Dinero)</p>
              </div>
              <p className="text-xs text-gray-700">
                ¿Cuánto gastó en total? Más dinero = cliente más valioso.
              </p>
            </div>
          </div>
          <div className="bg-brand-light/60 rounded-lg p-3 border border-brand/30">
            <p className="font-semibold text-brand-hover mb-1">💡 El Score RFM</p>
            <p className="text-xs text-brand-hover">
              Cada cliente recibe un puntaje de 3 números (ej: "555"). Cuanto más alto, mejor. "555" = Cliente
              perfecto. "111" = Cliente que casi no compra.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
