"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { SupportWhatsAppButton } from "@/components/help/SupportWhatsAppButton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Settings,
  Save,
  Plus,
  Trash2,
  Award,
  Info,
  MessageCircle,
  Brain,
  Eye,
  EyeOff,
  ExternalLink,
  Gift,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { LoyaltySettings, LoyaltyTier } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { AutoReportsConfig } from "@/components/config/auto-reports-config";
import { PaymentQrConfig } from "@/components/config/payment-qr-config";
import { TelegramConfig } from "@/components/config/telegram-config";
import { DebtRemindersConfig } from "@/components/config/debt-reminders-config";
import { PartnershipConfig } from "@/components/config/partnership-config";
import { GoogleDriveBackupConfig } from "@/components/config/google-drive-backup-config";
import { AccentConfig } from "@/components/config/accent-config";
import PosReviewCard from "@/components/dashboard/PosReviewCard";
import { landingConfig } from "@/lib/landing-config";
import { useAuth } from "@clerk/nextjs";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://tienda-pos-api.julii1295.workers.dev';

export default function ConfigPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);

  // Estado para la API Key de Gemini
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [savingGeminiKey, setSavingGeminiKey] = useState(false);

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [loyaltyRes, token] = await Promise.all([
        fetch("/api/loyalty-settings"),
        getToken(),
      ]);

      if (loyaltyRes.ok) {
        const data = await loyaltyRes.json();
        setSettings(data);
        setEnabled(data.enabled);
        setTiers(data.tiers);
      } else {
        toast.error("Error al cargar configuración");
      }

      // Cargar gemini_api_key del perfil
      if (token) {
        const profileRes = await fetch(`${WORKER_URL}/api/user-profiles/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          const key = profileData.data?.gemini_api_key || profileData.gemini_api_key || "";
          setGeminiApiKey(key);
        }
      }
    } catch (error) {
      console.error("Error loading settings:", error);
      toast.error("Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGeminiKey = async () => {
    setSavingGeminiKey(true);
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/api/user-profiles/me`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gemini_api_key: geminiApiKey.trim() || null }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      toast.success("API Key de Gemini guardada");
    } catch {
      toast.error("Error al guardar la API Key");
    } finally {
      setSavingGeminiKey(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    // Validar que los tiers no tengan rangos superpuestos
    const sortedTiers = [...tiers].sort((a, b) => a.min_amount - b.min_amount);
    for (let i = 0; i < sortedTiers.length - 1; i++) {
      if (sortedTiers[i].max_amount >= sortedTiers[i + 1].min_amount) {
        toast.error("Los rangos de montos no pueden superponerse");
        return;
      }
    }

    try {
      setSaving(true);

      const response = await fetch("/api/loyalty-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled,
          tiers,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        toast.success("Configuración guardada exitosamente");
      } else {
        const error = await response.json();
        toast.error(error.error || "Error al guardar configuración");
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Error al guardar configuración");
    } finally {
      setSaving(false);
    }
  };

  const handleAddTier = () => {
    const lastTier = tiers[tiers.length - 1];
    const newMin = lastTier ? lastTier.max_amount + 1 : 0;

    setTiers([
      ...tiers,
      {
        min_amount: newMin,
        max_amount: newMin + 49999,
        points: 5,
        name: "Nuevo nivel",
      },
    ]);
  };

  const handleRemoveTier = (index: number) => {
    if (tiers.length <= 1) {
      toast.error("Debe haber al menos un nivel");
      return;
    }
    setTiers(tiers.filter((_, i) => i !== index));
  };

  const handleUpdateTier = (
    index: number,
    field: keyof LoyaltyTier,
    value: LoyaltyTier[keyof LoyaltyTier],
  ) => {
    const newTiers = [...tiers];
    newTiers[index] = {
      ...newTiers[index],
      [field]: value,
    };
    setTiers(newTiers);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando configuración...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Soporte por WhatsApp: abajo a la izquierda (a la derecha está el acceso a la tienda) */}
      <SupportWhatsAppButton message="Hola, tengo una pregunta sobre mi configuración" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-8 w-8 text-brand" />
          <div>
            <h1 className="text-3xl font-bold">Configuración</h1>
            <p className="text-gray-500">
              Administra el sistema de puntos de lealtad
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || !settings}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Guardando..." : "Guardar Cambios"}
        </Button>
      </div>

      {/* Color del sistema elegido por el tendero */}
      <div id="color-sistema">
        <AccentConfig />
      </div>

      {/* Buzón de Sugerencias */}
      <Card className="border-brand/40 bg-brand-light/50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-6 w-6 text-brand" />
              <div>
                <h3 className="font-semibold text-brand">
                  💡 ¿Tienes ideas para mejorar?
                </h3>
                <p className="text-sm text-brand">
                  Tus sugerencias son valiosas para nosotros. Envía tus comentarios directamente al desarrollador.
                </p>
              </div>
            </div>
            <Button
              onClick={() => {
                const message = encodeURIComponent(
                  `Hola! Tengo una sugerencia para mejorar el sistema POS:\n\n[Escribe tu sugerencia aquí]`
                );
                // Número de WhatsApp del desarrollador
                const developerPhone = "573174503604"; // Reemplaza con tu número
                window.open(
                  `https://wa.me/${developerPhone}?text=${message}`,
                  "_blank"
                );
              }}
              className="bg-brand hover:bg-brand-hover text-white"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Enviar al Desarrollador
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reseña del sistema POS con estrellas */}
      <PosReviewCard />

      {/* QR de pagos para cobrar en el POS */}
      <div data-guide="config-qr">
        <PaymentQrConfig />
      </div>

      {/* Alertas por Telegram (productos próximos a vencer) */}
      <div data-guide="config-telegram">
        <TelegramConfig />
      </div>

      {/* Recordatorios de fiado (clientes por correo; aviso al tendero siempre) */}
      <DebtRemindersConfig />

      {/* Negocio de varios socios: reparto de la ganancia en Rentabilidad */}
      <PartnershipConfig />

      {/* Copia de seguridad de ventas a Google Drive */}
      <div id="google-drive" data-guide="config-backup">
        <GoogleDriveBackupConfig />
      </div>

      {/* Estado del Sistema - Temporalmente oculto */}
      <Card data-guide="config-loyalty">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-yellow-600" />
            Estado del Sistema de Puntos
          </CardTitle>
          <CardDescription>
            Activa o desactiva el sistema de puntos de lealtad para tus clientes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium">Sistema de Puntos</p>
              <p className="text-sm text-gray-500">
                {enabled
                  ? "Los clientes ganarán puntos en cada compra"
                  : "Sistema desactivado"}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardContent>
      </Card>

      {/* Niveles de Puntos - Temporalmente oculto */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Niveles de Puntos</CardTitle>
              <CardDescription>
                Define cuántos puntos ganan los clientes según el monto de su
                compra
              </CardDescription>
            </div>
            <Button onClick={handleAddTier} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Agregar Nivel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {tiers.map((tier, index) => (
              <div key={index} className="border rounded-lg p-4 bg-white">
                <div className="flex items-start gap-4">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        Nombre del Nivel
                      </label>
                      <Input
                        type="text"
                        value={tier.name}
                        onChange={(e) =>
                          handleUpdateTier(index, "name", e.target.value)
                        }
                        placeholder="Ej: Compra pequeña"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        Monto Mínimo
                      </label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={tier.min_amount}
                        onChange={(e) =>
                          handleUpdateTier(
                            index,
                            "min_amount",
                            Number(e.target.value),
                          )
                        }
                        placeholder="0"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {formatCurrency(tier.min_amount)}
                      </p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        Monto Máximo
                      </label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={
                          tier.max_amount === Infinity ? "" : tier.max_amount
                        }
                        onChange={(e) =>
                          handleUpdateTier(
                            index,
                            "max_amount",
                            e.target.value === ""
                              ? Infinity
                              : Number(e.target.value),
                          )
                        }
                        placeholder="Sin límite"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {tier.max_amount === Infinity
                          ? "Sin límite"
                          : formatCurrency(tier.max_amount)}
                      </p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">
                        Puntos a Otorgar
                      </label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={tier.points}
                        onChange={(e) =>
                          handleUpdateTier(
                            index,
                            "points",
                            Number(e.target.value),
                          )
                        }
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveTier(index)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-3 p-3 bg-brand-light/50 rounded text-sm">
                  <p className="text-brand">
                    <strong>Vista previa:</strong> Compras entre{" "}
                    {formatCurrency(tier.min_amount)} y{" "}
                    {tier.max_amount === Infinity
                      ? "sin límite"
                      : formatCurrency(tier.max_amount)}{" "}
                    otorgarán <strong>{tier.points} puntos</strong>
                  </p>
                </div>
              </div>
            ))}

            {tiers.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Award className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No hay niveles configurados</p>
                <p className="text-sm">Agrega un nivel para comenzar</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Configuración de IA - API Key de Gemini */}
      <Card data-guide="config-ai">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            Análisis con IA (Gemini)
          </CardTitle>
          <CardDescription>
            Conecta tu propia cuenta de Google AI para usar el análisis inteligente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Botón grande: abre Google directo en la página de crear la clave */}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-lg bg-purple-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-purple-700"
          >
            <Gift className="h-5 w-5" />
            Abrir Google y crear mi clave gratis
            <ExternalLink className="h-4 w-4" />
          </a>

          {/* Guía paso a paso, en lenguaje simple */}
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
            <p className="font-semibold text-purple-900 text-sm">
              Sigue estos 3 pasos (una sola vez):
            </p>
            <ol className="space-y-3">
              <li className="flex gap-3 text-sm text-purple-900">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">1</span>
                <span>
                  Toca el botón morado de arriba. Se abrirá Google y te pedirá
                  <strong> iniciar sesión con tu correo de Gmail</strong> (el tuyo de siempre).
                </span>
              </li>
              <li className="flex gap-3 text-sm text-purple-900">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">2</span>
                <span>
                  Arriba a la derecha verás el botón <strong>"Crear clave de API"</strong>
                  {" "}(o <strong>"Create API key"</strong>). Tiene el fondo blanco, igual que
                  la página. Presiónalo y Google la genera al instante.
                </span>
              </li>
              <li className="flex gap-3 text-sm text-purple-900">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">3</span>
                <span>
                  <strong>Copia</strong> el código que aparece (empieza con <code>AIza</code>) y
                  <strong> pégalo aquí abajo</strong>. Luego toca <strong>Guardar</strong>.
                </span>
              </li>
            </ol>
            <div className="flex items-start gap-2 pt-1 text-xs text-purple-700">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Es <strong>totalmente gratis</strong> y suficiente para el uso diario. Tu clave es
                privada, se guarda en tu cuenta y solo se usa para tus propios análisis.
              </span>
            </div>
          </div>

          {/* Campo de la key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Pega aquí tu clave</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showGeminiKey ? "text" : "password"}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={handleSaveGeminiKey} disabled={savingGeminiKey}>
                {savingGeminiKey ? "Guardando..." : "Guardar"}
              </Button>
            </div>
            {geminiApiKey && (
              <p className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                ¡Listo! El análisis con IA ya usa tu cuenta de Google.
              </p>
            )}
            {!geminiApiKey && (
              <p className="text-xs text-gray-500">
                Aún no has puesto tu clave. Sigue los 3 pasos de arriba para activar la IA.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reportes Automáticos */}
      <AutoReportsConfig />

      {/* Información adicional */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Información</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <p>
            • Los puntos se asignan automáticamente cuando un cliente realiza
            una compra
          </p>
          <p>• Los rangos de montos no pueden superponerse</p>
          <p>
            • Asegúrate de cubrir todos los rangos de montos que desees
            recompensar
          </p>
          <p>• Los cambios se aplicarán inmediatamente a las nuevas ventas</p>
        </CardContent>
      </Card>

      {/* Contadora - Reportes DIAN */}
      <Card className="border-brand/40 bg-brand-light/50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-brand" />
            Reportes DIAN
          </CardTitle>
          <CardDescription>
            ¿Necesitas hacer reportes a la DIAN?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-brand-light/50 border border-brand/40 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-brand">Contadora disponible</p>
                <p className="text-sm text-brand mt-1">
                  Nuestra contadora te puede ayudar con tus declaraciones y reportes ante la DIAN de forma rápida y confiable.
                </p>
              </div>
            </div>
            <a
              href="https://wa.me/573152523498?text=Hola,%20necesito%20ayuda%20con%20reportes%20a%20la%20DIAN"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <MessageCircle className="h-4 w-4" />
              Escríbeme
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Soporte y Chat en Vivo */}
      <Card className="border-green-200 bg-green-50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-600" />
            Soporte
          </CardTitle>
          <CardDescription>
            ¿Necesitas ayuda? Estamos aquí para ti
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-semibold text-green-900">Contacto</p>
                <p className="text-sm text-green-800">
                  Puedes contactarnos por:
                </p>
                <ul className="text-sm text-green-800 list-disc list-inside space-y-1 ml-2">
                  <li>WhatsApp: +57 317 450 3604</li>
                  <li>Email: {landingConfig.contact.email}</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
