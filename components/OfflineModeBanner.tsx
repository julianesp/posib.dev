"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { hasRealInternet, useOfflineReady } from "@/lib/offline-mode";
import { countQueuedSales, SALES_QUEUE_EVENT } from "@/lib/offline-store";

function formatReadyAt(at: number): string {
  return new Date(at).toLocaleString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Franja que se ve cuando el POS abrió desde la copia guardada (sin internet).
 * Revisa cada 20 s si volvió el internet; entonces ofrece recargar para que
 * la sesión se verifique y las ventas guardadas se suban.
 */
export function OfflineModeBanner() {
  const ready = useOfflineReady();
  const [internetBack, setInternetBack] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const [online, queued] = await Promise.all([
        hasRealInternet(),
        countQueuedSales(),
      ]);
      if (cancelled) return;
      setInternetBack(online);
      setPending(queued);
    };
    check();
    const interval = setInterval(check, 20000);
    const onOnline = () => check();
    const onQueue = () =>
      countQueuedSales().then((n) => {
        if (!cancelled) setPending(n);
      });
    window.addEventListener("online", onOnline);
    window.addEventListener(SALES_QUEUE_EVENT, onQueue);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(SALES_QUEUE_EVENT, onQueue);
    };
  }, []);

  const pendingText =
    pending > 0
      ? ` ${pending} venta${pending === 1 ? "" : "s"} guardada${pending === 1 ? "" : "s"} en este equipo.`
      : "";

  if (internetBack) {
    return (
      <div className="flex flex-wrap items-center gap-3 bg-emerald-600 px-4 py-2 text-sm text-white">
        <RefreshCw className="h-4 w-4 shrink-0" />
        <p className="flex-1 min-w-0">
          <strong>Volvió el internet.</strong> Recarga para subir las ventas y
          seguir con normalidad.{pendingText}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-white px-3 py-1 font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          Recargar
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-amber-500 px-4 py-2 text-sm text-white">
      <WifiOff className="h-4 w-4 shrink-0" />
      <p className="flex-1 min-w-0">
        <strong>Sin internet.</strong> Estás usando la copia guardada del POS
        {ready ? ` (${formatReadyAt(ready.at)})` : ""}. Las ventas en efectivo,
        tarjeta o transferencia se guardan aquí y se suben cuando vuelva la
        conexión.{pendingText}
      </p>
    </div>
  );
}
