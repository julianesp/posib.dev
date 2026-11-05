"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowDownToLine, ArrowUpFromLine, HelpCircle, History, Loader2, Lock, LockOpen, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useGuide } from "@/components/guide/GuideProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  addCashMovement,
  closeCashSession,
  deleteCashMovement,
  getCurrentCashSession,
  openCashSession,
  type CashSession,
  type CashSummary,
} from "@/lib/cloudflare-api";
import { cn, formatCurrency } from "@/lib/utils";

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Fiado",
};

// Motivos frecuentes: un toque en vez de escribir (el cajero está atendiendo).
const OUT_REASONS = ["Pago a proveedor", "Gasto de la tienda", "Retiro del dueño", "Domicilio"];
const IN_REASONS = ["Cambio para la caja", "Aporte del dueño"];

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });

/** "50.000" -> 50000. Solo pesos enteros. */
const parsePesos = (text: string) => Number(text.replace(/\D/g, "")) || 0;
const formatPesosInput = (text: string) => {
  const digits = text.replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("es-CO") : "";
};

/**
 * Franja de "Caja abierta / cerrada" del Punto de Venta, con los diálogos de
 * apertura (base) y cierre (conteo y cuadre). El cuadre lo calcula el Worker
 * (routes/cash-sessions.ts); aquí solo se muestra y se informa lo contado.
 * Si el usuario no tiene permiso para la caja, no se muestra nada.
 */
