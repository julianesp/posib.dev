"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPartnership, type Partner } from "@/lib/cloudflare-api";
import { formatCurrency } from "@/lib/utils";

/**
 * Rentabilidad → cuánto de la ganancia del período le corresponde a cada socio,
 * según los porcentajes de Configuración → "Negocio con socios". No aparece si
 * el negocio es de un solo dueño.
 */
export function PartnersSplitCard({ profit, periodLabel }: { profit: number; periodLabel: string }) {
  const { getToken } = useAuth();
  const [partners, setPartners] = useState<Partner[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPartnership(getToken)
      .then((d) => {
        if (!cancelled) setPartners(d.enabled ? d.partners : null);
      })
      .catch(() => {
        // Sin permiso o error de red: simplemente no se muestra.
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  if (!partners || partners.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-brand" />
          Reparto entre socios
        </CardTitle>
        <CardDescription>
          Lo que le toca a cada uno de la ganancia ({periodLabel.toLowerCase()}), según su parte del negocio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {profit <= 0 ? (
          <p className="text-sm text-gray-600">En este período no hay ganancia para repartir.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((p) => (
              <li key={p.name} className="rounded-xl bg-gray-50 p-4">
                <p className="font-medium text-gray-900">{p.name}</p>
                <p className="font-num mt-1 text-2xl font-bold text-brand">
                  {formatCurrency(Math.round((profit * p.share) / 100))}
                </p>
                <p className="text-sm text-gray-500">{p.share.toLocaleString("es-CO")} % del negocio</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Es la ganancia de las ventas (venta menos costo). No descuenta arriendo, servicios ni sueldos:
          réstenlos antes de repartir.
        </p>
      </CardContent>
    </Card>
  );
}
