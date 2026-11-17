"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteCustomer, getCustomers, mergeCustomer, type Customer } from "@/lib/cloudflare-api";
import { formatCurrency } from "@/lib/utils";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

interface Props {
  customer: { id: string; name: string; phone?: string | null; current_debt?: number | null };
  /** Compras registradas del cliente (para saber si tiene historial). */
  purchases: number;
}

/**
 * Eliminar un cliente o, si está repetido y ya tiene ventas o fiados, unirlo
 * con el otro para no perder el historial (POST /api/customers/:id/merge).
 */
export function RemoveCustomerDialog({ customer, purchases }: Props) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<Customer[]>([]);
  const [target, setTarget] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const debt = Number(customer.current_debt) || 0;
  const hasHistory = purchases > 0 || debt > 0;

  useEffect(() => {
    if (!open) return;
    getCustomers(getToken)
      .then((list) => {
        const rest = (list as Customer[]).filter((c) => c.id !== customer.id);
        // Primero los que se llaman igual o tienen el mismo teléfono: casi
        // siempre son el repetido.
        const same = (c: Customer) =>
          norm(c.name) === norm(customer.name) || (!!customer.phone && c.phone === customer.phone);
        rest.sort((a, b) => Number(same(b)) - Number(same(a)) || a.name.localeCompare(b.name));
        setOthers(rest);
        const first = rest.find(same);
        if (first) setTarget(first.id);
      })
      .catch(() => toast.error("No se pudo cargar la lista de clientes"));
  }, [open, getToken, customer.id, customer.name, customer.phone]);

  const visible = useMemo(() => {
    const f = norm(filter);
    return f ? others.filter((c) => norm(c.name).includes(f) || (c.phone || "").includes(f)) : others;
  }, [others, filter]);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteCustomer(customer.id, getToken);
      toast.success(`${customer.name} se eliminó`);
      router.push("/dashboard/customers");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el cliente");
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    const into = others.find((c) => c.id === target);
    if (!into) return;
    setBusy(true);
    try {
      await mergeCustomer(customer.id, into.id, getToken);
      toast.success(`Listo: todo quedó en ${into.name}`);
      router.push(`/dashboard/customers/${into.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron unir los clientes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-red-700 hover:bg-red-50 hover:text-red-800"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Eliminar
      </Button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar a {customer.name}</DialogTitle>
          </DialogHeader>

          {hasHistory ? (
            <div className="space-y-3 text-sm text-gray-800">
              <p>
                Este cliente tiene {purchases} {purchases === 1 ? "compra" : "compras"}
                {debt > 0 ? (
                  <>
                    {" "}y <strong>{formatCurrency(debt)} de fiado</strong>
                  </>
                ) : null}
                . Si lo borras se pierde ese historial.
              </p>
              <p className="flex items-start gap-2 rounded-lg bg-brand-light/50 p-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                <span>
                  <strong>¿Está repetido?</strong> Escoge el otro registro y se unen: las compras, los abonos, el fiado y
                  los puntos pasan a ese cliente, y este se elimina.
                </span>
              </p>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar por nombre o teléfono"
                aria-label="Buscar cliente para unir"
                className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
              <ul className="max-h-56 overflow-y-auto rounded-md border border-gray-200" role="radiogroup" aria-label="Unir con">
                {visible.length === 0 && <li className="p-3 text-gray-600">No hay otros clientes.</li>}
                {visible.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-0 hover:bg-gray-50">
                      <input
                        type="radio"
                        name="merge-target"
                        checked={target === c.id}
                        onChange={() => setTarget(c.id)}
                        className="h-4 w-4 accent-brand"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-900">{c.name}</span>
                        <span className="block text-xs text-gray-600">
                          {c.phone || "Sin teléfono"}
                          {Number(c.current_debt) > 0 ? ` · debe ${formatCurrency(Number(c.current_debt))}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-800">
              No tiene compras ni fiados registrados. ¿Seguro que quieres eliminarlo? No se puede deshacer.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            {hasHistory ? (
              <Button onClick={merge} disabled={busy || !target}>
                {busy ? "Uniendo..." : "Unir con el seleccionado"}
              </Button>
            ) : (
              <Button onClick={remove} disabled={busy} className="bg-red-600 text-white hover:bg-red-700">
                {busy ? "Eliminando..." : "Eliminar cliente"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
