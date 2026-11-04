import Image from "next/image";
import Link from "next/link";

/**
 * Botón flotante de soporte por WhatsApp (Configuración, Suscripción). Va abajo
 * a la IZQUIERDA del contenido, junto al menú (--sidebar-w lo publica el menú
 * lateral), porque abajo a la derecha está el acceso a la tienda
 * (StoreQuickAccess) y lo tapaba.
 */
export function SupportWhatsAppButton({ message }: { message: string }) {
  return (
    <Link
      href={`https://wa.me/573174503604?text=${encodeURIComponent(message)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 left-4 z-50 transition-transform hover:scale-110 md:left-[calc(var(--sidebar-w,16rem)+1rem)]"
      aria-label="Contactar a soporte por WhatsApp"
    >
      <Image
        src="https://pub-c0883d14d3e84a69bf84546fa108aa0b.r2.dev/socialmedia/social%20(1).png"
        alt="WhatsApp"
        className="h-14 w-14 drop-shadow-lg md:h-16 md:w-16"
        width={50}
        height={50}
      />
    </Link>
  );
}
