import Link from "next/link";
import { ArrowLeft, MessageCircle, Mail, CalendarClock } from "lucide-react";
import { landingConfig } from "@/lib/landing-config";

export const metadata = {
  title: "Contacto y soporte | posib.dev",
  description:
    "¿Necesitas ayuda con posib.dev? Escríbenos por WhatsApp o correo, o pide una demostración gratuita por WhatsApp. Soporte para tu tienda cuando lo necesites.",
};

export default function ContactoPage() {
  const { whatsapp, email } = landingConfig.contact;
  const waLink = `https://wa.me/${whatsapp.phoneNumber}?text=${encodeURIComponent(
    whatsapp.defaultMessage,
  )}`;
  // La demostración se pide por WhatsApp con el mensaje ya escrito.
  const demoLink = `https://wa.me/${whatsapp.phoneNumber}?text=${encodeURIComponent(
    whatsapp.demoMessage,
  )}`;

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-600 to-gray-200">
      <div className="container mx-auto max-w-3xl px-4 py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-white/80 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>

        <article className="rounded-2xl bg-gray-800 p-6 text-gray-200 shadow-2xl md:p-10">
          <h1 className="mb-2 text-3xl font-bold text-white">
            Contacto y soporte
          </h1>
          <p className="mb-8 text-base text-gray-400">
            ¿Tienes dudas o necesitas ayuda? Estamos para acompañarte. Elige el
            canal que prefieras.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* WhatsApp */}
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col rounded-2xl border border-gray-700 bg-gray-900/40 p-6 transition-colors hover:border-brand/60 hover:bg-gray-900/70"
            >
              <div className="mb-3 inline-flex w-fit rounded-full bg-brand-light p-3">
                <MessageCircle className="h-6 w-6 text-brand" />
              </div>
              <h2 className="text-lg font-semibold text-white">WhatsApp</h2>
              <p className="mt-1 text-sm text-gray-400">
                La forma más rápida de resolver tus dudas. Escríbenos y te
                respondemos.
              </p>
              <span className="mt-3 text-sm font-medium text-brand">
                Escribir por WhatsApp →
              </span>
            </a>

            {/* Email */}
            <a
              href={`mailto:${email}`}
              className="group flex flex-col rounded-2xl border border-gray-700 bg-gray-900/40 p-6 transition-colors hover:border-brand/60 hover:bg-gray-900/70"
            >
              <div className="mb-3 inline-flex w-fit rounded-full bg-brand-light p-3">
                <Mail className="h-6 w-6 text-brand" />
              </div>
              <h2 className="text-lg font-semibold text-white">Correo</h2>
              <p className="mt-1 text-sm text-gray-400">
                Para consultas más detalladas o soporte. Te respondemos por
                correo.
              </p>
              <span className="mt-3 break-all text-sm font-medium text-brand">
                {email}
              </span>
            </a>

            {/* Pedir demo por WhatsApp */}
            <a
              href={demoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col rounded-2xl border border-gray-700 bg-gray-900/40 p-6 transition-colors hover:border-brand/60 hover:bg-gray-900/70 sm:col-span-2"
            >
              <div className="mb-3 inline-flex w-fit rounded-full bg-brand-light p-3">
                <CalendarClock className="h-6 w-6 text-brand" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                Pide una demostración
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                ¿Prefieres que te mostremos cómo funciona? Escríbenos por
                WhatsApp, acordamos el día y la hora, y te guiamos paso a paso,
                sin compromiso.
              </p>
              <span className="mt-3 text-sm font-medium text-brand">
                Pedir mi demostración por WhatsApp →
              </span>
            </a>
          </div>
        </article>
      </div>
    </div>
  );
}
