"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  Upload,
  FileSpreadsheet,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  parseSiigoProductsFile,
  finalSalePrice,
  looksLikeThousands,
  toImportRows,
  type SiigoProductsParseResult,
} from "@/lib/siigo-products-import";
import { importProducts, type ImportProductsResult } from "@/lib/cloudflare-api";
import { reviewFromSiigo } from "@/lib/catalog-review";
import { CatalogReviewReport } from "@/components/products/catalog-review-report";
import { ImportBarChart, topWithOthers } from "@/components/import/import-chart";
import { ImportSteps } from "@/components/import/import-steps";

// Tandas pequeñas: el Worker tiene poco tiempo de CPU por petición.
const BATCH_SIZE = 250;

const STEPS = ["Exporta de Siigo", "Sube el archivo", "Revisa y elige opciones", "Importa"];

export default function ImportProductsPage() {
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<SiigoProductsParseResult | null>(null);
  const [noInventory, setNoInventory] = useState(false);
  const [addTaxToPrice, setAddTaxToPrice] = useState(true);
  const [fixThousands, setFixThousands] = useState(false);
  const priceOpts = { addTaxToPrice, fixThousands };
  const [updateExisting, setUpdateExisting] = useState(false);
  const [search, setSearch] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportProductsResult | null>(null);

  const products = useMemo(() => parsed?.products ?? [], [parsed]);
  const review = useMemo(() => (parsed ? reviewFromSiigo(parsed) : null), [parsed]);

  const stats = useMemo(() => {
    const withTax = products.filter((p) => p.taxRate > 0);
    return {
      categories: new Set(products.map((p) => p.category).filter(Boolean)).size,
      withTax,
      taxNotIncluded: withTax.filter((p) => !p.taxIncluded),
      withStock: products.filter((p) => (p.balance ?? 0) > 0).length,
      inactive: products.filter((p) => !p.active).length,
      withPrice2: products.filter((p) => p.price1 > 0 && p.price2 > 0).length,
      notInventoriable: products.filter((p) => !p.inventoriable).length,
      inThousands: products.filter(looksLikeThousands),
    };
  }, [products]);

  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const label = p.category ?? "Sin categoría";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return topWithOthers(
      [...counts.entries()].map(([label, value]) => ({ label, value })),
      8,
      "Otras categorías",
    );
  }, [products]);

  // Lo que conviene mirar antes de importar (un producto puede estar en varias).
  const toCheck = useMemo(
    () =>
      [
        { label: "Precio en miles", value: stats.inThousands.length },
        { label: "IVA sin incluir", value: stats.taxNotIncluded.length },
        { label: "Inactivos", value: stats.inactive },
        { label: "Sin unidades", value: noInventory ? 0 : products.length - stats.withStock },
      ].filter((p) => p.value > 0),
    [stats, noInventory, products.length],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            (p.category ?? "").toLowerCase().includes(q),
        )
      : products;
    return list.slice(0, 100);
  }, [products, search]);

  const reset = () => {
    setParsed(null);
    setResult(null);
    setProgress(null);
    setSearch("");
    setShowReview(false);
  };

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setParsing(true);
    try {
      const res = await parseSiigoProductsFile(file);
      setParsed(res);
      // Si casi nada tiene saldo positivo, el negocio no lleva inventario en el sistema anterior.
      const withStock = res.products.filter((p) => (p.balance ?? 0) > 0).length;
      setNoInventory(res.products.length > 0 && withStock / res.products.length < 0.2);
      if (res.products.length === 0) {
        toast.error("No se encontraron productos en el archivo.");
      } else {
        toast.success(`Se reconocieron ${res.products.length} productos. Revisa antes de importar.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al leer el archivo.");
      setFileName(null);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (products.length === 0) return;
    const rows = toImportRows(products, { addTaxToPrice, noInventory, fixThousands });
    const total: ImportProductsResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      categoriesCreated: 0,
      errors: [],
    };
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const res = await importProducts(rows.slice(i, i + BATCH_SIZE), updateExisting, getToken);
        total.created += res.created;
        total.updated += res.updated;
        total.skipped += res.skipped;
        total.categoriesCreated += res.categoriesCreated;
        total.errors.push(...res.errors);
        setProgress({ done: Math.min(i + BATCH_SIZE, rows.length), total: rows.length });
      }
      setResult(total);
      toast.success(`Listo: ${total.created} productos creados.`);
    } catch (err) {
      // Lo ya importado queda guardado; al reintentar se omiten (mismo código).
      setResult(total);
      toast.error(
        `${err instanceof Error ? err.message : "Error al importar"}. ` +
          "Puedes volver a importar el archivo: los productos ya creados se omiten.",
      );
    } finally {
      setProgress(null);
    }
  };

  const importing = progress !== null;
  const currentStep = result ? STEPS.length : products.length > 0 ? 2 : fileName ? 1 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/products">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer border-2 border-brand/60 font-semibold text-gray-800 hover:border-brand hover:bg-brand-light"
          >
            <ArrowLeft className="w-4 h-4 mr-1 text-brand" />
            Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Importar productos</h1>
          <p className="text-sm text-muted-foreground">
            Trae tu lista de productos desde Siigo u otro sistema POS: sube el Excel (.xlsx) o CSV
            exportado. Se pasan códigos, nombres, categorías, precios, IVA y unidades.
          </p>
        </div>
      </div>

      <ImportSteps steps={STEPS} current={currentStep} guideId="importar-productos" />

      {/* Zona de carga */}
      <Card>
        <CardContent className="pt-6">
          <div
            data-guide="products-import-drop"
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => !importing && fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file && !importing) handleFile(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            {parsing ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p>Leyendo archivo…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium break-all">
                  {fileName ?? "Haz clic o arrastra aquí el archivo de productos"}
                </p>
                <p className="text-xs text-muted-foreground">
                  En Siigo: Inventario → Productos → Exportar a Excel. En otros sistemas, busca
                  &quot;Exportar productos&quot; o &quot;Exportar inventario&quot;.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {parsed && products.length > 0 && !result && (
        <>
          {/* Resumen */}
          <Card data-guide="products-import-charts">
            <CardHeader>
              <CardTitle className="text-base">
                {parsed.businessName ?? "Catálogo a importar"}
                {parsed.nit && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    NIT {parsed.nit}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Productos" value={products.length} />
                <Stat label="Categorías" value={stats.categories} />
                <Stat label="Con IVA" value={stats.withTax.length} />
                <Stat label="Con unidades" value={stats.withStock} />
              </div>
              {(stats.inactive > 0 || stats.withPrice2 > 0 || stats.notInventoriable > 0) && (
                <p className="text-xs text-muted-foreground mt-3">
                  {stats.inactive > 0 && `${stats.inactive} inactivo(s) (no saldrán en la caja). `}
                  {stats.withPrice2 > 0 && `${stats.withPrice2} con segundo precio de venta. `}
                  {stats.notInventoriable > 0 &&
                    `${stats.notInventoriable} marcado(s) "no inventariable".`}
                </p>
              )}
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <ImportBarChart
                  title="Productos por categoría"
                  description="Las categorías que no existan en posib se crean solas."
                  data={byCategory}
                  horizontal
                />
                {toCheck.length > 0 ? (
                  <ImportBarChart
                    title="Para revisar antes de importar"
                    description="Cada caso tiene su opción abajo, en «Antes de importar»."
                    data={toCheck}
                    horizontal
                  />
                ) : (
                  <div className="flex items-center gap-2 self-center rounded-lg bg-muted/50 p-4 text-sm">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                    Precios, IVA y estados se ven bien: no hay nada que corregir antes de importar.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Opciones */}
          <Card data-guide="products-import-options">
            <CardHeader>
              <CardTitle className="text-base">Antes de importar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Option
                checked={noInventory}
                onChange={setNoInventory}
                title="Vender sin controlar inventario"
                detail={
                  `Solo ${stats.withStock} de ${products.length} productos tienen unidades en el archivo. ` +
                  "Con esta opción todos se pueden vender en la caja aunque no tengan stock cargado. " +
                  "Luego puedes activar el control de inventario producto por producto."
                }
              />
              {stats.inThousands.length > 0 && (
                <div>
                  <Option
                    checked={fixThousands}
                    onChange={setFixThousands}
                    title={`${stats.inThousands.length} precio(s) parecen estar escritos en miles`}
                    detail={
                      "En el archivo estos productos valen menos de $100 (ej. 2 en vez de 2.000). " +
                      "Sin marcar, se importan tal cual y el tendero los revisa en Productos → \"Precios por revisar\". " +
                      "Marcado, se multiplican por 1.000 al importar."
                    }
                  />
                  <ul className="mt-2 ml-7 text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                    {stats.inThousands.slice(0, 50).map((p) => (
                      <li key={p.row}>
                        {p.name}: {(p.price1 || p.price2).toLocaleString("es-CO")}
                        {fixThousands && (
                          <>
                            {" → "}
                            <span className="font-medium text-foreground">
                              {formatCurrency(finalSalePrice(p, priceOpts))}
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                    {stats.inThousands.length > 50 && (
                      <li>…y {stats.inThousands.length - 50} más.</li>
                    )}
                  </ul>
                </div>
              )}
              {stats.taxNotIncluded.length > 0 && (
                <div>
                  <Option
                    checked={addTaxToPrice}
                    onChange={setAddTaxToPrice}
                    title={`Sumar el IVA al precio de ${stats.taxNotIncluded.length} producto(s)`}
                    detail={
                      'En el archivo estos productos tienen el IVA "no incluido": el sistema anterior lo suma al facturar. ' +
                      "En posib el precio de venta es el que paga el cliente, con IVA."
                    }
                  />
                  <ul className="mt-2 ml-7 text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                    {stats.taxNotIncluded.map((p) => (
                      <li key={p.row}>
                        {p.name}: {p.price1 || p.price2} →{" "}
                        <span className="font-medium text-foreground">
                          {formatCurrency(finalSalePrice(p, priceOpts))}
                        </span>{" "}
                        ({p.taxLabel})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Option
                checked={updateExisting}
                onChange={setUpdateExisting}
                title="Actualizar los productos que ya existen en posib"
                detail="Si un código ya está en posib, se actualizan nombre, precio, categoría e IVA (el stock y el costo no se tocan). Sin marcar, esos productos se dejan igual."
              />
            </CardContent>
          </Card>

          {/* Avisos */}
          {parsed.warnings.length > 0 && (
            <Card className="border-amber-300">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="w-4 h-4" />
                  {parsed.warnings.length} aviso(s)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>
                      Fila {w.row}: {w.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Revisión para el tendero */}
          <Card>
            <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-medium">Revisión para el tendero</p>
                <p className="text-sm text-muted-foreground">
                  Un informe corto con lo que está bien y lo que conviene arreglar. Se puede descargar en
                  PDF o mandar por WhatsApp.
                </p>
              </div>
              <Button variant={showReview ? "default" : "outline"} onClick={() => setShowReview(!showReview)}>
                {showReview ? "Ocultar revisión" : "Ver revisión"}
              </Button>
            </CardContent>
          </Card>
          {showReview && review && <CatalogReviewReport review={review} />}

          {/* Previsualización */}
          <Card data-guide="products-import-preview">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-base">Previsualización</CardTitle>
              <Button data-guide="products-import-button" onClick={handleImport} disabled={importing}>
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importando {progress.done} de {progress.total}…
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Importar {products.length} productos
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <input
                type="search"
                placeholder="Buscar por nombre, código o categoría…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full mb-3 rounded-md border px-3 py-2 text-sm bg-background"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Código</th>
                      <th className="py-2 pr-4">Nombre</th>
                      <th className="py-2 pr-4">Categoría</th>
                      <th className="py-2 pr-4">IVA</th>
                      <th className="py-2 pr-4 text-right">Stock</th>
                      <th className="py-2 text-right">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.row} className={`border-b ${p.active ? "" : "opacity-50"}`}>
                        <td className="py-2 pr-4 font-mono text-xs">{p.code}</td>
                        <td className="py-2 pr-4">{p.name}</td>
                        <td className="py-2 pr-4 text-xs">{p.category ?? "—"}</td>
                        <td className="py-2 pr-4 text-xs">{p.taxLabel ?? "—"}</td>
                        <td className="py-2 pr-4 text-right">
                          {noInventory || !p.inventoriable ? (
                            <span className="text-xs text-muted-foreground">Sin control</span>
                          ) : (
                            Math.max(0, p.balance ?? 0)
                          )}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {formatCurrency(finalSalePrice(p, priceOpts))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-2">
                  Mostrando {visible.length} de {products.length}. Se importarán todos.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Resultado */}
      {result && (
        <Card className="border-green-300" data-guide="products-import-result">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              Importación terminada
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Productos creados" value={result.created} />
              <Stat label="Actualizados" value={result.updated} />
              <Stat label="Ya existían (sin cambios)" value={result.skipped} />
              <Stat label="Categorías creadas" value={result.categoriesCreated} />
            </div>
            {result.errors.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-sm font-medium text-amber-700 flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  {result.errors.length} producto(s) no se pudieron importar
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{e.code || "(sin código)"}</span> {e.name}:{" "}
                      {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Link href="/dashboard/products">
                <Button>Ver productos</Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setFileName(null);
                }}
              >
                Importar otro archivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Option({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="font-medium text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold">{value.toLocaleString("es-CO")}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