export function CashRegisterControl() {
  const { getToken } = useAuth();
  const { openGuide } = useGuide();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "hidden" }
    | { kind: "closed" }
    | { kind: "open"; session: CashSession; summary: CashSummary }
  >({ kind: "loading" });
  const [isOwner, setIsOwner] = useState(false);

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [base, setBase] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const [moveDialog, setMoveDialog] = useState(false);
  const [moveKind, setMoveKind] = useState<"salida" | "entrada">("salida");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const load = useCallback(async () => {
    try {
      const { session, summary, is_owner } = await getCurrentCashSession(getToken);
      setIsOwner(is_owner);
      setState(session && summary ? { kind: "open", session, summary } : { kind: "closed" });
      return session && summary ? { session, summary } : null;
    } catch (error) {
      // Sin permiso para la caja (o caja aún no desplegada): no estorbar.
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setState({ kind: "hidden" });
      } else {
        setState({ kind: "closed" });
      }
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    // Diferido para no hacer setState síncrono dentro del efecto.
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const handleOpen = async () => {
    setBusy(true);
    try {
      await openCashSession(parsePesos(base), getToken);
      toast.success("Caja abierta");
      setOpenDialog(false);
      setBase("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la caja");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const startMove = (kind: "salida" | "entrada") => {
    setMoveKind(kind);
    setMoveAmount("");
    setMoveReason("");
    setMoveDialog(true);
  };

  const handleMove = async () => {
    if (state.kind !== "open") return;
    if (parsePesos(moveAmount) <= 0) {
      toast.error("Escribe el valor en pesos");
      return;
    }
    if (!moveReason.trim()) {
      toast.error("Escribe para qué es o toca una opción");
      return;
    }
    setBusy(true);
    try {
      await addCashMovement(
        state.session.id,
        { kind: moveKind, amount: parsePesos(moveAmount), reason: moveReason.trim() },
        getToken,
      );
      toast.success(moveKind === "salida" ? "Salida de efectivo registrada" : "Entrada de efectivo registrada");
      setMoveDialog(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMove = async (movementId: string) => {
    if (state.kind !== "open") return;
    try {
      await deleteCashMovement(state.session.id, movementId, getToken);
      toast.success("Movimiento borrado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo borrar");
    }
    await load();
  };

  const startClose = async () => {
    setCounted("");
    setNotes("");
    setCloseDialog(true);
    await load(); // totales al momento de cerrar, no los de cuando se cargó la página
  };

  const handleClose = async () => {
    if (state.kind !== "open") return;
    if (!counted.trim()) {
      toast.error("Escribe cuánto dinero contaste en la caja");
      return;
    }
    setBusy(true);
    try {
      const closed = await closeCashSession(state.session.id, parsePesos(counted), notes, getToken);
      const diff = closed.difference ?? 0;
      if (diff === 0) toast.success("Caja cerrada: cuadra exacto");
      else if (diff > 0) toast.success(`Caja cerrada: sobran ${formatCurrency(diff)}`);
      else toast.warning(`Caja cerrada: faltan ${formatCurrency(Math.abs(diff))}`);
      setCloseDialog(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cerrar la caja");
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "loading" || state.kind === "hidden") return null;

  const summary = state.kind === "open" ? state.summary : null;
  const countedValue = parsePesos(counted);
  const difference = summary && counted.trim() ? countedValue - summary.expected_cash : null;
  const otherMethods = summary
    ? Object.entries(summary.sales).filter(([method]) => method !== "efectivo")
    : [];
  const otherPayments = summary
    ? Object.entries(summary.payments).filter(([method]) => method !== "efectivo")
    : [];

  return (
    <>
      <div
        data-guide="cash-status"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5",
          state.kind === "open" ? "border-brand/40 bg-brand-light/40" : "border-amber-300 bg-amber-50",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            state.kind === "open" ? "bg-brand text-white" : "bg-amber-400 text-white",
          )}
        >
          {state.kind === "open" ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {state.kind === "open" ? (
            <>
              <p className="font-semibold text-gray-900">
                Caja abierta desde las {hour(state.session.opened_at)}
              </p>
              <p className="text-xs text-gray-600">
                Base {formatCurrency(state.session.opening_amount)}
                {state.session.opened_by_name ? ` · abrió ${state.session.opened_by_name}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-gray-900">Caja cerrada</p>
              <p className="text-xs text-gray-600">
                Ábrela con la base del día para cuadrar al final del turno.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => openGuide("caja")}
            title="¿Cómo funciona la caja?"
            aria-label="¿Cómo funciona la caja?"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-gray-600 hover:bg-white"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <Link
            href="/dashboard/sales/caja"
            data-guide="cash-history"
            title="Ver cierres de caja"
            aria-label="Ver cierres de caja"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-white"
          >
            <History className="h-4 w-4" />
          </Link>
          {state.kind === "open" ? (
            <Button size="sm" variant="outline" onClick={() => startMove("salida")} className="cursor-pointer bg-white" data-guide="cash-move">
              <ArrowUpFromLine className="mr-1.5 h-4 w-4" />
              Sacar / meter
            </Button>
          ) : null}
          {state.kind === "open" ? (
            <Button size="sm" onClick={startClose} className="cursor-pointer" data-guide="cash-close">
              <Wallet className="mr-1.5 h-4 w-4" />
              Cerrar caja
            </Button>
          ) : (
            <Button size="sm" onClick={() => setOpenDialog(true)} className="cursor-pointer" data-guide="cash-open">
              <LockOpen className="mr-1.5 h-4 w-4" />
              Abrir caja
            </Button>
          )}
        </div>
      </div>

      {/* Abrir caja */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Abrir caja</DialogTitle>
            <DialogDescription>
              ¿Con cuánto efectivo empiezas? Es la base para dar cambio. Si no dejas base, escribe 0.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium" htmlFor="cash-base">
            Base en efectivo
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="cash-base"
              inputMode="numeric"
              autoFocus
              placeholder="0"
              value={base}
              onChange={(e) => setBase(formatPesosInput(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && !busy && handleOpen()}
              className="h-11 pl-7 text-lg font-semibold"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleOpen} disabled={busy} className="cursor-pointer">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Abrir caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sacar o meter efectivo */}
      <Dialog open={moveDialog} onOpenChange={(v) => !busy && setMoveDialog(v)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sacar o meter efectivo</DialogTitle>
            <DialogDescription>
              Si pagas algo con plata de la caja, anótalo aquí para que el cierre no salga con faltante.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de movimiento">
            {([
              ["salida", "Sale plata", ArrowUpFromLine],
              ["entrada", "Entra plata", ArrowDownToLine],
            ] as const).map(([kind, label, Icon]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={moveKind === kind}
                onClick={() => {
                  setMoveKind(kind);
                  setMoveReason("");
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                  moveKind === kind
                    ? kind === "salida"
                      ? "border-red-400 bg-red-50 text-red-700"
                      : "border-green-500 bg-green-50 text-green-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              inputMode="numeric"
              autoFocus
              aria-label="Valor en pesos"
              placeholder="Valor"
              value={moveAmount}
              onChange={(e) => setMoveAmount(formatPesosInput(e.target.value))}
              className="h-11 pl-7 text-lg font-semibold"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(moveKind === "salida" ? OUT_REASONS : IN_REASONS).map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setMoveReason(reason)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  moveReason === reason ? "border-brand bg-brand text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50",
                )}
              >
                {reason}
              </button>
            ))}
          </div>
          <Input
            aria-label="Para qué es"
            placeholder="¿Para qué es? (ej.: pago de los huevos)"
            maxLength={120}
            value={moveReason}
            onChange={(e) => setMoveReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleMove()}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleMove} disabled={busy} className="cursor-pointer">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cerrar caja */}
      <Dialog open={closeDialog} onOpenChange={(v) => !busy && setCloseDialog(v)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar caja</DialogTitle>
            <DialogDescription>
              Cuenta el efectivo del cajón y escribe cuánto hay. posib te dice si cuadra.
            </DialogDescription>
          </DialogHeader>

          {summary ? (
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
                <Row label="Base" value={state.kind === "open" ? state.session.opening_amount : 0} />
                <Row
                  label={`Ventas en efectivo (${summary.sales.efectivo?.count ?? 0})`}
                  value={summary.cash_sales}
                />
                <Row
                  label={`Abonos de fiado en efectivo (${summary.payments.efectivo?.count ?? 0})`}
                  value={summary.cash_payments}
                />
                {summary.cash_in > 0 && <Row label="Entradas de efectivo" value={summary.cash_in} />}
                {summary.cash_out > 0 && <Row label="Salidas de efectivo" value={-summary.cash_out} />}
                <div className="border-t border-dashed border-gray-300 pt-1.5">
                  <Row label="Debe haber en la caja" value={summary.expected_cash} strong />
                </div>
              </div>

              {summary.movements.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-gray-200 p-3 text-xs">
                  {summary.movements.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className={cn("font-num font-semibold", m.kind === "salida" ? "text-red-700" : "text-green-700")}>
                        {m.kind === "salida" ? "−" : "+"}
                        {formatCurrency(m.amount)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-700">{m.reason}</span>
                      <span className="text-gray-400">{hour(m.created_at)}</span>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMove(m.id)}
                          aria-label={`Borrar ${m.reason}`}
                          title="Borrar (por si te equivocaste)"
                          className="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {(otherMethods.length > 0 || otherPayments.length > 0) && (
                <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                  <p className="mb-1 font-medium text-gray-700">No van al cajón:</p>
                  {otherMethods.map(([method, t]) => (
                    <Row key={`s-${method}`} label={`${METHOD_LABEL[method] ?? method} (${t.count})`} value={t.total} small />
                  ))}
                  {otherPayments.map(([method, t]) => (
                    <Row key={`p-${method}`} label={`Abonos por ${METHOD_LABEL[method] ?? method}`} value={t.total} small />
                  ))}
                </div>
              )}

              <div>
                <label className="text-sm font-medium" htmlFor="cash-counted">
                  ¿Cuánto dinero contaste?
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    id="cash-counted"
                    inputMode="numeric"
                    autoFocus
                    placeholder="0"
                    value={counted}
                    onChange={(e) => setCounted(formatPesosInput(e.target.value))}
                    className="h-11 pl-7 text-lg font-semibold"
                  />
                </div>
              </div>

              {difference !== null && (
                <p
                  className={cn(
                    "rounded-lg px-3 py-2 text-center font-semibold",
                    difference === 0 && "bg-green-50 text-green-700",
                    difference > 0 && "bg-blue-50 text-blue-700",
                    difference < 0 && "bg-red-50 text-red-700",
                  )}
                >
                  {difference === 0
                    ? "✓ La caja cuadra exacto"
                    : difference > 0
                      ? `Sobran ${formatCurrency(difference)}`
                      : `Faltan ${formatCurrency(Math.abs(difference))}`}
                </p>
              )}

              <div>
                <label className="text-sm font-medium" htmlFor="cash-notes">
                  Nota <span className="font-normal text-gray-500">(opcional)</span>
                </label>
                <textarea
                  id="cash-notes"
                  rows={2}
                  maxLength={500}
                  placeholder="Ej.: saqué $20.000 para pagarle al proveedor"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
            </div>
          )}

          {/* Fijo abajo: en el celular el diálogo hace scroll y los botones deben verse siempre */}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 bg-inherit px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => setCloseDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleClose} disabled={busy || !summary} className="cursor-pointer">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cerrar caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, strong, small }: { label: string; value: number; strong?: boolean; small?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "text-base font-bold", small && "text-xs")}>
      <span className={strong ? "text-gray-900" : "text-gray-600"}>{label}</span>
      <span className={cn("font-num whitespace-nowrap", strong ? "text-brand" : "text-gray-900")}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}
