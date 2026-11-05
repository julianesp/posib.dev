import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, Mail, MessageCircle } from "lucide-react";
import { landingConfig } from "@/lib/landing-config";

const { contact } = landingConfig;

// Mismo logo que la barra de navegación (NavbarRueda).
const LOGO_URL = "https://pub-ea40242d92ce470fbb6e43d46f01cefe.r2.dev/images/logo.png";

// Los enlaces van en blanco y pasan a verde agua al pasar el mouse. El
// `!` es necesario porque el tema global fuerza el color del texto; antes el
// hover:text-brand nunca se veía por el !text-white.
const linkClass =
  "rounded-sm text-sm !text-white transition-colors hover:!text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800";

const contactLinks = [
  {
    name: "WhatsApp",
    href: `https://wa.me/${contact.whatsapp.phoneNumber}?text=${encodeURIComponent(contact.whatsapp.defaultMessage)}`,
    icon: MessageCircle,
    external: true,
  },
  { name: contact.email, href: `mailto:${contact.email}`, icon: Mail, external: false },
  { name: "Agenda una demo", href: contact.calendly.url, icon: CalendarDays, external: true },
];

// Enlaces de navegación interna (anclas a secciones de la misma landing).
// Los id correspondientes se definen en app/page.tsx.
const navLinks = [
  { name: "Precios", href: "#precios" },
  { name: "Reseñas", href: "#resenas" },
  { name: "Preguntas frecuentes", href: "#faq" },
];

const accessLinks = [
  { name: "Entrar", href: "/sign-in" },
  { name: "Crear cuenta", href: "/sign-up" },
];

// Páginas informativas del producto/empresa.
const empresaLinks = [
  { name: "Acerca de", href: "/acerca" },
  { name: "Funcionalidades", href: "/funcionalidades" },
  { name: "Cómo empezar", href: "/como-empezar" },
  { name: "Contacto y soporte", href: "/contacto" },
];

const legalLinks = [
  { name: "Términos y condiciones", href: "/terminos" },
  { name: "Política de privacidad", href: "/privacidad" },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-700 bg-gray-800 !text-white">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          {/* Marca + descripción (en el celular ocupa las dos columnas) */}
          <div className="col-span-2 space-y-3 md:col-span-1">
            <Link
              href="/"
              aria-label={`${landingConfig.brand.name} — inicio`}
              className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
            >
              {/* Fondo blanco: el logo es oscuro y se perdería sobre el gris */}
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm">
                <Image src={LOGO_URL} alt="" width={36} height={36} />
              </span>
              <span className="text-2xl font-bold !text-white" translate="no">
                {landingConfig.brand.name}
              </span>
            </Link>
            <p className="text-sm font-medium !text-white">
              {landingConfig.brand.tagline}
            </p>
            <p className="max-w-sm text-sm !text-white">
              Sistema integral de punto de venta, inventario, facturación y
              gestión de clientes para tiendas en Colombia. Todo lo que
              necesitas en un solo plan.
            </p>
            <ul className="space-y-2 pt-2">
              {contactLinks.map(({ name, href, icon: Icon, external }) => (
                <li key={href}>
                  <a
                    href={href}
                    {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className={`inline-flex items-center gap-2 ${linkClass}`}
                  >
                    <Icon className="h-4 w-4 text-teal-300" aria-hidden="true" />
                    {name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Navegación interna */}
          <div>
            <h4 className="mb-4 text-lg font-semibold !text-white">
              Navegación
            </h4>
            <ul className="space-y-3">
              {navLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className={linkClass}
                  >
                    {link.name}
                  </a>
                </li>
              ))}
              {accessLinks.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className={`inline-flex items-center gap-1 ${linkClass}`}
                  >
                    {link.name}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Empresa / producto */}
          <div>
            <h4 className="mb-4 text-lg font-semibold !text-white">posib</h4>
            <ul className="space-y-3">
              {empresaLinks.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className={linkClass}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="mb-4 text-lg font-semibold !text-white">Legal</h4>
            <ul className="space-y-3">
              {legalLinks.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className={linkClass}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Barra inferior */}
      <div className="border-t border-gray-700">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-6 text-center md:flex-row md:text-left">
          <p className="text-xs !text-white">
            © {year} <span translate="no">{landingConfig.brand.name}</span> —
            Todos los derechos reservados · Hecho en Colombia
          </p>
          <a
            href="https://www.neurai.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-gray-600 bg-gray-700/50 py-1 pl-1 pr-3 text-xs !text-white transition-colors hover:bg-gray-700 hover:!text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand     focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
          >
            <Image
              src="/neurai-logo.png"
              alt=""
              width={20}
              height={20}
              className="rounded-full"
            />
            Hecho por neurai.dev
          </a>
        </div>
      </div>
    </footer>
  );
}
