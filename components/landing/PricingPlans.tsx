"use client";

import { Check, Sparkles, Mail } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const basePlan = {
  name: "Plan Básico",
  price: "$24.900",
  priceValue: 24900,
  description: "Todo lo que tu negocio necesita, en un solo plan",
  features: [
    "Punto de Venta (POS)",
    "Gestión de inventario completa",
    "Hasta 100 productos",
    "Gestión de clientes y proveedores",
    "Reportes y estadísticas básicas",
    "Sistema de créditos y deudores",
    "Ofertas y promociones",
    "Soporte técnico por email",
  ],
};

// Funcionalidades que ANTES eran complementos de pago aparte y ahora vienen
// incluidas sin costo adicional dentro del Plan Básico de $24.900.
const includedFeatures = [
  {
    name: "Análisis con IA",
    icon: Sparkles,
    color: "purple",
    description: "Predicciones y análisis inteligentes",
    features: [
      "Predicciones de ventas automáticas",
      "Análisis de tendencias y patrones",
      "Recomendaciones de inventario inteligentes",
      "Alertas automáticas",
      "Detección de anomalías en ventas",
    ],
  },
  {
    name: "Email Marketing",
    icon: Mail,
    color: "green",
    description: "Automatiza tu comunicación con clientes",
    features: [
      "Reportes diarios por email",
      "Campañas personalizadas",
      "Segmentación de clientes",
      "Analytics de emails enviados",
    ],
  },
];

const getColorClasses = (color: string) => {
  const colors: Record<string, { border: string; bg: string; accent: string }> =
    {
      purple: {
        border: "border-purple-400",
        bg: "bg-purple-500/10",
        accent: "text-purple-400",
      },
      blue: {
        border: "border-brand/80",
        bg: "bg-brand/10",
        accent: "text-brand/80",
      },
      green: {
        border: "border-green-400",
        bg: "bg-green-500/10",
        accent: "text-green-400",
      },
    };
  return colors[color] || colors.purple;
};

export default function PricingPlans() {
  return (
    <section className="py-16 md:py-20 bg-white/5 backdrop-blur-sm">
      <div className="container mx-auto px-4 ">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Plan para tu negocio
          </h2>
          <p className="text-lg text-white/80 max-w-2xl mx-auto">
            El plan de la tienda incluye todas las funcionalidades del POS, el
            Análisis con IA y el Email Marketing, sin costos adicionales.
          </p>
        </div>

        {/* Plan Base */}
        <div className="max-w-2xl mx-auto mb-12">
          <Card className="border-4 border-brand shadow-2xl bg-gray-800">
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-brand text-white text-sm font-bold px-4 py-1 rounded-full">
                Todo Incluido
              </span>
            </div>

            <CardHeader className="text-center pb-4 pt-8">
              <CardTitle className="text-3xl !text-white">
                {basePlan.name}
              </CardTitle>
              <CardDescription className="!text-white text-lg">
                {basePlan.description}
              </CardDescription>
              <div className="mt-4">
                <span className="text-5xl font-bold !text-white">
                  {basePlan.price}
                </span>
                <span className="!text-white text-lg">/mes</span>
              </div>
            </CardHeader>

            <CardContent>
              <ul className="space-y-3 mb-6">
                {basePlan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <span className="!text-white text-sm">{feature}</span>
                  </li>
                ))}
                <li className="flex items-start gap-2">
                  <Sparkles className="h-5 w-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <span className="!text-white text-sm">
                    <strong className="!text-white">Análisis con IA</strong>{" "}
                    incluido
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Mail className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="!text-white text-sm">
                    <strong className="!text-white">Email Marketing</strong>{" "}
                    incluido
                  </span>
                </li>
              </ul>

              <Link href="/sign-up" className="block">
                <Button className="w-full bg-brand text-white hover:bg-brand-hover text-lg py-6 cursor-pointer">
                  Comenzar con Plan Básico
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Funcionalidades incluidas (antes eran complementos de pago) */}
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-3">
              Y además, incluido sin costo adicional
            </h3>
            <p className="text-white/80 text-[20px]">
              Estas funcionalidades ya vienen con tu Plan Básico de $24.900
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {includedFeatures.map((feature) => {
              const colors = getColorClasses(feature.color);
              const Icon = feature.icon;

              return (
                <Card
                  key={feature.name}
                  className="relative border-2 border-brand bg-gray-800 hover:shadow-2xl transition-shadow"
                >
                  <div className="absolute -top-3 right-4">
                    <span className="bg-green-500 !text-white text-xs font-bold px-3 py-1 rounded-full">
                      Incluido
                    </span>
                  </div>
                  <CardHeader className="text-center pb-3 pt-6">
                    <div
                      className={`w-14 h-14 mx-auto mb-3 rounded-full ${colors.bg} flex items-center justify-center border-2 ${colors.border}`}
                    >
                      <Icon className={`h-7 w-7 ${colors.accent}`} />
                    </div>
                    <CardTitle className="text-xl !text-white mb-2">
                      {feature.name}
                    </CardTitle>
                    <CardDescription className="!text-white text-2xl">
                      {feature.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="pt-0">
                    <ul className="space-y-2 min-h-[140px]">
                      {feature.features.slice(0, 5).map((item, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-brand mt-0.5" />
                          <span className="!text-white text-[16px] leading-tight">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mt-12 text-center">
          <p className="text-white/70 text-sm">
            ✨ <strong>30 días de prueba gratis</strong> con acceso completo a
            todas las funcionalidades. Sin tarjeta de crédito.
          </p>
          <p className="text-white/60 text-xs mt-2">
            Un solo precio, sin complementos ni cargos adicionales
          </p>
        </div>
      </div>
    </section>
  );
}
