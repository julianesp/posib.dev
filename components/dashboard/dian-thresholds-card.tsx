"use client";

import { useEffect, useId, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import {
  getDianThresholds,
  setDianAlreadyInvoicing,
  type DianLevel,
  type DianThresholds,
} from "@/lib/cloudflare-api";
import { formatCurrency } from "@/lib/utils";
import { clearDianNotificationCache } from "@/lib/notification-helpers";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const formatDay = (isoDay: string) => {
  const [, m, d] = isoDay.split("-").map(Number);
  return `${d} de ${MONTHS[m - 1]}`;
};

const STYLES: Record<DianLevel, { card: string; bar: string; badge: string; label: string }> = {
  ok: { card: "border-gray-200 bg-white", bar: "bg-brand", badge: "bg-gray-100 text-gray-700", label: "Lejos del tope" },
  aviso: { card: "border-amber-300 bg-amber-50", bar: "bg-amber-500", badge: "bg-amber-100 text-amber-800", label: "Aviso" },
  importante: { card: "border-orange-400 bg-orange-50", bar: "bg-orange-500", badge: "bg-orange-100 text-orange-800", label: "Importante" },
  obligado: { card: "border-red-400 bg-red-50", bar: "bg-red-600", badge: "bg-red-100 text-red-800", label: "Obligado a facturar" },
};

/**
 * Cuánto ha vendido la tienda en el año y cuánto le queda para el tope de
 * facturación electrónica de la DIAN (3.500 UVT). El conteo vuelve a cero
 * cada 1 de enero (hora Colombia). Solo la ven el dueño y quien tenga permiso
 * de reportes: el Worker responde 403 al resto y la tarjeta no se muestra.
 *
 * Plegada es una sola fila (monto, barra y estado); la flecha despliega los
 * detalles. Abre sola en "importante" y "obligado"; lo que el tendero elija se
 * recuerda por nivel, así que si el nivel sube vuelve a abrirse.
 */

const openKey = (level: DianLevel) => `dian_card_open_${level}`;

function readOpen(level: DianLevel): boolean {
  try {
    const v = localStorage.getItem(openKey(level));
    if (v !== null) return v === "1";
  } catch {
    // Sin almacenamiento: se usa el valor por defecto del nivel.
  }
  return level === "importante" || level === "obligado";
}
export function DianThresholdsCard() {
  const { getToken } = useAuth();
  const [data, setData] = useState<DianThresholds | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);
  const detailsId = useId();

  useEffect(() => {
    let cancelled = false;
    getDianThresholds(getToken)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // Sin permiso o error de red: no se muestra (no es una función crítica del dashboard).
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  if (!data) return null;

  // Quien ya factura electrónicamente ve sus ventas del año sin la alarma.
  const level: DianLevel = data.alreadyInvoicing ? "ok" : data.level;
  const style = STYLES[level];
  const pct = Math.min(data.percent, 100);

  const toggleAlreadyInvoicing = async (value: boolean) => {
    setSaving(true);
    try {
      await setDianAlreadyInvoicing(value, getToken);
      clearDianNotificationCache();
      setData({ ...data, alreadyInvoicing: value });
      toast.success(value ? "Listo: ya no te mostraremos la alerta" : "Volveremos a avisarte al acercarte al tope");
    } catch {
      toast.error("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const Icon = level === "obligado" ? AlertOctagon : level === "ok" ? Landmark : AlertTriangle;
  const isOpen = open ?? readOpen(level);

  const toggleOpen = () => {
    const next = !isOpen;
    setOpen(next);
    try {
      localStorage.setItem(openKey(level), next ? "1" : "0");
    } catch {
      // Sin almacenamiento: solo dura mientras la página esté abierta.
    }
  };

  return (
    <Card className={`gap-0 overflow-hidden border py-0 ${style.card}`}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-controls={detailsId}
        className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:px-5"
      >
        <Icon
          className={`h-5 w-5 flex-shrink-0 ${
            level === "obligado" ? "text-red-600" : level === "ok" ? "text-brand" : "text-amber-600"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-gray-600">Vendido en {data.year}</span>
            <span className="font-num text-base font-semibold text-gray-900 md:text-lg">
              {formatCurrency(data.yearSales)}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 max-w-xs overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${data.percent}% del tope de la DIAN`}
          >
            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${Math.max(pct, 1.5)}%` }} />
          </div>
        </div>
        <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:inline ${style.badge}`}>
          {data.alreadyInvoicing ? "Ya facturas electrónicamente" : style.label}
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-gray-500 group-hover:text-gray-800">
          <span className="hidden md:inline">{isOpen ? "Ocultar" : "Ver detalle"}</span>
          <ChevronDown
            className={`h-5 w-5 transition-transform duration-200 ease-out motion-reduce:transition-none ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </span>
      </button>

      {/* grid-rows 0fr → 1fr: despliega con transición sin medir alturas */}
      <div
        id={detailsId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden" inert={!isOpen}>
          <CardContent className="space-y-4 border-t border-black/5 px-4 pb-5 pt-4 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">
                Tope de facturación electrónica: <span className="font-num font-semibold">{formatCurrency(data.eInvoiceCap)}</span>
                {data.yearSales < data.eInvoiceCap && (
                  <>, te quedan <span className="font-num font-semibold">{formatCurrency(data.remaining)}</span></>
                )}
              </p>
              <span className="text-xs text-gray-500 tabular-nums">
                {data.percent.toLocaleString("es-CO")} % del tope
              </span>
            </div>
            <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold sm:hidden ${style.badge}`}>
              {data.alreadyInvoicing ? "Ya facturas electrónicamente" : style.label}
            </span>

            {!data.alreadyInvoicing && level !== "ok" && (
              <div className="space-y-1.5 text-sm text-gray-800">
                {level === "obligado" ? (
                  <>
                    <p className="font-semibold text-red-700">
                      {data.previousYear.exceeded
                        ? `En ${data.previousYear.year} vendiste ${formatCurrency(data.previousYear.sales)}, por encima del tope de ese año.`
                        : `Superaste el tope de ${formatCurrency(data.eInvoiceCap)} de ${data.year}.`}
                    </p>
                    <p>
                      La DIAN te exige factura electrónica en cada venta y pasas a ser responsable de IVA. No hacerlo
                      puede traer multas o el cierre del local. Habla con tu contador.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">
                      Si superas {formatCurrency(data.eInvoiceCap)} en ventas este año, debes facturar electrónicamente
                      desde esa venta.
                    </p>
                    {data.projectedCapDate && (
                      <p>A tu ritmo actual llegarías al tope alrededor del {formatDay(data.projectedCapDate)}.</p>
                    )}
                    <p>Prepárate desde ya: habla con tu contador y habilita la facturación electrónica antes del tope.</p>
                  </>
                )}
              </div>
            )}

            {level === "ok" && !data.alreadyInvoicing && data.projectedCapDate && (
              <p className="text-sm text-gray-700">
                A tu ritmo actual llegarías al tope alrededor del {formatDay(data.projectedCapDate)}.
              </p>
            )}

            {data.incomeTaxExceeded && (
              <p className="flex items-start gap-2 text-xs text-gray-700">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-gray-500" aria-hidden="true" />
                Ya pasaste {formatCurrency(data.incomeTaxCap)} (1.400 UVT): deberás declarar renta en {data.year + 1} por
                el año {data.year}.
              </p>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={data.alreadyInvoicing}
                disabled={saving}
                onChange={(e) => toggleAlreadyInvoicing(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              Ya facturo electrónicamente / soy responsable de IVA
            </label>

            <p className="text-xs text-gray-500">
              Calculado solo con las ventas registradas en posib (sin anuladas), del 1 de enero al 31 de diciembre. La
              DIAN cuenta todos tus ingresos y consignaciones: confírmalo con tu contador.
              {data.uvtEstimated && ` La DIAN aún no publica la UVT de ${data.year}; usamos la del año anterior.`}
            </p>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
