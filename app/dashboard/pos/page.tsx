"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  DollarSign,
  User,
  X,
  Package,
  Scan,
  Camera,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
// import { HelpCircle } from 'lucide-react'; // COMENTADO: Tour deshabilitado
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getProducts,
  createProduct,
  updateProduct,
  getCustomers,
  getCustomerById,
  createCustomer,
  getCategories,
  createSale,
  getUserProfile,
  getActiveOffers,
  getSelectedTenantId,
  Offer,
} from "@/lib/cloudflare-api";
import {
  Product,
  Customer,
  Category,
  Sale,
  SaleItemWithProduct,
  UserProfile,
  tracksInventory,
  isProductActive,
} from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calculatePointsForPurchase,
  addPointsToCustomer,
  canRedeemDiscount,
  redeemPointsForDiscount,
  getPointsMilestoneMessage,
  REWARD_CONSTANTS,
} from "@/lib/loyalty-helpers";
import {
  canCustomerGetCredit,
  updateCustomerDebt,
} from "@/lib/cloudflare-credit-helpers";
import Swal from "@/lib/sweetalert";
import { BarcodeScannerZXing } from "@/components/products/barcode-scanner-zxing";
import { InvoiceModal } from "@/components/sales/invoice-modal";
import { UnitSelectorModal } from "@/components/pos/unit-selector-modal";
import { CashRegisterControl } from "@/components/pos/cash-register-control";
import Link from "next/link";
import { normalizeBarcode, barcodeEquals } from "@/lib/barcode-utils";
import {
  cacheCollection,
  readCachedCollection,
  queueSale,
} from "@/lib/offline-store";

// Iniciales de las categorías para los filtros del POS: la primera letra, y si
// dos categorías empiezan igual, las letras justas para distinguirlas
// ("Abarrotes" → "Ab", "Aseo" → "As"). Mayúscula inicial, resto en minúscula.
function categoryInitials(names: string[]): string[] {
  const clean = names.map((n) => n.trim());
  return clean.map((name) => {
    const lower = name.toLowerCase();
    let len = 1;
    while (
      len < name.length &&
      clean.some((o) => o !== name && o.toLowerCase().startsWith(lower.slice(0, len)))
    ) {
      len++;
    }
    const label = name.slice(0, len);
    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  });
}

interface CartItem {
  product: Product;
  quantity: number;
  originalPrice?: number;
  discountPercentage?: number;
  hasOffer?: boolean;
  isUnitSale?: boolean; // Indica si se vende por unidades sueltas
  effectivePrice?: number; // Precio efectivo (por unidad o paquete)
}

type PosPaymentMethod =
  "efectivo" | "nequi" | "tarjeta" | "transferencia" | "credito";

// Venta en espera: cada pestaña del POS guarda su propio carrito, cliente y pago,
// para atender a varios clientes a la vez sin perder lo que ya se marcó.
interface HeldSale {
  id: string;
  number: number;
  cart: CartItem[];
  customer: Customer | null;
  paymentMethod: PosPaymentMethod;
  creditDays: number;
  canRedeem: boolean;
  applyDiscount: boolean;
  discountAmount: number;
}

const MAX_HELD_SALES = 8;

/** Se muestra en el POS: activo y con stock (o sin control de inventario). */
const isSellable = (p: Product) =>
  isProductActive(p) && (p.stock > 0 || !tracksInventory(p));

