import Link from "next/link";
import Image from "next/image";
import {
  ShoppingCart,
  Package,
  BarChart3,
  Users,
  ArrowRight,
  CreditCard,
  TrendingUp,
  Bell,
  Gift,
  Smartphone,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import NavbarRueda from "@/components/landing/NavbarRueda";
import FadeInSection from "@/components/landing/FadeInSection";
import WhatsAppButton from "@/components/landing/WhatsAppButton";
import BackToTop from "@/components/landing/BackToTop";
import AuthCtas from "@/components/landing/AuthCtas";
import PricingPlans from "@/components/landing/PricingPlans";
import WhyPosib from "@/components/landing/WhyPosib";
import ProcessShowcase from "@/components/landing/process-showcase/ProcessShowcase";
import FreeMigration from "@/components/landing/FreeMigration";
import TrustBadges from "@/components/landing/TrustBadges";
import VideoTutorials from "@/components/landing/VideoTutorials";
import OvercomeResistance from "@/components/landing/OvercomeResistance";
import ClientStores from "@/components/landing/ClientStores";
import PosReviews from "@/components/landing/PosReviews";
import FAQ from "@/components/landing/FAQ";
import Footer from "@/components/landing/Footer";
import LandingShell from "@/components/landing/LandingShell";
import { landingConfig } from "@/lib/landing-config";

export default function Home() {
  return (
    <LandingShell>
      {/* Header */}
      <NavbarRueda />

      {/* WhatsApp Button */}
      <WhatsAppButton />
      <BackToTop />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Glow de fondo centrado */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% -10%, var(--landing-glow) 0%, transparent 70%)",
          }}
        />
        <div className="container relative mx-auto px-4 pt-28 md:pt-44 pb-16 md:pb-24 text-center">
          {/* Etiqueta de confianza */}
          <div className="lp-badge inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium mb-8 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            Sistema POS para tiendas colombianas
          </div>

          <h1 className="lp-text text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight mb-5 leading-[1.05]">
            Tu tienda, <span className="text-brand">bajo control</span>
          </h1>
          <p className="lp-muted text-base sm:text-lg md:text-xl mb-10 max-w-xl mx-auto leading-relaxed px-2">
            Punto de venta, inventario, fiados y reportes — todo desde el
            celular que ya tienes. Sin cajas registradoras ni equipos costosos.
          </p>
          <AuthCtas />

          {/* Social proof mínimo */}
          <p className="lp-text mt-8 inline-block rounded-2xl border-2 border-brand px-4 py-2 text-xs font-medium leading-relaxed">
            Sin tarjeta de crédito · Cancela cuando quieras · Soporte en español
          </p>
        </div>
      </section>

      {/* Del caos al control */}
      <FadeInSection>
        <section className="lp-section-sep border-t">
          <div className="container mx-auto px-4 py-16 md:py-24">
            <div className="text-center mb-12 md:mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">
                Para la tienda de barrio
              </p>
              <h2 className="lp-text text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
                Del cuaderno al control total
              </h2>
              <p className="lp-muted text-base max-w-lg mx-auto">
                Mira cómo posib.dev transforma el día a día de tu negocio
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-5xl mx-auto">
              <div className="lp-card lp-border group relative overflow-hidden rounded-2xl ring-1">
                <div className="relative aspect-[4/5] overflow-hidden">
                  <Image
                    src="https://pub-ea40242d92ce470fbb6e43d46f01cefe.r2.dev/images/homepage_1.jpg"
                    alt="Tendero abrumado entre montañas de ventas y recibos en papel"
                    fill
                    sizes="(max-width: 768px) 100vw, 480px"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <span className="inline-block rounded-full bg-white border border-black/10 text-black text-xs font-semibold px-3 py-1 mb-3">
                      Antes
                    </span>
                    <h3 className="text-xl font-bold !text-white dark:!text-white">
                      Papeles, cuadernos y cuentas perdidas
                    </h3>
                    <p className="text-sm !text-white mt-1 dark:!text-white">
                      Sin saber cuánto vendiste hoy ni cuánto te deben
                    </p>
                  </div>
                </div>
              </div>

              <div className="lp-card group relative overflow-hidden rounded-2xl ring-1 ring-brand/20">
                <div className="relative aspect-4/5 overflow-hidden">
                  <Image
                    src="https://pub-ea40242d92ce470fbb6e43d46f01cefe.r2.dev/images/homepage_2.jpg"
                    alt="Panel de control mostrando ventas y tendencias de la tienda"
                    fill
                    sizes="(max-width: 768px) 100vw, 480px"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-6 text-white dark:text-white">
                    <span className="inline-block rounded-full bg-white border border-brand/30 text-brand text-xs font-semibold px-3 py-1 mb-3">
                      Con posib
                    </span>
                    <h3 className="text-xl font-bold !text-white dark:!text-white">
                      Ventas, inventario y fiados en tu celular
                    </h3>
                    <p className="text-sm !text-white mt-1 dark:!text-white">
                      La IA te muestra qué vender más y qué reponer
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center mt-10">
              <Link href="/sign-up">
                <Button
                  size="lg"
                  className="bg-brand hover:bg-brand-hover text-white cursor-pointer shadow-lg shadow-brand/20"
                >
                  Quiero verlo en mi tienda
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </FadeInSection>

      {/* Demos animadas de cada proceso (registrar producto, vender, fiados, etc.) */}
      <FadeInSection>
        <ProcessShowcase />
      </FadeInSection>

      {/* Por qué posib llega a cualquier tienda: sin equipos, fiados, reporte diario y respaldo en nube */}
      <FadeInSection>
        <WhyPosib />
      </FadeInSection>

      {/* Videos */}
      <FadeInSection>
        <section className="lp-section-sep border-t">
          <div className="container mx-auto px-4 py-16 md:py-20">
            <div className="text-center mb-10">
              <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">
                Vélo en acción
              </p>
              <h2 className="lp-text text-2xl md:text-3xl font-bold">
                El sistema en 2 minutos
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
              <div className="lp-card lp-border rounded-2xl overflow-hidden ring-1">
                <div className="aspect-video">
                  <iframe
                    className="w-full h-full"
                    src="https://www.youtube.com/embed/I6qJtQ1t2rQ"
                    title="Demo: Punto de Venta Rápido"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="p-4">
                  <p className="lp-text font-semibold text-sm">
                    Punto de Venta Rápido
                  </p>
                  <p className="lp-muted text-xs mt-0.5">
                    Escanea, cobra y registra en segundos
                  </p>
                </div>
              </div>
              <div className="lp-card lp-border rounded-2xl overflow-hidden ring-1">
                <div className="aspect-video">
                  <iframe
                    className="w-full h-full"
                    src="https://www.youtube.com/embed/b-yYlIAqopM"
                    title="Demo: Vende un producto"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="p-4">
                  <p className="lp-text font-semibold text-sm">
                    Registra una venta
                  </p>
                  <p className="lp-muted text-xs mt-0.5">
                    Lleva el historial de cada transacción
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </FadeInSection>

      {/* Funcionalidades principales — bento oscuro */}
      <FadeInSection>
        <section className="lp-section-sep border-t">
          <div className="container mx-auto px-4 py-16 md:py-24">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">
                Todo en uno
              </p>
              <h2 className="lp-text text-2xl sm:text-3xl md:text-4xl font-bold">
                Funcionalidades principales
              </h2>
              <p className="lp-muted mt-3 max-w-lg mx-auto text-sm">
                Todo lo que necesitas para administrar tu tienda de manera
                profesional
              </p>
            </div>

            {/* Bento 2×2 grande + items listados */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-5xl mx-auto mb-6">
              {[
                {
                  icon: ShoppingCart,
                  title: "Punto de Venta",
                  desc: "POS rápido con escaneo de código de barras, múltiples métodos de pago y recibos digitales.",
                  accent: true,
                },
                {
                  icon: Package,
                  title: "Control de Inventario",
                  desc: "Stock en tiempo real, alertas de agotamiento y control de vencimientos.",
                  accent: false,
                },
                {
                  icon: BarChart3,
                  title: "Reportes y Ganancias",
                  desc: "Ventas del día, productos más rentables y comparativos por período.",
                  accent: false,
                },
                {
                  icon: Users,
                  title: "Gestión de Clientes",
                  desc: "Historial de compras, cuentas por cobrar (fiados) y puntos de lealtad.",
                  accent: false,
                },
              ].map(({ icon: Icon, title, desc, accent }) => (
                <div
                  key={title}
                  className={`group rounded-2xl p-6 ring-1 transition-all duration-200 hover:ring-brand/40 ${
                    accent ? "bg-brand/10 ring-brand/20" : "lp-card lp-border"
                  }`}
                >
                  <div
                    className={`inline-flex rounded-xl p-2.5 mb-4 ${accent ? "bg-brand/20" : "lp-icon-bg"}`}
                  >
                    <Icon
                      className={`h-5 w-5 ${accent ? "text-brand" : "text-brand"}`}
                    />
                  </div>
                  <h3 className="lp-text font-semibold mb-1.5">{title}</h3>
                  <p className="lp-muted text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>

            {/* Features secundarias en fila compacta */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-5xl mx-auto">
              {[
                { icon: Gift, label: "Ofertas y descuentos" },
                { icon: Bell, label: "Alertas de stock y vencimientos" },
                { icon: Users, label: "Multi-usuario con roles" },
                { icon: CreditCard, label: "Efectivo, Nequi y crédito" },
                { icon: Smartphone, label: "Celular, tablet y PC" },
                { icon: TrendingUp, label: "Reportes diarios automáticos" },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="lp-card lp-border flex items-center gap-3 rounded-xl px-4 py-3 ring-1"
                >
                  <Icon className="h-4 w-4 text-brand shrink-0" />
                  <span className="lp-muted text-sm">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </FadeInSection>

      {/* Tiendas Clientes */}
      <FadeInSection>
        <ClientStores />
      </FadeInSection>

      {/* Reseñas del sistema POS */}
      <FadeInSection>
        <div id="resenas" className="scroll-mt-24">
          <PosReviews />
        </div>
      </FadeInSection>

      {/* Pricing Plans */}
      <FadeInSection>
        <div id="precios" className="scroll-mt-24">
          <PricingPlans />
        </div>
      </FadeInSection>

      {/* Free Migration */}
      {/* <FreeMigration /> */}

      {/* Trust & Social Proof */}
      {/* <TrustBadges /> */}

      {/* Overcome Resistance to Change */}
      <FadeInSection>
        <OvercomeResistance />
      </FadeInSection>

      {/* Video Tutorials */}
      {/* <VideoTutorials /> */}

      {/* FAQ */}
      <FadeInSection>
        <div id="faq" className="scroll-mt-24">
          <FAQ />
        </div>
      </FadeInSection>

      {/* CTA final */}
      <FadeInSection>
        <section className="lp-section-sep border-t">
          <div className="container mx-auto px-4 py-20 md:py-28 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-4">
              Empieza hoy
            </p>
            <h2 className="lp-text text-3xl sm:text-4xl md:text-5xl font-extrabold mb-4 tracking-tight">
              Tu tienda, bajo control
            </h2>
            <p className="lp-muted text-base max-w-md mx-auto mb-10">
              30 días gratis sin tarjeta. Configura en minutos y empieza a
              vender hoy mismo.
            </p>
            <AuthCtas primaryLabel="Crear cuenta gratis" />
            <p className="lp-text mt-6 inline-block rounded-2xl border-2 border-brand px-4 py-2 text-xs font-medium leading-relaxed">
              Sin tarjeta de crédito · Cancela cuando quieras · Soporte en
              español
            </p>
          </div>
        </section>
      </FadeInSection>

      {/* Footer */}
      <Footer />

      {/* Chat en Vivo con Tawk.to */}
      {/* <TawkToChat
        propertyId={landingConfig.contact.tawkTo.propertyId}
        widgetId={landingConfig.contact.tawkTo.widgetId}
      /> */}
    </LandingShell>
  );
}
