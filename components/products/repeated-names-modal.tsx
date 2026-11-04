'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { X, Tags, CheckCircle2, Search, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { updateProduct } from '@/lib/cloudflare-api';
import { findRepeatedNameGroups, normalizeName } from '@/lib/duplicate-helpers';
import { SuggestNameFromPhoto } from './suggest-name-from-photo';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

interface RepeatedNamesProduct {
  id: string;
  name: string;
  barcode?: string;
  sale_price: number;
  stock: number;
}

interface RepeatedNamesModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: RepeatedNamesProduct[];
  onUpdate?: () => void;
}

const GROUPS_PER_PAGE = 25;

export function RepeatedNamesModal({
  isOpen,
  onClose,
  products,
  onUpdate,
}: RepeatedNamesModalProps) {
  const { getToken } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [visibleGroups, setVisibleGroups] = useState(GROUPS_PER_PAGE);

  const groups = useMemo(
    () => (isOpen ? findRepeatedNameGroups(products) : []),
    [isOpen, products]
  );

  const filteredGroups = useMemo(() => {
    const term = normalizeName(search);
    if (!term) return groups;
    return groups.filter(
      (g) =>
        normalizeName(g.name).includes(term) ||
        g.products.some((p) => p.barcode?.includes(search.trim()))
    );
  }, [groups, search]);

  const draftFor = (product: RepeatedNamesProduct) => drafts[product.id] ?? product.name;

  const handleSave = async (product: RepeatedNamesProduct) => {
    const newName = draftFor(product).trim();
    if (!newName || newName === product.name.trim()) return;

    setSavingId(product.id);
    try {
      await updateProduct(product.id, { name: newName }, getToken);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      toast.success(`Renombrado: "${newName}"`);
      onUpdate?.();
    } catch (error) {
      console.error('Error renombrando producto:', error);
      toast.error('No se pudo cambiar el nombre. Intenta de nuevo.');
    } finally {
      setSavingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Tags className="h-6 w-6 text-brand" />
              Nombres repetidos
            </h2>
            <p className="text-gray-500 text-sm">
              Estos productos tienen el mismo nombre pero son distintos (otro código o
              precio). Ponles un nombre que los diferencie, por ejemplo con la marca,
              la variedad o el tamaño. No se fusiona nada.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 hover:bg-black hover:text-white hover:scale-90 scale-100 transition-all border cursor-pointer rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p className="font-medium">No hay nombres repetidos</p>
              <p className="text-sm">Cada producto tiene un nombre distinto.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-sm text-gray-600 flex-1">
                  <strong>{groups.length}</strong> nombre(s) repetido(s). Escribe el
                  nombre nuevo y pulsa <strong>Guardar</strong> en cada producto.
                </p>
                <div className="relative sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setVisibleGroups(GROUPS_PER_PAGE);
                    }}
                    placeholder="Buscar nombre o código"
                    className="pl-9"
                  />
                </div>
              </div>

              {filteredGroups.length === 0 && (
                <p className="text-center text-sm text-gray-500 py-8">
                  Ningún grupo coincide con la búsqueda.
                </p>
              )}

              {filteredGroups.slice(0, visibleGroups).map((group) => (
                <Card key={group.key} className="border-2 border-amber-200">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{group.name}</span>
                      <span className="text-xs text-gray-500">
                        ({group.products.length} productos)
                      </span>
                    </div>

                    <div className="space-y-2">
                      {group.products.map((product) => {
                        const draft = draftFor(product);
                        const changed =
                          draft.trim() !== '' && draft.trim() !== product.name.trim();
                        return (
                          <div
                            key={product.id}
                            className="p-3 rounded-lg border border-gray-200 space-y-2"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="sm:w-48 shrink-0 text-sm">
                              <p className="font-mono text-xs text-gray-500 truncate">
                                {product.barcode || 'Sin código'}
                              </p>
                              <p>
                                <span className="text-brand font-medium">
                                  {formatCurrency(product.sale_price)}
                                </span>
                                <span className="text-gray-500">
                                  {' '}
                                  · Stock: <strong>{product.stock}</strong>
                                </span>
                              </p>
                            </div>
                            <Input
                              value={draft}
                              onChange={(e) =>
                                setDrafts((prev) => ({ ...prev, [product.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSave(product);
                              }}
                              aria-label={`Nombre nuevo para el producto con código ${
                                product.barcode || 'sin código'
                              }`}
                              className="flex-1"
                            />
                            <Button
                              onClick={() => handleSave(product)}
                              disabled={!changed || savingId === product.id}
                              className="sm:w-28"
                            >
                              <Save className="mr-2 h-4 w-4" />
                              {savingId === product.id ? 'Guardando...' : 'Guardar'}
                            </Button>
                            </div>
                            <SuggestNameFromPhoto
                              currentName={product.name}
                              onUse={(name) =>
                                setDrafts((prev) => ({ ...prev, [product.id]: name }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filteredGroups.length > visibleGroups && (
                <div className="text-center">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleGroups((n) => n + GROUPS_PER_PAGE)}
                  >
                    Mostrar más ({filteredGroups.length - visibleGroups} restantes)
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-6 border-t">
          <Button onClick={onClose} variant="outline">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
