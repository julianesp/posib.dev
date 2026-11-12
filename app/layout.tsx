import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Instrument_Sans, Outfit } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import { esMX } from '@clerk/localizations';
import Script from 'next/script';
import "./globals.css";
import { Analytics } from "@vercel/analytics/next"
import HourTheme from '@/components/HourTheme';
import AppToaster from '@/components/AppToaster';
import SignupConversionTracker from '@/components/SignupConversionTracker';
import SiteVisitTracker from '@/components/SiteVisitTracker';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { ACCENT_INIT_SCRIPT } from '@/lib/accent';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Sistema (dashboard): Instrument Sans para el texto y Bricolage Grotesque para
// títulos y cifras grandes. Ver .app-shell en globals.css.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

// Solo para el texto del logo (components/brand/posib-logo.css).
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const SITE_DESCRIPTION =
  'Sistema POS (punto de venta) en Colombia para tiendas, minimarkets y negocios de barrio. Gestiona ventas, inventario, facturación, clientes y ventas a crédito con pagos en efectivo y Nequi. Pruébalo gratis 30 días.';

export const metadata: Metadata = {
  title: {
    default: 'posib.dev | Sistema POS para tiendas en Colombia',
    template: '%s | posib.dev',
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL('https://posib.dev'),
  applicationName: 'posib.dev',
  keywords: [
    'sistema POS',
    'punto de venta',
    'software POS Colombia',
    'sistema punto de venta',
    'programa para tiendas',
    'software de inventario',
    'gestión de inventario',
    'facturación electrónica',
    'sistema para tiendas de barrio',
    'control de ventas',
    'software para minimarket',
    'caja registradora digital',
    'ventas a crédito',
    'POS Nequi',
    'administrar tienda',
  ],
  authors: [{ name: 'posib.dev' }],
  creator: 'posib.dev',
  publisher: 'posib.dev',
  category: 'business',
  alternates: {
    canonical: 'https://posib.dev',
  },
  openGraph: {
    type: 'website',
    locale: 'es_CO',
    url: 'https://posib.dev',
    title: 'posib.dev | Sistema POS para tiendas en Colombia',
    description: SITE_DESCRIPTION,
    siteName: 'posib.dev',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'posib.dev - Sistema POS para tiendas en Colombia',
        type: 'image/png',
      }
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'posib.dev | Sistema POS para tiendas en Colombia',
    description: SITE_DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        alt: 'posib.dev - Sistema POS para tiendas en Colombia',
      }
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/posib-icono.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'posib.dev',
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#007C80",
};

// Datos estructurados (Schema.org) para que los buscadores entiendan que es
// un software de punto de venta y puedan mostrar resultados enriquecidos.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'posib.dev',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: SITE_DESCRIPTION,
  url: 'https://posib.dev',
  inLanguage: 'es-CO',
  image: 'https://posib.dev/icon-512x512.png',
  areaServed: {
    '@type': 'Country',
    name: 'Colombia',
  },
  offers: {
    '@type': 'Offer',
    price: '24900',
    priceCurrency: 'COP',
    description: 'Plan Básico mensual. Incluye 30 días de prueba gratis.',
  },
  featureList: [
    'Punto de venta (POS)',
    'Control de inventario',
    'Facturación',
    'Gestión de clientes',
    'Ventas a crédito y cuentas por cobrar',
    'Reportes y analítica de ventas',
    'Pagos en efectivo y Nequi',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Español para todo lo que dibuja Clerk (menú de usuario, inicio de sesión, cuenta).
    // No hay variante es-CO; es-MX es la más cercana.
    <ClerkProvider
      localization={esMX}
      appearance={{
        // Logo nuevo en todos los formularios de Clerk (sustituye al que
        // estaba configurado en el panel de Clerk).
        layout: { logoImageUrl: '/posib-logo.svg', logoPlacement: 'inside' },
        elements: { logoBox: 'h-10', logoImage: 'h-10 w-auto' },
      }}
    >
      <html lang="es" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
          <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} ${bricolage.variable} ${outfit.variable} antialiased`}
        >
          {/* JSON-LD para SEO: se sirve en el HTML del servidor y lo leen los
              bots del DOM; no necesita ejecutarse como JS, por eso es un
              <script> plano y no next/script (recomendación oficial de Next). */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
          <Script
            src="https://checkout.epayco.co/checkout.js"
            strategy="lazyOnload"
          />
          {/* Google Ads (gtag.js) — mide conversiones de la campaña Performance Max.
              La etiqueta base carga en todo el sitio; los eventos de conversión
              (p. ej. registro) se disparan aparte con gtag('event', 'conversion', …). */}
          <Script
            id="google-ads-gtag-src"
            src="https://www.googletagmanager.com/gtag/js?id=AW-17995545981"
            strategy="afterInteractive"
          />
          <Script id="google-ads-gtag-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'AW-17995545981');
            `}
          </Script>
          {children}
          <Analytics />
          <HourTheme />
          <SiteVisitTracker />
          <SignupConversionTracker />
          <AppToaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
