"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getPartnership, savePartnership, type Partner } from "@/lib/cloudflare-api";

const MAX_PARTNERS = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reparte 100 % en partes iguales; el último socio se queda con el redondeo. */
function equalShares(partners: Partner[]): Partner[] {
  const each = Math.floor((100 / partners.length) * 100) / 100;
  return partners.map((p, i) => ({
    ...p,
    share: i === partners.length - 1 ? round2(100 - each * (partners.length - 1)) : each,
  }));
}

/**
 * Negocio de varios socios: el dueño registra quiénes son y con qué porcentaje
 * participa cada uno. Con eso Rentabilidad muestra cuánto de la ganancia le toca
 * a cada socio. Si el usuario no puede ver reportes, la tarjeta no aparece.
 */
export function PartnershipConfig() {
  const { getToken } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPartnership(getToken)
      .then((data) => {
        setEnabled(data.enabled);
        setPartners(data.partners);
      })
      .catch(() => setHidden(true))
      .finally(() => setLoaded(true));
  }, [getToken]);

  if (hidden) return null;

  const total = round2(partners.reduce((sum, p) => sum + (Number.isFinite(p.share) ? p.share : 0), 0));
  const totalOk = total === 100;

  const update = (i: number, patch: Partial<Partner>) =>
    setPartners((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const toggle = (next: boolean) => {
    setEnabled(next);
    // Al activar por primera vez: dos socios a mitades, para empezar a llenar.
    if (next && partners.length < 2) {
      setPartners(equalShares([...partners, ...Array(2 - partners.length).fill({ name: "", share: 0 })]));
    }
    if (!next) persist(false, partners);
  };

  const persist = async (nextEnabled: boolean, list: Partner[]) => {
    setSaving(true);
    try {
      await savePartnership({ enabled: nextEnabled, partners: list }, getToken);
      toast.success(nextEnabled ? "Socios guardados" : "El negocio quedó como de un solo dueño");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
      if (!nextEnabled) setEnabled(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-brand" />
          Negocio con socios
        </CardTitle>
        <CardDescription>
          Actívalo si la tienda es de varias personas. En Rentabilidad verás cuánto de la ganancia le
          toca a cada socio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div>
            <p className="font-medium">Este negocio es de varios socios</p>
            <p className="text-sm text-gray-500">Escribe el nombre de cada socio y qué parte del negocio tiene.</p>
          </div>
          <Switch
            checked={enabled}
            disabled={!loaded || saving}
            onCheckedChange={toggle}
            aria-label="Este negocio es de varios socios"
          />
        </div>

        {enabled && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {partners.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Input
                    value={p.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder={`Nombre del socio ${i + 1}`}
                    aria-label={`Nombre del socio ${i + 1}`}
                    maxLength={60}
                    className="flex-1"
                  />
                  <div className="relative w-24 shrink-0">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      value={Number.isFinite(p.share) ? p.share : ""}
                      onChange={(e) => update(i, { share: e.target.value === "" ? NaN : Number(e.target.value) })}
                      aria-label={`Porcentaje de ${p.name || `socio ${i + 1}`}`}
                      className="pr-7 text-right"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                      %
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={partners.length <= 2}
                    onClick={() => setPartners((list) => list.filter((_, j) => j !== i))}
                    aria-label={`Quitar a ${p.name || `socio ${i + 1}`}`}
                    className="shrink-0 cursor-pointer text-gray-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={partners.length >= MAX_PARTNERS}
                onClick={() => setPartners((list) => [...list, { name: "", share: 0 }])}
                className="cursor-pointer"
              >
                <Plus className="mr-1 h-4 w-4" /> Agregar socio
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPartners((list) => equalShares(list))}
                className="cursor-pointer"
              >
                Repartir en partes iguales
              </Button>
              <span className={`ml-auto text-sm font-medium tabular-nums ${totalOk ? "text-gray-600" : "text-red-600"}`}>
                Suman {total.toLocaleString("es-CO")} %{!totalOk && " (deben sumar 100 %)"}
              </span>
            </div>

            <Button
              type="button"
              disabled={saving || !totalOk || partners.some((p) => !p.name.trim())}
              onClick={() => persist(true, partners)}
              className="cursor-pointer"
            >
              {saving ? "Guardando..." : "Guardar socios"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
