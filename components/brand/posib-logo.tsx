"use client";

import { useState, type AnimationEvent, type CSSProperties } from "react";
import "./posib-logo.css";

type PosibLogoProps = {
  /** Alto del ícono en px (el texto y los espacios escalan con él). */
  size?: number;
  /** Solo el ícono, sin el texto "posib.dev". */
  iconOnly?: boolean;
  /**
   * Color de las letras:
   * - "auto": oscuras en tema claro, claras cuando html[data-theme="dark"]
   * - "dark": siempre claras (para fondos oscuros fijos, como el footer)
   * - "light": siempre oscuras
   */
  tone?: "auto" | "dark" | "light";
  /** Animación de entrada, una sola vez al montarse. */
  enter?: boolean;
  /** El punto late en bucle (sistema activo). */
  pulse?: boolean;
  /** El aro gira como indicador de carga. */
  loading?: boolean;
  /**
   * El texto pierde su "p" inicial ("osib.dev"): la "p" del ícono hace de
   * primera letra y el nombre se lee completo, "posib.dev".
   */
  joined?: boolean;
  className?: string;
};

export default function PosibLogo({
  size = 40,
  iconOnly = false,
  tone = "auto",
  enter = false,
  pulse = false,
  loading = false,
  joined = false,
  className = "",
}: PosibLogoProps) {
  // Al terminar la entrada se quita la clase: si no, al salir el cursor el
  // punto volvería a su animación de entrada y se repetiría.
  const [entering, setEntering] = useState(enter);

  const onAnimationEnd = (e: AnimationEvent<HTMLElement>) => {
    if (entering && (e.target as HTMLElement).classList.contains("posib-logo__dot")) {
      setEntering(false);
    }
  };

  const classes = [
    "posib-logo",
    iconOnly && "posib-logo--icon-only",
    joined && "posib-logo--joined",
    tone === "auto" && "posib-logo--auto",
    tone === "dark" && "posib-logo--dark",
    entering && "is-entering",
    pulse && "is-pulsing",
    loading && "is-loading",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      style={{ "--posib-size": `${size}px` } as CSSProperties}
      role="img"
      aria-label="posib.dev"
      onAnimationEnd={onAnimationEnd}
    >
      <span className="posib-logo__icon" aria-hidden="true">
        <span className="posib-logo__stem" />
        <span className="posib-logo__ring" />
        <span className="posib-logo__dot" />
      </span>
      <span className="posib-logo__word" aria-hidden="true" translate="no">
        {joined ? "osib" : "posib"}
        <span>.dev</span>
      </span>
    </span>
  );
}