const newHeldSale = (number: number, id?: string): HeldSale => ({
  id: id ?? `venta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  number,
  cart: [],
  customer: null,
  paymentMethod: "efectivo",
  creditDays: 7,
  canRedeem: false,
  applyDiscount: false,
  discountAmount: 0,
});

export default function POSPage() {
  const { getToken } = useAuth();

  const { user } = useUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [hasAnyProducts, setHasAnyProducts] = useState(true); // Track if user has ANY products
  const [cart, setCart] = useState<CartItem[]>([]);
  // En el celular el carrito es un panel lateral que se abre con un botón
  const [cartOpen, setCartOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [activeOffers, setActiveOffers] = useState<Offer[]>([]);
  const [paymentMethod, setPaymentMethod] =
    useState<PosPaymentMethod>("efectivo");
  const [creditDays, setCreditDays] = useState<number>(7); // Plazo por defecto: 7 días
  const [processing, setProcessing] = useState(false);
  // Modal de cobro con QR (Nequi/Daviplata/transferencia)
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [canRedeem, setCanRedeem] = useState(false);
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    name: "",
    phone: "",
    email: "",
  });
  const [scanSuccess, setScanSuccess] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showBarcodeInput, setShowBarcodeInput] = useState(false); // Mostrar input para lector USB
  const [lastCameraScannedCode, setLastCameraScannedCode] =
    useState<string>("");
  const barcodeRef = useRef<HTMLInputElement>(null);

  // Estados para la factura
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastSaleItems, setLastSaleItems] = useState<SaleItemWithProduct[]>([]);
  const [lastSaleCustomer, setLastSaleCustomer] = useState<Customer | null>(
    null,
  );
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Estados para el modal de selección de unidades
  const [showUnitSelector, setShowUnitSelector] = useState(false);
  const [selectedProductForUnits, setSelectedProductForUnits] =
    useState<Product | null>(null);

  // Estados para el registro rápido de un producto no encontrado
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [quickRegisterSaving, setQuickRegisterSaving] = useState(false);
  const [quickRegisterData, setQuickRegisterData] = useState({
    barcode: "",
    name: "",
    sale_price: "",
    cost_price: "",
    stock: "",
  });
  // "Sin inventario": producto suelto (sin código) que se vende sin llevar stock
  const [quickNoInventory, setQuickNoInventory] = useState(false);

  // Estado para animación del carrito al agregar producto
  const [cartBump, setCartBump] = useState(false);
  const [floatingProducts, setFloatingProducts] = useState<Set<string>>(
    new Set(),
  );
  const cartIconRef = useRef<HTMLDivElement>(null);
  // En escritorio la tarjeta del carrito mide exactamente lo que queda de
  // pantalla debajo de su posición actual, para que "Procesar Venta" quede
  // pegado abajo y siempre visible (medido, no calculado a ojo con vh).
  const cartCardRef = useRef<HTMLDivElement>(null);
  const [cartCardHeight, setCartCardHeight] = useState<number | undefined>();
  useEffect(() => {
    const STICKY_TOP = 8; // = lg:top-2
    const update = () => {
      const el = cartCardRef.current;
      if (!el || !window.matchMedia("(min-width: 1024px)").matches) {
        setCartCardHeight(undefined);
        return;
      }
      const top = Math.max(el.getBoundingClientRect().top, STICKY_TOP);
      setCartCardHeight(
        Math.max(360, Math.floor(window.innerHeight - top - 16)),
      );
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    // El scroll ocurre dentro de <main>: no burbujea, se escucha en captura
    window.addEventListener("scroll", update, true);
    // La posición de la tarjeta también cambia sin scroll ni resize (avisos
    // que aparecen arriba, carga del catálogo, cambio de pestaña...): se
    // vuelve a medir al cambiar el tamaño del contenido y cada medio segundo.
    const main = cartCardRef.current?.closest("main");
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (main) observer?.observe(main);
    observer?.observe(document.body);
    const interval = window.setInterval(update, 500);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(interval);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);

  // Ventas en espera (pestañas). La pestaña activa vive en los estados de arriba
  // (cart, selectedCustomer, paymentMethod...); heldSales guarda las demás.
  const [heldSales, setHeldSales] = useState<HeldSale[]>(() => [
    newHeldSale(1, "venta-1"),
  ]);
  const [activeSaleId, setActiveSaleId] = useState("venta-1");
  const [heldSalesRestored, setHeldSalesRestored] = useState(false);
  const heldSalesRef = useRef(heldSales);
  const activeSaleIdRef = useRef(activeSaleId);
  useEffect(() => {
    heldSalesRef.current = heldSales;
    activeSaleIdRef.current = activeSaleId;
  }, [heldSales, activeSaleId]);
  // Stock más reciente por producto. El carrito guarda una copia del producto y,
  // con varias ventas abiertas, otra pestaña pudo vender del mismo producto.
  const latestStockRef = useRef<Map<string, number>>(new Map());

  const heldSalesStorageKey = () =>
    `pos_held_sales_${user?.id ?? "anon"}_${getSelectedTenantId() ?? "default"}`;

  const snapshotActiveSale = () => ({
    cart,
    customer: selectedCustomer,
    paymentMethod,
    creditDays,
    canRedeem,
    applyDiscount,
    discountAmount,
  });

  const withFreshStock = (items: CartItem[]) =>
    items.map((item) => {
      const stock = latestStockRef.current.get(item.product.id);
      return stock === undefined
        ? item
        : { ...item, product: { ...item.product, stock } };
    });

  const loadHeldSale = (sale: HeldSale) => {
    setCart(withFreshStock(sale.cart));
    setSelectedCustomer(sale.customer);
    setPaymentMethod(sale.paymentMethod);
    setCreditDays(sale.creditDays);
    setCanRedeem(sale.canRedeem);
    setApplyDiscount(sale.applyDiscount);
    setDiscountAmount(sale.discountAmount);
    setActiveSaleId(sale.id);
    setShowCustomerSearch(false);
    setCustomerSearchTerm("");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  };

  const switchHeldSale = (id: string) => {
    if (id === activeSaleId || processing) return;
    const target = heldSales.find((s) => s.id === id);
    if (!target) return;
    setHeldSales((prev) =>
      prev.map((s) =>
        s.id === activeSaleId ? { ...s, ...snapshotActiveSale() } : s,
      ),
    );
    loadHeldSale(target);
  };

  const addHeldSale = () => {
    if (processing) return;
    if (heldSales.length >= MAX_HELD_SALES) {
      Swal.warning(
        `Puedes tener hasta ${MAX_HELD_SALES} ventas abiertas a la vez`,
        "Demasiadas ventas abiertas",
      );
      return;
    }
    const fresh = newHeldSale(Math.max(...heldSales.map((s) => s.number)) + 1);
    setHeldSales((prev) => [
      ...prev.map((s) =>
        s.id === activeSaleId ? { ...s, ...snapshotActiveSale() } : s,
      ),
      fresh,
    ]);
    loadHeldSale(fresh);
  };

  // Quita una pestaña. Si era la activa, pasa a la vecina; si era la última, deja una vacía.
  // Usa refs porque se llama también al terminar una venta (después de un await).
  const removeHeldSale = (id: string) => {
    const current = heldSalesRef.current;
    let remaining = current.filter((s) => s.id !== id);
    // Si queda una sola venta, la numeración vuelve a empezar ("Cliente 1")
    if (remaining.length === 1) remaining = [{ ...remaining[0], number: 1 }];
    if (remaining.length === 0) {
      const fresh = newHeldSale(1);
      setHeldSales([fresh]);
      loadHeldSale(fresh);
      return;
    }
    setHeldSales(remaining);
    if (id === activeSaleIdRef.current) {
      const index = current.findIndex((s) => s.id === id);
      loadHeldSale(remaining[Math.min(index, remaining.length - 1)]);
    }
  };

  const closeHeldSale = async (id: string) => {
    if (processing) return;
    const sale = heldSales.find((s) => s.id === id);
    if (!sale) return;
    const isActive = id === activeSaleId;
    const items = isActive ? cart : sale.cart;
    const customer = isActive ? selectedCustomer : sale.customer;
    if (items.length > 0) {
      const confirmed = await Swal.confirm(
        items.length === 1
          ? "Se descartará el producto de esta venta."
          : `Se descartarán los ${items.length} productos de esta venta.`,
        `¿Cerrar la venta de ${customer?.name ?? `Cliente ${sale.number}`}?`,
        { confirmText: "Sí, cerrar" },
      );
      if (!confirmed) return;
    }
    removeHeldSale(id);
  };

  // Tira de pestañas: se desplaza de lado sin barra visible, con flechas laterales
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabsScroll, setTabsScroll] = useState({
    overflow: false,
    left: false,
    right: false,
  });

  const updateTabsScroll = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const next = {
      overflow: el.scrollWidth > el.clientWidth + 1,
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
    setTabsScroll((prev) =>
      prev.overflow === next.overflow &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next,
    );
  }, []);

  const scrollTabs = (direction: -1 | 1) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  };

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateTabsScroll);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateTabsScroll]);

  // Al cambiar o abrir una venta, dejar su pestaña a la vista
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      tabsScrollRef.current
        ?.querySelector(`[data-sale-id="${activeSaleId}"]`)
        ?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "smooth",
        });
      updateTabsScroll();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSaleId, heldSales.length, updateTabsScroll]);

  // Restaurar las ventas abiertas guardadas en este navegador (por cuenta y tienda)
  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(heldSalesStorageKey());
      if (raw) {
        const data = JSON.parse(raw) as {
          activeId?: string;
          sales?: HeldSale[];
        };
        if (Array.isArray(data.sales) && data.sales.length > 0) {
          // Restaurar desde localStorage solo puede hacerse tras montar (SSR)
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setHeldSales(data.sales);
          loadHeldSale(
            data.sales.find((s) => s.id === data.activeId) ?? data.sales[0],
          );
        }
      }
    } catch {
      // Sin acceso a localStorage: se arranca con una venta vacía
    }
    setHeldSalesRestored(true);
    // Solo al cargar la cuenta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Guardar las ventas abiertas para no perderlas si se recarga la página
  useEffect(() => {
    if (!heldSalesRestored) return;
    try {
      const sales = heldSales.map((s) =>
        s.id === activeSaleId ? { ...s, ...snapshotActiveSale() } : s,
      );
      const hasContent =
        sales.length > 1 || sales.some((s) => s.cart.length > 0 || s.customer);
      if (hasContent) {
        localStorage.setItem(
          heldSalesStorageKey(),
          JSON.stringify({ activeId: activeSaleId, sales }),
        );
      } else {
        localStorage.removeItem(heldSalesStorageKey());
      }
    } catch {
      // Sin acceso a localStorage: las ventas siguen en memoria
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    heldSalesRestored,
    heldSales,
    activeSaleId,
    cart,
    selectedCustomer,
    paymentMethod,
    creditDays,
    canRedeem,
    applyDiscount,
    discountAmount,
  ]);

  const handleCreateCustomer = async () => {
    // Validar nombre
    if (!newCustomerData.name.trim()) {
      Swal.warning("Nombre requerido", "Debes ingresar el nombre del cliente");
      return;
    }

    // Validar email
    if (!newCustomerData.email.trim()) {
      Swal.warning(
        "Email requerido",
        "El email es necesario para enviar recordatorios de pago",
      );
      return;
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newCustomerData.email.trim())) {
      Swal.warning("Email inválido", "Por favor ingresa un email válido");
      return;
    }

    // Validar teléfono
    if (!newCustomerData.phone.trim()) {
      Swal.warning(
        "Teléfono requerido",
        "El teléfono es necesario para enviar recordatorios de pago",
      );
      return;
    }

    // Validar que el teléfono tenga al menos 7 dígitos
    const phoneDigits = newCustomerData.phone.replace(/\D/g, "");
    if (phoneDigits.length < 7) {
      Swal.warning(
        "Teléfono inválido",
        "El teléfono debe tener al menos 7 dígitos",
      );
      return;
    }

    try {
      const customerData: Partial<Customer> = {
        name: newCustomerData.name.trim(),
        phone: newCustomerData.phone.trim(),
        email: newCustomerData.email.trim(),
        loyalty_points: 0,
      };

      const newCustomer = await createCustomer(customerData, getToken);

      Swal.success(
        "Cliente creado",
        `${newCustomer.name} ha sido agregado exitosamente`,
      );

      // Seleccionar automáticamente el nuevo cliente
      setSelectedCustomer(newCustomer);

      // Limpiar el formulario y cerrarlo
      setNewCustomerData({ name: "", phone: "", email: "" });
      setShowNewCustomerForm(false);
      setShowCustomerSearch(false);

      // Actualizar lista de clientes
      await fetchCustomers();
    } catch (error) {
      console.error("Error creating customer:", error);
      // Mostrar el mensaje de error específico del backend
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Por favor verifica los datos ingresados";
      Swal.error("Error al crear cliente", errorMessage);
    }
  };

  const fetchOffers = useCallback(async () => {
    try {
      const offers = await getActiveOffers(getToken);
      setActiveOffers(offers || []);
    } catch (error) {
      console.error("Error fetching offers:", error);
      // Si no hay ofertas o hay un error, simplemente usar un array vacío
      // Esto permite que el POS funcione normalmente sin ofertas
      setActiveOffers([]);
    }
  }, [getToken]);

  const getProductOffer = useCallback(
    (productId: string): Offer | undefined => {
      return activeOffers.find(
        (offer) => offer.product_id === productId && offer.is_active === 1,
      );
    },
    [activeOffers],
  );

  const getProductWithOffer = useCallback(
    (product: Product): Product => {
      const offer = getProductOffer(product.id);
      if (offer && offer.discount_percentage > 0) {
        const discountAmount =
          (product.sale_price * offer.discount_percentage) / 100;
        return {
          ...product,
          sale_price: product.sale_price - discountAmount,
        };
      }
      return product;
    },
    [getProductOffer],
  );

  const fetchProducts = useCallback(async () => {
    try {
      const raw = (await getProducts(getToken)) as Product[];

      // Normalizar sell_by_unit: SQLite devuelve 0/1, necesitamos boolean
      const data = raw.map((p) => ({ ...p, sell_by_unit: !!p.sell_by_unit }));

      // Guardar en caché para poder consultar productos sin conexión.
      cacheCollection("products", data);

      latestStockRef.current = new Map(data.map((p) => [p.id, p.stock]));

      // Verificar si hay productos en el sistema (antes de filtrar por stock)
      setHasAnyProducts(data.length > 0);

      // Productos vendibles: activos y con stock (o sin control de inventario)
      const productsInStock = data.filter(isSellable);
      // Ordenar por nombre manualmente
      productsInStock.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(productsInStock);
    } catch (error) {
      console.error("Error fetching products:", error);
      // Sin conexión: leer el último catálogo cacheado.
      const cached = await readCachedCollection<Product>("products");
      if (cached.length > 0) {
        const data = cached.map((p) => ({
          ...p,
          sell_by_unit: !!p.sell_by_unit,
        }));
        latestStockRef.current = new Map(data.map((p) => [p.id, p.stock]));
        setHasAnyProducts(data.length > 0);
        const productsInStock = data.filter(isSellable);
        productsInStock.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(productsInStock);
      }
    }
  }, [getToken]);

  const fetchCustomers = useCallback(async () => {
    try {
      const data = (await getCustomers(getToken)) as Customer[];
      data.sort((a, b) => a.name.localeCompare(b.name));
      cacheCollection("customers", data);
      setCustomers(data);
    } catch (error) {
      console.error("Error fetching customers:", error);
      const cached = await readCachedCollection<Customer>("customers");
      if (cached.length > 0) setCustomers(cached);
    }
  }, [getToken]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = (await getCategories(getToken)) as Category[];
      data.sort((a, b) => a.name.localeCompare(b.name));
      cacheCollection("categories", data);
      setCategories(data);
    } catch (error) {
      console.error("Error fetching categories:", error);
      const cached = await readCachedCollection<Category>("categories");
      if (cached.length > 0) setCategories(cached);
    }
  }, [getToken]);

  // Cargar perfil de usuario
  const fetchUserProfile = useCallback(async () => {
    try {
      const profile = await getUserProfile(getToken);
      setUserProfile(profile);
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
  }, [getToken]);

  useEffect(() => {
    fetchOffers();
    fetchProducts();
    fetchCustomers();
    fetchCategories();
    fetchUserProfile();
    // Auto-focus en el input de código de barras
    barcodeRef.current?.focus();
  }, [
    fetchOffers,
    fetchProducts,
    fetchCustomers,
    fetchCategories,
    fetchUserProfile,
  ]);

  const handleBarcodeSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    console.log("🔍 [LECTOR USB] Código recibido:", barcodeInput);

    // 🔧 Normalizar el código de barras con la función centralizada
    const scannedBarcode = normalizeBarcode(barcodeInput);
    console.log("🔧 [LECTOR USB] Código normalizado:", scannedBarcode);

    if (!scannedBarcode) {
      Swal.error("Código inválido", "El código de barras no es válido");
      setBarcodeInput("");
      barcodeRef.current?.focus();
      return;
    }

    // 🔧 Buscar usando comparación normalizada
    let product = products.find((p) =>
      barcodeEquals(p.barcode, scannedBarcode),
    );

    // Si no se encuentra en productos disponibles, buscar en todos los productos
    if (!product) {
      console.log(
        "⚠️ [LECTOR USB] No encontrado en productos disponibles, buscando en todos...",
      );
      try {
        const allProducts = (await getProducts(getToken)) as Product[];
        product = allProducts.find((p) =>
          barcodeEquals(p.barcode, scannedBarcode),
        );

        // Si se encuentra pero no tiene stock
        if (product && product.stock <= 0 && tracksInventory(product)) {
          console.log("❌ [LECTOR USB] Producto encontrado pero sin stock");
          Swal.error(
            "Producto sin stock",
            `${product.name} no tiene unidades disponibles (Stock: ${product.stock})`,
          );
          setBarcodeInput("");
          barcodeRef.current?.focus();
          return;
        }
      } catch (error) {
        console.error("Error fetching all products:", error);
      }
    }

    if (product) {
      console.log("✅ [LECTOR USB] Producto encontrado:", product.name);
      // Efecto visual de éxito
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 500);

      addToCart(product);
      setBarcodeInput("");

      // Toast pequeño y no intrusivo
      Swal.productAdded(product.name, 1);
    } else {
      console.log("❌ [LECTOR USB] Producto NO encontrado en ninguna lista");
      const result = await Swal.custom({
        title: "Producto no encontrado",
        html: `<p>El código <strong>${scannedBarcode}</strong> no está registrado.</p><p class="text-sm text-gray-600 mt-2">¿Deseas registrarlo ahora para venderlo?</p>`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Registrar producto",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#155dfc",
      });
      if (result.isConfirmed) {
        openQuickRegister({ barcode: scannedBarcode });
      }
    }
    setBarcodeInput("");
    barcodeRef.current?.focus();
  };

  const handleCameraScan = async (barcode: string) => {
    if (!barcode.trim()) return;

    console.log("📷 [CÁMARA] Código recibido:", barcode);

    // 🔧 Normalizar el código de barras con la función centralizada
    const scannedBarcode = normalizeBarcode(barcode);
    console.log("🔧 [CÁMARA] Código normalizado:", scannedBarcode);

    if (!scannedBarcode) {
      console.log("❌ [CÁMARA] Código inválido después de normalizar");
      Swal.error("Código inválido", "El código de barras no es válido");
      setTimeout(() => setLastCameraScannedCode(""), 2000);
      return;
    }

    // Evitar procesar el mismo código dos veces seguidas
    if (scannedBarcode === lastCameraScannedCode) {
      console.log("⏭️ [CÁMARA] Código ya procesado, ignorando duplicado");
      return;
    }

    setLastCameraScannedCode(scannedBarcode);

    // 🔧 Buscar usando comparación normalizada
    console.log(
      "🔍 [CÁMARA] Productos disponibles para buscar:",
      products.length,
    );
    console.log(
      "🔍 [CÁMARA] Códigos disponibles:",
      products.map((p) => ({
        nombre: p.name,
        codigo: p.barcode,
        codigoNormalizado: normalizeBarcode(p.barcode),
      })),
    );

    let product = products.find((p) =>
      barcodeEquals(p.barcode, scannedBarcode),
    );

    // Si no se encuentra en productos disponibles, buscar en todos los productos
    if (!product) {
      console.log(
        "⚠️ [CÁMARA] No encontrado en productos disponibles, buscando en TODOS...",
      );
      try {
        const allProducts = (await getProducts(getToken)) as Product[];
        console.log(
          "🔍 [CÁMARA] Total de productos en sistema:",
          allProducts.length,
        );
        console.log(
          "🔍 [CÁMARA] Todos los códigos:",
          allProducts.map((p) => ({
            nombre: p.name,
            codigo: p.barcode,
            stock: p.stock,
            codigoNormalizado: normalizeBarcode(p.barcode),
          })),
        );

        product = allProducts.find((p) =>
          barcodeEquals(p.barcode, scannedBarcode),
        );

        // Si se encuentra pero no tiene stock
        if (product && product.stock <= 0 && tracksInventory(product)) {
          console.log(
            "❌ [CÁMARA] Producto encontrado pero sin stock:",
            product.name,
          );
          Swal.error(
            "Producto sin stock",
            `${product.name} no tiene unidades disponibles (Stock: ${product.stock})`,
          );
          setTimeout(() => setLastCameraScannedCode(""), 2000);
          return;
        }
      } catch (error) {
        console.error("Error fetching all products:", error);
      }
    }

    if (product) {
      console.log("✅ [CÁMARA] Producto encontrado:", product.name);
      // Efecto visual de éxito
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 500);

      addToCart(product);

      // Toast pequeño y no intrusivo
      Swal.productAdded(product.name, 1);

      // Cerrar el escáner después de agregar el producto
      setTimeout(() => {
        setShowCameraScanner(false);
        // Resetear el último código escaneado después de cerrar
        setTimeout(() => setLastCameraScannedCode(""), 1000);
      }, 500);
    } else {
      console.log("❌ [CÁMARA] Producto NO encontrado en ninguna lista");
      // Cerrar el escáner para poder mostrar el formulario de registro.
      setShowCameraScanner(false);
      const result = await Swal.custom({
        title: "Producto no encontrado",
        html: `<p>El código <strong>${scannedBarcode}</strong> no está registrado.</p><p class="text-sm text-gray-600 mt-2">¿Deseas registrarlo ahora para venderlo?</p>`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Registrar producto",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#155dfc",
      });
      if (result.isConfirmed) {
        openQuickRegister({ barcode: scannedBarcode });
      }
      // También resetear el código en caso de error
      setTimeout(() => setLastCameraScannedCode(""), 2000);
    }
  };

  const addToCart = (
    product: Product,
    quantity: number = 1,
    isUnitSale: boolean | undefined = undefined,
  ) => {
    console.log("🛒 addToCart called:", {
      product: product.name,
      quantity,
      isUnitSale,
      sell_by_unit: product.sell_by_unit,
    });

    // Si el producto se vende por unidades y no se especificó explícitamente el tipo de venta, abrir modal
    // isUnitSale === undefined significa que se llamó desde la lista de productos
    if (!!product.sell_by_unit && isUnitSale === undefined) {
      console.log("📱 Opening unit selector modal (isUnitSale not specified)");
      setSelectedProductForUnits(product);
      setShowUnitSelector(true);
      return;
    }

    // Si isUnitSale es undefined pero el producto no se vende por unidades, usar false por defecto
    const finalIsUnitSale = isUnitSale ?? false;

    // Disparar animación del carrito
    setCartBump(true);
    setTimeout(() => setCartBump(false), 600);

    // Partícula flotante "+1" sobre la card del producto
    setFloatingProducts((prev) => new Set(prev).add(product.id));
    setTimeout(
      () =>
        setFloatingProducts((prev) => {
          const s = new Set(prev);
          s.delete(product.id);
          return s;
        }),
      900,
    );

    console.log("➕ Adding to cart...", { finalIsUnitSale });
    setCart((prev) => {
      // Buscar si ya existe en el carrito (del mismo tipo: paquete o unidad)
      const existing = prev.find(
        (item) =>
          item.product.id === product.id && item.isUnitSale === finalIsUnitSale,
      );

      // Calcular precio efectivo y stock disponible
      const unitsPerPackage = product.units_per_package || 1;
      const pricePerUnit =
        product.price_per_unit || product.sale_price / unitsPerPackage;
      const effectivePrice = finalIsUnitSale
        ? pricePerUnit
        : product.sale_price;
      const availableStock = !tracksInventory(product)
        ? Infinity // Sin control de inventario: se vende aunque no haya stock
        : finalIsUnitSale
          ? Math.floor(product.stock * unitsPerPackage) // Unidades disponibles
          : Math.floor(product.stock); // Paquetes completos disponibles

      if (existing) {
        const newQuantity = existing.quantity + quantity;
        if (newQuantity > availableStock) {
          Swal.warning(
            "Cantidad insuficiente",
            `Solo hay ${availableStock} ${finalIsUnitSale ? product.unit_name || "unidades" : product.package_name || "paquetes"} disponibles`,
          );
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id && item.isUnitSale === finalIsUnitSale
            ? { ...item, quantity: newQuantity }
            : item,
        );
      }

      // Verificar si el producto tiene una oferta activa
      const offer = getProductOffer(product.id);
      const hasOffer = offer && offer.discount_percentage > 0;
      const originalPrice = product.sale_price;
      const discountPercentage = hasOffer ? offer!.discount_percentage : 0;

      // Aplicar descuento si existe
      const productWithOffer = hasOffer
        ? getProductWithOffer(product)
        : product;

      return [
        ...prev,
        {
          product: productWithOffer,
          quantity: quantity,
          originalPrice: hasOffer ? originalPrice : undefined,
          discountPercentage: hasOffer ? discountPercentage : undefined,
          hasOffer: hasOffer,
          isUnitSale: finalIsUnitSale,
          effectivePrice,
        },
      ];
    });
  };

  const handleUnitSelectorConfirm = (quantity: number, isUnitSale: boolean) => {
    console.log("✅ Unit selector confirmed:", {
      product: selectedProductForUnits?.name,
      quantity,
      isUnitSale,
    });

    if (selectedProductForUnits) {
      addToCart(selectedProductForUnits, quantity, isUnitSale);
      setShowUnitSelector(false);
      setSelectedProductForUnits(null);

      // Toast de confirmación
      const unitName = isUnitSale
        ? selectedProductForUnits.unit_name || "unidad"
        : selectedProductForUnits.package_name || "paquete";
      Swal.productAdded(
        `${selectedProductForUnits.name} (${quantity} ${unitName}${quantity > 1 ? "s" : ""})`,
        quantity,
      );
    }
  };

  // Abre el modal de registro rápido, precargando el código de barras
  // (cuando viene del escáner) o el nombre (cuando viene de la búsqueda).
  const openQuickRegister = (
    opts: { barcode?: string; name?: string; noInventory?: boolean } = {},
  ) => {
    setQuickNoInventory(!!opts.noInventory);
    setQuickRegisterData({
      barcode: opts.barcode || "",
      name: opts.name || "",
      sale_price: "",
      cost_price: "",
      stock: "",
    });
    setShowQuickRegister(true);
  };

  // Crea el producto no registrado en el momento de la venta y lo agrega al
  // carrito para poder continuar la venta sin salir del POS.
  const handleQuickRegister = async () => {
    const name = quickRegisterData.name.trim();
    const salePrice = parseFloat(quickRegisterData.sale_price);
    const costPrice = quickRegisterData.cost_price.trim()
      ? parseFloat(quickRegisterData.cost_price)
      : 0;
    const noInventory = quickNoInventory;
    const stock = noInventory
      ? 0
      : quickRegisterData.stock.trim()
        ? parseFloat(quickRegisterData.stock)
        : 1;

    if (!name) {
      Swal.warning("Nombre requerido", "Ingresa el nombre del producto");
      return;
    }
    if (isNaN(salePrice) || salePrice <= 0) {
      Swal.warning(
        "Precio inválido",
        "Ingresa un precio de venta mayor a cero",
      );
      return;
    }
    if (isNaN(costPrice) || costPrice < 0) {
      Swal.warning(
        "Costo inválido",
        "El precio de costo no puede ser negativo",
      );
      return;
    }
    if (!noInventory && (isNaN(stock) || stock <= 0)) {
      Swal.warning("Stock inválido", "La cantidad debe ser mayor a cero");
      return;
    }

    // Venta rápida: si ya existe un producto sin inventario con ese nombre se
    // reutiliza, para no llenar el catálogo de duplicados ("mecato", "mecato"...).
    if (noInventory) {
      const existing = products.find(
        (p) =>
          !tracksInventory(p) &&
          !p.barcode &&
          p.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        // El precio escrito hoy manda sobre el guardado
        addToCart(existing, 1, false);
        setCart((prev) =>
          prev.map((i) =>
            i.product.id === existing.id && !i.isUnitSale
              ? { ...i, effectivePrice: salePrice }
              : i,
          ),
        );
        setShowQuickRegister(false);
        barcodeRef.current?.focus();
        return;
      }
    }

    setQuickRegisterSaving(true);
    try {
      const barcode = quickRegisterData.barcode.trim()
        ? normalizeBarcode(quickRegisterData.barcode)
        : undefined;

      const newProduct = (await createProduct(
        {
          barcode: barcode || undefined,
          name,
          sale_price: salePrice,
          cost_price: costPrice,
          stock,
          min_stock: noInventory ? 0 : 5,
          ...(noInventory ? { track_inventory: false } : {}),
        },
        getToken,
      )) as unknown as Product;

      // Normalizar sell_by_unit igual que en fetchProducts.
      const created: Product = {
        ...newProduct,
        sell_by_unit: !!newProduct.sell_by_unit,
      };

      // Refrescar el catálogo para que el producto aparezca en la lista.
      await fetchProducts();

      // Agregarlo directamente al carrito (venta por paquete).
      addToCart(created, 1, false);

      setShowQuickRegister(false);
      Swal.success(
        "Producto registrado",
        `${created.name} se creó y se agregó al carrito`,
      );
      barcodeRef.current?.focus();
    } catch (error) {
      console.error("Error registrando producto rápido:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Intenta de nuevo";
      Swal.error("No se pudo registrar el producto", errorMessage);
    } finally {
      setQuickRegisterSaving(false);
    }
  };

  const updateQuantity = (
    productId: string,
    delta: number,
    isUnitSale: boolean = false,
  ) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id === productId && item.isUnitSale === isUnitSale) {
          const newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return item;

          // Calcular stock disponible según el tipo de venta
          const unitsPerPackage = item.product.units_per_package || 1;
          const availableStock = !tracksInventory(item.product)
            ? Infinity
            : item.isUnitSale
              ? Math.floor(item.product.stock * unitsPerPackage)
              : Math.floor(item.product.stock);

          if (newQuantity > availableStock) {
            const unitLabel = item.isUnitSale
              ? item.product.unit_name || "unidades"
              : item.product.package_name || "paquetes";
            Swal.warning(
              "Cantidad insuficiente",
              `Solo hay ${availableStock} ${unitLabel} disponibles`,
            );
            return item;
          }
          return { ...item, quantity: newQuantity };
        }
        return item;
      }),
    );
  };

  const setDirectQuantity = (
    productId: string,
    quantity: number,
    isUnitSale: boolean = false,
  ) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id === productId && item.isUnitSale === isUnitSale) {
          if (quantity <= 0) {
            Swal.warning("Cantidad inválida", "La cantidad debe ser mayor a 0");
            return item;
          }

          // Calcular stock disponible según el tipo de venta
          const unitsPerPackage = item.product.units_per_package || 1;
          const availableStock = !tracksInventory(item.product)
            ? Infinity
            : item.isUnitSale
              ? Math.floor(item.product.stock * unitsPerPackage)
              : Math.floor(item.product.stock);

          if (quantity > availableStock) {
            const unitLabel = item.isUnitSale
              ? item.product.unit_name || "unidades"
              : item.product.package_name || "paquetes";
            Swal.warning(
              "Cantidad insuficiente",
              `Solo hay ${availableStock} ${unitLabel} disponibles`,
            );
            return { ...item, quantity: availableStock };
          }
          return { ...item, quantity };
        }
        return item;
      }),
    );
  };

  const removeFromCart = (productId: string, isUnitSale: boolean = false) => {
    setCart((prev) =>
      prev.filter(
        (item) =>
          !(item.product.id === productId && item.isUnitSale === isUnitSale),
      ),
    );
  };

  // Productos distintos (no unidades: los que se venden por peso llevan decimales)
  const cartItemCount = cart.length;

  useEffect(() => {
    if (!cartOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCartOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cartOpen]);

  const calculateTotal = () => {
    const subtotal = cart.reduce((sum, item) => {
      const price = item.effectivePrice || item.product.sale_price;
      return sum + price * item.quantity;
    }, 0);
    return subtotal - discountAmount;
  };

  // Procesa una venta cuando NO hay conexión: la encola en IndexedDB para
  // sincronizarla luego y descuenta el stock localmente.
  const processSaleOffline = async () => {
    if (paymentMethod === "credito") {
      Swal.warning(
        "Crédito no disponible sin conexión",
        "Las ventas a crédito requieren internet. Usa efectivo, tarjeta o transferencia.",
      );
      return;
    }

    setProcessing(true);
    try {
      const subtotal = cart.reduce((sum, item) => {
        const price = item.effectivePrice || item.product.sale_price;
        return sum + price * item.quantity;
      }, 0);
      const total = subtotal;

      const itemsPayload = cart.map((cartItem) => {
        const price = cartItem.effectivePrice || cartItem.product.sale_price;
        return {
          product_id: cartItem.product.id,
          quantity: cartItem.quantity,
          unit_price: price,
          discount: 0,
          subtotal: price * cartItem.quantity,
        };
      });

      const localId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const payload = {
        customer_id: selectedCustomer?.id ?? undefined,
        subtotal,
        tax: 0,
        discount: 0,
        total,
        payment_method: paymentMethod,
        status: "completada" as const,
        points_earned: 0,
        items: itemsPayload,
      };

      await queueSale({
        localId,
        payload,
        tenantId: getSelectedTenantId(),
        createdAt: Date.now(),
      });

      // Descontar stock localmente y refrescar la caché de productos.
      const cached = await readCachedCollection<Product>("products");
      if (cached.length > 0) {
        const updated = cached.map((p) => {
          const cartItem = cart.find((c) => c.product.id === p.id);
          if (!cartItem) return p;
          const unitsPerPackage = cartItem.product.units_per_package || 1;
          const packagesSold = cartItem.isUnitSale
            ? cartItem.quantity / unitsPerPackage
            : cartItem.quantity;
          return { ...p, stock: p.stock - packagesSold };
        });
        await cacheCollection("products", updated);
      }

      await Swal.custom({
        title: "Venta guardada sin conexión",
        html: `
          <p class="text-lg mb-2">Total: ${formatCurrency(total)}</p>
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            📴 Esta venta se guardó localmente y se sincronizará automáticamente
            cuando recuperes la conexión a internet.
          </div>
        `,
        icon: "success",
        confirmButtonText: "Aceptar",
      });

      // Limpiar el carrito y estados.
      setCart([]);
      setSelectedCustomer(null);
      setCanRedeem(false);
      setApplyDiscount(false);
      setDiscountAmount(0);
      removeHeldSale(activeSaleIdRef.current); // La venta terminó: cerrar su pestaña
      fetchProducts(); // Recargar desde caché (ya con stock descontado)
      barcodeRef.current?.focus();
    } catch (error) {
      console.error("Error processing offline sale:", error);
      Swal.error(
        "No se pudo guardar la venta offline",
        error instanceof Error ? error.message : "Error desconocido",
      );
    } finally {
      setProcessing(false);
    }
  };

  const processSale = async () => {
    if (cart.length === 0) {
      Swal.warning(
        "El carrito está vacío",
        "Agrega productos antes de procesar la venta",
      );
      return;
    }

    // ── Venta sin conexión ───────────────────────────────────────────────
    // Si no hay internet, encolamos la venta localmente y descontamos el
    // stock en la caché. Las ventas a crédito y los puntos requieren
    // validación del servidor, así que no se permiten offline.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await processSaleOffline();
      return;
    }

    // Validar venta a crédito
    if (paymentMethod === "credito") {
      if (!selectedCustomer) {
        Swal.warning(
          "Cliente requerido",
          "Debes seleccionar un cliente para vender a crédito",
        );
        return;
      }

      const total = calculateTotal();
      const creditCheck = await canCustomerGetCredit(
        selectedCustomer.id,
        total,
        getToken,
      );

      if (!creditCheck.canGetCredit) {
        Swal.error(
          "Crédito no disponible",
          creditCheck.message || "Este cliente no puede recibir más crédito",
        );
        return;
      }
    }

    setProcessing(true);
    try {
      // Obtener user_profile del usuario actual
      let userProfile = null;
      try {
        userProfile = await getUserProfile(getToken);
      } catch (error) {
        console.error("User profile not found:", error);
        Swal.error(
          "Error",
          "Perfil de usuario no encontrado. Asegúrate de haber iniciado sesión correctamente.",
        );
        setProcessing(false);
        return;
      }

      if (!userProfile || !userProfile.id) {
        Swal.error(
          "Perfil inválido",
          "No se pudo obtener información del usuario autenticado.",
        );
        setProcessing(false);
        return;
      }

      const subtotal = cart.reduce((sum, item) => {
        const price = item.effectivePrice || item.product.sale_price;
        return sum + price * item.quantity;
      }, 0);
      // El número de venta se genera automáticamente en la API de Cloudflare

      // Canjear puntos por descuento si aplica
      let appliedDiscount = 0;
      let pointsRedeemed = 0;
      if (selectedCustomer && applyDiscount) {
        const redeemResult = await redeemPointsForDiscount(
          selectedCustomer.id,
          subtotal,
          getToken,
        );
        appliedDiscount = redeemResult.discount;
        pointsRedeemed = redeemResult.pointsRedeemed;
      }

      const total = subtotal - appliedDiscount;

      // Calcular puntos si hay un cliente seleccionado (después de aplicar descuento)
      // NOTA: En ventas a crédito, los puntos NO se asignan hasta que se pague completamente
      let pointsEarned = 0;
      let pointsToAssignNow = 0;

      if (selectedCustomer) {
        // Calcular puntos basados en el total de la compra
        pointsEarned = await calculatePointsForPurchase(userProfile.id, total);

        // Solo asignar puntos inmediatamente si NO es venta a crédito
        if (paymentMethod !== "credito") {
          pointsToAssignNow = pointsEarned;
        } else {
          // En ventas a crédito, guardamos los puntos en la venta
          // pero NO los asignamos al cliente hasta que se pague completamente
          pointsToAssignNow = 0;
        }
      }

      // Crear la venta
      type SaleItemCreate = {
        product_id: string;
        quantity: number;
        unit_price: number;
        discount: number;
        subtotal: number;
      };

      type SalePayload = Partial<Sale> & { items?: SaleItemCreate[] };

      const saleData: SalePayload = {
        // sale_number se genera automáticamente en la API
        cashier_id: userProfile.id,
        customer_id: selectedCustomer?.id ?? undefined,
        subtotal: subtotal,
        tax: 0,
        discount: appliedDiscount,
        total: total,
        payment_method: paymentMethod,
        status: paymentMethod === "credito" ? "pendiente" : "completada",
        points_earned: pointsEarned || 0,
        notes: undefined,
      };

      // Campos específicos para ventas a crédito
      if (paymentMethod === "credito") {
        saleData.payment_status = "pendiente";
        saleData.amount_paid = 0;
        saleData.amount_pending = total;
        // Fecha de vencimiento: según días acordados
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + creditDays);
        saleData.due_date = dueDate.toISOString();
      } else {
        saleData.payment_status = undefined;
        saleData.amount_paid = undefined;
        saleData.amount_pending = undefined;
        saleData.due_date = undefined;
      }

      // Agregar items a la venta (la API de Cloudflare los crea automáticamente)
      const itemsPayload = cart.map((cartItem) => {
        // Calcular el descuento por oferta si existe
        const price = cartItem.effectivePrice || cartItem.product.sale_price;
        const itemDiscount =
          cartItem.hasOffer && cartItem.originalPrice
            ? (cartItem.originalPrice - price) * cartItem.quantity
            : 0;

        // IMPORTANTE: Guardar la cantidad REAL vendida (8 unidades o 2 paquetes)
        // NO convertir a paquetes aquí, eso se hace solo para el descuento de inventario
        return {
          product_id: cartItem.product.id,
          quantity: cartItem.quantity, // Cantidad real vendida
          unit_price: price,
          discount: itemDiscount,
          subtotal: price * cartItem.quantity,
        };
      });
      saleData.items = itemsPayload;

      // Validación básica antes de enviar al API para evitar errores de D1 por valores undefined
      if (
        !saleData.total ||
        !saleData.payment_method ||
        !Array.isArray(saleData.items) ||
        saleData.items!.length === 0
      ) {
        Swal.error(
          "Datos de venta inválidos",
          "Faltan campos requeridos (total, payment_method o items)",
        );
        setProcessing(false);
        return;
      }

      for (const item of saleData.items!) {
        if (
          !item.product_id ||
          typeof item.quantity !== "number" ||
          item.quantity <= 0 ||
          typeof item.unit_price !== "number" ||
          typeof item.subtotal !== "number"
        ) {
          Swal.error(
            "Datos de producto inválidos",
            "Revisa los productos en el carrito (id, cantidad o precio inválidos)",
          );
          setProcessing(false);
          return;
        }
      }

      const sale = await createSale(
        saleData as unknown as Partial<Sale>,
        getToken,
      );

      // Actualizar el stock de los productos
      for (const cartItem of cart) {
        const unitsPerPackage = cartItem.product.units_per_package || 1;
        // Partir del stock más reciente: otra venta en espera pudo vender de este producto
        const currentStock =
          latestStockRef.current.get(cartItem.product.id) ??
          cartItem.product.stock;

        // Calcular cuánto descontar del stock según si es venta por unidades o paquetes
        // IMPORTANTE: El stock SIEMPRE está en paquetes para TODOS los productos
        let newStock: number;

        if (cartItem.isUnitSale) {
          // Venta por unidades: convertir las unidades vendidas a paquetes
          const unitsSold = cartItem.quantity;
          const packagesSold = unitsSold / unitsPerPackage;
          newStock = currentStock - packagesSold;

          console.log("🔄 Venta por unidades:", {
            producto: cartItem.product.name,
            stockAnterior: currentStock,
            unidadesVendidas: unitsSold,
            unidadesPorPaquete: unitsPerPackage,
            paquetesDescontados: packagesSold,
            nuevoStock: newStock,
            unidadesRestantes: Math.floor(newStock * unitsPerPackage),
          });
        } else {
          // Venta por paquetes: descontar directamente
          newStock = currentStock - cartItem.quantity;

          console.log("📦 Venta por paquetes:", {
            producto: cartItem.product.name,
            stockAnterior: currentStock,
            paquetesVendidos: cartItem.quantity,
            nuevoStock: newStock,
          });
        }

        await updateProduct(
          cartItem.product.id,
          {
            stock: newStock,
          },
          getToken,
        );
        latestStockRef.current.set(cartItem.product.id, newStock);

        // TODO: Implementar API endpoint para inventory_movements
        // Por ahora la cantidad se actualiza pero no se registra el movimiento de inventario
        // Esto se puede implementar más adelante creando una ruta /api/inventory-movements
      }

      // Asignar puntos al cliente si aplica (solo para ventas NO a crédito)
      let customerReachedRewardThreshold = false;
      let customerNewPoints = 0;

      if (selectedCustomer && pointsToAssignNow > 0) {
        await addPointsToCustomer(
          selectedCustomer.id,
          pointsToAssignNow,
          getToken,
        );

        // Verificar si el cliente alcanzó el umbral para obtener descuento
        const updatedCustomer = await getCustomerById(
          selectedCustomer.id,
          getToken,
        );
        customerNewPoints = updatedCustomer.loyalty_points || 0;

        // Si el cliente ahora tiene >= 100 puntos y antes tenía < 100, alcanzó el umbral
        const previousPoints = selectedCustomer.loyalty_points || 0;
        const REWARD_THRESHOLD = REWARD_CONSTANTS.POINTS_FOR_DISCOUNT;

        if (
          previousPoints < REWARD_THRESHOLD &&
          customerNewPoints >= REWARD_THRESHOLD
        ) {
          customerReachedRewardThreshold = true;
        }
      }

      // Actualizar deuda del cliente si es venta a crédito
      if (paymentMethod === "credito" && selectedCustomer) {
        await updateCustomerDebt(selectedCustomer.id, total, getToken);
      }

      // Mostrar notificación especial si el cliente alcanzó el umbral de recompensa
      if (customerReachedRewardThreshold && selectedCustomer) {
        await Swal.custom({
          icon: "success",
          title: "🎉 ¡Cliente Alcanzó Recompensa!",
          html: `
            <div class="text-left space-y-3">
              <div class="bg-brand-light/50 border border-brand/40 rounded-lg p-4 mb-3">
                <p class="text-lg font-bold text-brand mb-2">
                  🏆 ${selectedCustomer.name}
                </p>
                <p class="text-sm text-gray-700 mb-2">
                  Ahora tiene <strong class="text-brand">${customerNewPoints} puntos acumulados</strong>
                </p>
                <p class="text-sm text-brand font-semibold">
                  ✓ Ya puede canjear un descuento del ${REWARD_CONSTANTS.DISCOUNT_PERCENTAGE}% en su próxima compra
                </p>
              </div>
              <div class="bg-brand-light/50 border border-brand/40 rounded-lg p-3 text-xs text-gray-600">
                <p><strong>Recuerda:</strong> El cliente puede canjear ${REWARD_CONSTANTS.POINTS_FOR_DISCOUNT} puntos por un ${REWARD_CONSTANTS.DISCOUNT_PERCENTAGE}% de descuento en su próxima compra.</p>
              </div>
            </div>
          `,
          confirmButtonText: "Entendido",
          confirmButtonColor: "#EAB308",
          timer: 8000,
          timerProgressBar: true,
        });
      }

      // Verificar si hay productos con descuento por oferta
      const itemsWithOffer = cart.filter((item) => item.hasOffer);
      const totalOfferDiscount = itemsWithOffer.reduce((sum, item) => {
        if (item.originalPrice) {
          return (
            sum + (item.originalPrice - item.product.sale_price) * item.quantity
          );
        }
        return sum;
      }, 0);

      // Mostrar mensaje personalizado - SIEMPRE con opción de factura
      let htmlContent = `
        <p class="text-sm text-gray-500 mb-1">Venta #${sale.sale_number}</p>
      `;

      // Mostrar información de productos con ofertas
      if (itemsWithOffer.length > 0) {
        htmlContent += `
          <div class="bg-brand-light/50 border-2 border-brand/60 rounded-lg p-3 mb-3">
            <p class="text-sm font-bold text-brand mb-2">🏷️ Descuentos Aplicados</p>
            <div class="space-y-1">
        `;
        itemsWithOffer.forEach((item) => {
          const itemDiscount = item.originalPrice
            ? (item.originalPrice - item.product.sale_price) * item.quantity
            : 0;
          htmlContent += `
            <div class="flex justify-between items-center text-xs">
              <span class="text-gray-700">
                ${item.product.name} <span class="font-semibold text-brand">(-${item.discountPercentage}%)</span>
              </span>
              <span class="text-brand font-semibold">-${formatCurrency(itemDiscount)}</span>
            </div>
          `;
        });
        htmlContent += `
            </div>
            <div class="mt-2 pt-2 border-t border-brand/40 flex justify-between text-sm font-bold">
              <span class="text-brand">Total Ahorrado:</span>
              <span class="text-brand">${formatCurrency(totalOfferDiscount)}</span>
            </div>
          </div>
        `;
      }

      // Agregar información de cliente si existe
      if (selectedCustomer) {
        htmlContent += `
          ${
            appliedDiscount > 0
              ? `
            <div class="bg-gray-50 p-2 rounded mb-2 text-sm">
              <p class="text-gray-600">Subtotal: ${formatCurrency(subtotal)}</p>
              <p class="text-brand font-semibold">Descuento (${
                REWARD_CONSTANTS.DISCOUNT_PERCENTAGE
              }%): -${formatCurrency(appliedDiscount)}</p>
              <p class="text-xs text-gray-500 mt-1">Se canjearon ${pointsRedeemed} puntos</p>
            </div>
          `
              : ""
          }
          <p class="text-xl font-bold text-brand mb-2">Total: ${formatCurrency(
            total,
          )}</p>
          <div class="bg-brand-light/50 border border-brand/40 rounded-lg px-3 py-2 mb-2">
            <p class="text-sm text-gray-600">Cliente: <strong>${
              selectedCustomer.name
            }</strong></p>
          </div>
        `;

        if (pointsEarned > 0) {
          if (paymentMethod === "credito") {
            // Para ventas a crédito, mostrar que los puntos se asignarán al pagar
            htmlContent += `
              <div class="bg-brand-light/50 border border-brand/40 rounded-lg p-3 mb-2">
                <p class="text-sm font-bold text-brand">⏳ ${pointsEarned} puntos pendientes</p>
                <p class="text-xs text-gray-600 mt-1">Se asignarán cuando se complete el pago</p>
              </div>
            `;
          } else {
            // Para ventas normales, mostrar que los puntos ya se asignaron
            htmlContent += `
              <div class="bg-brand-light/50 border border-brand/40 rounded-lg p-3 mb-2">
                <p class="text-lg font-bold text-brand">+${pointsEarned} puntos ganados</p>
              </div>
            `;

            // Agregar mensaje de hito si aplica
            const milestoneMessage = getPointsMilestoneMessage(pointsEarned);
            if (milestoneMessage) {
              htmlContent += `
                <div class="bg-brand-light/50 border border-brand/40 rounded-lg p-3 text-sm">
                  <p class="text-brand">${milestoneMessage}</p>
                </div>
              `;
            }
          }
        }

        // Agregar mensaje especial para ventas a crédito
        if (paymentMethod === "credito") {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + creditDays);
          htmlContent += `
            <div class="bg-brand-light/50 border border-brand/40 rounded-lg px-3 py-2">
              <p class="text-sm font-semibold text-brand">💳 Venta a Crédito (${creditDays} ${creditDays === 1 ? "día" : "días"})</p>
              <p class="text-xs text-gray-600 mt-0.5">Fecha de vencimiento: ${dueDate.toLocaleDateString(
                "es-CO",
              )}</p>
            </div>
          `;
        }
      } else {
        // Sin cliente seleccionado
        htmlContent += `
          <p class="text-xl font-bold text-brand mb-2">Total: ${formatCurrency(
            total,
          )}</p>
        `;
      }

      // Agregar botón para generar factura (PARA TODAS LAS VENTAS)
      htmlContent += `
        <div class="mt-3 pt-3 border-t border-gray-200">
          <button id="generate-invoice-btn" class="w-full bg-brand hover:bg-brand-hover text-white font-semibold py-2 px-4 rounded flex items-center justify-center gap-2">
            📄 Generar Factura
          </button>
        </div>
      `;

      await Swal.custom({
        title:
          paymentMethod === "credito"
            ? "Venta a Crédito Registrada"
            : "Venta Completada",
        html: htmlContent,
        icon: "success",
        confirmButtonText: "Aceptar",
        customClass: { popup: "swal-sale-popup" },
        didOpen: () => {
          // Agregar evento al botón de factura
          const invoiceBtn = document.getElementById("generate-invoice-btn");
          if (invoiceBtn) {
            invoiceBtn.addEventListener("click", () => {
              // Cerrar el SweetAlert y abrir el modal de factura
              Swal.close();
              // Guardar la información de la venta para la factura
              setLastSale(sale);
              // Construir los items con la información del producto
              const saleItemsWithProducts: SaleItemWithProduct[] = cart.map(
                (cartItem) => {
                  const price =
                    cartItem.effectivePrice || cartItem.product.sale_price;
                  return {
                    id: "", // Se genera en la API
                    user_profile_id: (sale as Sale).user_profile_id,
                    sale_id: sale.id,
                    product_id: cartItem.product.id,
                    quantity: cartItem.quantity,
                    unit_price: price,
                    discount: 0,
                    subtotal: price * cartItem.quantity,
                    created_at: new Date().toISOString(),
                    product: cartItem.product,
                  };
                },
              );
              setLastSaleItems(saleItemsWithProducts);
              setLastSaleCustomer(selectedCustomer);
              setShowInvoiceModal(true);
            });
          }
        },
      });

      // Limpiar el carrito y estados
      setCart([]);
      setSelectedCustomer(null);
      setCanRedeem(false);
      setApplyDiscount(false);
      setDiscountAmount(0);
      removeHeldSale(activeSaleIdRef.current); // La venta terminó: cerrar su pestaña
      fetchProducts(); // Actualizar inventario
      barcodeRef.current?.focus();
    } catch (error) {
      console.error("Error processing sale:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Error al procesar la venta";
      Swal.error(errorMessage, "Error en la venta");
    } finally {
      setProcessing(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === "all" || p.category_id === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Modal cuando NO hay productos en el sistema (no solo sin stock)
  if (!hasAnyProducts) {
    return (
      <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 text-center shadow-2xl">
          <div className="mb-6">
            <div className="mx-auto w-20 h-20 bg-brand-light rounded-full flex items-center justify-center mb-4">
              <Package className="h-10 w-10 text-brand" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              ¡Bienvenido al Punto de Venta!
            </h2>
            <p className="text-gray-600">
              Para comenzar a vender, primero necesitas agregar productos a tu
              inventario.
            </p>
          </div>

          <div className="space-y-3">
            <Link
              href="/dashboard/products/new"
              className="block w-full bg-brand hover:bg-brand-hover text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              <Plus className="inline-block h-5 w-5 mr-2 -mt-1" />
              Crear Mi Primer Producto
            </Link>

            <button
              onClick={async () => {
                const response = await fetch("/api/seed-products", {
                  method: "POST",
                });
                const data = await response.json();
                if (response.ok) {
                  Swal.success("¡Productos creados!", data.message);
                  fetchProducts();
                } else {
                  Swal.error(
                    "Error",
                    data.error || "No se pudieron crear productos de ejemplo",
                  );
                }
              }}
              className="block w-full bg-brand hover:bg-brand-hover text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              <Package className="inline-block h-5 w-5 mr-2 -mt-1" />
              Crear Productos de Ejemplo
            </button>

            <Link
              href="/dashboard/products"
              className="block w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Ver Todos los Productos
            </Link>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              💡 <strong>Consejo:</strong> Puedes crear productos de ejemplo
              para probar el sistema rápidamente.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Modal del escáner de cámara */}
      {showCameraScanner && (
        <div className="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl">
            <BarcodeScannerZXing
              onDetected={handleCameraScan}
              onClose={() => setShowCameraScanner(false)}
            />
          </div>
        </div>
      )}

      {/* Modal de registro rápido de producto no encontrado */}
      {showQuickRegister && (
        <div className="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <div className="p-2 bg-brand rounded-lg">
                    <Plus className="h-5 w-5 text-white" />
                  </div>
                  {quickNoInventory ? "Producto sin código" : "Registrar producto"}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setShowQuickRegister(false)}
                  disabled={quickRegisterSaving}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {quickNoInventory
                  ? "Escribe qué es y cuánto vale: se agrega a la venta y queda guardado para buscarlo la próxima vez."
                  : "Complétalo para venderlo ahora. Podrás editar el resto de detalles luego en Productos."}
              </p>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleQuickRegister();
                }}
                className="space-y-3"
              >
                {quickRegisterData.barcode && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">
                      Código de barras
                    </label>
                    <Input
                      value={quickRegisterData.barcode}
                      readOnly
                      className="mt-1 font-mono bg-gray-50"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Nombre <span className="text-red-500">*</span>
                  </label>
                  <Input
                    autoFocus
                    value={quickRegisterData.name}
                    onChange={(e) =>
                      setQuickRegisterData((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Ej: Gaseosa 350ml"
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600">
                      Precio de venta <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={quickRegisterData.sale_price}
                      onChange={(e) =>
                        setQuickRegisterData((prev) => ({
                          ...prev,
                          sale_price: e.target.value,
                        }))
                      }
                      placeholder="$ 0"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">
                      Precio de costo
                    </label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={quickRegisterData.cost_price}
                      onChange={(e) =>
                        setQuickRegisterData((prev) => ({
                          ...prev,
                          cost_price: e.target.value,
                        }))
                      }
                      placeholder="$ 0"
                      className="mt-1"
                    />
                  </div>
                </div>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={quickNoInventory}
                    onChange={(e) => setQuickNoInventory(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--brand,#155dfc)]"
                  />
                  <span>
                    <span className="font-medium">No llevar inventario</span>{" "}
                    (mecatos, productos sueltos sin código): se vende siempre,
                    sin contar unidades.
                  </span>
                </label>
                {!quickNoInventory && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Stock inicial <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={quickRegisterData.stock}
                    onChange={(e) =>
                      setQuickRegisterData((prev) => ({
                        ...prev,
                        stock: e.target.value,
                      }))
                    }
                    placeholder="1"
                    className="mt-1"
                  />
                </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowQuickRegister(false)}
                    disabled={quickRegisterSaving}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 bg-brand hover:bg-brand-hover text-white"
                    disabled={quickRegisterSaving}
                  >
                    {quickRegisterSaving
                      ? "Guardando..."
                      : "Crear y agregar al carrito"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Panel izquierdo - Productos */}
        <div className="space-y-4 order-2 lg:order-1">
          {/* Búsqueda por código de barras */}
          <Card
            data-guide="pos-scan"
            className={`border-2 shadow-lg transition-all duration-300 ${
              scanSuccess
                ? "border-brand bg-brand-light/50"
                : "border-brand bg-linear-to-r from-brand-light/50 to-white"
            }`}
          >
            <CardContent className="p-3">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-brand">
                    <Scan className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="flex-1 min-w-0 truncate font-bold text-base text-gray-900">
                    {scanSuccess ? "✓ Producto Agregado" : "Escanear Producto"}
                  </h4>

                  {/* Botones de selección de método de escaneo (ícono + texto en línea) */}
                  {!showBarcodeInput && !showCameraScanner && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setShowBarcodeInput(true);
                          // Auto-enfocar el input después de un pequeño delay
                          setTimeout(() => barcodeRef.current?.focus(), 100);
                        }}
                        className="h-9 gap-1.5 bg-brand hover:bg-brand-hover transition-colors cursor-pointer"
                        title="Escanear con lector USB"
                        aria-label="Escanear con lector USB"
                      >
                        <Scan className="h-4 w-4" />
                        Lector USB
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setShowCameraScanner(true)}
                        className="h-9 gap-1.5 bg-brand hover:bg-brand-hover transition-colors cursor-pointer"
                        title="Escanear con cámara"
                        aria-label="Escanear con cámara"
                      >
                        <Camera className="h-4 w-4" />
                        Cámara
                      </Button>
                    </div>
                  )}
                </div>

                {/* Formulario de escaneo con lector USB */}
                {showBarcodeInput && (
                  <form onSubmit={handleBarcodeSearch} className="space-y-3">
                    {/* Input de código de barras */}
                    <div className="relative">
                      <Input
                        ref={barcodeRef}
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        placeholder="Escanea aquí el código de barras..."
                        className={`h-12 md:h-14 text-xs md:text-sm font-mono tracking-wider border-2 focus:ring-2 pl-10 md:pl-12 transition-colors ${
                          scanSuccess
                            ? "border-brand/60 focus:border-brand focus:ring-brand/40"
                            : "border-brand/60 focus:border-brand focus:ring-brand/40"
                        }`}
                        autoComplete="off"
                      />
                      <div className="absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                        <Scan
                          className={`h-5 w-5 md:h-6 md:w-6 ${
                            scanSuccess
                              ? "text-brand"
                              : "text-brand animate-pulse"
                          }`}
                        />
                      </div>
                    </div>

                    {/* Botones de acción */}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={() => {
                          setShowBarcodeInput(false);
                          setBarcodeInput("");
                        }}
                        className="flex-1 h-11 md:h-14"
                      >
                        <X className="h-5 w-5 mr-2" />
                        <span className="text-sm md:text-base">Cancelar</span>
                      </Button>
                      <Button
                        type="submit"
                        size="lg"
                        className={`flex-1 h-11 md:h-14 transition-colors ${
                          scanSuccess
                            ? "bg-brand hover:bg-brand-hover"
                            : "bg-brand hover:bg-brand-hover"
                        }`}
                      >
                        <Search className="h-5 w-5 mr-2" />
                        <span className="text-sm md:text-base">Agregar</span>
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <div
                        className={`h-1.5 w-1.5 rounded-full ${
                          scanSuccess ? "bg-brand animate-ping" : "bg-brand"
                        }`}
                      ></div>
                      <span>
                        {scanSuccess
                          ? "Producto agregado al carrito"
                          : "Listo para escanear - Presiona Enter o click en Agregar"}
                      </span>
                    </div>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Búsqueda de productos */}
          <Card data-guide="pos-search">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar productos..."
                    className="pl-10 text-sm md:text-base"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    openQuickRegister({
                      name: searchTerm.trim(),
                      noInventory: true,
                    })
                  }
                  title="Vender algo que no tiene código de barras ni está registrado"
                  className="shrink-0 border-brand text-brand hover:bg-brand-light/50 cursor-pointer"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Sin código
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filtros de categoría */}
              <div className="mb-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  onClick={() => setSelectedCategory("all")}
                  className={`shrink-0 h-8 px-3 inline-flex items-center justify-center cursor-pointer rounded-full text-xs md:text-sm font-semibold transition-colors ${
                    selectedCategory === "all"
                      ? "bg-brand text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-brand hover:text-white"
                  }`}
                >
                  Todos
                </button>
                {(() => {
                  const initials = categoryInitials(
                    categories.map((c) => c.name),
                  );
                  return categories.map((category, i) => (
                    <button
                      key={category.id}
                      onClick={() => setSelectedCategory(category.id)}
                      title={category.name}
                      aria-label={category.name}
                      className={`shrink-0 h-8 min-w-8 px-2 inline-flex items-center justify-center cursor-pointer rounded-full text-xs md:text-sm font-semibold transition-colors ${
                        selectedCategory === category.id
                          ? "bg-brand text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-brand hover:text-white"
                      }`}
                    >
                      {initials[i]}
                    </button>
                  ));
                })()}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3 max-h-[400px] md:max-h-[500px] overflow-y-auto">
                {filteredProducts.length > 0 ? (
                  filteredProducts.map((product) => {
                    const offer = getProductOffer(product.id);
                    const hasOffer = offer && offer.discount_percentage > 0;
                    const originalPrice = product.sale_price;
                    const discountedPrice = hasOffer
                      ? product.sale_price -
                        (product.sale_price * offer.discount_percentage) / 100
                      : product.sale_price;

                    return (
                      <Card
                        key={product.id}
                        className={`cursor-pointer hover:border-brand transition-colors relative overflow-hidden ${hasOffer ? "border-2 border-brand/80" : ""}`}
                        onClick={() => addToCart(product)}
                      >
                        {floatingProducts.has(product.id) && (
                          <div
                            className="floating-plus-one-card"
                            aria-hidden="true"
                          >
                            +1
                          </div>
                        )}
                        <CardContent className="p-2 md:p-4">
                          {/* Imagen del producto */}
                          <div className="relative w-full aspect-square mb-2 bg-gray-50 rounded-md overflow-hidden">
                            {hasOffer && (
                              <div className="absolute top-0 right-0 z-10 bg-brand text-white text-xs font-bold px-2 py-1 rounded-bl-md">
                                -{offer.discount_percentage}%
                              </div>
                            )}
                            {product.images && product.images.length > 0 ? (
                              <Image
                                src={product.images[0]}
                                alt={product.name}
                                fill
                                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                                className="object-contain p-2"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="h-8 w-8 md:h-12 md:w-12 text-gray-300" />
                              </div>
                            )}
                          </div>
                          <h4 className="font-medium text-xs md:text-sm mb-1 line-clamp-2">
                            {product.name}
                          </h4>
                          <div>
                            {hasOffer ? (
                              <>
                                <p className="text-xs text-gray-400 line-through">
                                  {formatCurrency(originalPrice)}
                                </p>
                                <p className="font-num text-sm md:text-lg font-bold text-brand">
                                  {formatCurrency(discountedPrice)}
                                </p>
                              </>
                            ) : (
                              <p className="font-num text-sm md:text-lg font-bold text-brand">
                                {formatCurrency(product.sale_price)}
                              </p>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            Disponible:{" "}
                            {!!product.sell_by_unit
                              ? (() => {
                                  // IMPORTANTE: El stock está en PAQUETES para TODOS los productos
                                  const unitsPerPackage =
                                    product.units_per_package || 1;
                                  const packageName =
                                    product.package_name || "paquete";
                                  const unitName =
                                    product.unit_name || "unidad";

                                  // Calcular unidades totales y desglosar
                                  const totalUnits = Math.floor(
                                    product.stock * unitsPerPackage,
                                  );
                                  const fullPackages = Math.floor(
                                    product.stock,
                                  );
                                  const remainingUnits =
                                    totalUnits - fullPackages * unitsPerPackage;
                                  const packageNamePlural =
                                    fullPackages === 1
                                      ? packageName
                                      : `${packageName}s`;
                                  const unitNamePlural =
                                    remainingUnits === 1
                                      ? unitName
                                      : `${unitName}es`;

                                  return `${totalUnits} ${unitName}${totalUnits === 1 ? "" : "es"} (${fullPackages} ${packageNamePlural}${remainingUnits > 0 ? ` + ${remainingUnits} ${unitNamePlural}` : ""})`;
                                })()
                              : `${Math.round(product.stock)} ${product.package_name || "unidades"}`}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                    <Package className="h-16 w-16 text-gray-300 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                      No hay productos disponibles
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      {searchTerm || selectedCategory !== "all"
                        ? "Intenta cambiar los filtros de búsqueda"
                        : "Todos tus productos están sin stock"}
                    </p>
                    {searchTerm.trim() && (
                      <Button
                        onClick={() =>
                          openQuickRegister({ name: searchTerm.trim() })
                        }
                        className="bg-brand hover:bg-brand-hover text-white"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Registrar &quot;{searchTerm.trim()}&quot;
                      </Button>
                    )}
                    {!searchTerm && selectedCategory === "all" && (
                      <Link
                        href="/dashboard/products"
                        className="text-brand hover:text-brand text-sm font-medium underline"
                      >
                        Ver todos los productos
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panel derecho - Carrito. En escritorio sube hasta el borde
            superior (en el POS no hay bandeja de campana/tema/perfil). En el
            celular es un panel que entra desde la derecha (botón lateral). */}
        <div
          id="pos-cart-panel"
          className={cn(
            "space-y-4 order-1 lg:order-2",
            "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:m-0 max-md:w-[92vw] max-md:max-w-md max-md:overflow-y-auto max-md:bg-[var(--shell-canvas)] max-md:px-3 max-md:pb-8 max-md:pt-16 max-md:shadow-2xl max-md:transition-[transform,visibility] max-md:duration-300 max-md:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            !cartOpen && "max-md:invisible max-md:translate-x-full",
          )}
        >
          {/* Encabezado del panel en el celular */}
          <div className="md:hidden absolute inset-x-3 top-3 flex items-center justify-between">
            <p className="text-base font-semibold text-gray-900">Tu venta</p>
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className="flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-medium text-gray-600 ring-1 ring-[var(--shell-line)] hover:bg-white"
            >
              Seguir agregando
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {/* En escritorio la tarjeta no pasa del alto de la pantalla: la lista de
              productos tiene su propio scroll y el total con "Procesar Venta"
              queda siempre a la vista. En pantallas grandes la tarjeta ocupa todo
              el alto disponible: el cobro queda pegado abajo y la lista gana espacio. */}
          <Card
            ref={cartCardRef}
            data-guide="pos-cart"
            style={cartCardHeight ? { height: cartCardHeight } : undefined}
            className="receipt-edge relative rounded-b-none border-b-0 md:flex md:flex-col md:max-h-[calc(100dvh-9rem)] lg:sticky! lg:top-2 lg:max-h-none"
          >
            {/* Nueva venta: en la esquina de la tarjeta para dejar la fila a las pestañas */}
            <button
              type="button"
              onClick={addHeldSale}
              disabled={processing}
              aria-label="Nueva venta"
              title="Nueva venta"
              className="absolute -top-2.5 -right-2.5 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-brand text-white shadow-md ring-2 ring-white transition-transform hover:scale-110 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <Plus className="h-4 w-4" />
            </button>
            <CardHeader className="pb-3 shrink-0">
              {/* Ventas en espera: una pestaña por cliente */}
              {/* Las flechas van en el margen de la tarjeta para dejar todo el ancho a las pestañas */}
              <div className="relative pb-3 mb-1 border-b border-dashed border-gray-300">
                {tabsScroll.overflow && (
                  <button
                    type="button"
                    onClick={() => scrollTabs(-1)}
                    disabled={!tabsScroll.left}
                    aria-label="Ver ventas anteriores"
                    title="Ver ventas anteriores"
                    className="absolute top-[calc(50%-0.375rem)] -translate-y-1/2 -left-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-brand bg-white text-brand shadow-sm hover:bg-brand-light disabled:border-gray-200 disabled:text-gray-300 disabled:shadow-none disabled:hover:bg-white"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={3} />
                  </button>
                )}
                <div
                  ref={tabsScrollRef}
                  role="tablist"
                  aria-label="Ventas abiertas"
                  onScroll={updateTabsScroll}
                  className="flex w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {heldSales.map((sale) => {
                    const isActive = sale.id === activeSaleId;
                    const items = isActive ? cart : sale.cart;
                    const customer = isActive
                      ? selectedCustomer
                      : sale.customer;
                    const count = items.reduce((n, i) => n + i.quantity, 0);
                    const fullLabel =
                      customer?.name ?? `Cliente ${sale.number}`;
                    const canClose =
                      heldSales.length > 1 || items.length > 0 || !!customer;
                    return (
                      <div
                        key={sale.id}
                        data-sale-id={sale.id}
                        className={`flex items-center shrink-0 rounded-lg border text-xs md:text-sm transition-colors ${
                          isActive
                            ? "bg-brand border-brand text-white"
                            : "bg-white border-gray-300 text-gray-700 hover:border-brand"
                        }`}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => switchHeldSale(sale.id)}
                          disabled={processing}
                          title={fullLabel}
                          className={`flex items-center gap-1.5 py-1.5 pl-2.5 ${canClose ? "pr-1" : "pr-2.5"} max-w-36 disabled:cursor-not-allowed`}
                        >
                          <span className="truncate font-medium">
                            {customer ? customer.name.split(" ")[0] : fullLabel}
                          </span>
                          {count > 0 && (
                            <span
                              className={`rounded-full px-1.5 text-[10px] font-bold leading-4 ${
                                isActive
                                  ? "bg-white/25 text-white"
                                  : "bg-brand-light text-brand"
                              }`}
                            >
                              {count}
                            </span>
                          )}
                        </button>
                        {canClose && (
                          <button
                            type="button"
                            onClick={() => closeHeldSale(sale.id)}
                            disabled={processing}
                            aria-label={`Cerrar venta de ${fullLabel}`}
                            title="Cerrar esta venta"
                            className={`mr-1 rounded p-0.5 disabled:cursor-not-allowed ${
                              isActive
                                ? "hover:bg-white/20"
                                : "hover:bg-gray-100"
                            }`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {tabsScroll.overflow && (
                  <button
                    type="button"
                    onClick={() => scrollTabs(1)}
                    disabled={!tabsScroll.right}
                    aria-label="Ver más ventas"
                    title="Ver más ventas"
                    className="absolute top-[calc(50%-0.375rem)] -translate-y-1/2 -right-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-brand bg-white text-brand shadow-sm hover:bg-brand-light disabled:border-gray-200 disabled:text-gray-300 disabled:shadow-none disabled:hover:bg-white"
                  >
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={3} />
                  </button>
                )}
              </div>
              {/* Caja: debajo de las pestañas de ventas (y del botón "+"), con el
                  detalle de la sesión integrado. Sin permiso de caja no se ve. */}
              <CashRegisterControl compact />
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <div ref={cartIconRef} className="relative">
                  <ShoppingCart
                    className="h-4 w-4 md:h-5 md:w-5"
                    style={
                      cartBump
                        ? {
                            animation: "cartBump 0.5s ease forwards",
                            color: "#155dfc",
                          }
                        : {}
                    }
                  />
                  {cart.length > 0 && (
                    <span
                      className={`absolute -top-2 -right-2 bg-brand text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center ${cartBump ? "animate-ping-once" : ""}`}
                    >
                      {cart.reduce((sum, i) => sum + i.quantity, 0)}
                    </span>
                  )}
                </div>
                Carrito ({cart.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="md:flex md:flex-col md:flex-1 md:min-h-0">
              {/* Selector de Cliente */}
              <div data-guide="pos-customer" className="mb-3 pb-3 border-b border-dashed border-gray-300 shrink-0">
                {selectedCustomer ? (
                  <div className="space-y-2">
                    <div className="bg-brand-light/50 border border-brand/40 rounded-lg px-3 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <User className="h-4 w-4 shrink-0 text-brand" />
                          <p className="truncate text-sm font-medium text-brand">
                            {selectedCustomer.name}
                          </p>
                          <span className="shrink-0 text-xs text-brand/80">
                            {selectedCustomer.loyalty_points} pts
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedCustomer(null);
                            setCanRedeem(false);
                            setApplyDiscount(false);
                            setDiscountAmount(0);
                          }}
                          className="h-7 w-7 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Opción de canjear puntos */}
                    {canRedeem && (
                      <div className="bg-brand-light/50 border border-brand/40 rounded-lg p-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={applyDiscount}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setApplyDiscount(checked);

                              if (checked) {
                                const total = cart.reduce((sum, item) => {
                                  const price =
                                    item.effectivePrice ||
                                    item.product.sale_price;
                                  return sum + price * item.quantity;
                                }, 0);
                                const discount = Math.round(
                                  total *
                                    (REWARD_CONSTANTS.DISCOUNT_PERCENTAGE /
                                      100),
                                );
                                setDiscountAmount(discount);
                              } else {
                                setDiscountAmount(0);
                              }
                            }}
                            className="w-4 h-4 text-brand rounded focus:ring-brand"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-brand">
                              Canjear {REWARD_CONSTANTS.POINTS_FOR_DISCOUNT}{" "}
                              puntos por {REWARD_CONSTANTS.DISCOUNT_PERCENTAGE}%
                              de descuento
                            </p>
                            <p className="text-xs text-brand">
                              {applyDiscount
                                ? `Descuento: ${formatCurrency(discountAmount)}`
                                : "Marca para aplicar descuento"}
                            </p>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    {/* Una sola fila: el cliente es opcional y no debe robarle
                        espacio a la lista de productos. */}
                    <button
                      type="button"
                      onClick={() => setShowCustomerSearch(!showCustomerSearch)}
                      aria-expanded={showCustomerSearch}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-brand/60 px-3 py-2 text-left transition-colors hover:bg-brand-light/50"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                        <User className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-sm font-medium text-gray-800">
                        Cliente <span className="font-normal text-gray-500">(opcional)</span>
                      </span>
                      <span className="text-xs font-semibold text-brand">
                        {showCustomerSearch ? "Cerrar" : "Elegir"}
                      </span>
                    </button>

                    {showCustomerSearch && (
                      <div className="mt-2 space-y-2">
                        <Input
                          placeholder="Buscar cliente..."
                          value={customerSearchTerm}
                          onChange={(e) =>
                            setCustomerSearchTerm(e.target.value)
                          }
                          className="text-sm"
                        />

                        {/* Botón para crear nuevo cliente */}
                        {!showNewCustomerForm && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => setShowNewCustomerForm(true)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Crear Nuevo Cliente
                          </Button>
                        )}

                        {/* Formulario de creación de cliente */}
                        {showNewCustomerForm && (
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-gray-700">
                                Nuevo Cliente
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setShowNewCustomerForm(false);
                                  setNewCustomerData({
                                    name: "",
                                    phone: "",
                                    email: "",
                                  });
                                }}
                                className="h-6 w-6 p-0"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                            <Input
                              placeholder="Nombre *"
                              value={newCustomerData.name}
                              onChange={(e) =>
                                setNewCustomerData({
                                  ...newCustomerData,
                                  name: e.target.value,
                                })
                              }
                              className="text-xs h-8"
                            />
                            <Input
                              placeholder="Teléfono *"
                              type="tel"
                              inputMode="numeric"
                              value={newCustomerData.phone}
                              onChange={(e) =>
                                setNewCustomerData({
                                  ...newCustomerData,
                                  phone: e.target.value,
                                })
                              }
                              className="text-xs h-8"
                              required
                            />
                            <Input
                              placeholder="Email *"
                              type="email"
                              value={newCustomerData.email}
                              onChange={(e) =>
                                setNewCustomerData({
                                  ...newCustomerData,
                                  email: e.target.value,
                                })
                              }
                              className="text-xs h-8"
                              required
                            />
                            <Button
                              size="sm"
                              className="w-full text-xs h-8"
                              onClick={handleCreateCustomer}
                            >
                              Crear Cliente
                            </Button>
                          </div>
                        )}

                        {/* Lista de clientes con scroll mejorado */}
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {customers
                            .filter(
                              (c) =>
                                c.name
                                  .toLowerCase()
                                  .includes(customerSearchTerm.toLowerCase()) ||
                                c.phone?.includes(customerSearchTerm) ||
                                c.email
                                  ?.toLowerCase()
                                  .includes(customerSearchTerm.toLowerCase()),
                            )
                            .slice(0, 10)
                            .map((customer) => (
                              <button
                                key={customer.id}
                                onClick={async () => {
                                  setSelectedCustomer(customer);
                                  setShowCustomerSearch(false);
                                  setCustomerSearchTerm("");
                                  setShowNewCustomerForm(false);

                                  // Verificar si el cliente puede canjear puntos
                                  const eligible = await canRedeemDiscount(
                                    customer.id,
                                    getToken,
                                  );
                                  setCanRedeem(eligible);
                                  setApplyDiscount(false);
                                  setDiscountAmount(0);
                                }}
                                className="w-full text-left p-2 hover:bg-gray-100 rounded text-xs"
                              >
                                <p className="font-medium">{customer.name}</p>
                                <p className="text-gray-500">
                                  {customer.phone || customer.email}
                                </p>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1 max-h-[300px] md:max-h-none md:flex-1 md:min-h-[7rem] overflow-y-auto mb-3 md:-mr-2 md:pr-2">
                {cart.length === 0 ? (
                  <p className="text-center text-gray-500 py-6 text-sm">
                    Carrito vacío
                  </p>
                ) : (
                  cart.map((item) => {
                    const price =
                      item.effectivePrice || item.product.sale_price;
                    const unitLabel = item.isUnitSale
                      ? item.product.unit_name || "unidad"
                      : item.product.package_name || "paquete";

                    return (
                      <div
                        key={`${item.product.id}-${item.isUnitSale ? "unit" : "package"}`}
                        className={cn(
                          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 md:flex-nowrap",
                          item.hasOffer
                            ? "bg-brand-light/50 border-brand/60"
                            : "border-gray-300",
                          // Cantidad mayor a 1: resalta para notar un escaneo doble
                          item.quantity > 1 && "bg-amber-50 border-amber-300",
                        )}
                      >
                        <p
                          className="w-full min-w-0 text-sm font-medium leading-snug md:w-auto md:flex-1 md:truncate"
                          title={item.product.name}
                        >
                          {item.product.name}
                          {item.isUnitSale && (
                            <span className="ml-1 text-[10px] text-brand">
                              ({unitLabel})
                            </span>
                          )}
                        </p>
                        <span className="hidden xl:inline font-num text-xs text-gray-500 whitespace-nowrap">
                          {formatCurrency(price)}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            aria-label="Quitar uno"
                            onClick={() =>
                              updateQuantity(item.product.id, -1, item.isUnitSale)
                            }
                            className="flex h-9 w-9 md:h-7 md:w-7 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover cursor-pointer"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Cantidad de ${item.product.name}`}
                            value={item.quantity === 0 ? "" : item.quantity}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value !== "" && !/^\d+$/.test(value)) return;
                              if (value === "") {
                                // Campo vacío mientras se escribe
                                setCart((prev) =>
                                  prev.map((c) =>
                                    c.product.id === item.product.id &&
                                    c.isUnitSale === item.isUnitSale
                                      ? { ...c, quantity: 0 }
                                      : c,
                                  ),
                                );
                              } else {
                                setDirectQuantity(
                                  item.product.id,
                                  parseInt(value),
                                  item.isUnitSale,
                                );
                              }
                            }}
                            onBlur={(e) => {
                              if (
                                e.target.value === "" ||
                                parseInt(e.target.value) === 0
                              ) {
                                setDirectQuantity(
                                  item.product.id,
                                  1,
                                  item.isUnitSale,
                                );
                              }
                            }}
                            className={cn(
                              "h-9 md:h-7 w-10 rounded-md border border-gray-300 text-center text-[16px] md:text-sm font-bold font-num p-0",
                              item.quantity > 1 &&
                                "border-amber-400 text-amber-700",
                            )}
                          />
                          <button
                            type="button"
                            aria-label="Agregar uno"
                            onClick={() =>
                              updateQuantity(item.product.id, 1, item.isUnitSale)
                            }
                            className="flex h-9 w-9 md:h-7 md:w-7 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="flex-1 text-right font-num text-sm font-bold text-brand whitespace-nowrap md:w-20 md:flex-none">
                          {formatCurrency(price * item.quantity)}
                        </span>
                        <button
                          type="button"
                          aria-label="Eliminar del carrito"
                          onClick={() =>
                            removeFromCart(item.product.id, item.isUnitSale)
                          }
                          className="flex h-9 w-9 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md hover:bg-brand-light/50 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 text-brand" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {cart.length > 0 && (
                <>
                  <div className="shrink-0 border-t border-dashed border-gray-300 pt-3 space-y-2">
                    {discountAmount > 0 && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Subtotal:</span>
                          <span>
                            {formatCurrency(
                              cart.reduce((sum, item) => {
                                const price =
                                  item.effectivePrice ||
                                  item.product.sale_price;
                                return sum + price * item.quantity;
                              }, 0),
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm text-brand font-semibold">
                          <span>
                            Descuento ({REWARD_CONSTANTS.DISCOUNT_PERCENTAGE}%):
                          </span>
                          <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between text-base md:text-lg font-bold">
                      <span>Total</span>
                      <span className="font-num text-2xl md:text-3xl text-brand">
                        {formatCurrency(calculateTotal())}
                      </span>
                    </div>

                    <div data-guide="pos-payment" className="flex items-center gap-2">
                      <label htmlFor="pos-payment-method" className="shrink-0 text-xs md:text-sm font-medium">
                        Pago:
                      </label>
                      <select
                        value={paymentMethod}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                          setPaymentMethod(
                            e.target.value as
                              | "efectivo"
                              | "nequi"
                              | "tarjeta"
                              | "transferencia"
                              | "credito",
                          )
                        }
                        id="pos-payment-method"
                        className="flex-1 min-w-0 h-9 rounded-md border border-gray-300 px-3 text-sm"
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="nequi">Nequi</option>
                        {/* <option value="tarjeta">Tarjeta</option> */}
                        {/* <option value="transferencia">Transferencia</option> */}
                        <option value="credito" disabled={!selectedCustomer}>
                          Crédito {!selectedCustomer && "(Requiere cliente)"}
                        </option>
                      </select>
                    </div>

                    {/* Selector de plazo de crédito - solo visible cuando se selecciona crédito */}
                    {paymentMethod === "credito" && (
                      <div className="space-y-1.5 md:space-y-2">
                        <label className="text-xs md:text-sm font-medium">
                          Plazo de Pago:
                        </label>
                        <select
                          value={creditDays}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                            setCreditDays(Number(e.target.value))
                          }
                          className="w-full h-9 md:h-10 rounded-md border border-gray-300 px-3 text-sm"
                        >
                          <option value={7}>7 días</option>
                          <option value={15}>15 días</option>
                          <option value={30}>30 días</option>
                          <option value={45}>45 días</option>
                          <option value={60}>60 días</option>
                        </select>
                      </div>
                    )}

                    <Button
                      data-guide="pos-checkout"
                      className="w-full text-sm md:text-base"
                      size="lg"
                      onClick={() => {
                        // Con Nequi/transferencia, primero mostrar el QR de
                        // pago para que el cliente pague; la venta se procesa
                        // cuando el tendero confirma que recibió el pago.
                        if (
                          paymentMethod === "nequi" ||
                          paymentMethod === "transferencia"
                        ) {
                          setShowQrModal(true);
                        } else {
                          processSale();
                        }
                      }}
                      disabled={processing}
                    >
                      <DollarSign className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                      {processing ? "Procesando..." : "Procesar Venta"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Celular: fondo oscuro detrás del carrito abierto */}
      {cartOpen && (
        <div
          className="cart-overlay-in fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setCartOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Celular: botón lateral que abre el carrito, con cantidad y total */}
      {!cartOpen && (
        <button
          type="button"
          data-guide="pos-cart"
          onClick={() => setCartOpen(true)}
          aria-controls="pos-cart-panel"
          aria-expanded={cartOpen}
          aria-label={`Ver carrito: ${cartItemCount} ${cartItemCount === 1 ? "producto" : "productos"}, ${formatCurrency(calculateTotal())}`}
          className="cart-side-tab fixed right-0 top-1/2 z-40 flex flex-col items-center gap-1.5 rounded-l-2xl bg-brand py-3 pl-2.5 pr-2 text-white shadow-lg md:hidden"
        >
          {/* La key reinicia la animación de "salto" cada vez que cambia la cantidad */}
          <span key={cartItemCount} className={cartItemCount > 0 ? "cart-tab-bump flex flex-col items-center gap-1.5" : "flex flex-col items-center gap-1.5"}>
            <ShoppingCart className="h-5 w-5" />
            {cartItemCount > 0 && (
              <span className="min-w-5 rounded-full bg-white px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-brand">
                {cartItemCount}
              </span>
            )}
          </span>
          <span className="font-num text-[11px] font-semibold leading-none [writing-mode:vertical-rl] rotate-180">
            {cartItemCount > 0 ? formatCurrency(calculateTotal()) : "Carrito"}
          </span>
        </button>
      )}

      {/* Modal de cobro con QR (Nequi/Daviplata/transferencia) */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {userProfile?.payment_qr_url ? (
              <>
                <div className="text-center">
                  <h3 className="text-lg font-bold">Cobrar con QR</h3>
                  <p className="text-sm text-gray-500">
                    Muéstrale este código al cliente
                  </p>
                </div>
                <div className="flex justify-center">
                  <Image
                    src={userProfile.payment_qr_url}
                    alt="QR de pago"
                    width={280}
                    height={280}
                    className="rounded-lg border"
                  />
                </div>
                <div className="text-center bg-brand-light/50 border border-brand/40 rounded-lg py-3">
                  <p className="text-sm text-brand font-medium">
                    El cliente debe pagar
                  </p>
                  <p className="text-3xl font-bold text-brand">
                    {formatCurrency(calculateTotal())}
                  </p>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={processing}
                  onClick={() => {
                    setShowQrModal(false);
                    processSale();
                  }}
                >
                  ✓ El cliente ya pagó — Procesar venta
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowQrModal(false)}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <div className="text-center">
                  <h3 className="text-lg font-bold">
                    No has registrado tu QR de pagos
                  </h3>
                  <p className="text-sm text-gray-600 mt-2">
                    Registra el QR de tu Nequi, Daviplata o cuenta bancaria para
                    mostrárselo al cliente al momento de cobrar. Lo encuentras
                    en la app de tu banco o billetera.
                  </p>
                </div>
                <div className="text-center bg-gray-50 border rounded-lg py-3">
                  <p className="text-sm text-gray-500">Total a cobrar</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(calculateTotal())}
                  </p>
                </div>
                <Link href="/dashboard/config">
                  <Button className="w-full" size="lg">
                    Ir a Configuración y agregar mi QR
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={processing}
                  onClick={() => {
                    setShowQrModal(false);
                    processSale();
                  }}
                >
                  Procesar sin QR (el cliente ya pagó)
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal de Factura */}
      {userProfile && lastSale && (
        <InvoiceModal
          open={showInvoiceModal}
          onOpenChange={setShowInvoiceModal}
          sale={lastSale}
          saleItems={lastSaleItems}
          customer={lastSaleCustomer}
          storeInfo={userProfile}
          cashierName={user?.fullName || undefined}
        />
      )}

      {/* Modal de Selección de Unidades */}
      {selectedProductForUnits && (
        <UnitSelectorModal
          product={selectedProductForUnits}
          isOpen={showUnitSelector}
          onClose={() => {
            setShowUnitSelector(false);
            setSelectedProductForUnits(null);
          }}
          onConfirm={handleUnitSelectorConfirm}
        />
      )}

      <style>{`
        @keyframes cartBump {
          0%   { transform: scale(1); }
          30%  { transform: scale(1.6) rotate(-12deg); }
          60%  { transform: scale(1.3) rotate(8deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes floatUpCard {
          0%   { opacity: 1; transform: translate(-50%, 0) scale(1.1); }
          70%  { opacity: 1; transform: translate(-50%, -55px) scale(1.3); }
          100% { opacity: 0; transform: translate(-50%, -75px) scale(0.9); }
        }
        .floating-plus-one-card {
          position: absolute;
          bottom: 30%;
          left: 50%;
          animation: floatUpCard 0.85s ease-out forwards;
          font-size: 1.6rem;
          font-weight: 900;
          color: #155dfc;
          text-shadow: 0 0 12px rgba(21,93,252,0.5), 0 2px 4px rgba(0,0,0,0.15);
          pointer-events: none;
          z-index: 50;
          user-select: none;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
