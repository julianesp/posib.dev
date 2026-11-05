"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Loader2,
  Trash2,
  Check,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSupplierById,
  getProducts,
  createProduct,
  updateProduct,
  createPurchaseOrder,
  tenantHeaders,
} from "@/lib/cloudflare-api";
import type { Supplier, Product, PurchaseOrderItem } from "@/lib/cloudflare-api";
import { toast } from "sonner";

// Margen por defecto (%) para sugerir el precio de venta a partir del costo.
const DEFAULT_MARGIN = 30;

interface ReviewRow {
  name: string;
  quantity: number;
  cost_price: number;
  sale_price: number;
  barcode?: string;
  // Producto existente detectado (por barcode o nombre), si lo hay.
  existingProduct?: Product;
}

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result = "data:image/jpeg;base64,XXXX" → separamos el prefijo.
      const [meta, data] = result.split(",");
      const mimeType = meta.match(/data:(.*);base64/)?.[1] || file.type || "image/jpeg";
      resolve({ base64: data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Busca un producto existente que coincida por código de barras o por nombre. */
function findExisting(
  products: Product[],
  name: string,
  barcode?: string,
): Product | undefined {
  if (barcode) {
    const byBarcode = products.find((p) => p.barcode && p.barcode === barcode);
    if (byBarcode) return byBarcode;
  }
  const norm = (s: string) => s.trim().toLowerCase();
  return products.find((p) => norm(p.name) === norm(name));
}

export default function ScanInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const supplierId = params.id as string;

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [readDone, setReadDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, p] = await Promise.all([
          getSupplierById(supplierId, getToken),
          getProducts(getToken),
        ]);
        setSupplier(s);
        setProducts(p);
      } catch (error) {
        console.error("Error cargando datos:", error);
        toast.error("No se pudieron cargar los datos del proveedor.");
      }
    })();
  }, [supplierId, getToken]);

  const priceWithMargin = useCallback(
    (cost: number) => Math.round(cost * (1 + margin / 100)),
    [margin],
  );

  // Cambiar el margen recalcula el precio sugerido SOLO de los productos nuevos
  // (a los existentes no les tocamos el precio de venta). Se hace en el handler
  // del input, no en un efecto, para no reescribir estado en cascada.
  const handleMarginChange = (nextMargin: number) => {
    setMargin(nextMargin);
    const factor = 1 + nextMargin / 100;
    setRows((prev) =>
      prev.map((r) =>
        r.existingProduct
          ? r
          : { ...r, sale_price: Math.round(r.cost_price * factor) },
      ),
    );
  };

  const handleImage = async (file: File) => {
    setReading(true);
    setReadDone(false);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const res = await fetch("/api/ai/read-invoice", {
        method: "POST",
        headers: tenantHeaders(),
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo leer la factura.");

      const items = (data.items || []) as {
        name: string;
        quantity: number;
        cost_price: number;
        barcode?: string;
      }[];

      if (items.length === 0) {
        toast.warning("La IA no detectó productos. Intenta con una foto más clara.");
        setRows([]);
        setReadDone(true);
        return;
      }

      const mapped: ReviewRow[] = items.map((it) => {
        const existing = findExisting(products, it.name, it.barcode);
        return {
          name: it.name,
          quantity: it.quantity,
          cost_price: it.cost_price,
          // Existente: conservar su precio de venta actual. Nuevo: sugerir con margen.
          sale_price: existing ? existing.sale_price : priceWithMargin(it.cost_price),
          barcode: it.barcode || existing?.barcode,
          existingProduct: existing,
        };
      });
      setRows(mapped);
      setReadDone(true);
      toast.success(`La IA leyó ${mapped.length} producto(s). Revisa antes de guardar.`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Error al leer la factura.");
    } finally {
      setReading(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const valid = rows.filter((r) => r.name.trim() && r.quantity > 0);
    if (valid.length === 0) {
      toast.error("No hay productos válidos para guardar.");
      return;
    }
    setSaving(true);
    let creados = 0;
    let actualizados = 0;
    let errores = 0;
    // Renglones guardados, para registrar la factura como compra al proveedor
    const purchaseItems: PurchaseOrderItem[] = [];

    for (const row of valid) {
      try {
        let productId: string;
        if (row.existingProduct) {
          // Sumar stock y actualizar costo del producto existente.
          await updateProduct(
            row.existingProduct.id,
            {
              stock: (row.existingProduct.stock || 0) + row.quantity,
              cost_price: row.cost_price,
            },
            getToken,
          );
          productId = row.existingProduct.id;
          actualizados++;
        } else {
          // Crear el producto nuevo.
          const created = await createProduct(
            {
              name: row.name.trim(),
              barcode: row.barcode || undefined,
              cost_price: row.cost_price,
              sale_price: row.sale_price,
              stock: row.quantity,
              min_stock: 5,
              supplier_id: supplierId,
            },
            getToken,
          );
          productId = created.id;
          creados++;
        }
        purchaseItems.push({
          product_id: productId,
          product_name: row.name.trim(),
          quantity: row.quantity,
          unit_cost: row.cost_price,
        });
      } catch (error) {
        console.error("Error guardando producto:", row.name, error);
        errores++;
      }
    }

    // Guardar la factura como compra ya recibida: el stock ya se sumó arriba,
    // y con status 'recibida' el Worker no lo vuelve a sumar. Así la compra
    // aparece en Rentabilidad → Compras a proveedores.
    if (purchaseItems.length > 0) {
      try {
        await createPurchaseOrder(
          {
            supplier_id: supplierId,
            status: "recibida",
            items: purchaseItems,
            notes: "Factura subida por foto",
          },
          getToken,
        );
      } catch (error) {
        console.error("Error registrando la compra:", error);
        toast.warning(
          "Los productos se guardaron, pero no se pudo registrar la factura en las compras.",
        );
      }
    }

    setSaving(false);

    if (errores > 0) {
      toast.warning(
        `Guardado con ${errores} error(es). Creados: ${creados}, actualizados: ${actualizados}.`,
      );
    } else {
      toast.success(
        `Listo. ${creados} producto(s) nuevo(s) y ${actualizados} actualizado(s).`,
      );
    }
    if (creados + actualizados > 0) {
      router.push("/dashboard/products");
    }
  };

  const nuevos = rows.filter((r) => !r.existingProduct).length;
  const existentes = rows.length - nuevos;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/dashboard/suppliers/${supplierId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-brand" />
            Subir compra por foto
          </h1>
          <p className="text-sm text-gray-500">
            {supplier ? `Proveedor: ${supplier.name}` : "Cargando proveedor..."}
          </p>
        </div>
      </div>

      {/* Paso 1: subir la foto */}
      {!readDone && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Toma o sube la foto de la factura</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              La IA leerá los productos, cantidades y costos. Después podrás
              revisar y corregir antes de guardarlos en tu inventario.
            </p>
            <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-brand-light/40 p-10 cursor-pointer hover:bg-brand-light transition-colors">
              {reading ? (
                <>
                  <Loader2 className="h-10 w-10 text-brand animate-spin" />
                  <span className="text-brand font-medium">Leyendo la factura...</span>
                </>
              ) : (
                <>
                  <Camera className="h-10 w-10 text-brand" />
                  <span className="text-brand font-medium">
                    Tocar para tomar foto o elegir imagen
                  </span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={reading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImage(file);
                  e.target.value = "";
                }}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {/* Paso 2: revisión */}
      {readDone && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Revisa y confirma</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-gray-500">
                <AlertCircle className="h-10 w-10 opacity-40" />
                <p>No se detectaron productos. Prueba con otra foto.</p>
                <Button variant="outline" onClick={() => setReadDone(false)}>
                  Volver a intentar
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-4 rounded-lg bg-gray-50 p-3 text-sm">
                  <span className="font-medium text-gray-700">
                    {nuevos} nuevo(s) · {existentes} ya existe(n)
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-gray-600">Margen sugerido:</label>
                    <Input
                      type="number"
                      value={margin}
                      onChange={(e) => handleMarginChange(Math.max(0, Number(e.target.value)))}
                      className="w-20 h-8"
                    />
                    <span className="text-gray-600">%</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="py-2 pr-2">Producto</th>
                        <th className="py-2 px-2 w-20">Cant.</th>
                        <th className="py-2 px-2 w-28">Costo</th>
                        <th className="py-2 px-2 w-28">Precio venta</th>
                        <th className="py-2 pl-2 w-24">Estado</th>
                        <th className="py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-2">
                            <Input
                              value={row.name}
                              onChange={(e) => updateRow(i, { name: e.target.value })}
                              className="h-8"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              value={row.quantity}
                              onChange={(e) =>
                                updateRow(i, { quantity: Math.max(0, Number(e.target.value)) })
                              }
                              className="h-8"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              value={row.cost_price}
                              onChange={(e) => {
                                const cost = Math.max(0, Number(e.target.value));
                                updateRow(i, {
                                  cost_price: cost,
                                  // Al cambiar el costo de un NUEVO, recalcular su venta.
                                  ...(row.existingProduct
                                    ? {}
                                    : { sale_price: priceWithMargin(cost) }),
                                });
                              }}
                              className="h-8"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              value={row.sale_price}
                              onChange={(e) =>
                                updateRow(i, { sale_price: Math.max(0, Number(e.target.value)) })
                              }
                              className="h-8"
                              disabled={!!row.existingProduct}
                              title={
                                row.existingProduct
                                  ? "Este producto ya existe: no se cambia su precio de venta"
                                  : undefined
                              }
                            />
                          </td>
                          <td className="py-2 pl-2">
                            {row.existingProduct ? (
                              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                                +{row.quantity} stock
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                Nuevo
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-400 hover:text-red-600"
                              onClick={() => removeRow(i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-gray-500">
                  Los productos <span className="font-medium">nuevos</span> se crean;
                  los que <span className="font-medium">ya existen</span> suman stock
                  y actualizan su costo (su precio de venta no cambia).
                </p>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setReadDone(false)}
                    disabled={saving}
                  >
                    Subir otra foto
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-brand hover:bg-brand-hover text-white"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Guardar en inventario
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
