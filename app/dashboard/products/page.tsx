'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plus, Search, Edit, Trash2, Package, Tag, Tags, Camera, AlertTriangle, Download, Layers, FileSpreadsheet, ClipboardCheck, ScanBarcode, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@clerk/nextjs';
import { getProducts, deleteProduct as deleteProductAPI, checkProductHasSales, getCategories } from '@/lib/cloudflare-api';
import { Product, ProductWithRelations, Category, Supplier, tracksInventory } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import Swal from '@/lib/sweetalert';
import SwalOriginal from 'sweetalert2';
import { CategoryManagerModal } from '@/components/products/category-manager-modal';
import { DuplicatesReviewModal } from '@/components/products/duplicates-review-modal';
import { RepeatedNamesModal } from '@/components/products/repeated-names-modal';
import { findDuplicateGroups, findRepeatedNameGroups } from '@/lib/duplicate-helpers';
import { exportProductsToExcel, exportProductsToCSV } from '@/lib/excel-export';
import { MoreActions } from '@/components/products/more-actions';
import { useBusinessType } from '@/hooks/useBusinessType';
import { normalizeBarcode } from '@/lib/barcode-utils';

// Cámara del celular (solo en el navegador)
const BarcodeScanner = dynamic(
  () => import('@/components/barcode-scanner').then((mod) => ({ default: mod.BarcodeScanner })),
  { ssr: false }
);

// La API devuelve `images` como un string JSON (ej: '["https://..."]').
// Esta función lo convierte en un array real de URLs, soportando también
// el caso de un array ya parseado o una URL suelta.
function normalizeImages(
  images?: string | string[],
  fallbackUrl?: string
): string[] | undefined {
  if (Array.isArray(images)) {
    return images.length > 0 ? images : undefined;
  }

  if (typeof images === 'string' && images.trim()) {
    const trimmed = images.trim();
    // Intentar parsear si parece un array JSON
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const urls = parsed.filter(
            (url): url is string => typeof url === 'string' && url.trim().length > 0
          );
          return urls.length > 0 ? urls : undefined;
        }
      } catch {
        // Si falla el parseo, lo tratamos como una URL suelta abajo
      }
    }
    return [trimmed];
  }

  return fallbackUrl ? [fallbackUrl] : undefined;
}

// Ningún producto de tienda vale menos de esto; por debajo suele ser un precio
// mal digitado (ej. 2 en vez de 2.000) o un producto sin precio.
const SUSPICIOUS_PRICE = 100;
const needsPriceReview = (p: { sale_price: number }) => p.sale_price < SUSPICIOUS_PRICE;

// Busca el producto cuyo código coincide exactamente con lo escaneado.
// Si no hay coincidencia exacta, prueba ignorando ceros a la izquierda
// (algunos lectores/Excel los quitan o los agregan).
function findByScannedCode<T extends { barcode?: string | null }>(products: T[], raw: string): T | undefined {
  const code = normalizeBarcode(raw);
  if (!code) return undefined;
  const exact = products.find((p) => normalizeBarcode(p.barcode) === code);
  if (exact) return exact;
  const stripped = code.replace(/^0+/, '');
  if (!stripped) return undefined;
  const matches = products.filter((p) => (normalizeBarcode(p.barcode) || '').replace(/^0+/, '') === stripped);
  return matches.length === 1 ? matches[0] : undefined;
}

