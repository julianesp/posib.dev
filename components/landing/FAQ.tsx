"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const faqs = [
  {
    category: "General",
    questions: [
      {
        question: "¿Qué es posib.dev?",
        answer:
          "posib.dev es un sistema POS (Punto de Venta) completo diseñado para pequeños y medianos negocios en Colombia. Te permite gestionar ventas, inventario, clientes, proveedores y más, todo desde una plataforma fácil de usar.",
      },
      {
        question: "¿Necesito experiencia técnica para usar el sistema?",
        answer:
          "No, nuestro sistema está diseñado para ser intuitivo y fácil de usar. Si sabes usar WhatsApp, puedes usar nuestro POS.",
      },
    ],
  },
  {
    category: "Planes y Precios",
    questions: [
      {
        question: "¿Puedo probar el sistema antes de pagar?",
        answer:
          "Sí, todos los planes incluyen 30 días de prueba gratis con acceso completo a todas las funcionalidades. No se requiere tarjeta de crédito para iniciar la prueba.",
      },
      {
        question: "¿Qué incluye el plan?",
        answer:
          "Con el Plan Básico ($24.900/mes) tienes todo incluido: POS, inventario, clientes, proveedores, créditos y deudores, ofertas, y además el Análisis con IA para saber cómo va tu negocio y el Email Marketing para mantener a tus clientes informados de nuevos pedidos o descuentos exclusivos. Todo en un solo precio, sin complementos que pagar aparte.",
      },
      {
        question:
          "¿El Análisis con IA y el Email Marketing tienen costo extra?",
        answer:
          "No. Antes eran complementos de pago aparte, pero ahora vienen incluidos en el Plan Básico de $24.900/mes sin ningún costo adicional.",
      },
      {
        question: "¿Hay costos ocultos?",
        answer:
          "No, el precio que ves es el precio que pagas. No hay cargos ocultos, ni tarifas de instalación, ni complementos que pagar aparte. Solo pagas tus $24.900 al mes y tienes todo incluido.",
      },
    ],
  },

  {
    category: "Soporte y Seguridad",
    questions: [
      {
        question: "¿Qué tipo de soporte ofrecen?",
        answer: "Todos los planes incluyen soporte por email y chat en vivo.",
      },

      {
        question: "¿Puedo exportar mis datos si decido cambiar de sistema?",
        answer:
          "Sí, puedes exportar tus productos, clientes y ventas en cualquier momento en formato Excel o CSV, directamente desde cada sección del panel.",
      },
    ],
  },
];

export default function FAQ() {
  const [openItems, setOpenItems] = useState<string[]>([]);

  const toggleItem = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <section className="py-16 md:py-20 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <div className="flex justify-center mb-4">
            <div className="bg-brand/20 rounded-full p-3">
              <HelpCircle className="h-10 w-10 text-brand/80" />
            </div>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold !text-white mb-4">
            Preguntas Frecuentes
          </h2>
          <p className="text-lg !text-white max-w-2xl mx-auto">
            Encuentra respuestas a las preguntas más comunes sobre nuestro
            sistema POS
          </p>
        </div>

        <div className="max-w-4xl mx-auto space-y-8">
          {faqs.map((category, categoryIndex) => (
            <div key={categoryIndex}>
              <h3 className="text-2xl font-bold !text-white mb-4 flex items-center gap-2">
                <span className="w-1 h-8 bg-brand rounded"></span>
                {category.category}
              </h3>
              <div className="space-y-3">
                {category.questions.map((faq, questionIndex) => {
                  const id = `${categoryIndex}-${questionIndex}`;
                  const isOpen = openItems.includes(id);

                  return (
                    <Card
                      key={id}
                      data-open={isOpen ? "true" : "false"}
                      className="faq-item bg-gray-800/50 border-gray-700 hover:border-gray-600 transition-colors"
                    >
                      <button
                        onClick={() => toggleItem(id)}
                        className="w-full text-left p-4 focus:outline-none focus:ring-2 focus:ring-brand rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <h4 className="text-lg font-semibold !text-white pr-8">
                            {faq.question}
                          </h4>
                          <ChevronDown className="faq-chevron h-5 w-5 !text-white flex-shrink-0 transition-transform" />
                        </div>
                        {/*
                          La respuesta se renderiza siempre para poder animarla.
                          Se despliega cuando data-open="true" (clic) y, en
                          computadores con cursor (>=1024px), también al hover.
                        */}
                        <div className="faq-answer grid grid-rows-[0fr] opacity-0 transition-all duration-300 ease-out">
                          <div className="overflow-hidden">
                            <CardContent className="pt-4 pb-2 px-0">
                              <p className="!text-white leading-relaxed">
                                {faq.answer}
                              </p>
                            </CardContent>
                          </div>
                        </div>
                      </button>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* CTA de contacto */}
        <div className="mt-12 text-center">
          <p className="!text-white mb-4">¿No encuentras lo que buscas?</p>
          <a
            href="https://wa.me/573174503604?text=Hola,%20tengo%20una%20pregunta%20sobre%20el%20sistema%20POS"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand hover:bg-brand/90 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            Contáctanos por WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}
