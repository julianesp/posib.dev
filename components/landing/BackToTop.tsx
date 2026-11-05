"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useFooterOverlap } from "./use-footer-overlap";

// A partir de cuánto scroll aparece la flecha (más o menos una pantalla).
const SHOW_AFTER_PX = 600;

/**
 * Flecha flotante para volver arriba en la landing. Va en la esquina inferior
 * derecha (la izquierda es de WhatsApp) y, igual que ese botón, se detiene
 * encima del footer en vez de taparlo.
 */
export default function BackToTop() {
  const { overlap: footerOverlap, hidden: overFooter } = useFooterOverlap();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > SHOW_AFTER_PX);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const visible = scrolled && !overFooter;

  const goTop = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Volver arriba"
      title="Volver arriba"
      aria-hidden={!visible || undefined}
      tabIndex={visible ? undefined : -1}
      style={{
        bottom: `calc(max(0.5rem, env(safe-area-inset-bottom)) + ${footerOverlap}px)`,
      }}
      className={`fixed right-2 z-50 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-brand text-white shadow-xl shadow-brand/30 transition-all duration-300 hover:scale-110 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
