"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, LayoutGrid, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MoreAction {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Navega a otra página… */
  href?: string;
  /** …o ejecuta una acción en esta. */
  onSelect?: () => void;
  /** Número a resaltar (p. ej. repetidos por revisar). */
  badge?: number;
  /** Filtro activo en la lista. */
  active?: boolean;
}

/**
 * Botón pegado al borde derecho que late cada 5 segundos para recordar que hay
 * más funciones, y abre un panel con ellas en filas. Libera la barra de
 * botones de la página (en el celular se amontonaban).
 */
export function MoreActions({
  actions,
  title = "Más funciones",
  guideTarget,
}: {
  actions: MoreAction[];
  title?: string;
  guideTarget?: string;
}) {
  const [open, setOpen] = useState(false);
  const pending = actions.reduce((sum, a) => sum + (a.badge ?? 0), 0);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        data-guide={guideTarget}
        aria-label={pending > 0 ? `${title} (${pending} por revisar)` : title}
        title={title}
        className="more-actions-tab cursor-pointer fixed right-0 top-1/2 z-40 flex flex-col items-center gap-1.5 rounded-l-2xl bg-brand py-3 pl-2.5 pr-2 text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <LayoutGrid className="h-5 w-5" />
        <span className="text-[11px] font-semibold leading-none [writing-mode:vertical-rl] rotate-180">
          Más
        </span>
        {pending > 0 && (
          <span className="min-w-5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold leading-none text-gray-900">
            {pending}
          </span>
        )}
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="more-actions-overlay fixed inset-0 z-50 modal-backdrop" />
        <DialogPrimitive.Content className="more-actions-sheet fixed inset-y-0 right-0 z-50 flex w-[88vw] max-w-sm flex-col bg-white shadow-2xl outline-none">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <DialogPrimitive.Title className="text-lg font-semibold text-gray-900">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Otras herramientas de esta sección
          </DialogPrimitive.Description>

          <ul className="flex-1 overflow-y-auto py-2">
            {actions.map((action, i) => {
              const Icon = action.icon;
              const content = (
                <>
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      action.active ? "bg-brand text-white" : "bg-brand-light text-brand",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-gray-900">{action.label}</span>
                    <span className="block text-sm text-gray-500">{action.description}</span>
                  </span>
                  {action.badge ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {action.badge}
                    </span>
                  ) : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </>
              );
              const rowClass =
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none";

              return (
                <li key={action.id} style={{ animationDelay: `${40 + i * 30}ms` }} className="more-actions-row">
                  {action.href ? (
                    <Link href={action.href} className={rowClass} onClick={() => setOpen(false)}>
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() => {
                        setOpen(false);
                        action.onSelect?.();
                      }}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
