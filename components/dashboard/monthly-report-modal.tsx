"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { CheckCircle2, Download, FileBarChart, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  getMonthlyReportDownloads,
  getProducts,
  getSales,
  getSelectedTenantId,
  getUserProfile,
  markMonthlyReportDownloaded,
} from "@/lib/cloudflare-api";
import {
  buildMonthlyReport,
  downloadMonthlyReportPdf,
  hasSalesIn,
  isDownloadedLocally,
  markDownloadedLocally,
  monthKey,
  monthLabel,
  previousMonth,
  type MonthlyReport,
} from "@/lib/monthly-sales-report";

// "Mostrar más tarde" o cerrar: no molesta más en esta sesión; vuelve al abrir el sistema otra vez.
const laterKey = (tenant: string, month: string) => `posib:monthly-report:later:${tenant}:${month}`;

function isLater(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function markLater(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* sin almacenamiento: el aviso puede volver a salir, no es grave */
  }
}

const cop = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;

/**
 * Al abrir el sistema durante el mes, ofrece descargar el informe de ventas del
 * mes anterior. Sigue apareciendo cada vez que se abre el sistema hasta que el
 * tendero lo descargue (en cualquier dispositivo: se registra en el Worker).
 */
export function MonthlyReportModal() {
  const { getToken } = useAuth();
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const tenant = getSelectedTenantId() || "propia";
  const month = previousMonth();
  const key = monthKey(month);

  const close = () => {
    if (!downloaded) markLater(laterKey(tenant, key));
    setOpen(false);
  };

  useEffect(() => {
    if (isDownloadedLocally(tenant, key) || isLater(laterKey(tenant, key))) return;
    let cancelled = false;
    (async () => {
      try {
        // ¿Ya lo descargó en otro dispositivo?
        const downloadedMonths = await getMonthlyReportDownloads(getToken);
        if (downloadedMonths?.includes(key)) {
          markDownloadedLocally(tenant, key);
          return;
        }
        const [sales, products, profile] = await Promise.all([
          getSales(getToken),
          getProducts(getToken),
          getUserProfile(getToken).catch(() => null),
        ]);
        if (cancelled || !hasSalesIn(sales, month)) return;
        setReport(buildMonthlyReport(sales, products, month, profile?.store_name || null));
        setOpen(true);
      } catch {
        /* si no cargan las ventas, el aviso sale la próxima vez */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo al abrir el sistema (y si cambia la tienda activa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, downloaded]);

  const download = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      await downloadMonthlyReportPdf(report);
      markDownloadedLocally(tenant, key);
      setDownloaded(true);
      await markMonthlyReportDownloaded(key, getToken);
    } catch (err) {
      console.error("Error generando el informe mensual:", err);
      toast.error("No se pudo generar el informe. Intente de nuevo.");
    } finally {
      setDownloading(false);
    }
  };

  if (!open || !report) return null;

  const name = monthLabel(report.month);
  const star = report.topByUnits[0];
  const change =
    report.previous && report.previous.revenue > 0
      ? ((report.revenue - report.previous.revenue) / report.previous.revenue) * 100
      : null;

  return (
    <div
      data-blocking-modal
      className="fixed inset-0 z-[70] flex items-center justify-center modal-backdrop p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthly-report-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar"
          className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="bg-brand px-6 pb-5 pt-6 text-white">
          <FileBarChart className="mb-3 h-8 w-8" />
          <p className="text-xs font-semibold uppercase tracking-wider text-white/80">Informe mensual</p>
          <h2 id="monthly-report-title" className="text-xl font-bold text-balance">
            Ya está listo su informe de {name}
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-brand-light p-3">
              <p className="text-xs text-gray-600">Vendió</p>
              <p className="text-lg font-bold text-brand tabular-nums">{cop(report.revenue)}</p>
              {change !== null && (
                <p className="text-xs text-gray-600">
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(0)}% vs. mes anterior
                </p>
              )}
            </div>
            <div className="rounded-xl bg-brand-light p-3">
              <p className="text-xs text-gray-600">Ventas</p>
              <p className="text-lg font-bold text-brand tabular-nums">
                {report.salesCount.toLocaleString("es-CO")}
              </p>
              <p className="text-xs text-gray-600">Promedio {cop(report.avgTicket)}</p>
            </div>
          </div>

          {star && (
            <p className="text-sm text-gray-700">
              Lo que más vendió: <b>{star.name}</b> ({star.units.toLocaleString("es-CO")} unidades).
            </p>
          )}

          <ul className="space-y-1 text-sm text-gray-600">
            <li>• Los productos que no le deben faltar y cuáles pedir ya</li>
            <li>• Los días y horarios en que más vende</li>
            <li>• Cómo le pagaron y cuánto quedó fiado</li>
            <li>• La mercancía que no se movió y recomendaciones</li>
          </ul>

          {downloaded ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-xl bg-brand-light p-3 text-sm font-medium text-brand">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                Listo, el informe quedó en sus descargas.
              </p>
              <button
                type="button"
                onClick={close}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={download}
                disabled={downloading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-70"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? "Preparando el informe…" : "Descargar informe (PDF)"}
              </button>
              <button
                type="button"
                onClick={close}
                className="w-full rounded-xl py-2.5 text-sm font-medium text-brand hover:bg-brand-light"
              >
                Mostrar más tarde
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
