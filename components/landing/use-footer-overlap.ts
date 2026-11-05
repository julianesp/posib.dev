"use client";

import { useEffect, useState } from "react";

// Alto de la barra superior fija más el botón: si el footer sube más arriba
// que esto (celular, donde el footer es más alto que la pantalla), el botón
// quedaría sobre la barra, así que se oculta.
const HIDE_ABOVE_PX = 150;

/**
 * Cuánto se mete el footer en la pantalla (px). El botón sube esa cantidad
 * para quedarse justo encima del footer en vez de taparlo.
 */
export function useFooterOverlap() {
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
