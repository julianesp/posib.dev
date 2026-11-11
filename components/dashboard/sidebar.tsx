"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Truck,
  BarChart3,
  Tag,
  Settings,
  Scan,
  CreditCard,
  Percent,
  Shield,
  Banknote,
  Brain,
  Receipt,
  Lock,
  Store,
  Mail,
  TrendingUp,
  PiggyBank,
  GripVertical,
  UserCog,
  ChevronLeft,
  Calendar,
  CheckCircle,
  MonitorSmartphone,
  HeartPulse,
} from "lucide-react";
import {
  getUserProfileByClerkId,
  hasAIAccess,
  hasEmailMarketingAccess,
  hasStoreAccess,
} from "@/lib/cloudflare-subscription-helpers";
import { UserProfile, Permission } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { getHiddenModules, getBusinessType } from "@/lib/business-types";

// Menú para Super Administradores (gestión del SaaS)
const superAdminMenuItems = [
  {
    title: "Panel de control general",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Gestión de Tiendas",
    href: "/dashboard/superadmin",
    icon: Shield,
  },
  {
    title: "Usuarios del Sistema",
    href: "/dashboard/admin/users",
    icon: Users,
  },
  {
    title: "Suscripciones",
    href: "/dashboard/admin/subscriptions",
    icon: CreditCard,
  },
  {
    title: "Historial de Cobros",
    href: "/dashboard/admin/billing",
    icon: Banknote,
  },
  {
    title: "Corregir Fechas de Pago",
    href: "/dashboard/admin/fix-payment-dates",
    icon: Calendar,
  },
  {
    title: "Activar Planes",
    href: "/dashboard/admin/activate-plan-manually",
    icon: CheckCircle,
  },
  {
    title: "Reconciliar Pagos ePayco",
    href: "/dashboard/admin/reconciliar-pagos",
    icon: Receipt,
  },
  {
    title: "Analytics del Sistema",
    href: "/dashboard/admin/analytics",
    icon: TrendingUp,
  },
  {
    title: "Salud de las tiendas",
    href: "/dashboard/admin/salud",
    icon: HeartPulse,
  },
  {
    title: "Visitas al sitio",
    href: "/dashboard/admin/visitas",
    icon: MonitorSmartphone,
  },
  {
    title: "Reportes Globales",
    href: "/dashboard/admin/reports",
    icon: BarChart3,
  },
];

