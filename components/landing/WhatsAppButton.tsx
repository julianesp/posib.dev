"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Alto de la barra superior fija más el botón: si el footer sube más arriba
// que esto (celular, donde el footer es más alto que la pantalla), el botón
// quedaría sobre la barra, así que se oculta.
const HIDE_ABOVE_PX = 150;

/**
 * Cuánto se mete el footer en la pantalla (px). El botón sube esa cantidad
 * para quedarse justo encima del footer en vez de taparlo.
 */
function useFooterOverlap() {
  const [overlap, setOverlap] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = footer.getBoundingClientRect().top;
        setOverlap(Math.max(0, Math.round(window.innerHeight - top)));
        setHidden(top < HIDE_ABOVE_PX);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { overlap, hidden };
}

export default function WhatsAppButton() {
  const { overlap: footerOverlap, hidden } = useFooterOverlap();

  const handleWhatsAppClick = () => {
    // Reemplaza con tu número de WhatsApp (incluye código de país sin + ni espacios)
    const phoneNumber = "573174503604"; // Ejemplo: Colombia
    const message = encodeURIComponent(
      "Hola, me gustaría saber más sobre el sistema POS",
    );
    window.open(`https://wa.me/${phoneNumber}?text=${message}`, "_blank");
  };

  return (
    <Button
      onClick={handleWhatsAppClick}
      // Pegado a la esquina inferior izquierda (en iPhone respeta la barra de
      // inicio); al llegar al footer se queda encima de él.
      style={{
        bottom: `calc(max(0.5rem, env(safe-area-inset-bottom)) + ${footerOverlap}px)`,
      }}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      className={`fixed left-2 z-50 cursor-pointer ${hidden ? "pointer-events-none opacity-0" : "opacity-100"} rounded-full w-14 h-14 shadow-2xl shadow-brand/30 bg-brand hover:bg-brand-hover text-white transition-all hover:scale-110 animate-bounce`}
      size="icon"
      aria-label="Contactar por WhatsApp"
    >
      {/* Glifo de WhatsApp (Simple Icons, CC0) en blanco sobre el color
          principal del sistema, en vez del PNG verde. */}
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="!h-7 !w-7">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
      </svg>
    </Button>
  );
}