export default function ProductsPage() {
  const { getToken, userId } = useAuth();
  const bt = useBusinessType();
  const [products, setProducts] = useState<ProductWithRelations[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Modo "escanear para editar": campo grande para el lector USB + opción de cámara
  const [scanMode, setScanMode] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showPriceReview, setShowPriceReview] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [showRepeatedNamesModal, setShowRepeatedNamesModal] = useState(false);

  // Grupos de productos repetidos (para el badge y el modal de revisión)
  const duplicateGroups = useMemo(() => findDuplicateGroups(products), [products]);
  const repeatedNameGroups = useMemo(() => findRepeatedNameGroups(products), [products]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      // Obtener todos los productos
      const productsData = await getProducts(getToken);

      // Obtener categorías
      const categoriesData = await getCategories(getToken);
      const suppliers: Supplier[] = []; // TODO: Implementar getSuppliers cuando esté disponible

      // Ordenar categorías por nombre
      categoriesData.sort((a, b) => a.name.localeCompare(b.name));

      // Crear un mapa para acceso rápido
      const categoriesMap = new Map(categoriesData.map(c => [c.id, c]));
      const suppliersMap = new Map(suppliers.map(s => [s.id, s]));

      // Combinar los datos
      const productsWithRelations: ProductWithRelations[] = productsData.map(product => ({
        ...product,
        // Asegurar que images sea un array. La API devuelve images como string
        // JSON (ej: '["https://..."]'), así que hay que parsearlo.
        images: normalizeImages(product.images, product.image_url),
        category: product.category_id ? categoriesMap.get(product.category_id) : undefined,
        supplier: product.supplier_id ? suppliersMap.get(product.supplier_id) : undefined,
      }));

      // Ordenar por nombre
      productsWithRelations.sort((a, b) => a.name.localeCompare(b.name));

      setCategories(categoriesData);
      setProducts(productsWithRelations);
    } catch (error) {
      console.error('Error fetching products:', error);
      Swal.error('Error al cargar productos', 'Intenta recargar la página');
    } finally {
      setLoading(false);
    }
  };

  // Función para formatear stock de huevos
  const formatEggStock = (stock: number, productName: string) => {
    // Detectar si es un producto de huevos
    const isEgg = productName.toLowerCase().includes('huevo');

    if (!isEgg) {
      // Para productos normales, redondear y mostrar solo el número
      return Math.round(stock);
    }

    // Para huevos, calcular cubetas y unidades
    const roundedStock = Math.round(stock);

    if (roundedStock === 0) {
      return 0;
    }

    const EGGS_PER_TRAY = 30;
    const trays = Math.floor(roundedStock / EGGS_PER_TRAY);
    const units = roundedStock % EGGS_PER_TRAY;

    if (trays === 0) {
      return `${units} ${units === 1 ? 'unidad' : 'unidades'}`;
    } else if (units === 0) {
      return `${trays} ${trays === 1 ? 'cubeta' : 'cubetas'}`;
    } else {
      return `${trays} ${trays === 1 ? 'cubeta' : 'cubetas'} + ${units} ${units === 1 ? 'unidad' : 'unidades'}`;
    }
  };

  const handleExportExcel = async () => {
    if (products.length === 0) {
      toast.error('No hay productos para exportar');
      return;
    }
    try {
      await exportProductsToExcel(products);
      toast.success(`Exportados ${products.length} productos a Excel`);
    } catch (error) {
      console.error('Error exporting products:', error);
      toast.error('Error al exportar productos');
    }
  };

  const handleExportCSV = () => {
    if (products.length === 0) {
      toast.error('No hay productos para exportar');
      return;
    }
    exportProductsToCSV(products);
    toast.success(`Exportados ${products.length} productos a CSV`);
  };

  const deleteProduct = async (id: string) => {
    const product = products.find(p => p.id === id);
    const productName = product?.name || 'este producto';

    try {
      // Primero verificar si el producto tiene ventas
      Swal.loading('Verificando producto...');
      const { hasSales, salesCount } = await checkProductHasSales(id, getToken);
      Swal.closeLoading();

      // Si tiene ventas, mostrar advertencia y no permitir eliminar
      if (hasSales) {
        const result = await SwalOriginal.fire({
          icon: 'warning',
          title: '⚠️ No se puede eliminar',
          html: `
            <div class="text-left space-y-3">
              <p class="font-medium text-gray-800">
                No se puede eliminar un producto que tiene ventas registradas.
              </p>
              <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm mb-3">
                <p class="text-gray-700">
                  <strong>${productName}</strong> tiene <strong>${salesCount}</strong> venta${salesCount > 1 ? 's' : ''} registrada${salesCount > 1 ? 's' : ''} en el historial.
                </p>
              </div>
              <div class="bg-brand-light/50 border border-brand/40 rounded-lg p-3 text-sm">
                <p class="text-brand mb-2">
                  <strong>💡 ¿Por qué no se puede eliminar?</strong>
                </p>
                <p class="text-brand">
                  Para mantener la integridad del historial de ventas, facturas e inventario,
                  no podemos eliminar productos que ya se han vendido.
                </p>
              </div>
              <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                <p class="text-green-800 mb-2">
                  <strong>✅ En su lugar, puedes establecer su cantidad en 0</strong>
                </p>
                <p class="text-green-700">
                  Esto marcará el producto como no disponible.
                  El producto dejará de aparecer en el POS pero se conservará en el historial.
                </p>
              </div>
            </div>
          `,
          showCancelButton: true,
          confirmButtonText: '✏️ Editar Producto',
          cancelButtonText: 'Cerrar',
          confirmButtonColor: '#3b82f6',
          cancelButtonColor: '#6b7280',
          width: '600px',
        });

        // Si el usuario quiere editar el producto, navegar a la página de edición
        if (result.isConfirmed) {
          window.location.href = `/dashboard/products/${id}`;
        }
        return;
      }

      // Si no tiene ventas, proceder con la confirmación normal
      const confirmed = await Swal.deleteConfirm(
        productName,
        'Esta acción no se puede deshacer'
      );

      if (!confirmed) return;

      Swal.loading('Eliminando producto...');
      await deleteProductAPI(id, getToken);
      Swal.closeLoading();
      Swal.success('Producto eliminado correctamente');
      fetchProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
      Swal.closeLoading();
      Swal.error(
        'No se pudo eliminar el producto',
        error instanceof Error ? error.message : 'Intenta de nuevo'
      );
    }
  };

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.barcode?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || product.category_id === selectedCategory;
    const matchesOutOfStock = !showOutOfStock || (product.stock === 0 && tracksInventory(product));
    const matchesPriceReview = !showPriceReview || needsPriceReview(product);
    return matchesSearch && matchesCategory && matchesOutOfStock && matchesPriceReview;
  });

  // Precios por revisar: en $0 o sospechosamente bajos (ej. importados de Siigo "en miles")
  const priceReviewCount = products.filter(needsPriceReview).length;

  // Calcular productos agotados (stock = 0)
  const outOfStockCount = products.filter(p => p.stock === 0 && tracksInventory(p)).length;

  const openScannedCode = (raw: string) => {
    const value = raw.trim();
    if (!value || loading) return;
    const found = findByScannedCode(products, value);
    if (found) {
      router.push(`/dashboard/products/${found.id}`);
      return;
    }
    // Sin código exacto: si lo escrito deja un solo resultado, abrir ese.
    const q = value.toLowerCase();
    const matches = products.filter((p) =>
      p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)
    );
    if (matches.length === 1) {
      router.push(`/dashboard/products/${matches[0].id}`);
      return;
    }
    const code = normalizeBarcode(value);
    if (code && /\d{4,}/.test(code) && matches.length === 0) {
      SwalOriginal.fire({
        icon: 'question',
        title: 'Código no registrado',
        html: `No hay ningún producto con el código <b>${code}</b>.<br/>¿Quieres crearlo?`,
        showCancelButton: true,
        confirmButtonText: 'Crear producto',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#3b82f6',
        returnFocus: false,
      }).then((r) => {
        if (r.isConfirmed) {
          router.push(`/dashboard/products/new?barcode=${encodeURIComponent(code)}`);
        } else {
          setSearchTerm('');
          searchInputRef.current?.focus();
        }
      });
    }
  };

  // Escanear con el lector abre el producto para editarlo.
  // Si se escanea sin tener el cursor en el buscador, se capta igual:
  // el lector "teclea" muy rápido y termina con Enter.
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector('.swal2-container, [role="dialog"]')) return;

      const now = Date.now();
      if (now - lastKeyAt > 80) buffer = '';
      lastKeyAt = now;

      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          e.preventDefault();
          const code = buffer;
          buffer = '';
          setSearchTerm(code);
          openScannedCode(code);
        }
        buffer = '';
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (scanMode) scanInputRef.current?.focus();
  }, [scanMode]);

  // Con teclado físico (computador) el buscador queda listo para escanear.
  useEffect(() => {
    if (!loading && window.matchMedia('(pointer: fine)').matches) {
      searchInputRef.current?.focus();
    }
  }, [loading]);

  return (
    <>
      <CategoryManagerModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        onUpdate={fetchProducts}
      />

      <DuplicatesReviewModal
        isOpen={showDuplicatesModal}
        onClose={() => setShowDuplicatesModal(false)}
        products={products}
        onUpdate={fetchProducts}
      />

      {showCamera && (
        <BarcodeScanner
          onScan={(code) => {
            setShowCamera(false);
            openScannedCode(code);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}

      <RepeatedNamesModal
        isOpen={showRepeatedNamesModal}
        onClose={() => setShowRepeatedNamesModal(false)}
        products={products}
        onUpdate={fetchProducts}
      />

      <div className="space-y-6">
        {/* Sin título: el menú lateral ya indica en qué sección se está.
            Arriba solo lo de todos los días; el resto va en el botón lateral "Más". */}
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            data-guide="products-outofstock"
            variant={showOutOfStock ? "default" : "outline"}
            onClick={() => {
              setShowOutOfStock(!showOutOfStock);
              if (!showOutOfStock) {
                setSelectedCategory('all'); // Reset category filter when showing out of stock
              }
            }}
            className="flex-1 sm:flex-none"
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Agotados
            {outOfStockCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {outOfStockCount}
              </span>
            )}
          </Button>
          <Link href="/dashboard/products/quick-add" data-guide="products-quick" className="flex-1 sm:flex-none">
            <Button variant="outline" className="w-full">
              <Camera className="mr-2 h-4 w-4" />
              Agregar rápido
            </Button>
          </Link>
          <Link href="/dashboard/products/new" data-guide="products-new" className="basis-full sm:basis-auto">
            <Button className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {bt.vocabulary.itemSingular} nuevo
            </Button>
          </Link>
        </div>

        <MoreActions
          guideTarget="products-more"
          actions={[
            {
              id: 'categories',
              label: 'Categorías',
              description: 'Crea y ordena grupos como bebidas, aseo o granos.',
              icon: Tag,
              onSelect: () => setShowCategoryModal(true),
            },
            {
              id: 'duplicates',
              label: 'Productos repetidos',
              description: 'Une los productos que quedaron registrados dos veces.',
              icon: Layers,
              badge: duplicateGroups.length,
              onSelect: () => setShowDuplicatesModal(true),
            },
            {
              id: 'repeated-names',
              label: 'Nombres repetidos',
              description: 'Renombra productos distintos que se llaman igual.',
              icon: Tags,
              badge: repeatedNameGroups.length,
              onSelect: () => setShowRepeatedNamesModal(true),
            },
            ...(priceReviewCount > 0 || showPriceReview
              ? [
                  {
                    id: 'price-review',
                    label: 'Precios por revisar',
                    description: `Productos con precio menor a ${formatCurrency(SUSPICIOUS_PRICE)}.`,
                    icon: Tag,
                    badge: priceReviewCount,
                    active: showPriceReview,
                    onSelect: () => setShowPriceReview(!showPriceReview),
                  },
                ]
              : []),
            {
              id: 'review',
              label: 'Revisar catálogo',
              description: 'Corrige categorías y datos de todo el catálogo.',
              icon: ClipboardCheck,
              href: '/dashboard/products/review',
            },
            {
              id: 'import',
              label: 'Importar productos',
              description: 'Trae tu catálogo desde el Excel de Siigo u otro sistema.',
              icon: FileSpreadsheet,
              href: '/dashboard/products/import',
            },
            {
              id: 'excel',
              label: 'Exportar a Excel',
              description: 'Descarga la lista de productos en un archivo .xlsx.',
              icon: Download,
              onSelect: handleExportExcel,
            },
            {
              id: 'csv',
              label: 'Exportar a CSV',
              description: 'Descarga la lista en formato CSV.',
              icon: Download,
              onSelect: handleExportCSV,
            },
          ]}
        />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div data-guide="products-search" className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                ref={searchInputRef}
                placeholder="Buscar o escanear el código para editar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    openScannedCode(searchTerm);
                  }
                }}
                autoComplete="off"
                enterKeyHint="search"
                className="pl-10"
              />
            </div>
            <Button
              type="button"
              variant={scanMode ? 'default' : 'outline'}
              onClick={() => {
                setScanValue('');
                setScanMode((v) => !v);
              }}
              className="shrink-0"
            >
              <ScanBarcode className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Escanear código</span>
            </Button>
          </div>

          {scanMode && (
            <div className="mt-4 rounded-xl border-2 border-dashed border-brand/50 bg-brand/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold flex items-center gap-2">
                    <ScanBarcode className="h-5 w-5 text-brand" />
                    Escanear para editar
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Pasa el producto por el lector de código de barras y se abre listo para cambiarle precio, stock o lo que necesites.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  onClick={() => setScanMode(false)}
                  className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <Input
                  ref={scanInputRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = scanValue;
                      setScanValue('');
                      openScannedCode(v);
                    }
                  }}
                  placeholder="Esperando el lector... (o escribe el código y Enter)"
                  autoComplete="off"
                  inputMode="numeric"
                  enterKeyHint="go"
                  className="h-12 text-lg font-mono bg-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-12"
                  onClick={() => setShowCamera(true)}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Usar cámara
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {/* Filtros de categoría */}
          <div className="mb-6 pb-4 border-b">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-brand text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Todos ({products.length})
              </button>
              {categories.map((category) => {
                const categoryCount = products.filter(p => p.category_id === category.id).length;
                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.id)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      selectedCategory === category.id
                        ? 'bg-brand text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {category.name} ({categoryCount})
                  </button>
                );
              })}
            </div>
          </div>
          {loading ? (
            <div className="text-center py-8">Cargando productos...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No se encontraron productos</p>
            </div>
          ) : (
            <>
              {/* Vista de tabla para desktop */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">Imagen</th>
                      <th className="text-left py-3 px-4">Código</th>
                      <th className="text-left py-3 px-4">Nombre</th>
                      <th className="text-left py-3 px-4">Categoría</th>
                      <th className="text-left py-3 px-4">Proveedor</th>
                      <th className="text-right py-3 px-4">Precio Compra</th>
                      <th className="text-right py-3 px-4">Precio Venta</th>
                      <th className="text-right py-3 px-4">Disponible</th>
                      <th className="text-right py-3 px-4">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => (
                      <tr key={product.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="relative w-12 h-12 bg-gray-100 rounded border overflow-hidden">
                            {product.images && Array.isArray(product.images) && product.images.length > 0 && product.images[0] ? (
                              <Image
                                src={product.images[0]}
                                alt={product.name}
                                fill
                                sizes="48px"
                                className="object-contain p-1"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="h-6 w-6 text-gray-400" />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-sm">{product.barcode || 'N/A'}</td>
                        <td className="py-3 px-4 font-medium">{product.name}</td>
                        <td className="py-3 px-4">{product.category?.name || '-'}</td>
                        <td className="py-3 px-4">{product.supplier?.name || '-'}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(product.cost_price)}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(product.sale_price)}</td>
                        <td className="py-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-1 rounded text-sm ${
                              !tracksInventory(product)
                                ? 'bg-gray-100 text-gray-600'
                                : product.stock <= product.min_stock
                                ? 'bg-red-100 text-red-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                            title={!tracksInventory(product) ? 'Se vende sin controlar unidades' : undefined}
                          >
                            {!tracksInventory(product) ? 'Sin control' : formatEggStock(product.stock, product.name)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2 justify-end">
                            <Link href={`/dashboard/products/${product.id}`}>
                              <Button variant="ghost" size="sm">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteProduct(product.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Vista de cards para móvil y tablet */}
              <div className="lg:hidden space-y-4">
                {filteredProducts.map((product) => (
                  <Card key={product.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex gap-4">
                        <div className="shrink-0">
                          <div className="relative w-20 h-20 bg-gray-100 rounded border overflow-hidden">
                            {product.images && product.images.length > 0 ? (
                              <Image
                                src={product.images[0]}
                                alt={product.name}
                                fill
                                sizes="80px"
                                className="object-contain p-1"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="h-8 w-8 text-gray-400" />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg mb-1 truncate">{product.name}</h3>
                          <p className="text-xs text-gray-500 mb-2 font-mono">{product.barcode || 'Sin código'}</p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-gray-500">Categoría:</span>
                              <p className="font-medium truncate">{product.category?.name || '-'}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Disponible:</span>
                              <p>
                                <span
                                  className={`inline-block px-2 py-1 rounded text-xs ${
                                    !tracksInventory(product)
                                      ? 'bg-gray-100 text-gray-600'
                                      : product.stock <= product.min_stock
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-green-100 text-green-800'
                                  }`}
                                >
                                  {product.sell_by_unit
                                    ? (() => {
                                        const unitsPerPackage = product.units_per_package || 1;
                                        const totalUnits = Math.floor(product.stock * unitsPerPackage);
                                        const fullPackages = Math.floor(product.stock);
                                        const remainingUnits = totalUnits - (fullPackages * unitsPerPackage);
                                        const packageName = product.package_name || 'paquete';
                                        const packageNamePlural = fullPackages === 1 ? packageName : `${packageName}s`;
                                        const unitName = product.unit_name || 'unidad';
                                        const unitNamePlural = remainingUnits === 1 ? unitName : `${unitName}es`;

                                        return `${totalUnits} ${unitName}${totalUnits === 1 ? '' : 'es'} (${fullPackages} ${packageNamePlural}${remainingUnits > 0 ? ` + ${remainingUnits} ${unitNamePlural}` : ''})`;
                                      })()
                                    : formatEggStock(product.stock, product.name)
                                  }
                                </span>
                              </p>
                            </div>
                            <div>
                              <span className="text-gray-500">P. Compra:</span>
                              <p className="font-medium">{formatCurrency(product.cost_price)}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">P. Venta:</span>
                              <p className="font-medium text-brand">{formatCurrency(product.sale_price)}</p>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <Link href={`/dashboard/products/${product.id}`} className="flex-1">
                              <Button variant="outline" size="sm" className="w-full">
                                <Edit className="h-4 w-4 mr-1" />
                                Editar
                              </Button>
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deleteProduct(product.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </>
  );
}
