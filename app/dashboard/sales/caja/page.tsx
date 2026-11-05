"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Loader2, Wallet } from "lucide-react";
import { ApiError, getCashSessions, type CashSession } from "@/lib/cloudflare-api";
import { cn, formatCurrency } from "@/lib/utils";

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Fiado",
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });

/** Historial de aperturas y cierres de caja (Ventas → Cierres de caja). */
export default function CashSessionsPage() {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState<CashSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCashSessions(getToken)
      .then((list) => !cancelled && setSessions(list))
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 403
            ? "Solo el dueño o quien tenga permiso de ver reportes puede ver los cierres de caja."
            : "No se pudieron cargar los cierres de caja.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <Link href="/dashboard/sales" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Ventas
        </Link>
        <h1 className="text-2xl font-bold md:text-3xl">Cierres de caja</h1>
        <p className="text-sm text-gray-500 md:text-base">
          Cada turno: con cuánto se abrió, cuánto debía haber y cuánto se contó al cerrar.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      {!error && !sessions && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      )}

      {sessions && sessions.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-600">
          <Wallet className="mx-auto mb-2 h-8 w-8 text-gray-400" />
          Todavía no hay cierres. Abre la caja desde el Punto de Venta al empezar el turno.
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="space-y-3">
          {sessions.map((s) => {
            const diff = s.difference ?? 0;
            const others = Object.entries(s.totals?.sales ?? {}).filter(([m]) => m !== "efectivo");
            return (
              <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold capitalize">{day(s.opened_at)}</p>
                    <p className="text-xs text-gray-500">
                      {hour(s.opened_at)}
                      {s.closed_at ? ` a ${hour(s.closed_at)}` : " · sigue abierta"}
                      {s.closed_by_name ? ` · cerró ${s.closed_by_name}` : s.opened_by_name ? ` · abrió ${s.opened_by_name}` : ""}
                    </p>
                  </div>
                  {s.status === "open" ? (
                    <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand">Abierta</span>
                  ) : (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        diff === 0 && "bg-green-50 text-green-700",
                        diff > 0 && "bg-blue-50 text-blue-700",
                        diff < 0 && "bg-red-50 text-red-700",
                      )}
                    >
                      {diff === 0 ? "Cuadra" : diff > 0 ? `Sobran ${formatCurrency(diff)}` : `Faltan ${formatCurrency(Math.abs(diff))}`}
                    </span>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <Item label="Base" value={s.opening_amount} />
                  {s.status === "closed" && (
                    <>
                      <Item label="Ventas efectivo" value={s.cash_sales ?? 0} />
                      <Item label="Debía haber" value={s.expected_cash ?? 0} />
                      <Item label="Se contó" value={s.counted_cash ?? 0} strong />
                    </>
                  )}
                </dl>

                {(s.totals?.movements?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                    {s.totals?.movements?.map((m) => (
                      <li key={m.id}>
                        <span className={cn("font-num font-semibold", m.kind === "salida" ? "text-red-700" : "text-green-700")}>
                          {m.kind === "salida" ? "−" : "+"}
                          {formatCurrency(m.amount)}
                        </span>{" "}
                        {m.reason}
                      </li>
                    ))}
                  </ul>
                )}

                {others.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    Otros medios: {others.map(([m, t]) => `${METHOD_LABEL[m] ?? m} ${formatCurrency(t.total)}`).join(" · ")}
                  </p>
                )}
                {s.notes && <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">Nota: {s.notes}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Item({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={cn("font-num", strong ? "font-bold text-brand" : "font-medium text-gray-900")}>{formatCurrency(value)}</dd>
    </div>
  );
}
