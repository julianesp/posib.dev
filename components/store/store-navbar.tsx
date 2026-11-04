"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, usePathname } from "next/navigation";
import { useStorefrontUser } from "@/lib/storefront-user-context";
import { StorefrontAuthModal } from "./storefront-auth-modal";
import {
  ShoppingCart,
  Menu,
  X,
  Store,
  Home,
  Package,
  Info,
  User,
  LogOut,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreConfig } from "@/lib/storefront-api";
import {
  CART_UPDATED_EVENT,
  cartItemCount,
  readCart,
} from "@/lib/storefront-cart";

interface StoreNavbarProps {
  config: StoreConfig;
}

export function StoreNavbar({ config }: StoreNavbarProps) {
  const params = useParams();
  const pathname = usePathname();
  const slug = params.slug as string;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // Menú del cliente: se abre al tocarlo (en el celular no hay "hover").
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  // Sube cada vez que el conteo AUMENTA. Sirve de key para re-montar el badge
  // y disparar el "pop"; no se anima al quitar productos.
  const [pop, setPop] = useState(0);
  const prevCountRef = useRef(0);

  const { user, logout, isAuthenticated } = useStorefrontUser();

  useEffect(() => {
    // La primera lectura solo sincroniza el conteo, sin "pop": un carrito ya
    // precargado al entrar no es una acción de "agregar".
    let initialized = false;
    const updateCartCount = () => {
      const next = cartItemCount(readCart(slug));
      if (initialized && next > prevCountRef.current) {
        setPop((p) => p + 1);
      }
      prevCountRef.current = next;
      initialized = true;
      setCartCount(next);
    };

    updateCartCount();

    // "storage" solo se dispara desde otras pestañas; CART_UPDATED_EVENT
    // cubre los cambios hechos en esta misma pestaña (agregar/quitar/vaciar)
    window.addEventListener("storage", updateCartCount);
    window.addEventListener(CART_UPDATED_EVENT, updateCartCount);
    window.addEventListener("focus", updateCartCount);

    return () => {
      window.removeEventListener("storage", updateCartCount);
      window.removeEventListener(CART_UPDATED_EVENT, updateCartCount);
      window.removeEventListener("focus", updateCartCount);
    };
  }, [slug]);

  const primaryColor = config.store_primary_color || "#3B82F6";
  const storeName = config.store_name || "Tienda Online";

  const navigation = [
    { name: "Inicio", href: `/store/${slug}`, icon: Home },
    { name: "Productos", href: `/store/${slug}#productos`, icon: Package },
    { name: "Información", href: `/store/${slug}#info`, icon: Info },
  ];

  const isActive = (href: string) => {
    if (href.includes("#")) {
      return pathname === href.split("#")[0];
    }
    return pathname === href;
  };

  return (
    <nav
      className="sticky top-0 z-50 bg-white shadow-md"
      style={{ borderBottom: `4px solid ${primaryColor}` }}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo y nombre */}
          <Link
            href={`/store/${slug}`}
            className="flex items-center gap-3 group"
          >
            {config.store_logo_url ? (
              <div className="relative w-12 h-12 rounded-full overflow-hidden transition-transform group-hover:scale-105">
                <Image
                  src={config.store_logo_url}
                  alt={storeName}
                  fill
                  className="object-cover"
                />
              </div>
            ) : (
              <div
                className="p-2 rounded-full transition-transform group-hover:scale-110"
                style={{ backgroundColor: `${primaryColor}20` }}
              >
                <Store className="h-6 w-6" style={{ color: primaryColor }} />
              </div>
            )}
            <span className="text-xl font-bold text-gray-900 hidden sm:block">
              {storeName}
            </span>
          </Link>

          {/* Links de navegación - Desktop */}
          <div className="hidden md:flex items-center space-x-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    active ? "font-semibold" : "text-gray-600 hover:bg-gray-100"
                  }`}
                  style={
                    active
                      ? {
                          color: primaryColor,
                          backgroundColor: `${primaryColor}10`,
                        }
                      : {}
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Botones de acción */}
          <div className="flex items-center gap-2">
            {/* Usuario / Login */}
            {isAuthenticated ? (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  style={{ borderColor: primaryColor, color: primaryColor }}
                  onClick={() => setUserMenuOpen((open) => !open)}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                >
                  <User className="h-5 w-5" />
                  <span className="hidden sm:inline ml-2">{user?.name}</span>
                </Button>
                {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg z-50"
                  onMouseLeave={() => setUserMenuOpen(false)}
                >
                  <div className="p-3 border-b text-sm text-gray-600">
                    {user?.email}
                  </div>
                  <Link
                    href={`/store/${slug}/mis-compras`}
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                  >
                    <Receipt className="h-4 w-4" />
                    Mis compras
                  </Link>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-b-lg"
                  >
                    <LogOut className="h-4 w-4" />
                    Cerrar sesión
                  </button>
                </div>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAuthModalOpen(true)}
                style={{ borderColor: primaryColor, color: primaryColor }}
              >
                <User className="h-5 w-5" />
                <span className="hidden sm:inline ml-2">Entrar</span>
              </Button>
            )}

            {/* Carrito */}
            <Link href={`/store/${slug}/cart`}>
              <Button
                variant="outline"
                size="sm"
                className="relative"
                style={{ borderColor: primaryColor, color: primaryColor }}
              >
                <ShoppingCart id="store-cart-icon" className="h-5 w-5" />
                {cartCount > 0 && (
                  <span
                    key={pop}
                    className="cart-badge-pop absolute -top-2 -right-2 h-5 w-5 rounded-full text-white text-xs flex items-center justify-center font-bold"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
                <span className="hidden sm:inline ml-2">Carrito</span>
              </Button>
            </Link>

            {/* Menú hamburguesa - Mobile */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden text-black "
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>

        {/* Menú móvil - Overlay */}
        {isMenuOpen && (
          <>
            {/* Backdrop con blur */}
            <div
              className="fixed inset-0 top-16 backdrop-blur-sm bg-black/20 md:hidden z-40"
              onClick={() => setIsMenuOpen(false)}
            />
            {/* Menú desplegable */}
            <div className="fixed top-16 left-0 right-0 md:hidden bg-white shadow-lg z-50 max-h-[calc(100vh-64px)] overflow-y-auto">
              <div className="px-4 py-4 space-y-2">
                {navigation.map((item, index) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);

                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setIsMenuOpen(false)}
                      className={`flex flex-col items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all animate-in fade-in slide-in-from-top-4 ${
                        active ? "font-semibold" : "text-gray-600 hover:bg-gray-100"
                      }`}
                      style={{
                        ...{
                          animationDelay: `${index * 75}ms`,
                        },
                        ...(active
                          ? {
                              color: primaryColor,
                              backgroundColor: `${primaryColor}10`,
                            }
                          : {}),
                      }}
                    >
                      <Icon className="h-5 w-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Modal de autenticación */}
        <StorefrontAuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      </div>
    </nav>
  );
}
