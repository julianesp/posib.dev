"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, CheckCircle2, Download, FileBarChart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getMonthlyReportDownloads,
  getProducts,
  getSales,
  getSelectedTenantId,
  getUserProfile,
  markMonthlyReportDownloaded,
  type Product,
  type Sale,
} from "@/lib/cloudflare-api";
import {
  buildMonthlyReport,
  downloadMonthlyReportPdf,
  isDownloadedLocally,
  markDownloadedLocally,
  monthKey,
  monthLabel,
  monthsWithSales,
  type MonthSummary,
} from "@/lib/monthly-sales-report";

const cop = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function MonthlyReportsPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<{
    sales: Sale[];
    products: Product[];
    storeName: string | null;
    months: MonthSummary[];
  } | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenant = getSelectedTenantId() || "propia";
  const currentKey = monthKey({ year: new Date().getFullYear(), month: new Date().getMonth() });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sales, products, profile, serverMonths] = await Promise.all([
          getSales(getToken),
          getProducts(getToken),
          getUserProfile(getToken).catch(() => null),
          getMonthlyReportDownloads(getToken),
        ]);
        if (cancelled) return;
        const months = monthsWithSales(sales);
        setData({ sales, products, storeName: profile?.store_name || null, months });
        setDownloaded(
          new Set(months.map((m) => m.key).filter((k) => serverMonths?.includes(k) || isDownloadedLocally(tenant, k))),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar las ventas.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, tenant]);

  const download = async (m: MonthSummary) => {
    if (!data) return;
    setBusy(m.key);
    try {
      const report = buildMonthlyReport(data.sales, data.products, m.month, data.storeName);
      await downloadMonthlyReportPdf(report);
      // El mes en curso no cuenta como "descargado": su informe aún no está completo.
      if (m.key !== currentKey) {
        markDownloadedLocally(tenant, m.key);
        setDownloaded((prev) => new Set(prev).add(m.key));
        await markMonthlyReportDownloaded(m.key, getToken);
      }
    } catch (err) {
      console.error("Error generando el informe mensual:", err);
      toast.error("No se pudo generar el informe. Intente de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/sales">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer border-2 border-brand/60 font-semibold text-gray-800 hover:border-brand hover:bg-brand-light"
          >
            <ArrowLeft className="w-4 h-4 mr-1 text-brand" />
            Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Informes mensuales</h1>
          <p className="text-sm text-muted-foreground">
            El análisis de las ventas de cada mes en PDF: lo que no le debe faltar, qué pedir, cuándo vende más
            y cuánto ganó.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando ventas…
        </div>
      )}
      {data && data.months.length === 0 && (
        <p className="text-muted-foreground">Todavía no hay ventas. Cuando venda, aquí aparecerá el informe de cada mes.</p>
      )}

      {data && data.months.length > 0 && (
        <ul className="divide-y rounded-xl border bg-white">
          {data.months.map((m) => {
            const isCurrent = m.key === currentKey;
            return (
              <li key={m.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light text-brand">
                    <FileBarChart className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {capitalize(monthLabel(m.month))}
                      {isCurrent && <span className="ml-2 text-xs font-normal text-gray-500">(mes en curso, hasta hoy)</span>}
                    </p>
                    <p className="text-sm text-gray-600 tabular-nums">
                      {m.salesCount.toLocaleString("es-CO")} {m.salesCount === 1 ? "venta" : "ventas"} · {cop(m.revenue)}
                    </p>
                    {downloaded.has(m.key) && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-brand">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Ya descargado
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  onClick={() => download(m)}
                  disabled={busy !== null}
                  variant={downloaded.has(m.key) ? "outline" : "default"}
                  className="sm:w-auto"
                >
                  {busy === m.key ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  {downloaded.has(m.key) ? "Descargar de nuevo" : "Descargar PDF"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
