"use client";

import Link from "next/link";
import { CreditCard } from "lucide-react";
import type { UserProfile } from "@/lib/types";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Enlace que abre directamente el pago del plan (lo usa también el correo de recordatorio). */
export const PAY_PLAN_HREF = "/dashboard/subscription?pagar=plan";

/**
 * Panel de control → fila "Mi plan": hasta cuándo está pagado y un botón para
 * pagar (abre ePayco directo con ?pagar=plan). Siempre visible para el dueño, discreta; en los últimos 3 días se
 * resalta con el color de la tienda. Pagar antes no hace perder días: el mes
 * nuevo se suma al final del período vigente.
 */
export function PlanPaymentRow({ profile, now }: { profile: UserProfile; /** ms de cuando se cargó el perfil */ now: number }) {
  const isTrial = profile.subscription_status === "trial";
  const endIso = isTrial ? profile.trial_end_date : profile.next_billing_date;
  if (!endIso || (profile.subscription_status !== "trial" && profile.subscription_status !== "active")) {
    return null;
  }

  const end = new Date(endIso);
  const daysLeft = Math.ceil((end.getTime() - now) / 86_400_000);
  if (daysLeft < 0) return null; // vencido: de eso se encarga el modal de suscripción

  const urgent = daysLeft <= 3;
  // Igual que la página de suscripción: el plan activo se puede renovar desde
  // 7 días antes; antes de eso el botón solo lleva a ver el plan.
  const payable = isTrial || daysLeft <= 7;
  const when = daysLeft === 0 ? "hoy" : daysLeft === 1 ? "mañana" : `en ${daysLeft} días`;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 md:px-5 ${
        urgent ? "border-brand/50 bg-brand-light" : "border-gray-200 bg-white"
      }`}
    >
      <CreditCard className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-gray-700">
        {isTrial ? "Tu prueba gratis" : "Tu plan"} vence el{" "}
        <strong className="text-gray-900">
          {end.getDate()} de {MONTHS[end.getMonth()]}
        </strong>{" "}
        <span className={urgent ? "font-semibold text-brand" : "text-gray-500"}>({when})</span>
      </p>
      <Link
        href={payable ? PAY_PLAN_HREF : "/dashboard/subscription"}
        className={`inline-flex shrink-0 items-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
          urgent
            ? "bg-brand text-white hover:bg-brand-hover"
            : "border-2 border-brand/40 text-gray-800 hover:border-brand hover:bg-brand-light"
        }`}
      >
        {isTrial ? "Activar mi plan" : payable ? "Pagar ahora" : "Ver mi plan"}
      </Link>
    </div>
  );
}
