"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useIsDark } from "@/lib/use-is-dark";

const noopSubscribe = () => () => {};

const LIGHT_CSS = `
  .landing-root .lp-text         { color: #0f172a !important; }
  .landing-root .lp-muted        { color: rgba(15,23,42,0.58) !important; }
  .landing-root .lp-subtle       { color: rgba(15,23,42,0.38) !important; }
  .landing-root .lp-card         { background: rgba(15,23,42,0.04) !important; }
  .landing-root .lp-border       { border-color: rgba(15,23,42,0.10) !important; }
  .landing-root .lp-ghost-btn    { color: rgba(15,23,42,0.65) !important; border-color: rgba(15,23,42,0.18) !important; }
  .landing-root .lp-ghost-btn:hover { color: #0f172a !important; background: rgba(15,23,42,0.07) !important; }
  .landing-root .lp-badge        { background: rgba(15,23,42,0.06) !important; border-color: rgba(15,23,42,0.12) !important; color: rgba(15,23,42,0.6) !important; }
  .landing-root .lp-modal-bg     { background: #ffffff !important; color: #0f172a !important; }
  .landing-root .lp-section-sep  { border-color: rgba(15,23,42,0.07) !important; }
  .landing-root .lp-icon-bg      { background: rgba(15,23,42,0.07) !important; }
  .landing-root .lp-check-bg     { background: rgba(0,124,128,0.12) !important; }
`;

const DARK_CSS = `
  .landing-root .lp-text         { color: #ffffff !important; }
  /* En oscuro los textos secundarios van en blanco: en gris no se leían. */
  .landing-root .lp-muted        { color: #ffffff !important; }
  .landing-root .lp-subtle       { color: #ffffff !important; }
  .landing-root .lp-card         { background: rgba(255,255,255,0.03) !important; }
  .landing-root .lp-border       { border-color: rgba(255,255,255,0.05) !important; }
  .landing-root .lp-ghost-btn    { color: #ffffff !important; border-color: rgba(255,255,255,0.25) !important; }
  .landing-root .lp-ghost-btn:hover { color: #ffffff !important; background: rgba(255,255,255,0.08) !important; }
  .landing-root .lp-badge        { background: rgba(255,255,255,0.05) !important; border-color: rgba(255,255,255,0.10) !important; color: #ffffff !important; }
  .landing-root .lp-modal-bg     { background: #252932 !important; color: #ffffff !important; }
  .landing-root .lp-section-sep  { border-color: rgba(255,255,255,0.05) !important; }
  .landing-root .lp-icon-bg      { background: rgba(255,255,255,0.06) !important; }
  .landing-root .lp-check-bg     { background: rgba(0,124,128,0.20) !important; }
`;

export default function LandingShell({ children }: { children: ReactNode }) {
  const dark = useIsDark();
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  return (
    <>
      {mounted && <style>{dark ? DARK_CSS : LIGHT_CSS}</style>}
      <div
        data-landing-theme={dark ? "dark" : "light"}
        className="min-h-screen landing-root"
        style={{
          background: mounted ? (dark ? "#1c1f26" : "#f8fafb") : "#1c1f26",
          transition: mounted ? "background 0.5s ease" : "none",
        }}
      >
        {children}
      </div>
    </>
  );
}
