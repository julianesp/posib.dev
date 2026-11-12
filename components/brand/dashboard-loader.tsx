"use client";

import { useEffect, useState } from "react";
import PosibLogo from "./posib-logo";

/** Tiempo mínimo en pantalla para que se alcance a ver cómo se arma el logo. */
const MIN_MS = 800;

/**
 * Pantalla de carga del dashboard: el logo se arma y, mientras se verifica la
 * sesión y la suscripción, el aro gira. Al terminar se desvanece.
 */
export default function DashboardLoader({ show }: { show: boolean }) {
  const [minDone, setMinDone] = useState(false);
  const [spin, setSpin] = useState(false);
  const [gone, setGone] = useState(false);

  const visible = show || !minDone;

  useEffect(() => {
    const t1 = setTimeout(() => setMinDone(true), MIN_MS);
    const t2 = setTimeout(() => setSpin(true), 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (visible) return;
    const t = setTimeout(() => setGone(true), 350);
    return () => clearTimeout(t);
  }, [visible]);

  if (gone) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Cargando posib.dev"
      className="fixed inset-0 z-[200] flex items-center justify-center transition-opacity duration-300"
      style={{
        background: "var(--shell-canvas, #f6f3ec)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <PosibLogo size={64} enter loading={spin} />
    </div>
  );
}
