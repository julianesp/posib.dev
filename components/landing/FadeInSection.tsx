"use client";

import { useEffect, useRef, useState } from "react";

interface FadeInSectionProps {
  children: React.ReactNode;
  /** Retraso opcional (ms) para escalonar secciones consecutivas. */
  delay?: number;
  className?: string;
}

/**
 * Envuelve una sección de la landing para que aparezca con un fade-in (opacidad
 * + leve subida) la primera vez que entra en el viewport al hacer scroll. Una
 * vez visible se queda; no se vuelve a ocultar al subir. Respeta
 * prefers-reduced-motion (solo opacidad) vía CSS en globals.css.
 */
export default function FadeInSection({
  children,
  delay = 0,
  className = "",
}: FadeInSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Navegador sin IntersectionObserver (muy raro): mostrar sin animación,
    // diferido con rAF para no llamar a setState síncronamente en el efecto.
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect(); // una sola vez
        }
      },
      // threshold 0 + margen inferior negativo grande: la animación no se
      // dispara al asomar apenas por el borde inferior (donde el usuario ni la
      // ve porque termina antes de llegar), sino cuando la sección ya subió
      // ~25% dentro del viewport, bien a la vista. Así se alcanza a ver el
      // fade-in completo.
      { threshold: 0, rootMargin: "0px 0px -25% 0px" },
    );

    observer.observe(el);

    // Red de seguridad: una sección al final de la página (sin scroll suficiente
    // debajo) podría no llegar nunca a subir el 25% y quedaría invisible. Un
    // segundo observer, sin margen inferior, la revela si de plano ya está
    // enteramente dentro del viewport (llegó al fondo). No compite con la
    // animación normal: solo cubre el borde de la última sección.
    const fallback = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          fallback.disconnect();
          observer.disconnect();
        }
      },
      { threshold: 0.9 },
    );
    fallback.observe(el);

    return () => {
      observer.disconnect();
      fallback.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`fade-in-section ${visible ? "is-visible" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
