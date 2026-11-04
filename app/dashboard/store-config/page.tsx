"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { getUserProfile, updateUserProfile } from "@/lib/cloudflare-api";
import { UserProfile } from "@/lib/types";
import { toast } from "sonner";
import {
  Store,
  Palette,
  Share2,
  MapPin,
  Eye,
  Plus,
  Trash2,
  ImageIcon,
} from "lucide-react";

import dynamic from "next/dynamic";
import { ShippingZonesManager } from "@/components/store-config/shipping-zones-manager";
import { ImageUploadField } from "@/components/store-config/image-upload-field";
import {
  hasStorefrontAccess,
  getStorefrontBlockMessage,
} from "@/lib/storefront-access";
import { StorefrontUserStats } from "@/components/store/storefront-user-stats";
import { StoreReadinessGuide } from "@/components/store-config/store-readiness-guide";
import Swal from "sweetalert2";

const StoreQRGenerator = dynamic(
  () => import("@/components/store-config/store-qr-generator").then(mod => ({ default: mod.StoreQRGenerator })),
  { ssr: false }
);

export default function StoreConfigPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hasAccess, setHasAccess] = useState(false);

  // Estados del formulario
  const [storeSlug, setStoreSlug] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeDescription, setStoreDescription] = useState("");
  const [storeEnabled, setStoreEnabled] = useState(false);

  // Personalización
  const [storePrimaryColor, setStorePrimaryColor] = useState("#3B82F6");
  const [storeSecondaryColor, setStoreSecondaryColor] = useState("#10B981");
  const [storeLogoUrl, setStoreLogoUrl] = useState("");
  const [storeBannerUrl, setStoreBannerUrl] = useState("");
  const [storeBannerImages, setStoreBannerImages] = useState<string[]>([]);
  const [uploadingCarousel, setUploadingCarousel] = useState(false);

  // Redes sociales y contacto
  const [storeWhatsapp, setStoreWhatsapp] = useState("");
  const [storeFacebook, setStoreFacebook] = useState("");
  const [storeInstagram, setStoreInstagram] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [storeCity, setStoreCity] = useState("");
  // Enlace de Google Maps del negocio (para "Cómo llegar" en la tienda)
  const [storeMapsUrl, setStoreMapsUrl] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeEmail, setStoreEmail] = useState("");
  const [storeNequiNumber, setStoreNequiNumber] = useState("");
  // QR de Nequi/Daviplata para que el cliente escanee y pague en la tienda
  const [paymentQrUrl, setPaymentQrUrl] = useState("");


  // Configuración de entrega
  const [storeShippingEnabled, setStoreShippingEnabled] = useState(false);
  const [storePickupEnabled, setStorePickupEnabled] = useState(true);
  // Pedido mínimo predeterminado para todas las tiendas; el tendero puede subirlo
  const DEFAULT_MIN_ORDER = 5000;
  const [storeMinOrder, setStoreMinOrder] = useState(DEFAULT_MIN_ORDER);
  const [storeTerms, setStoreTerms] = useState("");

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await getUserProfile(getToken);
      setProfile(data);

      // Verificar acceso a Tienda Online
      const accessCheck = hasStorefrontAccess(data);
      setHasAccess(accessCheck.hasAccess);

      // Si no tiene acceso, mostrar alerta y redirigir
      if (!accessCheck.hasAccess) {
        const message = getStorefrontBlockMessage(accessCheck.reason);

        Swal.fire({
          icon: "warning",
          title: message.title,
          html: message.html,
          showCancelButton: true,
          confirmButtonText: "Ver Planes de Suscripción",
          cancelButtonText: "Volver al panel de control",
          confirmButtonColor: "#8B5CF6",
          cancelButtonColor: "#6B7280",
          allowOutsideClick: false,
        }).then((result) => {
          if (result.isConfirmed) {
            router.push("/dashboard/subscription");
          } else {
            router.push("/dashboard");
          }
        });

        setLoading(false);
        return;
      }

      // Cargar valores existentes
      setStoreSlug(data.store_slug || "");
      setStoreName(data.store_name || "");
      setStoreDescription(data.store_description || "");
      setStoreEnabled(data.store_enabled || false);
      setStorePrimaryColor(data.store_primary_color || "#3B82F6");
      setStoreSecondaryColor(data.store_secondary_color || "#10B981");
      setStoreLogoUrl(data.store_logo_url || "");
      setStoreBannerUrl(data.store_banner_url || "");
      try {
        const parsed = data.store_banner_images
          ? JSON.parse(data.store_banner_images)
          : [];
        setStoreBannerImages(Array.isArray(parsed) ? parsed : []);
      } catch {
        setStoreBannerImages([]);
      }
      setStoreWhatsapp(data.store_whatsapp || "");
      setStoreFacebook(data.store_facebook || "");
      setStoreInstagram(data.store_instagram || "");
      setStoreAddress(data.store_address || "");
      setStoreCity(data.store_city || "");
      setStoreMapsUrl(data.store_maps_url || "");
      setStorePhone(data.store_phone || "");
      setStoreEmail(data.store_email || "");
      setStoreNequiNumber(data.store_nequi_number || "");
      setPaymentQrUrl(data.payment_qr_url || "");
      setStoreShippingEnabled(data.store_shipping_enabled || false);
      setStorePickupEnabled(data.store_pickup_enabled !== false);
      setStoreMinOrder(data.store_min_order ?? DEFAULT_MIN_ORDER);
      setStoreTerms(data.store_terms || "");
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  };

  const handleCarouselUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (storeBannerImages.length + files.length > 8) {
      toast.error("Máximo 8 imágenes en el carrusel");
      return;
    }
    setUploadingCarousel(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload-image", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al subir imagen");
        uploaded.push(data.secure_url);
      }
      setStoreBannerImages((prev) => [...prev, ...uploaded]);
      toast.success(`${uploaded.length} imagen(es) agregada(s) al carrusel`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir imagen");
    } finally {
      setUploadingCarousel(false);
      e.target.value = "";
    }
  };

  const removeCarouselImage = (index: number) => {
    setStoreBannerImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!profile) return;

    // Validaciones
    if (storeEnabled) {
      if (!storeSlug.trim()) {
        toast.error("El slug de la tienda es requerido");
        return;
      }
      if (!storeName.trim()) {
        toast.error("El nombre de la tienda es requerido");
        return;
      }

      // Validar formato del slug (solo letras, números y guiones)
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(storeSlug)) {
        toast.error(
          "El slug solo puede contener letras minúsculas, números y guiones",
        );
        return;
      }
    }

    // Pedido mínimo: 0 = sin mínimo; cualquier otro valor no puede ser
    // inferior a $5.000 (mínimo obligatorio para todas las tiendas).
    if (storeMinOrder > 0 && storeMinOrder < DEFAULT_MIN_ORDER) {
      toast.error(
        `El pedido mínimo no puede ser menor a $${DEFAULT_MIN_ORDER.toLocaleString("es-CO")} COP`,
      );
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(
        profile.id,
        {
          store_slug: storeSlug.toLowerCase().trim() || undefined,
          store_name: storeName.trim() || undefined,
          store_description: storeDescription.trim() || undefined,
          store_enabled: storeEnabled,
          store_primary_color: storePrimaryColor,
          store_secondary_color: storeSecondaryColor,
          store_logo_url: storeLogoUrl.trim() || undefined,
          store_banner_url: storeBannerUrl.trim() || undefined,
          store_banner_images:
            storeBannerImages.length > 0
              ? JSON.stringify(storeBannerImages)
              : undefined,
          store_whatsapp: storeWhatsapp.trim() || undefined,
          store_facebook: storeFacebook.trim() || undefined,
          store_instagram: storeInstagram.trim() || undefined,
          store_address: storeAddress.trim() || undefined,
          store_city: storeCity.trim() || undefined,
          store_phone: storePhone.trim() || undefined,
          store_email: storeEmail.trim() || undefined,
          store_nequi_number: storeNequiNumber.trim() || undefined,
          payment_qr_url: paymentQrUrl || undefined,
          store_maps_url: storeMapsUrl.trim() || undefined,
          store_shipping_enabled: storeShippingEnabled,
          store_pickup_enabled: storePickupEnabled,
          store_min_order: storeMinOrder,
          store_terms: storeTerms.trim() || undefined,
        },
        getToken,
      );

      toast.success("Configuración guardada exitosamente");
      loadProfile(); // Recargar para obtener datos actualizados
    } catch (error) {
      console.error("Error saving config:", error);
      toast.error(error instanceof Error ? error.message : "Error al guardar configuración");
    } finally {
      setSaving(false);
    }
  };

  const getStoreUrl = () => {
    if (!storeSlug) return null;
    // Usar la URL de producción configurada en variables de entorno
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://tienda-pos.vercel.app";
    return `${baseUrl}/store/${storeSlug}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando configuración...</p>
      </div>
    );
  }

  // Si no tiene acceso, no mostrar el formulario (ya se mostró el modal)
  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Redirigiendo...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Tienda Online</h1>
          <p className="text-gray-500">
            Configura tu tienda para vender por internet
          </p>
        </div>
        <div data-guide="store-save" className="fixed top-[130px] right-6 z-40 flex flex-col items-center gap-2">
          {storeEnabled && storeSlug && (
            <Button
              variant="outline"
              onClick={() => window.open(getStoreUrl()!, "_blank")}
            >
              <Eye className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Vista Previa</span>
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {/* Guía con avance: qué falta para vender, con gráficas animadas */}
      <StoreReadinessGuide
        storeEnabled={storeEnabled}
        storeName={storeName}
        storeSlug={storeSlug}
        storeWhatsapp={storeWhatsapp}
        storeNequiNumber={storeNequiNumber}
        paymentQrUrl={paymentQrUrl}
        storeShippingEnabled={storeShippingEnabled}
        storePickupEnabled={storePickupEnabled}
      />

      {/* Estado de la tienda */}
      <Card data-guide="store-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Estado de la Tienda
          </CardTitle>
          <CardDescription>Activa o desactiva tu tienda online</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex-1">
              <h3 className="font-semibold">
                Tienda Online {storeEnabled ? "Activa" : "Inactiva"}
              </h3>
              <p className="text-sm text-gray-600">
                {storeEnabled
                  ? "Tu tienda está visible para el público"
                  : "Activa tu tienda para que los clientes puedan comprar online"}
              </p>
              {storeEnabled && storeSlug && (
                <p className="text-sm text-brand mt-2 font-mono">
                  {getStoreUrl()}
                </p>
              )}
            </div>
            <Switch checked={storeEnabled} onCheckedChange={setStoreEnabled} />
          </div>
        </CardContent>
      </Card>

      {/* Información básica */}
      <Card data-guide="store-info">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Información Básica
          </CardTitle>
          <CardDescription>Configuración general de tu tienda</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="slug">
                Slug de la Tienda *
                <span className="text-xs text-gray-500 ml-2">(URL única)</span>
              </Label>
              <Input
                id="slug"
                value={storeSlug}
                onChange={(e) => setStoreSlug(e.target.value.toLowerCase())}
                placeholder="mi-tienda"
                className="font-mono"
              />
              <p className="text-xs text-gray-500">
                Solo letras minúsculas, números y guiones. Ejemplo:
                mi-tienda-123
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Nombre de la Tienda *</Label>
              <Input
                id="name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Mi Tienda"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              value={storeDescription}
              onChange={(e) => setStoreDescription(e.target.value)}
              placeholder="Descripción de tu tienda..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="minOrder">
              Pedido Mínimo en Tienda Online (COP)
            </Label>
            <Input
              id="minOrder"
              type="number"
              inputMode="numeric"
              value={storeMinOrder || ""}
              onChange={(e) => setStoreMinOrder(Number(e.target.value) || 0)}
              placeholder="5000"
              min="0"
              step="1000"
            />
            <p className="text-xs text-gray-500">
              Monto mínimo que los clientes deben gastar para completar un
              pedido en la tienda online.
            </p>
            <p className="text-xs text-gray-400 italic">
              💡 El mínimo obligatorio es $5.000 COP. Puedes subirlo si tu
              negocio lo necesita, o ponerlo en 0 para no exigir mínimo.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Personalización */}
      <Card data-guide="store-look">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Personalización
          </CardTitle>
          <CardDescription>Colores e imágenes de tu tienda</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primaryColor">Color Principal</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  id="primaryColor"
                  value={storePrimaryColor}
                  onChange={(e) => setStorePrimaryColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={storePrimaryColor}
                  onChange={(e) => setStorePrimaryColor(e.target.value)}
                  placeholder="#3B82F6"
                  className="flex-1 font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="secondaryColor">Color Secundario</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  id="secondaryColor"
                  value={storeSecondaryColor}
                  onChange={(e) => setStoreSecondaryColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={storeSecondaryColor}
                  onChange={(e) => setStoreSecondaryColor(e.target.value)}
                  placeholder="#10B981"
                  className="flex-1 font-mono"
                />
              </div>
            </div>
          </div>

          <ImageUploadField
            label="Logo de la tienda"
            value={storeLogoUrl}
            onChange={setStoreLogoUrl}
            helpText="Sube el logo desde tu celular o computador (máx. 5MB)."
          />

          <ImageUploadField
            label="Banner de la tienda"
            value={storeBannerUrl}
            onChange={setStoreBannerUrl}
            helpText="Se usa como imagen única si no hay imágenes en el carrusel."
          />

          {/* Carrusel de presentación */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Carrusel de Presentación
                </Label>
                <p className="text-xs text-gray-500 mt-1">
                  Agrega hasta 8 imágenes que se mostrarán como carrusel en tu
                  tienda. Se cambian automáticamente cada 5 segundos.
                </p>
              </div>
              <span className="text-xs text-gray-400">
                {storeBannerImages.length}/8
              </span>
            </div>

            {/* Miniaturas actuales */}
            {storeBannerImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {storeBannerImages.map((url, index) => (
                  <div
                    key={url}
                    className="relative group aspect-video rounded-lg overflow-hidden border"
                  >
                    <img
                      src={url}
                      alt={`Carrusel ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => removeCarouselImage(index)}
                        className="opacity-0 group-hover:opacity-100 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 transition-all"
                        aria-label="Eliminar imagen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {index + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Botón de upload */}
            {storeBannerImages.length < 8 && (
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleCarouselUpload}
                  disabled={uploadingCarousel}
                />
                <div className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 hover:border-gray-400 rounded-lg text-sm text-gray-600 hover:text-gray-800 transition-colors">
                  <Plus className="h-4 w-4" />
                  {uploadingCarousel ? "Subiendo..." : "Agregar imágenes"}
                </div>
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Redes sociales y contacto */}
      <Card data-guide="store-contact">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Redes Sociales y Contacto
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <Input
                id="whatsapp"
                value={storeWhatsapp}
                onChange={(e) => setStoreWhatsapp(e.target.value)}
                placeholder="+57 300 123 4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
                placeholder="(601) 123 4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={storeEmail}
                onChange={(e) => setStoreEmail(e.target.value)}
                placeholder="contacto@mitienda.com"
                type="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nequi">Número Nequi / Cuenta Bancaria</Label>
              <Input
                id="nequi"
                value={storeNequiNumber}
                onChange={(e) => setStoreNequiNumber(e.target.value)}
                placeholder="3001234567 o número de cuenta"
              />
              <p className="text-xs text-gray-500">
                Los clientes usarán este número para realizar pagos
              </p>
            </div>

            <div className="space-y-2">
              <ImageUploadField
                label="Código QR de Nequi"
                value={paymentQrUrl}
                onChange={setPaymentQrUrl}
                helpText="Sube tu QR de Nequi/Daviplata (Nequi: Recibir → Código QR). Los clientes lo escanearán para pagarte en la tienda online."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="facebook">Facebook</Label>
              <Input
                id="facebook"
                value={storeFacebook}
                onChange={(e) => setStoreFacebook(e.target.value)}
                placeholder="https://facebook.com/mitienda"
                type="url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instagram">Instagram</Label>
              <Input
                id="instagram"
                value={storeInstagram}
                onChange={(e) => setStoreInstagram(e.target.value)}
                placeholder="https://instagram.com/mitienda"
                type="url"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ubicación */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Ubicación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                placeholder="Calle 123 # 45-67"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">Ciudad</Label>
              <Input
                id="city"
                value={storeCity}
                onChange={(e) => setStoreCity(e.target.value)}
                placeholder="Bogotá"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maps">Ubicación en Google Maps</Label>
            <Input
              id="maps"
              value={storeMapsUrl}
              onChange={(e) => setStoreMapsUrl(e.target.value)}
              placeholder="https://maps.app.goo.gl/..."
              type="url"
            />
            <p className="text-xs text-gray-500">
              Pega el enlace de tu negocio en Google Maps. Tus clientes verán un
              botón <strong>&quot;Cómo llegar&quot;</strong> que abre la ruta
              directa hacia tu tienda.
            </p>
            <a
              href={
                storeAddress
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${storeAddress} ${storeCity}`.trim(),
                    )}`
                  : "https://www.google.com/maps"
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
            >
              <MapPin className="h-4 w-4" />
              Buscar mi negocio en Google Maps y copiar el enlace
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Opciones de entrega */}
      <Card data-guide="store-delivery">
        <CardHeader>
          <CardTitle>Opciones de Entrega</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-medium">Envío a Domicilio</h4>
              <p className="text-sm text-gray-600">
                Permite que los clientes soliciten envío
              </p>
            </div>
            <Switch
              checked={storeShippingEnabled}
              onCheckedChange={setStoreShippingEnabled}
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-medium">Recogida en Tienda</h4>
              <p className="text-sm text-gray-600">
                Los clientes pueden recoger en tu ubicación
              </p>
            </div>
            <Switch
              checked={storePickupEnabled}
              onCheckedChange={setStorePickupEnabled}
            />
          </div>

        </CardContent>
      </Card>

      {/* Código QR de la tienda */}
      {storeSlug && <StoreQRGenerator storeSlug={storeSlug} storeName={storeName} />}

      {/* Estadísticas de clientes registrados */}
      {storeSlug && profile && (
        <Card>
          <CardHeader>
            <CardTitle>Estadísticas de Clientes</CardTitle>
            <CardDescription>
              Número de clientes registrados en tu tienda
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StorefrontUserStats slug={storeSlug} storeId={profile.id} />
          </CardContent>
        </Card>
      )}

      {/* Términos y condiciones */}
      <Card>
        <CardHeader>
          <CardTitle>Términos y Condiciones</CardTitle>
          <CardDescription>Políticas de tu tienda (opcional)</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={storeTerms}
            onChange={(e) => setStoreTerms(e.target.value)}
            placeholder="Términos y condiciones de tu tienda..."
            rows={6}
          />
        </CardContent>
      </Card>

      {/* Zonas de Envío */}
      <ShippingZonesManager />
    </div>
  );
}