// Menú para usuarios normales (gestión de su tienda)
const defaultStoreMenuItems = [
  {
    id: "dashboard",
    title: "Panel de control",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "cajero"],
    permissions: ["view_dashboard"] as const,
  },
  {
    id: "pos",
    title: "Punto de Venta",
    href: "/dashboard/pos",
    icon: ShoppingCart,
    roles: ["admin", "cajero"],
    permissions: ["access_pos"] as const,
  },
  {
    id: "products",
    title: "Productos",
    href: "/dashboard/products",
    icon: Package,
    roles: ["admin", "cajero"],
    permissions: ["view_products"] as const,
  },
  {
    id: "customers",
    title: "Clientes",
    href: "/dashboard/customers",
    icon: Users,
    roles: ["admin", "cajero"],
    permissions: ["view_customers"] as const,
  },
  {
    id: "debtors",
    title: "Deudores",
    href: "/dashboard/debtors",
    icon: Receipt,
    roles: ["admin", "cajero"],
    permissions: ["view_debtors"] as const,
  },
  // {
  //   id: "suppliers",
  //   title: "Proveedores",
  //   href: "/dashboard/suppliers",
  //   icon: Truck,
  //   roles: ["admin"],
  //   permissions: ["view_suppliers"] as const,
  // },
  // {
  //   id: "purchase-stats",
  //   title: "Estadísticas de Compras",
  //   href: "/dashboard/purchase-stats",
  //   icon: TrendingUp,
  //   roles: ["admin"],
  //   permissions: ["view_suppliers"] as const,
  // },
  {
    id: "sales",
    title: "Ventas",
    href: "/dashboard/sales",
    icon: BarChart3,
    roles: ["admin", "cajero"],
    permissions: ["view_sales_history"] as const,
  },
  {
    id: "profitability",
    title: "Rentabilidad",
    href: "/dashboard/rentabilidad",
    icon: PiggyBank,
    // Datos de margen/ganancia: solo para el dueño (admin), no cajeros
    roles: ["admin"],
    permissions: ["view_sales_history"] as const,
  },
  // {
  //   id: "offers",
  //   title: "Ofertas",
  //   href: "/dashboard/offers",
  //   icon: Percent,
  //   roles: ["admin"],
  //   permissions: ["view_offers"] as const,
  // },
  {
    id: "store-config",
    title: "Tienda Online",
    href: "/dashboard/store-config",
    icon: Store,
    roles: ["admin"],
    permissions: ["access_online_store"] as const,
    requiresAddon: "store" as const,
  },
  {
    id: "web-orders",
    title: "Pedidos Web",
    href: "/dashboard/web-orders",
    icon: ShoppingCart,
    roles: ["admin"],
    permissions: ["manage_online_orders"] as const,
    requiresAddon: "store" as const,
  },
  {
    id: "inventory",
    title: "Inventario",
    href: "/dashboard/inventory",
    icon: Scan,
    roles: ["admin"],
    permissions: ["view_inventory"] as const,
  },
  {
    id: "analytics",
    title: "Análisis IA",
    href: "/dashboard/analytics",
    icon: Brain,
    roles: ["admin"],
    permissions: ["access_ai_insights"] as const,
    requiresAddon: "ai" as const,
  },
  {
    id: "email-settings",
    title: "Email Marketing",
    href: "/dashboard/email-settings",
    icon: Mail,
    roles: ["admin"],
    permissions: ["access_email_marketing"] as const,
    requiresAddon: "email" as const,
  },
  // {
  //   title: "Gestión de Equipo",
  //   href: "/dashboard/team",
  //   icon: UserCog,
  //   roles: ["admin"],
  //   ownerOnly: true,
  // },
];

