"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Check, ChevronRight, CircleHelp, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGuide } from "@/components/guide/GuideProvider";
import { getProducts } from "@/lib/cloudflare-api";
import { useIsDark } from "@/lib/use-is-dark";
import { idleShippingZones, productVisibility, storeReadiness, type StoreReadinessInput } from "@/lib/store-readiness";
import { getShippingZones } from "@/lib/shipping-zones";

// Solo lo que usan estas dos gráficas: Chart.js se queda pequeño en el bundle.
Chart.register(DoughnutController, ArcElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/**
 * Color del tendero (--brand, lib/accent.ts) para el lienzo de Chart.js, que no
 * entiende variables CSS: se lee el valor ya resuelto en <html>.
 */
function brandColors(isDark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const brand = css.getPropertyValue("--brand").trim() || "#007c80";
  return {
    brand,
    track: isDark ? "rgba(255,255,255,0.08)" : "#ece7df",
    text: isDark ? "#a8a29e" : "#57534e",
  };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Anillo de avance que se llena al entrar (animado salvo "reducir movimiento"). */
function ProgressRing({ percent }: { percent: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const isDark = useIsDark();

  useEffect(() => {
    if (!ref.current) return;
    const c = brandColors(isDark);
    const chart = new Chart(ref.current, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [percent, 100 - percent],
            backgroundColor: [c.brand, c.track],
            borderWidth: 0,
            borderRadius: percent > 0 && percent < 100 ? 6 : 0,
          },
        ],
      },
      options: {
        cutout: "78%",
        responsive: true,
        maintainAspectRatio: false,
        events: [],
        animation: reducedMotion() ? false : { animateRotate: true, duration: 1100, easing: "easeOutCubic" },
        plugins: { tooltip: { enabled: false }, legend: { display: false } },
      },
    });
    return () => chart.destroy();
  }, [percent, isDark]);

  return (
    <div className="relative h-32 w-32 shrink-0">
      <canvas ref={ref} role="img" aria-label={`Tienda ${percent} % lista`} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-num text-3xl font-bold text-gray-900">{percent}%</span>
        <span className="text-xs text-gray-500">lista</span>
      </div>
    </div>
  );
}

/** Barras animadas: qué productos se ven en la tienda y cuáles no. */
function ProductsChart({ ready, noPhoto, noStock }: { ready: number; noPhoto: number; noStock: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const isDark = useIsDark();
  const rows = [
    { label: "Se ven con foto", value: ready },
    { label: "Se ven sin foto", value: noPhoto },
    { label: "No aparecen (sin stock)", value: noStock },
  ];

  useEffect(() => {
    if (!ref.current) return;
    const c = brandColors(isDark);
    const solidLight = isDark ? "rgba(255,255,255,0.28)" : "#d6d3d1";
    const chart = new Chart(ref.current, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.value),
            // Fuerte, medio y apagado del mismo color: lo que se ve bien resalta.
            backgroundColor: [c.brand, `${c.brand}99`, solidLight],
            borderRadius: 6,
            borderSkipped: "start",
            maxBarThickness: 26,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 900, easing: "easeOutQuart", delay: (ctx) => ctx.dataIndex * 150 },
        scales: {
          x: { beginAtZero: true, grid: { color: c.track }, border: { display: false }, ticks: { color: c.text, precision: 0 } },
          y: { grid: { display: false }, border: { display: false }, ticks: { color: c.text } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false, callbacks: { label: (ctx) => `${ctx.raw} producto(s)` } },
        },
      },
    });
    return () => chart.destroy();
    // rows depende solo de los tres conteos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, noPhoto, noStock, isDark]);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-medium text-gray-900">Tus productos en la tienda</figcaption>
      <div className="relative h-36 w-full">
        <canvas ref={ref} role="img" aria-label="Productos que se ven en la tienda y los que no" />
      </div>
      <table className="sr-only">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Lleva a una sección de la página y la resalta un momento. */
function goToSection(target: string) {
  const el = document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  el.classList.add("ring-2", "ring-brand", "ring-offset-2", "transition-shadow");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-brand", "ring-offset-2"), 1800);
}

/**
 * Guía "¿Lista para vender?" arriba de Configuración de la tienda: anillo de
 * avance y barras de productos con Chart.js, más los pasos que faltan con un
 * botón para ir a cada uno. "Ver guía animada" abre la guía con la demo.
 */
