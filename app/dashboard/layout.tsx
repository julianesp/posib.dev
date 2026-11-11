"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { StoreQuickAccess } from "@/components/dashboard/store-quick-access";
import { PWAInstallPrompt } from "@/components/dashboard/pwa-install-prompt";
import { MonthlyReportModal } from "@/components/dashboard/monthly-report-modal";
import { NewInterfaceAnnouncement } from "@/components/dashboard/new-interface-announcement";
import { WelcomeTour } from "@/components/dashboard/welcome-tour";
import { TrialBanner } from "@/components/subscription/trial-banner";
import { SubscriptionExpiredModal } from "@/components/subscription/expired-modal";
import { ConnectionErrorModal } from "@/components/subscription/connection-error-modal";
import { ExpirationAlert } from "@/components/subscription/expiration-alert";
import { TrialNotificationWrapper } from "@/components/subscription/trial-notification-wrapper";
import { AddonExpiryBanner } from "@/components/subscription/addon-expiry-banner";
import OfflineProvider from "@/components/OfflineProvider";
import {
  evaluateSubscriptionStatus,
  getUserProfileByClerkId,
} from "@/lib/cloudflare-subscription-helpers";
import { SubscriptionStatus } from "@/lib/types";
import { usePageTracking } from "@/lib/hooks/use-analytics";
import { setSelectedTenantId } from "@/lib/cloudflare-api";
import { readStoredAccent, setAccent } from "@/lib/accent";
import { TenantProvider, useTenant } from "@/lib/tenant-context";
import { GuideProvider } from "@/components/guide/GuideProvider";
import styles from "./styles/Layout.module.scss";
import { cn } from "@/lib/utils";

// Escritorio = breakpoint md de Tailwind (donde se ve el sidebar fijo).
const DESKTOP_QUERY = "(min-width: 768px)";
function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

interface UserStore {
  id: string;
  access_type?: string;
}

// Component to add noindex meta tag
function NoIndexMeta() {
  useEffect(() => {
    // Add noindex meta tag to prevent search engine indexing
    const metaRobots = document.createElement("meta");
    metaRobots.name = "robots";
    metaRobots.content = "noindex, nofollow";
    document.head.appendChild(metaRobots);

    return () => {
      // Cleanup on unmount
      document.head.removeChild(metaRobots);
    };
  }, []);

  return null;
}

function DashboardLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { setTenantReady } = useTenant();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Control visual para animaciones (open/closing)
  const [sidebarShown, setSidebarShown] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] =
    useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [expiringAddons, setExpiringAddons] = useState<Array<{
    name: string;
    daysLeft: number;
    expiresAt: string;
  }>>([]);

  // Rastrear automáticamente todas las visitas a páginas
  usePageTracking();

  // La piel del sistema (.app-shell) va también en <body>: los modales y menús
  // que se montan en un portal (Radix, SweetAlert, Clerk) quedan fuera del árbol.
  useEffect(() => {
    document.body.classList.add("app-shell");
    return () => document.body.classList.remove("app-shell");
  }, []);

  useEffect(() => {
    async function checkAccess() {
      if (user) {
        try {
          const token = await getToken();

          // NOTA: NO borramos aquí el selected_tenant_id. Antes se hacía en cada
          // carga "para recargar con el usuario actual", pero eso pisaba la tienda
          // elegida en el StoreSwitcher (no sobrevivía a un refresco) y forzaba
          // volver siempre a la primera tienda. En su lugar, más abajo validamos
          // que el tenant guardado pertenezca a las tiendas del usuario actual: si
          // es suyo lo respetamos; si no (p. ej. otro usuario en el mismo
          // navegador) lo reemplazamos. Así se conserva la elección y se mantiene
          // la protección contra heredar un tenant ajeno.

          // PASO 1: Obtener tiendas accesibles para configurar el tenant_id
          // Esto debe hacerse ANTES de cualquier otra llamada a la API
          let userIsTeamMember = false;
          let teamMemberStores: UserStore[] = [];

          try {
            // Intentar primero el fetch directo al Worker. Si falla (caída
            // transitoria, token, etc.), reintentar vía el route handler interno
            // /api/user-stores, que normaliza la respuesta y usa la misma sesión
            // de Clerk del servidor. Así un fallo puntual del Worker no deja al
            // usuario sin tenant y varado en la pantalla de suscripción.
            let stores: UserStore[] = [];

            const storesResponse = await fetch(
              `${process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL}/api/user-stores`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (storesResponse.ok) {
              const storesData = await storesResponse.json();
              stores = Array.isArray(storesData)
                ? storesData
                : storesData.data || [];
            } else {
              // Reintento por el route handler interno
              const fallbackResponse = await fetch("/api/user-stores");
              if (fallbackResponse.ok) {
                const fallbackData = await fallbackResponse.json();
                stores = Array.isArray(fallbackData)
                  ? fallbackData
                  : fallbackData.data || [];
              }
            }

            if (storesResponse.ok && stores.length === 0) {
              // El Worker respondió bien pero el usuario no tiene tiendas listadas
              // (p. ej. un dueño que aún no configuró el nombre de su tienda). Un
              // tenant guardado aquí sería de OTRA cuenta que usó este navegador:
              // enviarlo da 403 y el perfil no carga ("No pudimos verificar tu
              // sesión") aunque la cuenta solo esté vencida. Se quita para que el
              // Worker use la tienda propia; más abajo se fija con profile.id.
              setSelectedTenantId(null);
            }

            if (stores.length > 0) {
              // Verificar si tiene acceso como team member a alguna tienda
              teamMemberStores = stores.filter(
                (store: UserStore) => store.access_type === "team_member"
              );

              if (teamMemberStores.length > 0) {
                userIsTeamMember = true;
                setIsTeamMember(true);

                // IMPORTANTE: Establecer el tenant_id ANTES de hacer otras llamadas.
                // Respetamos el guardado solo si es una de las tiendas del usuario
                // (así sobrevive el cambio de tienda); si no, tomamos la primera.
                const selectedTenantId = localStorage.getItem("selected_tenant_id");
                const savedIsValid =
                  !!selectedTenantId &&
                  teamMemberStores.some((s) => s.id === selectedTenantId);
                if (!savedIsValid) {
                  localStorage.setItem(
                    "selected_tenant_id",
                    teamMemberStores[0].id
                  );
                }

                // Team members siempre tienen acceso (usan la suscripción del owner)
                setSubscriptionInfo({
                  canAccess: true,
                  status: "active",
                });

                setTenantReady(true);
                setLoading(false);
                return; // Terminar aquí para team members
              } else {
                // Owner: respetar el tenant guardado si es una de sus tiendas
                // (conserva el cambio del StoreSwitcher); si no, usar la propia.
                const savedTenantId = localStorage.getItem("selected_tenant_id");
                const savedIsValid =
                  !!savedTenantId &&
                  stores.some((s: UserStore) => s.id === savedTenantId);
                if (!savedIsValid) {
                  const ownerStore =
                    stores.find((s: UserStore) => s.access_type === "owner") ||
                    stores[0];
                  if (ownerStore) {
                    localStorage.setItem("selected_tenant_id", ownerStore.id);
                  }
                }
              }
            }
          } catch (error) {
            console.error("Error obteniendo tiendas:", error);
          }

          // PASO 2: Si NO es team member, continuar con el flujo normal de owner

          // Asegurarse de que el perfil de usuario existe. No dependemos de su
          // resultado para leer el perfil (init-profile es idempotente y el
          // Worker crea el perfil bajo demanda), así que lo lanzamos en paralelo
          // con la lectura del perfil en lugar de esperar en serie.
          const initProfilePromise = fetch("/api/user/init-profile", {
            method: "POST",
          }).catch((err) => {
            console.warn("Error initializing profile:", err);
          });

          // Esperamos el perfil y el init en paralelo (init no aporta datos, solo
          // garantiza existencia; su fallo ya quedó registrado arriba).
          let [profile] = await Promise.all([
            getUserProfileByClerkId(getToken),
            initProfilePromise,
          ]);

          // Si el perfil no cargó con un tenant guardado, puede ser de otra cuenta
          // de este navegador (el Worker responde 403). Reintentar una vez con la
          // tienda propia antes de mostrar el error de conexión.
          if (!profile && localStorage.getItem("selected_tenant_id")) {
            setSelectedTenantId(null);
            profile = await getUserProfileByClerkId(getToken);
          }

          // Poblar la caché de perfil que lee el Sidebar (PROFILE_CACHE_KEY),
          // para que NO tenga que llamar de nuevo a /api/user/init-profile en el
          // mismo montaje. Formato {profile, at} con timestamp para TTL.
          if (profile) {
            try {
              localStorage.setItem(
                "posib-profile-cache",
                JSON.stringify({ profile, at: Date.now() })
              );
            } catch {
              // Cuota de localStorage llena: no es crítico.
            }
          }

          // Fallback: si user-stores no devolvió tenant, usar el profile.id
          if (profile?.id && !localStorage.getItem("selected_tenant_id")) {
            localStorage.setItem("selected_tenant_id", profile.id);
          }

          // Superadmin solo por el flag de la BD (únicamente admin@neurai.dev
          // lo tiene); nunca por el email de la sesión.
          const isSuperAdminUser = !!profile?.is_superadmin;
          setIsSuperAdmin(isSuperAdminUser);

          // Color del sistema guardado en el perfil de la tienda: así el tendero (y
          // su equipo) lo ven en cualquier dispositivo, no solo donde lo eligió.
          if (profile?.ui_accent && profile.ui_accent !== readStoredAccent()) {
            setAccent(profile.ui_accent);
          }

          // Verificar addons próximos a vencer (solo para owners, no para team members ni superadmin)
          if (profile && !isSuperAdminUser && !userIsTeamMember && profile.subscription_status === 'active') {
            const today = new Date();
            const expiring: Array<{ name: string; daysLeft: number; expiresAt: string }> = [];

            // Verificar addon de IA
            if (profile.has_ai_addon && profile.ai_addon_expires_at) {
              const expiryDate = new Date(profile.ai_addon_expires_at);
              const diffTime = expiryDate.getTime() - today.getTime();
              const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (daysLeft <= 3 && daysLeft >= 0) {
                expiring.push({
                  name: 'Análisis con IA',
                  daysLeft,
                  expiresAt: profile.ai_addon_expires_at
                });
              }
            }

            // Verificar addon de Tienda
            if (profile.has_store_addon && profile.store_addon_expires_at) {
              const expiryDate = new Date(profile.store_addon_expires_at);
              const diffTime = expiryDate.getTime() - today.getTime();
              const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (daysLeft <= 3 && daysLeft >= 0) {
                expiring.push({
                  name: 'Tienda Online',
                  daysLeft,
                  expiresAt: profile.store_addon_expires_at
                });
              }
            }

            // Verificar addon de Email
            if (profile.has_email_addon && profile.email_addon_expires_at) {
              const expiryDate = new Date(profile.email_addon_expires_at);
              const diffTime = expiryDate.getTime() - today.getTime();
              const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (daysLeft <= 3 && daysLeft >= 0) {
                expiring.push({
                  name: 'Email Marketing',
                  daysLeft,
                  expiresAt: profile.email_addon_expires_at
                });
              }
            }

            setExpiringAddons(expiring);
          }

          if (isSuperAdminUser) {
            console.log("🔐 Usuario verificado como Super Admin");
            setSubscriptionInfo({
              canAccess: true,
              status: "active",
            });
          } else {
            // Verificar el estado de suscripción para owners normales.
            // Reutilizamos el perfil ya cargado (evaluateSubscriptionStatus) en
            // lugar de volver a pedirlo con checkSubscriptionStatus.
            const info = await evaluateSubscriptionStatus(profile, getToken);
            setSubscriptionInfo(info);
          }
          setTenantReady(true);
        } catch (error) {
          console.error("Error checking subscription:", error);
          setTenantReady(true); // desbloquear aunque haya error
        } finally {
          setLoading(false);
        }
      }
    }
    checkAccess();
  }, [user]);

  // Permitir acceso a la página de suscripción incluso si está expirado
  const isSubscriptionPage = pathname?.startsWith("/dashboard/subscription");
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
  const floatingHeader = isDesktop && pathname !== "/dashboard";
  // En el Punto de Venta no se muestra la bandeja (campana, tema, ayuda, perfil):
  // el carrito sube a ocupar ese espacio. En escritorio no hay otra cabecera, así
  // que ahí no queda ninguna; en celular se mantiene la barra con el menú.
  const pinnedHeader = floatingHeader && pathname === "/dashboard/pos";

  // Caso "unknown": no pudimos verificar la cuenta por un fallo de red/auth con
  // la API (p. ej. Unauthorized del Worker). NO es una suscripción expirada, así
  // que mostramos un error de conexión reintentable en lugar de empujar a pagar.
  // Se muestra en cualquier página (incluida la de suscripción), porque sin
  // perfil verificado tampoco tiene sentido enseñar los planes.
  if (
    !loading &&
    !isSuperAdmin &&
    !isTeamMember &&
    subscriptionInfo &&
    subscriptionInfo.status === "unknown"
  ) {
    return <ConnectionErrorModal />;
  }

  // Si no puede acceder y no está en la página de suscripción, mostrar modal (excepto superadmin y team members)
  if (
    !loading &&
    !isSuperAdmin &&
    !isTeamMember &&
    subscriptionInfo &&
    !subscriptionInfo.canAccess &&
    !isSubscriptionPage
  ) {
    return <SubscriptionExpiredModal reason={subscriptionInfo.status} />;
  }

  // handlers para animación de apertura/cierre del sidebar móvil
  const openSidebar = () => {
    setSidebarOpen(true);
    // activar clase 'open' en el siguiente tick para que la transición ocurra
    setTimeout(() => setSidebarShown(true), 20);
  };

  const closeSidebar = () => {
    // quitar clase 'open' para iniciar transición de cierre
    setSidebarShown(false);
    // esperar la duración de la transición antes de desmontar
    setTimeout(() => setSidebarOpen(false), 500);
  };

  return (
    <OfflineProvider>
      <GuideProvider nudgesEnabled={!loading && !isSuperAdmin}>
      <NoIndexMeta />
      {/* Modal de notificación de trial - solo se muestra para usuarios en trial (no team members) */}
      {!loading && !isSuperAdmin && !isTeamMember &&
        // Ocultar para la cuenta de demostración (julii1295@gmail.com)
        user?.emailAddresses[0]?.emailAddress !== "julii1295@gmail.com" &&
        <TrialNotificationWrapper />}
      <div className="app-shell flex h-screen overflow-hidden">
        <Sidebar />

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-50 md:hidden bg-black/20 backdrop-blur-sm"
            onClick={closeSidebar}
          >
            <div
              className={`w-80 h-full ${styles.sidebar} ${
                sidebarShown ? styles.open : styles.closing
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar isMobile onLinkClick={closeSidebar} />
            </div>
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden text-gray-900">
          {/* Mostrar banner solo cuando queden 3 días o menos (trial o suscripción activa) */}
          {!loading &&
            !isSuperAdmin &&
            !isTeamMember &&
            subscriptionInfo?.daysLeft !== undefined &&
            subscriptionInfo.daysLeft <= 3 &&
            subscriptionInfo.daysLeft >= 0 &&
            (subscriptionInfo.status === "trial" || subscriptionInfo.status === "active") &&
            // Ocultar para la cuenta de demostración (julii1295@gmail.com)
            user?.emailAddresses[0]?.emailAddress !== "julii1295@gmail.com" && (
              <TrialBanner
                daysLeft={subscriptionInfo.daysLeft}
                subscriptionType={subscriptionInfo.status}
              />
            )}

          {/* Mostrar banner de addons próximos a vencer */}
          {!loading && !isSuperAdmin && !isTeamMember && expiringAddons.length > 0 &&
            // Ocultar para la cuenta de demostración (julii1295@gmail.com)
            user?.emailAddresses[0]?.emailAddress !== "julii1295@gmail.com" && (
            <AddonExpiryBanner addons={expiringAddons} />
          )}

          {/* Barra superior: en móvil siempre; en escritorio solo en el Panel de
              control (lleva el saludo). En las demás páginas los botones flotan
              dentro del contenido para no dejar una franja vacía. */}
          {!floatingHeader && (
            <Header
              onMenuClick={() => {
                if (sidebarOpen) {
                  closeSidebar();
                } else {
                  openSidebar();
                }
              }}
            />
          )}

          <main
            className={cn(
              "flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-gray-50 px-4 pb-6 pt-2 md:px-8 md:pb-10",
              floatingHeader && "md:pt-4",
              pinnedHeader && "relative",
            )}
          >
            {floatingHeader && !pinnedHeader && <Header floating />}

            {/* Alerta de expiración cuando faltan 3 días o menos (no para team members) */}
            {!loading &&
              !isSuperAdmin &&
              !isTeamMember &&
              subscriptionInfo?.daysLeft !== undefined &&
              subscriptionInfo.daysLeft <= 3 &&
              // Ocultar para la cuenta de demostración (julii1295@gmail.com)
              user?.emailAddresses[0]?.emailAddress !== "julii1295@gmail.com" && (
                <div className="mb-4">
                  <ExpirationAlert
                    type={
                      subscriptionInfo.status === "trial"
                        ? "trial"
                        : "subscription"
                    }
                    daysLeft={subscriptionInfo.daysLeft}
                  />
                </div>
              )}

            {children}
          </main>
        </div>

        {/* Acceso directo flotante a la tienda pública (todas las pantallas) */}
        {!isSuperAdmin && <StoreQuickAccess />}

        {/* Invitación a instalar la PWA + bienvenida tras instalar. */}
        {!isSuperAdmin && <PWAInstallPrompt />}

        {/* Informe de ventas del mes anterior: solo el dueño, hasta que lo descargue. */}
        {!loading && !isTeamMember && <MonthlyReportModal />}

        {/* Anuncio de la nueva interfaz y del color por tienda: dueños con cuenta activa o en prueba. */}
        {!loading && !isTeamMember && !isSuperAdmin && subscriptionInfo?.canAccess && (
          <NewInterfaceAnnouncement />
        )}

        {/* Presentación de beneficios para usuarios nuevos (se apaga con "No mostrar" o en Configuración). */}
        {!loading && !isTeamMember && !isSuperAdmin && subscriptionInfo?.canAccess && <WelcomeTour />}
      </div>
      </GuideProvider>
    </OfflineProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TenantProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </TenantProvider>
  );
}
