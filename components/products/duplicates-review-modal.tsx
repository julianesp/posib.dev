'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@clerk/nextjs';
import { X, Package, Layers, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProductWithRelations } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { mergeProducts } from '@/lib/cloudflare-api';
import {
  findDuplicateGroups,
  reasonLabel,
  DuplicateGroup,
} from '@/lib/duplicate-helpers';
import Swal from '@/lib/sweetalert';
import { toast } from 'sonner';

interface DuplicatesReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: ProductWithRelations[];
  onUpdate?: () => void;
}

export function DuplicatesReviewModal({
  isOpen,
  onClose,
  products,
  onUpdate,
}: DuplicatesReviewModalProps) {
  const { getToken } = useAuth();
  // Producto principal elegido por grupo (grupo.key -> productId)
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>({});
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  const groups = useMemo(
    () => (isOpen ? findDuplicateGroups(products) : []),
    [isOpen, products]
  );

  // Sugerir como principal el producto con más stock de cada grupo.
  // El historial de los demás se reasigna al principal, así que no se pierde
  // ninguna venta aunque el principal no sea el que las tenía.
  const suggestedPrimary = (group: DuplicateGroup): string => {
    const chosen = primaryByGroup[group.key];
    if (chosen && group.products.some(p => p.id === chosen)) return chosen;
    return [...group.products].sort((a, b) => (b.stock || 0) - (a.stock || 0))[0].id;
  };

  const handleMerge = async (group: DuplicateGroup) => {
    const primaryId = suggestedPrimary(group);
    const primary = group.products.find(p => p.id === primaryId)!;
    const duplicateIds = group.products.filter(p => p.id !== primaryId).map(p => p.id);
    const totalStock = group.products.reduce((s, p) => s + (p.stock || 0), 0);

    const confirmed = await Swal.confirm(
      `Se conservará "${primary.name}" con ${totalStock} en stock y se eliminarán ` +
        `${duplicateIds.length} producto(s) repetido(s). El historial de ventas se conserva.`,
      '¿Agrupar estos productos?',
      { confirmText: 'Sí, agrupar', type: 'question' }
    );
    if (!confirmed) return;

    setMergingKey(group.key);
    try {
      const result = await mergeProducts(primaryId, duplicateIds, getToken);
      toast.success(`${result.mergedCount} producto(s) agrupado(s) en "${primary.name}"`);
      onUpdate?.();
    } catch (error) {
      console.error('Error merging products:', error);
      Swal.error(
        error instanceof Error ? error.message : 'Intenta de nuevo',
        'No se pudieron agrupar'
      );
    } finally {
      setMergingKey(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6 text-brand" />
              Productos repetidos
            </h2>
            <p className="text-gray-500 text-sm">
              Agrupa los productos duplicados para que no queden sueltos. El stock
              se suma y el historial de ventas se conserva.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-black hover:text-white hover:scale-90 scale-100 transition-all border cursor-pointer rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p className="font-medium">No se encontraron productos repetidos</p>
              <p className="text-sm">Tu inventario está limpio.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Se encontraron <strong>{groups.length}</strong> grupo(s) de posibles
                repetidos. Elige cuál producto se conserva (el <em>principal</em>) y
                pulsa <strong>Agrupar</strong>.
              </p>

              {groups.map((group) => {
                const primaryId = suggestedPrimary(group);
                const isMerging = mergingKey === group.key;
                return (
                  <Card key={group.key} className="border-2 border-amber-200">
                    <CardContent className="p-4 space-y-3">
                      {/* Motivos */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{group.label}</span>
                        {group.reasons.map((r) => (
                          <span
                            key={r}
                            className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5"
                          >
                            {reasonLabel(r)}
                          </span>
                        ))}
                        <span className="text-xs text-gray-500">
                          ({group.products.length} productos)
                        </span>
                      </div>

                      {/* Lista de productos del grupo */}
                      <div className="space-y-2">
                        {group.products.map((product) => {
                          const isPrimary = product.id === primaryId;
                          return (
                            <label
                              key={product.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                isPrimary
                                  ? 'border-brand bg-brand-light/40'
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`primary-${group.key}`}
                                checked={isPrimary}
                                onChange={() =>
                                  setPrimaryByGroup((prev) => ({
                                    ...prev,
                                    [group.key]: product.id,
                                  }))
                                }
                                className="h-4 w-4 accent-brand"
                              />
                              <div className="relative w-10 h-10 bg-gray-100 rounded border overflow-hidden shrink-0 flex items-center justify-center">
                                {product.images && product.images.length > 0 && product.images[0] ? (
                                  <Image
                                    src={product.images[0]}
                                    alt={product.name}
                                    fill
                                    sizes="40px"
                                    className="object-contain p-0.5"
                                    loading="lazy"
                                  />
                                ) : (
                                  <Package className="h-5 w-5 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{product.name}</p>
                                <p className="text-xs text-gray-500 font-mono truncate">
                                  {product.barcode || 'Sin código'}
                                  {product.category?.name ? ` · ${product.category.name}` : ''}
                                </p>
                              </div>
                              <div className="text-right text-sm shrink-0">
                                <p className="text-gray-500">
                                  Stock: <strong>{product.stock}</strong>
                                </p>
                                <p className="text-brand font-medium">
                                  {formatCurrency(product.sale_price)}
                                </p>
                              </div>
                              {isPrimary && (
                                <span className="text-xs font-semibold text-brand shrink-0">
                                  Principal
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Acción */}
                      <div className="flex items-center justify-between pt-1">
                        <p className="text-sm text-gray-500">
                          Stock resultante:{' '}
                          <strong>
                            {group.products.reduce((s, p) => s + (p.stock || 0), 0)}
                          </strong>
                        </p>
                        <Button
                          onClick={() => handleMerge(group)}
                          disabled={isMerging}
                        >
                          <Layers className="mr-2 h-4 w-4" />
                          {isMerging ? 'Agrupando...' : 'Agrupar'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-6 border-t">
          <Button onClick={onClose} variant="outline">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