export function StoreReadinessGuide(props: Omit<StoreReadinessInput, "products">) {
  const { getToken } = useAuth();
  const { openGuide } = useGuide();
  const [products, setProducts] = useState<StoreReadinessInput["products"]>(null);
  const [zones, setZones] = useState<{ is_active?: boolean | number | null }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getShippingZones(getToken)
      .then((list) => !cancelled && setZones(list))
      .catch(() => !cancelled && setZones([]));
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    getProducts(getToken)
      .then((list) => !cancelled && setProducts(list))
      .catch(() => !cancelled && setProducts([]));
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const { steps, percent, canSell } = storeReadiness({ ...props, products });
  const visibility = useMemo(() => (products ? productVisibility(products) : null), [products]);
  const pending = steps.filter((s) => !s.done);
  const idleZones = idleShippingZones(zones, props.storeShippingEnabled);

  return (
    <section
      data-guide="store-readiness"
      aria-labelledby="store-readiness-title"
      className="rounded-2xl border border-brand/25 bg-white p-4 md:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <ProgressRing percent={percent} />
        <div className="min-w-0 flex-1">
          <h2 id="store-readiness-title" className="text-xl font-bold text-gray-900">
            {canSell
              ? percent === 100
                ? "Tu tienda está lista para vender"
                : "Tu tienda ya puede vender"
              : "¿Lista para vender?"}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {canSell
              ? percent === 100
                ? "Comparte tu enlace por WhatsApp y empieza a recibir pedidos."
                : "Solo faltan detalles opcionales que ayudan a vender más."
              : `Te falta${pending.length === 1 ? "" : "n"} ${pending.length} paso${pending.length === 1 ? "" : "s"}. Tócalo para ir directo.`}
          </p>
          <Button variant="outline" size="sm" onClick={() => openGuide("tienda")} className="mt-3 cursor-pointer">
            <CircleHelp className="mr-1.5 h-4 w-4" />
            Ver guía animada
          </Button>
        </div>
      </div>

      {/* Zonas creadas con el domicilio apagado: el cliente no puede pedir domicilio */}
      {idleZones > 0 && (
        <div role="alert" className="mt-5 flex flex-col gap-3 rounded-xl border-2 border-brand/50 bg-brand-light p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-gray-900">
            <strong>Tus clientes no pueden pedir domicilio.</strong> Tienes {idleZones} zona
            {idleZones === 1 ? "" : "s"} de envío, pero el envío a domicilio está apagado: actívalo en
            &quot;Entregas&quot; y guarda.
          </p>
          <Button size="sm" onClick={() => goToSection("store-delivery")} className="shrink-0 cursor-pointer">
            Activar domicilio
          </Button>
        </div>
      )}

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <ol className="space-y-1.5">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className="readiness-step"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              {step.id === "productos" && !step.done ? (
                <Link
                  href="/dashboard/products"
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-brand-light"
                >
                  <StepContent step={step} />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => goToSection(step.target)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-brand-light"
                >
                  <StepContent step={step} />
                </button>
              )}
            </li>
          ))}
        </ol>

        {visibility && visibility.ready + visibility.noPhoto + visibility.noStock > 0 ? (
          <ProductsChart {...visibility} />
        ) : (
          <div className="flex items-center justify-center rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-600">
            {products === null ? "Revisando tus productos…" : (
              <span>
                Aún no tienes productos.{" "}
                <Link href="/dashboard/products" className="font-semibold text-brand underline">
                  Agrega el primero
                </Link>{" "}
                para que aparezca en tu tienda.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StepContent({ step }: { step: ReturnType<typeof storeReadiness>["steps"][number] }) {
  return (
    <>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          step.done ? "bg-brand text-white" : "border-2 border-brand/40 text-brand"
        }`}
        aria-hidden="true"
      >
        {step.done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Circle className="h-2.5 w-2.5 fill-current" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${step.done ? "text-gray-500 line-through decoration-brand/40" : "text-gray-900"}`}>
          {step.title}
          <span className="sr-only">{step.done ? " (hecho)" : " (falta)"}</span>
        </span>
        {!step.done && <span className="block text-xs text-gray-600">{step.hint}</span>}
      </span>
      {!step.done && <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
    </>
  );
}
