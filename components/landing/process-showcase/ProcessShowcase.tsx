"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { ArrowRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Phone } from "./ui";
import { SCENES, type Scene } from "./scenes";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const STEP_MS = 2800;
const HOLD_MS = 3600;

function ScenePlayer({
  scene,
  playing,
  cycle,
  paused,
  showPauseControl,
  onEnd,
  onInteract,
  onTogglePause,
}: {
  scene: Scene;
  playing: boolean;
  cycle: boolean;
  paused: boolean;
  showPauseControl: boolean;
  onEnd: () => void;
  onInteract: () => void;
  onTogglePause: () => void;
}) {
  const [step, setStep] = useState(0);
  const last = scene.steps.length - 1;

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(
      () => {
        if (step < last) setStep(step + 1);
        else if (cycle) onEnd();
        else setStep(0);
      },
      step === last ? HOLD_MS : STEP_MS,
    );
    return () => window.clearTimeout(id);
  }, [playing, step, last, cycle, onEnd]);

  return (
    <div
      id="showcase-panel"
      role="tabpanel"
      aria-labelledby={`showcase-tab-${scene.id}`}
      className="mt-5 grid items-start gap-8 md:mt-10 md:grid-cols-2 md:gap-x-14 md:gap-y-6"
    >
      {/* En el celular se oculta título y descripción: empujaban el celular
          animado fuera de la pantalla. La pestaña ya dice qué proceso es. */}
      <div className="hidden md:col-start-1 md:row-start-1 md:block md:self-end">
        {scene.badge && (
          <span className="mb-3 inline-block rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
            {scene.badge}
          </span>
        )}
        <h3 className="lp-text text-xl font-bold sm:text-2xl">{scene.title}</h3>
        <p className="lp-muted mt-2 text-base">{scene.blurb}</p>
      </div>

      <div className="flex flex-col items-center md:col-start-2 md:row-span-2 md:row-start-1 md:self-center">
        <Phone>
          <scene.Screen step={step} />
        </Phone>
        {showPauseControl && (
          <button
            type="button"
            onClick={onTogglePause}
            className="lp-badge mt-5 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium"
          >
            {paused ? (
              <Play className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Pause className="h-4 w-4" aria-hidden="true" />
            )}
            {paused ? "Reproducir animación" : "Pausar animación"}
          </button>
        )}
      </div>

      <ol className="space-y-1.5 md:col-start-1 md:row-start-2 md:self-start">
        {scene.steps.map((item, i) => {
          const active = i === step;
          return (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => {
                  onInteract();
                  setStep(i);
                }}
                aria-current={active ? "step" : undefined}
                className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? "lp-card lp-border ring-1 ring-brand/40"
                    : "border-transparent"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    active ? "bg-brand text-white" : "lp-badge border"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-semibold ${
                      active ? "lp-text" : "lp-muted"
                    }`}
                  >
                    {item.title}
                  </span>
                  <span
                    className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none ${
                      active ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <span className="overflow-hidden">
                      <span className="lp-muted block pt-1 text-sm leading-snug">
                        {item.text}
                      </span>
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ProcessShowcase() {
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(true);
  const [userPaused, setUserPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const scene = SCENES[index];
  const playing = inView && !userPaused && !keyboardFocus && !reduced;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const tab = tabRefs.current[index];
    const list = tab?.parentElement;
    if (!tab || !list) return;
    list.scrollTo({
      left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [index, reduced]);

  const nextScene = useCallback(
    () => setIndex((i) => (i + 1) % SCENES.length),
    [],
  );

  const select = (i: number) => {
    setIndex(i);
    setCycle(false);
    setUserPaused(false);
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = SCENES.length;
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % n;
    else if (e.key === "ArrowLeft") next = (index - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  const onFocusCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target.matches(":focus-visible")) setKeyboardFocus(true);
  };

  const onBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setKeyboardFocus(false);
  };

  return (
    <section
      id="como-funciona"
      ref={rootRef}
      className="lp-section-sep scroll-mt-24 border-t"
    >
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-brand">
            Así se usa
          </p>
          <h2 className="lp-text text-2xl font-bold sm:text-3xl md:text-4xl">
            Mira cómo se hace cada cosa
          </h2>
          <p className="lp-muted mt-3 text-base">
            Elige un proceso y míralo paso a paso, tal como lo harías en tu
            tienda.
          </p>
        </div>

        <div
          onFocusCapture={onFocusCapture}
          onBlurCapture={onBlurCapture}
          className="mx-auto mt-8 max-w-5xl"
        >
          <div
            role="tablist"
            aria-label="Procesos del sistema"
            onKeyDown={onTabKeyDown}
            className="relative flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:justify-center md:overflow-visible"
          >
            {SCENES.map((item, i) => {
              const active = i === index;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={`showcase-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="showcase-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => select(i)}
                  className={`inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium ${
                    active
                      ? "border-brand bg-brand text-white"
                      : "lp-badge"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.tab}
                </button>
              );
            })}
          </div>

          <ScenePlayer
            key={scene.id}
            scene={scene}
            playing={playing}
            cycle={cycle}
            paused={userPaused}
            showPauseControl={!reduced}
            onEnd={nextScene}
            onInteract={() => setCycle(false)}
            onTogglePause={() => setUserPaused((p) => !p)}
          />
        </div>

        <div className="mt-12 text-center">
          <Link href="/sign-up">
            <Button
              size="lg"
              className="cursor-pointer bg-brand text-white shadow-lg shadow-brand/20 hover:bg-brand-hover"
            >
              Empezar gratis 30 días
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
