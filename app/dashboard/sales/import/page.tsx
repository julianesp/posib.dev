"use client";

import { useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  Upload,
  FileSpreadsheet,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  parseSiigoFile,
  type SiigoImportInvoice,
} from "@/lib/siigo-import";
import { importSales, type ImportSalesResult } from "@/lib/cloudflare-api";
import { ImportBarChart, type ChartPoint } from "@/components/import/import-chart";
import { ImportSteps } from "@/components/import/import-steps";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};

const STEPS = ["Exporta de Siigo", "Sube el archivo", "Revisa las gráficas", "Importa"];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Total vendido por período: por mes, o por día si todo cae en un mismo mes
 * (un archivo de pocas semanas se ve mejor día a día).
 */
function salesByPeriod(invoices: SiigoImportInvoice[]): { byDay: boolean; points: ChartPoint[] } {
  const dated = invoices.filter((inv) => inv.date);
  const months = new Set(dated.map((inv) => inv.date!.slice(0, 7)));
  const byDay = months.size === 1;
  const totals = new Map<string, number>();
  for (const inv of dated) {
    const key = byDay ? inv.date!.slice(0, 10) : inv.date!.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + inv.total);
  }
  const points = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const [y, m, d] = key.split("-");
      const label = byDay ? `${Number(d)} ${MONTHS[Number(m) - 1]}` : `${MONTHS[Number(m) - 1]} ${y}`;
      return { label, value };
    });
  const undated = invoices.filter((inv) => !inv.date).reduce((sum, inv) => sum + inv.total, 0);
  if (undated > 0) points.push({ label: "Sin fecha", value: undated });
  return { byDay, points };
}

