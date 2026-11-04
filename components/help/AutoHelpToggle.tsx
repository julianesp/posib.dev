"use client";

import { useSyncExternalStore } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  isAutoHelpEnabled,
  setAutoHelpEnabled,
  subscribeAutoHelp,
} from "@/lib/help-preferences";

/** Preferencia de ayudas automáticas, siempre al día en todos los componentes. */
export function useAutoHelpEnabled(): boolean {
  return useSyncExternalStore(subscribeAutoHelp, isAutoHelpEnabled, () => true);
}

/**
 * Check del panel de inicio para activar o desactivar las ayudas gráficas (los
 * avisos de primera vez que abren la guía con la demo animada). Es la misma
 * preferencia que el interruptor de la guía de uso.
 */
export function AutoHelpToggle() {
  const enabled = useAutoHelpEnabled();

  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) => setAutoHelpEnabled(checked === true)}
        className="border-gray-400 data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white"
      />
      Mostrar ayudas gráficas
    </label>
  );
}
