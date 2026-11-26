"use client";

import { useEffect, useState } from "react";
import { CloudDownload, CloudOff, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useOfflineMode, useOfflineReady } from "@/lib/offline-mode";
import { countQueuedSales, SALES_QUEUE_EVENT } from "@/lib/offline-store";

function formatWhen(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const time = date.toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) return `hoy ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `ayer ${time}`;
  return `${date.toLocaleDateString("es-CO", { day: "numeric", month: "short" })} ${time}`;
}

/**
 * Botón "Preparar sin internet" del POS. Muestra si este equipo tiene una
 * copia lista para abrir el POS sin internet (p. ej. tras un corte de luz) y
 * de cuándo es. Al tocarlo vuelve a guardar productos, clientes y la página.
 */
export function OfflineReadyButton({
  onPrepare,
}: {
  onPrepare: () => Promise<boolean>;
}) {
  const ready = useOfflineReady();
  const offlineMode = useOfflineMode();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      countQueuedSales().then((n) => {
        if (!cancelled) setPending(n);
      });
    refresh();
    const interval = setInterval(refresh, 10000);
    window.addEventListener(SALES_QUEUE_EVENT, refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(SALES_QUEUE_EVENT, refresh);
    };
  }, []);

  const handleClick = async () => {
    if (offlineMode || !navigator.onLine) {
      toast.info("Sin internet", {
        description:
          "Puedes seguir vendiendo. La copia se actualiza cuando vuelva la conexión.",
      });
      return;
    }
    setBusy(true);
    try {
      const ok = await onPrepare();
      if (ok) {
        toast.success("Listo para trabajar sin internet", {
          description:
            "Si se va la luz o el internet, abre posib.dev en este equipo y el POS cargará con tus productos.",
        });
      } else {
        toast.error("No se pudo guardar la copia", {
          description: "Revisa la conexión e inténtalo de nuevo.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const pendingText =
    pending > 0
      ? ` · ${pending} venta${pending === 1 ? "" : "s"} por subir`
      : "";

  let icon = <CloudDownload className="h-3.5 w-3.5" />;
  let label = "Preparar para trabajar sin internet";
  let tone = "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100";
  if (busy) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    label = "Guardando copia en este equipo…";
  } else if (offlineMode) {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = ready ? `Sin internet · copia de ${formatWhen(ready.at)}` : "Sin internet";
    tone = "border-amber-400 bg-amber-100 text-amber-900";
  } else if (ready) {
    icon = <CheckCircle2 className="h-3.5 w-3.5" />;
    label = `Listo sin internet · ${formatWhen(ready.at)}`;
    tone = "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={
        ready
          ? `Copia guardada: ${ready.products} productos y ${ready.customers} clientes. Toca para actualizarla.`
          : "Guarda productos, clientes y el POS en este equipo para seguir vendiendo si se va la luz o el internet."
      }
      className={`mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-70 ${tone}`}
    >
      {icon}
      <span className="truncate">
        {label}
        {pendingText}
      </span>
    </button>
  );
}
