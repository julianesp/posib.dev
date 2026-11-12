"use client";

import { Zap, DollarSign, Clock, TrendingUp, X, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OvercomeResistance() {
  return (
    <section className="py-16 md:py-20 bg-gradient-[#007c80] from-[#007C80] to-[#007C80]/80">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            ¿Por Qué Cambiar de Sistema?
          </h2>
          <p className="text-lg text-white max-w-3xl mx-auto">
            Sabemos que el cambio da miedo. Pero quedarte con un sistema
            obsoleto te cuesta más de lo que piensas.
          </p>
        </div>

        {/* Comparison */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto mb-12">
          {/* Old Way */}
          <Card className="bg-brand border-white border-2">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <X className="h-6 w-6 text-white" />
                Sin un Sistema Moderno
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-white">
                  <X className="h-5 w-5 text-white shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Cobras a ojo y pierdes el control de las cuentas por cobrar
                  </span>
                </li>
                <li className="flex items-start gap-2 text-white">
                  <X className="h-5 w-5 text-white   shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Gastas horas haciendo inventario manualmente
                  </span>
                </li>
                <li className="flex items-start gap-2 text-white">
                  <X className="h-5 w-5 text-white shrink-0 mt-0.5" />
                  <span className="text-sm">
                    No sabes qué productos te generan más ganancia
                  </span>
                </li>
                <li className="flex items-start gap-2 text-white">
                  <X className="h-5 w-5 text-white   shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Pierdes dinero en productos vencidos o robos
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* New Way */}
          <Card className="bg-brand border-white border-2">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Check className="h-6 w-6 text-white" />
                Con posib.dev
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-white">
                  <Check className="h-5 w-5 text-white shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Controlas ventas a crédito y cuentas por cobrar al instante
                  </span>
                </li>
                <li className="flex items-start gap-2 text-white">
                  <Check className="h-5 w-5 text-white shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Inventario actualizado en tiempo real, sin esfuerzo
                  </span>
                </li>
                <li className="flex items-start gap-2 text-white">
                  <Check className="h-5 w-5 text-white shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Reportes claros que te muestran tus mejores productos
                  </span>
                </li>
                <li className="flex items-start gap-2 text-white">
                  <Check className="h-5 w-5 text-white shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Alertas de vencimiento y control total del stock
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* ROI Calculation */}
        {/* <div className="bg-yellow-400 rounded-lg p-6 md:p-8 max-w-4xl mx-auto mb-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            El Cambio se Paga Solo
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="bg-gray-900 rounded-lg p-4 mb-2">
                <Clock className="h-8 w-8 text-yellow-400 mx-auto" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-1">Ahorra Tiempo</h4>
              <p className="text-sm text-gray-800">
                10+ horas/semana que puedes usar para hacer crecer tu negocio
              </p>
            </div>
            <div className="text-center">
              <div className="bg-gray-900 rounded-lg p-4 mb-2">
                <TrendingUp className="h-8 w-8 text-yellow-400 mx-auto" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-1">Aumenta Ventas</h4>
              <p className="text-sm text-gray-800">
                Promedio de 30-40% más ventas con tienda online activa
              </p>
            </div>
            <div className="text-center">
              <div className="bg-gray-900 rounded-lg p-4 mb-2">
                <DollarSign className="h-8 w-8 text-yellow-400 mx-auto" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-1">Evita Pérdidas</h4>
              <p className="text-sm text-gray-800">
                Reduce mermas, robos y pérdidas significativamente
              </p>
            </div>
          </div>
        </div> */}

        {/* Ease of Transition */}
        {/* <div className="text-center">
          <Card className="bg-gradient-to-br from-purple-800 to-indigo-800 border-purple-400 max-w-3xl mx-auto">
            <CardContent className="pt-6">
              <Zap className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-white mb-3">
                Te Hacemos el Cambio Fácil
              </h3>
              <div className="space-y-2 text-purple-100">
                <p className="flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-green-400" />
                  <span>Migración gratuita de todos tus datos</span>
                </p>
                <p className="flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-green-400" />
                  <span>Capacitación incluida con videos y soporte</span>
                </p>
                <p className="flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-green-400" />
                  <span>Prueba gratis 30 días sin compromiso</span>
                </p>
                <p className="flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-green-400" />
                  <span>Puedes usar ambos sistemas en paralelo al inicio</span>
                </p>
              </div>
              <p className="text-yellow-400 font-bold mt-6 text-lg">
                El único riesgo es quedarte donde estás
              </p>
            </CardContent>
          </Card>
        </div> */}
      </div>
    </section>
  );
}