interface SidebarProps {
  isMobile?: boolean;
  onLinkClick?: () => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256; // 16rem = 256px
const COLLAPSED_WIDTH = 64; // Ancho cuando está colapsado
const SIDEBAR_ANIMATION_MS = 300; // = duration-300 de la transición del ancho
const STORAGE_KEY = "sidebar-width";
const COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
const MENU_ORDER_STORAGE_KEY = "sidebar-menu-order";
// Último perfil conocido, para no dejar el menú sin opciones cuando el
// dispositivo está sin conexión y /api/user/init-profile falla.
const PROFILE_CACHE_KEY = "posib-profile-cache";

export function Sidebar({ isMobile = false, onLinkClick }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useUser();
  const { isOwner, can, loading: permissionsLoading } = usePermissions();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [hasAI, setHasAI] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [hasStore, setHasStore] = useState(false);

  // Estado para el ancho del sidebar
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // El ancho cambia de inmediato (y se anima); el contenido pasa a la vista
  // compacta al terminar de cerrarse, para que los íconos no salten a mitad.
  const [collapsedView, setCollapsedView] = useState(false);
  // Solo se anima tras un clic: al cargar con el estado guardado no hay transición.
  const [animateWidth, setAnimateWidth] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Estado para el orden del menú (drag and drop)
  const [storeMenuItems, setStoreMenuItems] = useState(defaultStoreMenuItems);
  const [draggedItem, setDraggedItem] = useState<number | null>(null);

  // Cargar el ancho guardado y el estado de colapsado del localStorage
  useEffect(() => {
    if (!isMobile) {
      const savedWidth = localStorage.getItem(STORAGE_KEY);
      if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
          setSidebarWidth(width);
        }
      }

      const savedCollapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (savedCollapsed === "true") {
        setIsCollapsed(true);
        setCollapsedView(true);
      }

      // Cargar orden del menú guardado
      const savedOrder = localStorage.getItem(MENU_ORDER_STORAGE_KEY);
      if (savedOrder) {
        try {
          const orderIds = JSON.parse(savedOrder) as string[];
          // Reordenar items según el orden guardado
          const orderedItems = [...defaultStoreMenuItems].sort((a, b) => {
            const indexA = orderIds.indexOf(a.id);
            const indexB = orderIds.indexOf(b.id);
            // Si no está en el orden guardado, poner al final
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          });
          setStoreMenuItems(orderedItems);
        } catch (error) {
          console.error('Error loading menu order:', error);
        }
      }
    }
  }, [isMobile]);

  // Guardar el ancho y estado de colapsado en localStorage cuando cambia
  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem(STORAGE_KEY, sidebarWidth.toString());
      localStorage.setItem(COLLAPSED_STORAGE_KEY, isCollapsed.toString());
    }
  }, [sidebarWidth, isCollapsed, isMobile]);

  // Función para alternar el estado de colapsado
  const toggleCollapse = () => {
    const next = !isCollapsed;
    setAnimateWidth(true);
    setIsCollapsed(next);
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    if (next) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      collapseTimer.current = setTimeout(
        () => setCollapsedView(true),
        reduceMotion ? 0 : SIDEBAR_ANIMATION_MS,
      );
    } else {
      // Al abrir, los textos aparecen ya y la barra los va descubriendo
      setCollapsedView(false);
    }
  };

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    [],
  );

  // Manejar el redimensionamiento
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    },
    [isResizing],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Handlers para drag and drop del menú
  const handleDragStart = (index: number) => {
    setDraggedItem(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === index) return;

    const items = [...storeMenuItems];
    const draggedItemContent = items[draggedItem];
    items.splice(draggedItem, 1);
    items.splice(index, 0, draggedItemContent);

    setDraggedItem(index);
    setStoreMenuItems(items);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    // Guardar el nuevo orden en localStorage
    const orderIds = storeMenuItems.map(item => item.id);
    localStorage.setItem(MENU_ORDER_STORAGE_KEY, JSON.stringify(orderIds));
  };

  useEffect(() => {
    // Aplica un perfil a todos los estados del menú.
    const applyProfile = (profile: UserProfile) => {
      setIsSuperAdmin(profile.is_superadmin || false);
      setUserProfile(profile);
      setHasAI(hasAIAccess(profile));
      setHasEmail(hasEmailMarketingAccess(profile));
      setHasStore(hasStoreAccess(profile));
    };

    async function checkSuperAdmin() {
      if (!user) return;

      // El layout del dashboard ya llama a /api/user/init-profile al montar y
      // guarda el perfil en PROFILE_CACHE_KEY. Si esa caché es fresca, la
      // reusamos y evitamos una SEGUNDA llamada idéntica al servidor (que a su
      // vez lee la tabla user_profiles en D1). Esto duplicaba el consumo de D1
      // en cada carga del dashboard.
      try {
        const cached = localStorage.getItem(PROFILE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          // Soportar tanto el formato nuevo {profile, at} como el viejo (perfil
          // plano) por compatibilidad con cachés ya guardadas.
          const profile = parsed?.profile ?? parsed;
          const at = parsed?.at ?? 0;
          if (profile && Date.now() - at < 60_000) {
            applyProfile(profile);
            return; // Caché fresca: no llamamos al API.
          }
        }
      } catch {
        // Caché corrupta: seguimos al fetch.
      }

      try {
        // Sin caché fresca: pedir el perfil al servidor.
        const response = await fetch("/api/user/init-profile", {
          method: "POST",
        });
        const data = await response.json();

        if (data.success && data.profile) {
          applyProfile(data.profile);
          try {
            localStorage.setItem(
              PROFILE_CACHE_KEY,
              JSON.stringify({ profile: data.profile, at: Date.now() })
            );
          } catch {
            // Cuota de localStorage llena u otro error: no es crítico.
          }
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
        // Sin conexión: usar el último perfil cacheado (aunque esté viejo) para
        // no dejar el menú sin opciones.
        try {
          const cached = localStorage.getItem(PROFILE_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            const profile = parsed?.profile ?? parsed;
            if (profile) applyProfile(profile);
          }
        } catch {
          // Sin caché disponible: se deja el estado por defecto.
        }
      }
    }
    checkSuperAdmin();
  }, [user]);

  // Escuchar cambios en el caché del perfil (ej: cuando el usuario cambia
  // el tipo de negocio desde la página de suscripción sin recargar).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PROFILE_CACHE_KEY || !e.newValue) return;
      try {
        const profile = JSON.parse(e.newValue);
        setUserProfile(profile);
        setHasAI(hasAIAccess(profile));
        setHasEmail(hasEmailMarketingAccess(profile));
        setHasStore(hasStoreAccess(profile));
      } catch { /* valor corrupto */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Filtrar items del menú según permisos
  const getFilteredMenuItems = () => {
    // IMPORTANTE: No filtrar hasta que termine de cargar los permisos
    // Si filtramos mientras loading=true, currentUser será null y no se mostrará nada
    if (permissionsLoading) {
      return [];
    }

    if (isSuperAdmin) return superAdminMenuItems;

    // Módulos ocultos según el tipo de negocio (abarrotes, papelería, etc.).
    // Si el perfil aún no cargó, no ocultamos nada (getHiddenModules devuelve
    // los de 'abarrotes' por defecto, que es la tienda completa).
    const hiddenModules = getHiddenModules(userProfile?.business_type);
    const bt = getBusinessType(userProfile?.business_type);

    const filtered = storeMenuItems
      // Aplicar vocabulary y feature flags antes de filtrar
      .map((item) => {
        if (item.id === "products") {
          return { ...item, title: bt.vocabulary.itemPlural };
        }
        return item;
      })
      .filter((item) => {
        // Ocultar Deudores si el negocio no maneja fiado
        if (item.id === "debtors" && !bt.features.showFiado) return false;

        // Ocultar módulos que no aplican a este tipo de negocio
        if (hiddenModules.includes(item.id as (typeof hiddenModules)[number])) {
          return false;
        }

      // Si es solo para owners y el usuario no es owner, ocultar
      if ((item as { ownerOnly?: boolean }).ownerOnly && !isOwner) {
        return false;
      }

      // Si requiere un permiso específico, verificarlo
      if (item.permissions && item.permissions.length > 0) {
        // El owner siempre tiene acceso
        if (isOwner) {
          // IMPORTANTE: NO ocultar los addons, solo mostrarlos con candado
          // Los usuarios deben poder VER los addons para saber que existen y comprarlos
          // El candado se muestra automáticamente en las líneas 621-654
          return true;
        }
        // Para team members, verificar permisos
        const hasPermission = item.permissions.some((permission) => can(permission as Permission));
        return hasPermission;
      }

      // Si no tiene permisos definidos, SOLO mostrar a owners
      // Esto evita que team members vean items sin restricciones de permisos
      const showToOwner = isOwner;
      return showToOwner;
    });

    return filtered;
  };

  const menuItems = getFilteredMenuItems();

  // Combinar todos los items para móvil
  const allMenuItemsForMobile = [
    ...menuItems,
    // Solo mostrar Suscripción y Configuración para owners (no para team members)
    ...(!isSuperAdmin && isOwner
      ? [
          {
            title: "Suscripción",
            href: "/dashboard/subscription",
            icon: CreditCard,
            roles: ["admin"] as string[],
          },
        ]
      : []),
    ...(isOwner
      ? [
          {
            title: "Configuración",
            href: "/dashboard/config",
            icon: Settings,
            roles: ["admin"] as string[],
          },
        ]
      : []),
  ];

  // Ancho actual del menú como variable CSS (--sidebar-w) para que los botones
  // flotantes de la izquierda (p. ej. WhatsApp de soporte) queden junto a él.
  useEffect(() => {
    if (isMobile) return;
    document.documentElement.style.setProperty(
      "--sidebar-w",
      `${isCollapsed ? COLLAPSED_WIDTH : sidebarWidth}px`,
    );
  }, [isMobile, isCollapsed, sidebarWidth]);

  // Mostrar sidebar en pantallas >= 768px (md breakpoint)
  const sidebarClasses = isMobile
    ? "flex w-full md:w-64 flex-col bg-[var(--shell-rail)] text-gray-700 h-full shadow-2xl"
    : "hidden md:flex flex-col bg-[var(--shell-rail)] text-gray-700 flex-shrink-0 relative border-r border-[var(--shell-line)]";

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        sidebarClasses,
        animateWidth &&
          !isResizing &&
          "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
      )}
      style={
        isMobile
          ? undefined
          : {
              width: isCollapsed ? `${COLLAPSED_WIDTH}px` : `${sidebarWidth}px`,
            }
      }
    >
      {/* Header - Solo visible en desktop */}
      <div
        className={cn(
          "hidden md:flex h-16 items-center gap-2 overflow-hidden border-b border-[var(--shell-line)] transition-[padding] duration-300 motion-reduce:transition-none",
          isCollapsed ? "justify-center px-3" : "justify-between px-6",
        )}
      >
        {!collapsedView && (
          <div className="sidebar-label-in min-w-0 overflow-hidden">
            {isSuperAdmin ? (
              <h1 className="text-xl font-bold">Admin Panel</h1>
            ) : (
              <Image
                src="https://pub-ea40242d92ce470fbb6e43d46f01cefe.r2.dev/images/logo.png"
                alt="posib.dev"
                width={120}
                height={40}
                className="h-10 w-auto max-w-none"
                priority
              />
            )}
          </div>
        )}

        {/* Botón de colapsar/expandir: borde y fondo con el color de la tienda */}
        <button
          type="button"
          onClick={toggleCollapse}
          className={cn(
            "sidebar-collapse-btn shrink-0 p-2 rounded-xl active:scale-90",
            !collapsedView && "ml-auto",
          )}
          aria-label={isCollapsed ? "Expandir menú" : "Colapsar menú"}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? "Expandir menú" : "Colapsar menú"}
        >
          <ChevronLeft
            className={cn(
              "h-5 w-5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              isCollapsed && "rotate-180",
            )}
          />
        </button>
      </div>

      {/* Header móvil */}
      <div className="flex md:hidden h-16 items-center justify-center border-b border-[var(--shell-line)] relative">
        {isSuperAdmin ? (
          <h1 className="text-xl font-bold">Admin Panel</h1>
        ) : (
          <Image
            src="https://pub-ea40242d92ce470fbb6e43d46f01cefe.r2.dev/images/logo.png"
            alt="posib.dev"
            width={120}
            height={40}
            className="h-10 w-auto"
            priority
          />
        )}

        {/* Botón de cerrar (solo móvil) */}
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={onLinkClick}
          className="absolute -right-12 top-3 md:hidden w-11 h-11 rounded-xl bg-white text-gray-800 shadow-lg ring-1 ring-[var(--shell-line)] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="sr-only">Cerrar menú</span>
          {/* X icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Layout Desktop - Lista vertical */}
      <nav className="hidden md:flex flex-1 flex-col space-y-1 px-3 py-4 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {menuItems.map((item, index) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
              (item.href !== "/dashboard" && pathname?.startsWith(item.href + "/"));
          const isAnalytics = item.href === "/dashboard/analytics";
          const isEmailMarketing = item.href === "/dashboard/email-settings";
          const isStoreConfig = item.href === "/dashboard/store-config";
          const isWebOrders = item.href === "/dashboard/web-orders";

          return (
            <div
              key={item.href}
              draggable={!isSuperAdmin}
              onDragStart={() => !isSuperAdmin && handleDragStart(index)}
              onDragOver={(e) => !isSuperAdmin && handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                "relative group",
                draggedItem === index && "opacity-50"
              )}
            >
              <Link
                href={item.href}
                onClick={onLinkClick}
                title={collapsedView ? item.title : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 relative",
                  isActive
                    ? "bg-white text-gray-900 ring-1 ring-[var(--shell-line)] shadow-[var(--shell-shadow)] before:absolute before:-left-3 before:inset-y-2 before:w-1 before:rounded-r-full before:bg-brand"
                    : "text-gray-600 hover:bg-white hover:text-gray-900",
                  collapsedView && "justify-center",
                )}
              >
                {/* Drag handle - solo mostrar para usuarios normales */}
                {!isSuperAdmin && !collapsedView && (
                  <GripVertical className="h-4 w-4 -ml-1 flex-shrink-0 cursor-move opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity" />
                )}
                <Icon
                  className={cn(
                    "h-5 w-5 transition-colors",
                    isActive ? "text-brand" : "text-gray-400 group-hover:text-gray-700",
                    collapsedView && "shrink-0",
                  )}
                />
              {!collapsedView && (
                <>
                  <span className="sidebar-label-in flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
                    {item.title}
                  </span>
                  {isAnalytics && userProfile && (
                    <>
                      {userProfile.subscription_status === "trial" && (
                        <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                          Gratis
                        </span>
                      )}
                      {!hasAI &&
                        userProfile.subscription_status !== "trial" && (
                          <Lock className="h-4 w-4 text-gray-400" />
                        )}
                    </>
                  )}
                  {isEmailMarketing && userProfile && (
                    <>
                      {userProfile.subscription_status === "trial" && (
                        <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                          Gratis
                        </span>
                      )}
                      {!hasEmail &&
                        userProfile.subscription_status !== "trial" && (
                          <Lock className="h-4 w-4 text-gray-400" />
                        )}
                    </>
                  )}
                  {(isStoreConfig || isWebOrders) && userProfile && (
                    <>
                      {userProfile.subscription_status === "trial" && (
                        <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                          Gratis
                        </span>
                      )}
                      {!hasStore &&
                        userProfile.subscription_status !== "trial" && (
                          <Lock className="h-4 w-4 text-gray-400" />
                        )}
                    </>
                  )}
                </>
              )}

                {/* Tooltip cuando está colapsado */}
                {collapsedView && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                    {item.title}
                  </div>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Layout Móvil - Grid de 2 columnas con cuadrados */}
      <nav className="md:hidden flex-1 overflow-y-auto overflow-x-hidden px-2 custom-scrollbar">
        <div className="grid grid-cols-2 gap-2 w-full">
          {allMenuItemsForMobile.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname?.startsWith(item.href + "/"));
            const isAnalytics = item.href === "/dashboard/analytics";
            const isEmailMarketing = item.href === "/dashboard/email-settings";
            const isStoreConfig = item.href === "/dashboard/store-config";
            const isWebOrders = item.href === "/dashboard/web-orders";

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onLinkClick}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-2xl p-4 aspect-square text-sm font-medium transition-colors relative",
                  isActive
                    ? "bg-white text-gray-900 ring-1 ring-[var(--shell-line)] shadow-[var(--shell-shadow)] [&>svg]:text-brand"
                    : "text-gray-600 hover:bg-white hover:text-gray-900",
                )}
              >
                <Icon className="h-8 w-8" />
                <span className="text-xs text-center leading-tight">
                  {item.title}
                </span>
                {isAnalytics && userProfile && (
                  <>
                    {userProfile.subscription_status === "trial" && (
                      <span className="absolute top-1.5 right-1.5 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                        Gratis
                      </span>
                    )}
                    {!hasAI && userProfile.subscription_status !== "trial" && (
                      <Lock className="absolute top-1 right-1 h-3 w-3 text-gray-400" />
                    )}
                  </>
                )}
                {isEmailMarketing && userProfile && (
                  <>
                    {userProfile.subscription_status === "trial" && (
                      <span className="absolute top-1.5 right-1.5 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                        Gratis
                      </span>
                    )}
                    {!hasEmail &&
                      userProfile.subscription_status !== "trial" && (
                        <Lock className="absolute top-1 right-1 h-3 w-3 text-gray-400" />
                      )}
                  </>
                )}
                {(isStoreConfig || isWebOrders) && userProfile && (
                  <>
                    {userProfile.subscription_status === "trial" && (
                      <span className="absolute top-1.5 right-1.5 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                        Gratis
                      </span>
                    )}
                    {!hasStore &&
                      userProfile.subscription_status !== "trial" && (
                        <Lock className="absolute top-1 right-1 h-3 w-3 text-gray-400" />
                      )}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer Desktop */}
      <div className={cn("hidden md:block px-3 py-4 border-t border-[var(--shell-line)] space-y-1", !collapsedView && "overflow-hidden")}>
        {!isSuperAdmin && (
          <Link
            href="/dashboard/subscription"
            onClick={onLinkClick}
            title={collapsedView ? "Suscripción" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors relative group",
              pathname === "/dashboard/subscription" ||
                pathname?.startsWith("/dashboard/subscription/")
                ? "bg-white text-gray-900 ring-1 ring-[var(--shell-line)] shadow-[var(--shell-shadow)] [&>svg]:text-brand"
                : "text-gray-600 hover:bg-white hover:text-gray-900",
              collapsedView && "justify-center",
            )}
          >
            <CreditCard className="h-5 w-5 shrink-0" />
            {!collapsedView && <span className="sidebar-label-in whitespace-nowrap">Suscripción</span>}
            {collapsedView && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                Suscripción
              </div>
            )}
          </Link>
        )}
        <Link
          href="/dashboard/config"
          onClick={onLinkClick}
          title={collapsedView ? "Configuración" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors relative group",
            pathname === "/dashboard/config" ||
              pathname?.startsWith("/dashboard/config/")
              ? "bg-white text-gray-900 ring-1 ring-[var(--shell-line)] shadow-[var(--shell-shadow)] [&>svg]:text-brand"
              : "text-gray-600 hover:bg-white hover:text-gray-900",
            collapsedView && "justify-center",
          )}
        >
          <Settings className="h-5 w-5 shrink-0" />
          {!collapsedView && <span className="sidebar-label-in whitespace-nowrap">Configuración</span>}
          {collapsedView && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
              Configuración
            </div>
          )}
        </Link>
      </div>

      {/* Handle de redimensionamiento - Solo visible en desktop y cuando NO está colapsado */}
      {!isMobile && !isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            "absolute top-0 -right-px w-1.5 h-full cursor-col-resize bg-transparent hover:bg-brand/40 transition-colors duration-200 group",
            isResizing && "bg-brand border-brand",
          )}
          title="Arrastrar para redimensionar"
        >
          {/* Indicador visual permanente con tooltip */}
          <div
            className={cn(
              "absolute right-0 top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-200 pointer-events-none",
              "opacity-60 group-hover:opacity-100 group-hover:scale-125",
              isResizing && "opacity-100 scale-125",
            )}
          >
            <GripVertical
              className={cn(
                "w-5 h-5 transition-colors",
                isResizing
                  ? "text-brand/80"
                  : "text-gray-400 group-hover:text-brand/80",
              )}
            />
          </div>

          {/* Tooltip informativo */}
          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity shadow-xl border border-gray-700">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-brand/80" />
              <span>Arrastrar para redimensionar</span>
            </div>
            <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1">
              <div className="border-8 border-transparent border-r-gray-900"></div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
