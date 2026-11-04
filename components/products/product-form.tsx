"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCategories,
  getSuppliers,
  getProducts,
  getUserProfile,
  createProduct,
  updateProduct,
  createCategory,
  createSupplier,
  type Product as ApiProduct,
} from "@/lib/cloudflare-api";
import { Category, Supplier, Product, tracksInventory, isProductActive } from "@/lib/types";
import { getBusinessType, type BusinessType } from "@/lib/business-types";

// Payload que envía el formulario: usa el modelo de dominio (`images` como
// array, `main_image_index`); se serializa al modelo de la API al guardar.
type ProductPayload = Partial<Product> & {
  images?: string[];
  main_image_index?: number;
};
import { toast } from "sonner";
import { Scan, Camera, X, Plus, Minus, Package } from "lucide-react";
import { ImageUploader } from './image-uploader';
import { SuggestNameFromPhoto } from './suggest-name-from-photo';
import { Html5Qrcode } from "html5-qrcode";
import { normalizeBarcode, barcodeEquals } from "@/lib/barcode-utils";
import { findProductsWithSameName, normalizeName } from "@/lib/duplicate-helpers";
import { formatCurrency } from "@/lib/utils";
import Swal from "@/lib/sweetalert";

const productSchema = z.object({
  barcode: z.string().optional().or(z.literal("")),
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional().or(z.literal("")),
  category_id: z.string().optional().or(z.literal("")),
  supplier_id: z.string().optional().or(z.literal("")),
  cost_price: z.number().min(0, "El precio de compra debe ser mayor a 0"),
  sale_price: z.number().min(0, "El precio de venta debe ser mayor a 0"),
  stock: z
    .number()
    .int()
    .min(0, "La cantidad disponible debe ser mayor o igual a 0"),
  min_stock: z
    .number()
    .int()
    .min(0, "El mínimo disponible debe ser mayor o igual a 0"),
  expiration_date: z.string().optional().or(z.literal("")),

  // Campos para venta por unidades
  sell_by_unit: z.boolean().optional(),
  units_per_package: z.number().int().min(1).optional().or(z.undefined()),
  unit_name: z.string().optional().or(z.literal("")),
  package_name: z.string().optional().or(z.literal("")),
  price_per_unit: z.number().min(0).optional().or(z.undefined()),

  // Facturación / campos tipo Siigo
  tax_rate: z.number().min(0).max(100).optional(),
  sale_price_2: z.number().min(0).optional().or(z.undefined()),
  factory_reference: z.string().optional().or(z.literal("")),
  track_inventory: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

// Impuestos que maneja una tienda en Colombia (el precio de venta los incluye).
const TAX_OPTIONS = [
  { rate: 0, label: "Sin IVA (excluido / exento)" },
  { rate: 5, label: "IVA 5%" },
  { rate: 19, label: "IVA 19%" },
  { rate: 8, label: "Impuesto al consumo (INC) 8%" },
];

type ProductFormData = z.infer<typeof productSchema>;

interface ProductFormProps {
  initialData?: Partial<Product>;
  productId?: string;
}

export function ProductForm({ initialData, productId }: ProductFormProps) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Tipo de negocio de la tienda: adapta qué campos se muestran (vencimiento,
  // código de barras) y el vocabulario. Por defecto abarrotes (tienda completa).
  const [businessType, setBusinessType] = useState<BusinessType>(() =>
    getBusinessType(null),
  );
  const [productImages, setProductImages] = useState<string[]>(initialData?.images || []);
  const [mainImageIndex, setMainImageIndex] = useState<number>(initialData?.main_image_index ?? 0);
  const [doesNotExpire, setDoesNotExpire] = useState(!initialData?.expiration_date);
  const [sellByUnit, setSellByUnit] = useState(Boolean(initialData?.sell_by_unit));
  const [showScanner, setShowScanner] = useState(false);
  const [showScannerOptions, setShowScannerOptions] = useState(false); // Modal con opciones de escaneo
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSupplierData, setNewSupplierData] = useState({
    name: "",
    phone: "",
    email: "",
  });
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const hasScannedRef = useRef(false); // Flag para evitar múltiples escaneos
  const scannerElementId = "barcode-scanner";

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: initialData
      ? {
          ...initialData,
          // El stock siempre debe ser entero (puede llegar con decimales si hubo ventas por unidades)
          stock: Math.round(initialData.stock || 0),
          // Limpiar IDs que sean null, undefined o inválidos
          category_id: (initialData.category_id && !initialData.category_id.includes('null')) ? initialData.category_id : "",
          supplier_id: (initialData.supplier_id && !initialData.supplier_id.includes('null')) ? initialData.supplier_id : "",
          // Asegurar que expiration_date sea string o undefined
          expiration_date: initialData.expiration_date || undefined,
          // Asegurar que sell_by_unit sea boolean
          sell_by_unit: Boolean(initialData.sell_by_unit),
          // Limpiar campos de unidades si son null
          units_per_package: initialData.units_per_package || undefined,
          unit_name: initialData.unit_name || undefined,
          package_name: initialData.package_name || undefined,
          price_per_unit: initialData.price_per_unit || undefined,
          tax_rate: initialData.tax_rate || 0,
          sale_price_2: initialData.sale_price_2 || undefined,
          factory_reference: initialData.factory_reference || "",
          track_inventory: tracksInventory(initialData),
          is_active: isProductActive(initialData),
        }
      : { tax_rate: 0, track_inventory: true, is_active: true },
  });

  // Log errors when they change
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.error('❌ Form validation errors:', errors);
    }
  }, [errors]);

  // Obtener la ref del register de react-hook-form
  const { ref: barcodeRegisterRef, ...barcodeRegisterRest } = register("barcode", {
    setValueAs: (value) => value?.trim() || undefined,
  });

  // Ref personalizada para el input de código de barras
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Combinar las refs (una del register y otra personalizada)
  const setBarcodeRef = (element: HTMLInputElement | null) => {
    barcodeRegisterRef(element);
    if (barcodeInputRef) {
      (barcodeInputRef as React.MutableRefObject<HTMLInputElement | null>).current = element;
    }
  };

  // Verificar código de barras duplicado al escribir manualmente
  const handleBarcodeBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const barcodeValue = e.target.value.trim();

    // Solo verificar si hay un código y estamos creando un nuevo producto
    if (!barcodeValue || productId) {
      return;
    }

    try {
      const products = await getProducts(getToken);
      // 🔧 Usar comparación normalizada de códigos de barras
      const existingProduct = products.find(p => barcodeEquals(p.barcode, barcodeValue));

      if (existingProduct) {
        toast.error(`Este código de barras ya está registrado en el producto: ${existingProduct.name}`);
        // Limpiar el campo de código de barras
        setValue("barcode", "");
        // Enfocar nuevamente el campo
        setTimeout(() => {
          barcodeInputRef.current?.focus();
        }, 100);
      }
    } catch (error) {
      console.error("Error verificando código de barras:", error);
    }
  };

  const startScanner = async () => {
    try {
      setIsScanning(true);

      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerElementId);
      }

      // Configuración optimizada para detección rápida
      const config = {
        fps: 30, // Incrementado de 10 a 30 para detección más rápida
        qrbox: { width: 350, height: 150 }, // Área de escaneo más amplia
        aspectRatio: 1.7777778,
        disableFlip: false, // Permitir flip para mejor detección
        // Formatos soportados (códigos de barras comunes)
        formatsToSupport: [
          0, // QR_CODE
          5, // EAN_13 (más común en productos)
          6, // EAN_8
          7, // UPC_A
          8, // UPC_E
          9, // CODE_39
          10, // CODE_93
          11, // CODE_128
          12, // ITF (Interleaved 2 of 5)
        ],
      };

      await scannerRef.current.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          // Código escaneado exitosamente
          // Evitar procesar múltiples veces el mismo escaneo
          if (!hasScannedRef.current) {
            hasScannedRef.current = true;

            // Verificar si el código de barras ya existe (solo para productos nuevos)
            if (!productId) {
              try {
                const products = await getProducts(getToken);
                // 🔧 Usar comparación normalizada de códigos de barras
                const existingProduct = products.find(p => barcodeEquals(p.barcode, decodedText));

                if (existingProduct) {
                  toast.error(`Este código de barras ya está registrado en el producto: ${existingProduct.name}`);
                  hasScannedRef.current = false; // Permitir escanear otro código
                  return;
                }
              } catch (error) {
                console.error("Error verificando código de barras:", error);
                toast.error("Error al verificar el código de barras");
                hasScannedRef.current = false;
                return;
              }
            }

            // 🔧 Normalizar el código antes de guardarlo
            const normalizedCode = normalizeBarcode(decodedText);
            setValue("barcode", normalizedCode || "");
            toast.success("✓ Código escaneado: " + normalizedCode);
            stopScanner();
          }
        },
        (errorMessage) => {
          // Errores de escaneo (normal durante el proceso)
          // No mostrar nada para evitar spam en consola
        }
      );
    } catch (err) {
      console.error("Error starting scanner:", err);
      toast.error("No se pudo iniciar la cámara. Verifica los permisos.");
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (scannerRef.current && isScanning) {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      }
    } catch (err) {
      console.error("Error stopping scanner:", err);
    } finally {
      setIsScanning(false);
      setShowScanner(false);
    }
  };

  // Cleanup al desmontar el componente
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const handleOpenScanner = () => {
    hasScannedRef.current = false; // Resetear flag al abrir el escáner
    setShowScanner(true);
    setTimeout(() => {
      startScanner();
    }, 100);
  };

  useEffect(() => {
    fetchCategories();
    fetchSuppliers();
    fetchBusinessType();
  }, []);

  const fetchBusinessType = async () => {
    try {
      const profile = await getUserProfile(getToken);
      setBusinessType(getBusinessType(profile?.business_type));
    } catch (error) {
      console.error("Error fetching business type:", error);
      // Si falla, se queda con el valor por defecto (abarrotes = todo visible)
    }
  };

  // Asegurar que los valores de category_id y supplier_id se mantengan cuando se edita
  // Este efecto se ejecuta cuando las categorías y proveedores se cargan
  useEffect(() => {
    if (initialData && productId && (categories.length > 0 || suppliers.length > 0)) {
      console.log('🔍 Datos iniciales del producto:', {
        category_id: initialData.category_id,
        supplier_id: initialData.supplier_id,
        categoriesLoaded: categories.length,
        suppliersLoaded: suppliers.length,
      });

      if (initialData.category_id && categories.length > 0) {
        // Verificar que la categoría exista en la lista
        const categoryExists = categories.find(cat => cat.id === initialData.category_id);
        if (categoryExists) {
          setValue("category_id", initialData.category_id, { shouldValidate: true });
          console.log('✅ Categoría establecida:', initialData.category_id);
        } else {
          console.warn('⚠️ La categoría no existe en la lista:', initialData.category_id);
        }
      }

      if (initialData.supplier_id && suppliers.length > 0) {
        // Verificar que el proveedor exista en la lista
        const supplierExists = suppliers.find(sup => sup.id === initialData.supplier_id);
        if (supplierExists) {
          setValue("supplier_id", initialData.supplier_id, { shouldValidate: true });
          console.log('✅ Proveedor establecido:', initialData.supplier_id);
        } else {
          console.warn('⚠️ El proveedor no existe en la lista:', initialData.supplier_id);
        }
      }
    }
  }, [categories, suppliers, initialData, productId, setValue]);

  const fetchCategories = async () => {
    try {
      const data = (await getCategories(getToken)) as Category[];
      // Ordenar por nombre manualmente
      data.sort((a, b) => a.name.localeCompare(b.name));
      setCategories(data);
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const data = (await getSuppliers(getToken)) as Supplier[];
      data.sort((a, b) => a.name.localeCompare(b.name));
      setSuppliers(data);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      toast.error("Error al cargar proveedores");
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) {
      toast.error("El nombre de la categoría es requerido");
      return;
    }

    try {
      const newCategory = (await createCategory(
        { name: newCategoryName.trim() },
        getToken
      )) as Category;
      toast.success("Categoría creada correctamente");
      await fetchCategories();
      setValue("category_id", newCategory.id);
      setNewCategoryName("");
      setShowNewCategory(false);
    } catch (error) {
      console.error("Error creating category:", error);
      toast.error("Error al crear la categoría");
    }
  };

  const handleCreateSupplier = async () => {
    if (!newSupplierData.name.trim()) {
      toast.error("El nombre del proveedor es requerido");
      return;
    }

    try {
      const supplierData: Partial<Supplier> = {
        name: newSupplierData.name.trim(),
        phone: newSupplierData.phone.trim() || undefined,
        email: newSupplierData.email.trim() || undefined,
      };
      const newSupplier = (await createSupplier(
        supplierData,
        getToken
      )) as Supplier;
      toast.success("Proveedor creado correctamente");
      await fetchSuppliers();
      setValue("supplier_id", newSupplier.id);
      setNewSupplierData({ name: "", phone: "", email: "" });
      setShowNewSupplier(false);
    } catch (error) {
      console.error("Error creating supplier:", error);
      toast.error("Error al crear el proveedor");
    }
  };

  // Avisa (sin bloquear) si el nombre ya lo usa otro producto: en el POS dos
  // productos con el mismo nombre y distinto precio se confunden al vender.
  const confirmRepeatedName = async (name: string): Promise<boolean> => {
    if (productId && normalizeName(name) === normalizeName(initialData?.name || "")) {
      return true;
    }
    let sameName: Awaited<ReturnType<typeof getProducts>> = [];
    try {
      sameName = findProductsWithSameName(await getProducts(getToken), name, productId);
    } catch {
      return true;
    }
    if (sameName.length === 0) return true;

    const details = sameName
      .slice(0, 3)
      .map((p) => `${p.barcode || "sin código"} a ${formatCurrency(p.sale_price)}`)
      .join(" · ");
    const more = sameName.length > 3 ? ` y ${sameName.length - 3} más` : "";
    return Swal.confirm(
      `Ya tienes ${sameName.length === 1 ? "un producto" : `${sameName.length} productos`} llamado "${name.trim()}" (${details}${more}). ` +
        `Para no confundirlos al vender, agrega la marca, la variedad o el tamaño al nombre (por ejemplo "${name.trim()} 100 g").`,
      "Este nombre ya existe",
      { confirmText: "Guardar así", cancelText: "Corregir el nombre", type: "question" }
    );
  };

  const onSubmit = async (data: ProductFormData) => {
    console.log('🚀 onSubmit called with data:', data);
    console.log('🔍 productId:', productId);
    setLoading(true);
    try {
      if (!(await confirmRepeatedName(data.name))) return;

      const productData: ProductPayload = {
        ...data,
        images: productImages, // Incluir imágenes
        main_image_index: mainImageIndex, // Incluir índice de imagen principal
      };

      // Log para debugging - verificar que el código de barras esté presente
      console.log('📦 Datos del producto antes de limpiar:', productData);

      // 🔧 NORMALIZAR código de barras antes de guardar
      if (productData.barcode) {
        const normalizedBarcode = normalizeBarcode(productData.barcode);
        productData.barcode = normalizedBarcode ?? undefined;
        console.log('🔧 Código de barras normalizado:', {
          original: data.barcode,
          normalizado: normalizedBarcode
        });
      }

      // Limpiar campos vacíos para evitar errores en la base de datos
      // Convertir strings vacíos a undefined y validar IDs
      if (!productData.category_id || productData.category_id === "" || productData.category_id.includes('null')) {
        productData.category_id = undefined;
      }
      if (!productData.supplier_id || productData.supplier_id === "" || productData.supplier_id.includes('null')) {
        productData.supplier_id = undefined;
      }
      if (productData.barcode === "") {
        productData.barcode = undefined;
      }
      if (productData.description === "") {
        productData.description = undefined;
      }
      if (productData.expiration_date === "") {
        productData.expiration_date = undefined;
      }

      // Impuesto: conservar el texto original (ej. el de Siigo) si la tarifa no cambió.
      const taxRate = Number(productData.tax_rate) || 0;
      productData.tax_rate = taxRate;
      productData.tax_label =
        taxRate === 0
          ? null
          : initialData?.tax_label && initialData.tax_rate === taxRate
            ? initialData.tax_label
            : taxRate === 8
              ? "INC 8%"
              : `IVA ${taxRate}%`;
      if (!productData.sale_price_2 || Number.isNaN(productData.sale_price_2)) {
        productData.sale_price_2 = null;
      }
      if (!productData.factory_reference) {
        productData.factory_reference = null;
      }

      // Limpiar campos de venta por unidades si está desactivado
      if (!productData.sell_by_unit) {
        productData.units_per_package = undefined;
        productData.unit_name = undefined;
        productData.package_name = undefined;
        productData.price_per_unit = undefined;
      } else {
        // Asegurar que los campos de texto vacíos se conviertan a undefined
        if (productData.unit_name === "") {
          productData.unit_name = undefined;
        }
        if (productData.package_name === "") {
          productData.package_name = undefined;
        }
      }

      // Log después de limpiar
      console.log('✅ Datos del producto a enviar:', productData);

      if (productId) {
        console.log('🔄 Calling updateProduct with:', { productId, productData });
        await updateProduct(productId, productData as Partial<ApiProduct>, getToken);
        console.log('✅ Product updated successfully');
        toast.success("Producto actualizado correctamente");
      } else {
        console.log('➕ Calling createProduct with:', { productData });
        await createProduct(productData as Partial<ApiProduct>, getToken);
        console.log('✅ Product created successfully');
        toast.success("Producto creado correctamente");
      }

      router.push("/dashboard/products");
      router.refresh();
    } catch (error) {
      console.error("Error saving product:", error);
      toast.error(error instanceof Error ? error.message : "Error al guardar producto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={(e) => {
      console.log('📝 Form submit event triggered');
      handleSubmit(onSubmit)(e);
    }} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Información Básica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={
              businessType.features.showBarcode
                ? "grid grid-cols-1 md:grid-cols-2 gap-4"
                : "grid grid-cols-1 gap-4"
            }
          >
            {businessType.features.showBarcode && (
            <div className="space-y-2">
              <Label htmlFor="barcode" className="flex items-center gap-2">
                <Scan className="h-4 w-4 text-brand" />
                Código de Barras
              </Label>
              <div className="flex flex-col gap-2">
                <div className="relative flex-1">
                  <Input
                    id="barcode"
                    {...barcodeRegisterRest}
                    ref={setBarcodeRef}
                    placeholder="Escanea o escribe el código"
                    className="pr-10"
                    autoFocus={!productId}
                    onBlur={handleBarcodeBlur}
                  />
                  {/* <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none">
                    <Scan className="h-5 w-5 text-brand" />
                  </div> */}
                </div>
                <Button
                  type="button"
                  onClick={() => setShowScannerOptions(true)}
                  className="shrink-0 bg-brand hover:bg-brand-hover flex-col md:flex-row gap-1 md:gap-2 h-auto py-2 px-3"
                  size="default"
                  title="Toque aquí para escanear código de barras"
                >
                  <Scan className="h-5 w-5" />
                  <span className="text-xs md:text-sm leading-tight text-center md:text-left">
                    Escanear<br className="md:hidden" />Código
                  </span>
                </Button>
              </div>
              <div className="bg-brand-light/50 border border-brand/40 rounded-lg p-2 mt-2">
                <p className="text-xs text-brand font-medium flex items-center gap-1">
                  <Scan className="h-3 w-3" />
                  💡 Toca el botón "Escanear Código" para usar tu lector USB o cámara
                </p>
                <p className="text-xs text-brand mt-1">
                  Es más rápido y evita errores al registrar productos
                </p>
              </div>
              {errors.barcode && (
                <p className="text-sm text-red-600">{errors.barcode.message}</p>
              )}
            </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">
                Nombre de {businessType.vocabulary.itemSingular.toLowerCase()} *
              </Label>
              <Input
                id="name"
                {...register("name")}
                placeholder={`Nombre de ${businessType.vocabulary.itemSingular.toLowerCase()}`}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
              <SuggestNameFromPhoto
                currentName={watch("name")}
                onUse={(name) => setValue("name", name, { shouldValidate: true, shouldDirty: true })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <textarea
              id="description"
              {...register("description")}
              className="w-full min-h-[100px] rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Descripción del producto..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Categoría */}
            <div className="space-y-2">
              <Label htmlFor="category_id">Categoría</Label>
              {!showNewCategory ? (
                <div className="flex gap-2">
                  <select
                    id="category_id"
                    {...register("category_id")}
                    className="flex-1 h-9 rounded-md border border-gray-300 px-3 text-sm"
                  >
                    <option value="">Seleccionar categoría</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    onClick={() => setShowNewCategory(true)}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    title="Crear nueva categoría"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-3 bg-brand-light/50 border border-brand/40 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-brand">
                      Nueva Categoría
                    </span>
                    <Button
                      type="button"
                      onClick={() => {
                        setShowNewCategory(false);
                        setNewCategoryName("");
                      }}
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Nombre de la categoría"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCreateCategory();
                      }
                    }}
                    className="h-8"
                  />
                  <Button
                    type="button"
                    onClick={handleCreateCategory}
                    size="sm"
                    className="w-full h-8"
                  >
                    Crear Categoría
                  </Button>
                </div>
              )}
            </div>

            {/* Proveedor */}
            <div className="space-y-2">
              <Label htmlFor="supplier_id">Proveedor</Label>
              {!showNewSupplier ? (
                <div className="flex gap-2">
                  <select
                    id="supplier_id"
                    {...register("supplier_id")}
                    className="flex-1 h-9 rounded-md border border-gray-300 px-3 text-sm"
                  >
                    <option value="">Seleccionar proveedor</option>
                    {suppliers.map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    onClick={() => setShowNewSupplier(true)}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    title="Crear nuevo proveedor"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-green-900">
                      Nuevo Proveedor
                    </span>
                    <Button
                      type="button"
                      onClick={() => {
                        setShowNewSupplier(false);
                        setNewSupplierData({ name: "", phone: "", email: "" });
                      }}
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Nombre del proveedor *"
                    value={newSupplierData.name}
                    onChange={(e) =>
                      setNewSupplierData({
                        ...newSupplierData,
                        name: e.target.value,
                      })
                    }
                    className="h-8"
                  />
                  <Input
                    placeholder="Teléfono"
                    value={newSupplierData.phone}
                    onChange={(e) =>
                      setNewSupplierData({
                        ...newSupplierData,
                        phone: e.target.value,
                      })
                    }
                    className="h-8"
                  />
                  <Input
                    placeholder="Email"
                    type="email"
                    value={newSupplierData.email}
                    onChange={(e) =>
                      setNewSupplierData({
                        ...newSupplierData,
                        email: e.target.value,
                      })
                    }
                    className="h-8"
                  />
                  <Button
                    type="button"
                    onClick={handleCreateSupplier}
                    size="sm"
                    className="w-full h-8"
                  >
                    Crear Proveedor
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Precios e Inventario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cost_price">Precio de Compra *</Label>
              <Input
                id="cost_price"
                type="number"
                inputMode="decimal"
                step="0.01"
                {...register("cost_price", {
                  valueAsNumber: true,
                  setValueAs: (value) => value === "" ? 0 : Number(value)
                })}
                placeholder="0.00"
              />
              {errors.cost_price && (
                <p className="text-sm text-red-600">
                  {errors.cost_price.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sale_price">Precio de Venta *</Label>
              <Input
                id="sale_price"
                type="number"
                inputMode="decimal"
                step="0.01"
                {...register("sale_price", {
                  valueAsNumber: true,
                  setValueAs: (value) => value === "" ? 0 : Number(value)
                })}
                placeholder="0.00"
              />
              {errors.sale_price && (
                <p className="text-sm text-red-600">
                  {errors.sale_price.message}
                </p>
              )}
            </div>
          </div>

          {/* Facturación: lo que Siigo / la DIAN piden por producto */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tax_rate">Impuesto (IVA)</Label>
              <select
                id="tax_rate"
                {...register("tax_rate", { setValueAs: (value) => Number(value) || 0 })}
                className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm"
              >
                {TAX_OPTIONS.map((t) => (
                  <option key={t.rate} value={t.rate}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">El precio de venta ya lo incluye.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale_price_2">Precio de Venta 2 (opcional)</Label>
              <Input
                id="sale_price_2"
                type="number"
                inputMode="decimal"
                {...register("sale_price_2", {
                  setValueAs: (value) => (value === "" || value == null ? undefined : Number(value)),
                })}
                placeholder="Ej. precio por mayor"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="factory_reference">Referencia de fábrica</Label>
              <Input
                id="factory_reference"
                {...register("factory_reference")}
                placeholder="Opcional"
              />
            </div>
          </div>

          {/* Sección de Venta por Unidades */}
          <Card className="border-brand/40 bg-brand-light/50/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5 text-brand" />
                Venta por Unidades (Opcional)
              </CardTitle>
              <p className="text-sm text-gray-600">
                Activa esta opción para productos que se venden tanto por paquete completo como por unidades sueltas (ej: huevos, gaseosas, etc.)
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Toggle para activar venta por unidades */}
              <div className="flex items-center space-x-2 p-4 bg-white rounded-lg border">
                <input
                  type="checkbox"
                  id="sell_by_unit"
                  checked={sellByUnit}
                  onChange={(e) => {
                    setSellByUnit(e.target.checked);
                    setValue("sell_by_unit", e.target.checked);
                    if (!e.target.checked) {
                      // Limpiar campos si se desactiva
                      setValue("units_per_package", undefined);
                      setValue("unit_name", "");
                      setValue("package_name", "");
                      setValue("price_per_unit", undefined);
                    }
                  }}
                  className="h-5 w-5 rounded border-gray-300"
                />
                <Label htmlFor="sell_by_unit" className="cursor-pointer font-medium">
                  Permitir venta por unidades sueltas
                </Label>
              </div>

              {sellByUnit && (
                <div className="space-y-4 p-4 bg-white rounded-lg border">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="package_name">Nombre del Paquete *</Label>
                      <Input
                        id="package_name"
                        {...register("package_name")}
                        placeholder="ej: cubeta, caja, paquete"
                      />
                      <p className="text-xs text-gray-500">
                        Cómo llamas al paquete completo
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="unit_name">Nombre de la Unidad *</Label>
                      <Input
                        id="unit_name"
                        {...register("unit_name")}
                        placeholder="ej: huevo, botella, unidad"
                      />
                      <p className="text-xs text-gray-500">
                        Cómo llamas a cada unidad suelta
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="units_per_package">Unidades por Paquete *</Label>
                      <Input
                        id="units_per_package"
                        type="number"
                        inputMode="numeric"
                        {...register("units_per_package", {
                          valueAsNumber: true,
                          setValueAs: (value) => value === "" ? undefined : Number(value)
                        })}
                        placeholder="ej: 30"
                      />
                      <p className="text-xs text-gray-500">
                        Cuántas unidades tiene el paquete completo
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="price_per_unit">Precio por Unidad Suelta</Label>
                      <Input
                        id="price_per_unit"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        {...register("price_per_unit", {
                          valueAsNumber: true,
                          setValueAs: (value) => value === "" ? undefined : Number(value)
                        })}
                        placeholder="Opcional (se calcula automáticamente)"
                      />
                      <p className="text-xs text-gray-500">
                        Si no lo especificas, se calcula dividiendo el precio del paquete
                      </p>
                    </div>
                  </div>

                  {/* Vista previa del cálculo */}
                  {watch("units_per_package") && watch("sale_price") && (
                    <div className="p-3 bg-brand-light/50 border border-brand/40 rounded-lg">
                      <p className="text-sm font-medium text-brand mb-1">
                        Vista Previa:
                      </p>
                      <p className="text-sm text-brand">
                        • Paquete completo ({watch("units_per_package")} {watch("unit_name") || "unidades"}): ${watch("sale_price")?.toLocaleString()}
                      </p>
                      <p className="text-sm text-brand">
                        • Precio por {watch("unit_name") || "unidad"} suelta:{" "}
                        ${(watch("price_per_unit") || (watch("sale_price") || 0) / (watch("units_per_package") || 1)).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border bg-white cursor-pointer">
              <input
                type="checkbox"
                {...register("track_inventory")}
                className="mt-0.5 h-5 w-5 rounded border-gray-300"
              />
              <span>
                <span className="font-medium text-sm">Controlar inventario</span>
                <span className="block text-xs text-gray-500">
                  Desmarcado: se puede vender aunque no haya unidades registradas (no se lleva la cuenta del stock).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border bg-white cursor-pointer">
              <input
                type="checkbox"
                {...register("is_active")}
                className="mt-0.5 h-5 w-5 rounded border-gray-300"
              />
              <span>
                <span className="font-medium text-sm">Producto activo</span>
                <span className="block text-xs text-gray-500">
                  Desmarcado: no aparece en la caja, pero se conserva con su historial.
                </span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock">Cantidad Disponible *</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    const currentValue = Math.round(watch("stock") || 0);
                    if (currentValue > 0) {
                      setValue("stock", currentValue - 1);
                    }
                  }}
                  className="h-14 w-14 shrink-0 bg-brand hover:bg-brand-hover text-white border-brand text-2xl font-bold"
                  size="lg"
                >
                  <span className="text-2xl font-bold leading-none">−</span>
                </Button>
                <Input
                  id="stock"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  {...register("stock", {
                    valueAsNumber: true,
                    setValueAs: (value) => value === "" ? 0 : Math.round(Number(value))
                  })}
                  placeholder="0"
                  className="h-14 text-center text-2xl font-bold"
                />
                <Button
                  type="button"
                  onClick={() => {
                    const currentValue = Math.round(watch("stock") || 0);
                    setValue("stock", currentValue + 1);
                  }}
                  className="h-14 w-14 shrink-0 bg-brand hover:bg-brand-hover text-white border-brand"
                  size="lg"
                >
                  <span className="text-2xl font-bold leading-none">+</span>
                </Button>
              </div>
              {errors.stock && (
                <p className="text-sm text-red-600">{errors.stock.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="min_stock">Mínimo Disponible *</Label>
              <Input
                id="min_stock"
                type="number"
                inputMode="numeric"
                {...register("min_stock", {
                  valueAsNumber: true,
                  setValueAs: (value) => value === "" ? 10 : Number(value)
                })}
                placeholder="10"
              />
              {errors.min_stock && (
                <p className="text-sm text-red-600">
                  {errors.min_stock.message}
                </p>
              )}
            </div>
          </div>

          {businessType.features.showExpiration && (
          <div className="space-y-3">
            <Label htmlFor="expiration_date">Fecha de Vencimiento</Label>

            <div className="flex gap-3">
              {/* Campo de fecha más corto */}
              <div className="w-64">
                <Input
                  id="expiration_date"
                  type="date"
                  disabled={doesNotExpire}
                  {...register("expiration_date")}
                  className={doesNotExpire ? "bg-gray-100 cursor-not-allowed" : ""}
                />
              </div>

              {/* Botón "No vence" grande y visible */}
              <Button
                type="button"
                variant={doesNotExpire ? "default" : "outline"}
                onClick={() => {
                  setDoesNotExpire(!doesNotExpire);
                  if (!doesNotExpire) {
                    setValue("expiration_date", "");
                  }
                }}
                className={`flex items-center gap-2 px-6 ${
                  doesNotExpire
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "border-2 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {doesNotExpire ? (
                  <>
                    <span className="text-lg">✓</span>
                    <span className="font-semibold">No vence</span>
                  </>
                ) : (
                  <span>Marcar como "No vence"</span>
                )}
              </Button>
            </div>

            {doesNotExpire && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2 flex items-center gap-2">
                <span className="text-lg">✓</span>
                <span>Este producto no tiene fecha de vencimiento</span>
              </p>
            )}
          </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imágenes del Producto</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUploader
            productId={productId}
            initialImages={productImages}
            onChange={setProductImages}
            onMainImageChange={setMainImageIndex}
            initialMainImageIndex={mainImageIndex}
            maxImages={4}
          />
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando..." : productId ? "Actualizar" : "Crear"}{" "}
          {businessType.vocabulary.itemSingular}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>

      {/* Modal de Opciones de Escaneo */}
      {showScannerOptions && (
        <div className="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Scan className="h-5 w-5 text-brand" />
                  Método de Escaneo
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowScannerOptions(false)}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-gray-600 mb-4">
                  Selecciona cómo deseas escanear el código de barras:
                </p>

                {/* Botón Lector USB */}
                <Button
                  type="button"
                  onClick={() => {
                    setShowScannerOptions(false);
                    // Enfocar el campo para que el lector USB pueda escribir
                    setTimeout(() => {
                      barcodeInputRef.current?.focus();
                      barcodeInputRef.current?.select();
                    }, 100);
                  }}
                  className="w-full h-20 bg-brand hover:bg-brand-hover flex items-center justify-start gap-4 px-6"
                >
                  <Scan className="h-8 w-8" />
                  <div className="text-left">
                    <div className="font-semibold text-base">Lector USB</div>
                    <div className="text-xs opacity-90">
                      Usa tu lector de código de barras
                    </div>
                  </div>
                </Button>

                {/* Botón Cámara */}
                <Button
                  type="button"
                  onClick={() => {
                    setShowScannerOptions(false);
                    handleOpenScanner();
                  }}
                  className="w-full h-20 bg-purple-600 hover:bg-purple-700 flex items-center justify-start gap-4 px-6"
                >
                  <Camera className="h-8 w-8" />
                  <div className="text-left">
                    <div className="font-semibold text-base">Cámara</div>
                    <div className="text-xs opacity-90">
                      Escanea con la cámara del dispositivo
                    </div>
                  </div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal del Escáner de Códigos de Barras - HTML5-QRCode (Optimizado) */}
      {showScanner && (
        <div className="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full overflow-hidden">
            <div className="bg-brand text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-6 w-6" />
                <h2 className="text-xl font-bold">Escanear Código de Barras</h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={stopScanner}
                className="text-white hover:bg-brand-hover"
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
            <div className="p-4">
              <div className="bg-brand-light/50 border border-brand/40 rounded-lg p-3 mb-4">
                <p className="text-sm text-brand text-center font-medium">
                  📱 Apunta la cámara hacia el código de barras
                </p>
                <p className="text-xs text-brand text-center mt-1">
                  El código se detectará automáticamente
                </p>
              </div>

              {/* Contenedor del escáner */}
              <div
                id={scannerElementId}
                className="w-full rounded-lg overflow-hidden"
                style={{ minHeight: "300px" }}
              ></div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isScanning && (
                    <>
                      <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-sm text-gray-600">
                        Escaneando...
                      </span>
                    </>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={stopScanner}
                  className="w-auto"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