function salesByPayment(invoices: SiigoImportInvoice[]): ChartPoint[] {
  const totals = new Map<string, number>();
  for (const inv of invoices) {
    const label = PAYMENT_LABELS[inv.payment_method] ?? inv.payment_method;
    totals.set(label, (totals.get(label) ?? 0) + inv.total);
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export default function ImportSalesPage() {
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<SiigoImportInvoice[]>([]);
  const [warnings, setWarnings] = useState<
    Array<{ row: number; reason: string }>
  >([]);
  const [detectedColumns, setDetectedColumns] = useState<Record<string, string>>(
    {},
  );
  const [result, setResult] = useState<ImportSalesResult | null>(null);

  const resetState = () => {
    setInvoices([]);
    setWarnings([]);
    setDetectedColumns({});
    setResult(null);
  };

  const handleFile = async (file: File) => {
    resetState();
    setFileName(file.name);
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseSiigoFile(buffer, file.name);
      setInvoices(parsed.invoices);
      setWarnings(parsed.warnings);
      setDetectedColumns(parsed.detectedColumns);
      if (parsed.invoices.length === 0) {
        toast.error("No se encontraron facturas en el archivo.");
      } else {
        toast.success(
          `Se reconocieron ${parsed.invoices.length} factura(s). Revisa la previsualización.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al leer el archivo.";
      toast.error(message);
      setFileName(null);
    } finally {
      setParsing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Permite volver a seleccionar el mismo archivo.
    e.target.value = "";
  };

  const handleImport = async () => {
    if (invoices.length === 0) return;
    setImporting(true);
    try {
      const res = await importSales(invoices, getToken);
      setResult(res);
      if (res.errors.length > 0) {
        toast.warning(
          `Importadas ${res.imported}, con ${res.errors.length} error(es).`,
        );
      } else {
        toast.success(
          `Importadas ${res.imported} ventas${
            res.skipped > 0 ? `, ${res.skipped} omitidas (duplicadas)` : ""
          }.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al importar las ventas.";
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const totalGeneral = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalItems = invoices.reduce((sum, inv) => sum + inv.items.length, 0);
  const byPeriod = useMemo(() => salesByPeriod(invoices), [invoices]);
  const byPayment = useMemo(() => salesByPayment(invoices), [invoices]);
  const dates = invoices.map((inv) => inv.date).filter((d): d is string => !!d).sort();
  const currentStep = result ? STEPS.length : invoices.length > 0 ? 2 : fileName ? 1 : 0;

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
          <h1 className="text-2xl font-bold">Importar ventas desde Siigo</h1>
          <p className="text-sm text-muted-foreground">
            Sube el reporte de ventas exportado desde Siigo (.xlsx o .csv). Las
            ventas se registran como históricas: no modifican el inventario.
          </p>
        </div>
      </div>

      <ImportSteps steps={STEPS} current={currentStep} guideId="importar-ventas" />

      {/* Zona de carga */}
      <Card>
        <CardContent className="pt-6">
          <div
            data-guide="sales-import-drop"
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileChange}
            />
            {parsing ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p>Leyendo archivo…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium">
                  {fileName ?? "Haz clic o arrastra el archivo de Siigo aquí"}
                </p>
                <p className="text-xs text-muted-foreground">
                  En Siigo, exporta a Excel el reporte de ventas con el detalle
                  de productos (una fila por producto). Acepta .xlsx o .csv.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Columnas reconocidas */}
      {Object.keys(detectedColumns).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Columnas reconocidas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(detectedColumns).map(([field, header]) => (
                <span
                  key={field}
                  className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
                >
                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                  {header}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Advertencias de parseo */}
      {warnings.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              {warnings.length} fila(s) omitida(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
              {warnings.slice(0, 20).map((w, i) => (
                <li key={i}>
                  Fila {w.row}: {w.reason}
                </li>
              ))}
              {warnings.length > 20 && (
                <li>…y {warnings.length - 20} más.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Gráficas: para ver de un vistazo si el archivo es el correcto */}
      {invoices.length > 0 && !result && (
        <Card data-guide="sales-import-charts">
          <CardHeader>
            <CardTitle className="text-base">¿Es el archivo correcto?</CardTitle>
            <p className="text-sm text-muted-foreground">
              {dates.length > 0
                ? `Ventas del ${formatDate(dates[0])} al ${formatDate(dates[dates.length - 1])}. `
                : ""}
              Si un mes falta o se ve muy distinto a lo que vendiste, revisa el
              reporte en Siigo antes de importar.
            </p>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <ImportBarChart
              title={byPeriod.byDay ? "Vendido por día" : "Vendido por mes"}
              description={`Total ${formatCurrency(totalGeneral)}`}
              data={byPeriod.points}
              money
            />
            <ImportBarChart
              title="Vendido por forma de pago"
              description="Lo que Siigo no trae como Nequi, tarjeta o crédito queda como efectivo."
              data={byPayment}
              money
              horizontal
            />
          </CardContent>
        </Card>
      )}

      {/* Previsualización */}
      {invoices.length > 0 && !result && (
        <Card data-guide="sales-import-preview">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Previsualización · {invoices.length} factura(s)
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {totalItems} ítems · Total {formatCurrency(totalGeneral)}
              </p>
            </div>
            <Button data-guide="sales-import-button" onClick={handleImport} disabled={importing}>
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importando…
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Importar {invoices.length} venta(s)
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Documento</th>
                    <th className="py-2 pr-4">Fecha</th>
                    <th className="py-2 pr-4">Cliente</th>
                    <th className="py-2 pr-4">Pago</th>
                    <th className="py-2 pr-4 text-right">Ítems</th>
                    <th className="py-2 pr-4 text-right">IVA</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 100).map((inv) => (
                    <tr key={inv.document_number} className="border-b">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {inv.document_number}
                      </td>
                      <td className="py-2 pr-4">{inv.date ?? "—"}</td>
                      <td className="py-2 pr-4">
                        {inv.customer_name ?? "Cliente ocasional"}
                      </td>
                      <td className="py-2 pr-4">
                        {PAYMENT_LABELS[inv.payment_method] ??
                          inv.payment_method}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {inv.items.length}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatCurrency(inv.tax)}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {formatCurrency(inv.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invoices.length > 100 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Mostrando 100 de {invoices.length} facturas. Se importarán
                  todas.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resultado de la importación */}
      {result && (
        <Card className="border-green-300" data-guide="sales-import-result">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              Importación completada
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Ventas importadas" value={result.imported} />
              <Stat
                label="Omitidas (duplicadas)"
                value={result.skipped}
              />
              <Stat label="Productos creados" value={result.productsCreated} />
              <Stat label="Clientes creados" value={result.customersCreated} />
            </div>

            {result.errors.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-sm font-medium text-amber-700 flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  {result.errors.length} factura(s) con error
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{e.document}</span>:{" "}
                      {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Link href="/dashboard/sales">
                <Button>Ver ventas</Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => {
                  resetState();
                  setFileName(null);
                }}
              >
                Importar otro archivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
