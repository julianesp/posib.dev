"use client";

import { useMemo, type CSSProperties } from "react";
import { Check, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { GUIDES, findGuideForPath, type Guide } from "@/lib/guide/guides";
import { setAutoHelpEnabled } from "@/lib/help-preferences";
import { useAutoHelpEnabled } from "@/components/help/AutoHelpToggle";
import s from "./guide.module.css";

/**
 * Solo las guías de secciones que este usuario tiene en su menú (un cajero no
 * ve Rentabilidad; sin el complemento no hay Tienda online). Se lee del menú
 * lateral ya pintado para no duplicar la lógica de permisos y complementos.
 */
function availableGuides(): Guide[] {
  const menu = document.querySelector("aside");
  if (!menu || !menu.querySelector('a[href^="/dashboard"]')) return GUIDES;
  return GUIDES.filter((g) => menu.querySelector(`a[href="${g.menuHref ?? g.href}"]`));
}

function GuideRow({
  guide,
  seen,
  index,
  onOpen,
}: {
  guide: Guide;
  seen: boolean;
  index: number;
  onOpen: () => void;
}) {
  const Icon = guide.icon;
  return (
    <li className={s.stagger} style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        onClick={onOpen}
        className={`${s.row} flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-gray-50`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">{guide.title}</span>
          <span className="block truncate text-sm text-gray-600">{guide.summary}</span>
        </span>
        {seen ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Vista</span>
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

export function GuideCenter({
  open,
  onOpenChange,
  seen,
  pathname,
  onOpenGuide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seen: readonly string[];
  pathname: string | null;
  onOpenGuide: (id: string) => void;
}) {
  // Misma preferencia que el check "Ayudas gráficas" del panel de inicio.
  const autoHelp = useAutoHelpEnabled();
  // Se recalcula cada vez que se abre (el diálogo solo se pinta en el cliente).
  const guides = useMemo(() => (open ? availableGuides() : GUIDES), [open]);

  const current = findGuideForPath(pathname);
  const here = current && guides.includes(current) ? current : undefined;
  const rest = guides.filter((g) => g !== here);
  const seenCount = guides.filter((g) => seen.includes(g.id)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${s.root} flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-md`}>
        <DialogHeader className="border-b border-gray-100 p-5 pb-4 text-left">
          <DialogTitle className="text-lg text-gray-900">Guía de uso</DialogTitle>
          <DialogDescription className="text-gray-600">
            Aprende cada función a tu ritmo. Llevas {seenCount} de {guides.length}.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {here && (
            <>
              <p className="px-2 pb-1 text-xs font-medium text-gray-500">En esta pantalla</p>
              <ul>
                <GuideRow
                  guide={here}
                  seen={seen.includes(here.id)}
                  index={0}
                  onOpen={() => onOpenGuide(here.id)}
                />
              </ul>
              <p className="px-2 pb-1 pt-3 text-xs font-medium text-gray-500">Todas las guías</p>
            </>
          )}
          <ul>
            {rest.map((g, i) => (
              <GuideRow
                key={g.id}
                guide={g}
                seen={seen.includes(g.id)}
                index={i + (here ? 1 : 0)}
                onOpen={() => onOpenGuide(g.id)}
              />
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-gray-100 p-5 pt-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Avisos de primera vez</p>
            <p className="text-sm text-gray-600">
              Un aviso pequeño la primera vez que entras a cada sección.
            </p>
          </div>
          <Switch
            checked={autoHelp}
            onCheckedChange={setAutoHelpEnabled}
            aria-label="Activar o desactivar los avisos de primera vez"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
