'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Clock,
  CreditCard,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Calendar,
  AlertCircle,
  X
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';

interface TrialUsageModalProps {
  daysUsed: number;
  daysRemaining: number;
  totalDays: number;
  userEmail: string;
}

export function TrialUsageModal({
  daysUsed,
  daysRemaining,
  totalDays,
  userEmail,
}: TrialUsageModalProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Verificar si ya se mostró el modal en esta sesión
    const sessionKey = `trial-modal-session-${userEmail}`;
    const shownInSession = sessionStorage.getItem(sessionKey);

    console.log('[TrialUsageModal] Check display conditions:', {
      userEmail,
      shownInSession,
      dismissed,
      shouldShow: !shownInSession && !dismissed
    });

    if (shownInSession || dismissed) {
      console.log('[TrialUsageModal] Not showing modal - already shown in this session or dismissed');
      return;
    }

    console.log('[TrialUsageModal] Will show modal in 3 seconds');

    // Mostrar el modal después de 3 segundos de cargar la página
    const timer = setTimeout(() => {
      console.log('[TrialUsageModal] Showing modal now');
      setOpen(true);
      // Marcar como mostrado en esta sesión (se borra al cerrar el navegador)
      sessionStorage.setItem(sessionKey, 'true');
    }, 3000);

    return () => clearTimeout(timer);
  }, [dismissed, userEmail]);

  const handleSubscribe = () => {
    setOpen(false);
    router.push('/dashboard/subscription');
  };

  const handleDismiss = () => {
    setOpen(false);
    setDismissed(true);
  };

  // Calcular el porcentaje de días usados
  const usagePercentage = (daysUsed / totalDays) * 100;

  // Determinar el color según el uso
  const getProgressColor = () => {
    if (usagePercentage < 50) return 'bg-green-500';
    if (usagePercentage < 75) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getTextColor = () => {
    if (usagePercentage < 50) return 'text-green-700';
    if (usagePercentage < 75) return 'text-yellow-700';
    return 'text-red-700';
  };

  const getBgColor = () => {
    if (usagePercentage < 50) return 'bg-green-50';
    if (usagePercentage < 75) return 'bg-yellow-50';
    return 'bg-red-50';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] p-0 overflow-hidden flex flex-col">
        {/* Botón de cerrar */}
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 z-50 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-950 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-gray-100 data-[state=open]:text-gray-500"
        >
          <X className="h-5 w-5 text-white hover:text-gray-200" />
          <span className="sr-only">Cerrar</span>
        </button>

        {/* Header con gradiente */}
        <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 p-4 text-white flex-shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur">
                <Clock className="h-5 w-5" />
              </div>
              <DialogTitle className="text-xl font-bold text-white">
                Estado de tu Prueba Gratuita
              </DialogTitle>
            </div>
            <DialogDescription className="text-purple-100 text-sm">
              Estás probando nuestro sistema completo sin costo
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Contenido principal con scroll */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Barra de progreso visual */}
          <div className={`${getBgColor()} border-2 ${usagePercentage >= 75 ? 'border-red-200' : usagePercentage >= 50 ? 'border-yellow-200' : 'border-green-200'} rounded-lg p-4`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar className={`h-5 w-5 ${getTextColor()}`} />
                <span className={`font-bold text-lg ${getTextColor()}`}>
                  Día {daysUsed} de {totalDays}
                </span>
              </div>
              <span className={`text-sm font-medium ${getTextColor()}`}>
                {daysRemaining} {daysRemaining === 1 ? 'día restante' : 'días restantes'}
              </span>
            </div>

            {/* Barra de progreso */}
            <div className="w-full bg-white/50 rounded-full h-3 overflow-hidden border border-gray-200">
              <div
                className={`h-full ${getProgressColor()} transition-all duration-500 ease-out rounded-full`}
                style={{ width: `${usagePercentage}%` }}
              />
            </div>

            {/* Mensaje motivacional */}
            <div className="mt-4 flex items-start gap-2">
              <AlertCircle className={`h-5 w-5 ${getTextColor()} mt-0.5 flex-shrink-0`} />
              <p className={`text-sm ${getTextColor()} font-medium`}>
                {daysRemaining <= 3 ? (
                  <>¡Últimos días! No pierdas acceso a todas las funcionalidades. Suscríbete ahora para continuar sin interrupciones.</>
                ) : daysRemaining <= 7 ? (
                  <>Tu período de prueba está por terminar. Suscríbete antes de perder acceso al sistema.</>
                ) : (
                  <>Disfruta de todas las funcionalidades premium durante tu prueba. Después puedes elegir el plan que mejor se ajuste a tu negocio.</>
                )}
              </p>
            </div>
          </div>

          {/* Beneficios incluidos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-start gap-3 p-3 bg-brand-light/50 rounded-lg border border-brand/40">
              <TrendingUp className="h-5 w-5 text-brand mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-brand text-sm">Sistema Completo</p>
                <p className="text-xs text-brand">POS, inventario, reportes</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
              <Sparkles className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-purple-900 text-sm">Todos los Addons</p>
                <p className="text-xs text-purple-700">IA, tienda, email gratis</p>
              </div>
            </div>
          </div>

          {/* Planes disponibles */}
          <div className="border-t pt-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-gray-700" />
              Continúa con tu Plan
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200 hover:border-gray-300 transition-all">
                <div>
                  <p className="font-bold text-gray-900">Plan Básico</p>
                  <p className="text-xs text-gray-600">Todo lo esencial para tu negocio</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg text-gray-900">{formatCurrency(24900)}</p>
                  <p className="text-xs text-gray-500">/mes</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 bg-purple-50 rounded border border-purple-200 text-center">
                  <p className="font-semibold text-purple-900">+ IA</p>
                  <p className="text-purple-700">{formatCurrency(5000)}</p>
                </div>
                <div className="p-2 bg-brand-light/50 rounded border border-brand/40 text-center">
                  <p className="font-semibold text-brand">+ Tienda</p>
                  <p className="text-brand">{formatCurrency(9900)}</p>
                </div>
                <div className="p-2 bg-green-50 rounded border border-green-200 text-center">
                  <p className="font-semibold text-green-900">+ Email</p>
                  <p className="text-green-700">{formatCurrency(5000)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Garantía */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-900 font-medium text-center">
              ✓ Pago seguro con ePayco • Cancela cuando quieras • Soporte incluido
            </p>
          </div>
        </div>

        {/* Footer con botones */}
        <DialogFooter className="border-t bg-gray-50 p-4 flex-shrink-0">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Button
              variant="outline"
              onClick={handleDismiss}
              className="flex-1 border-gray-300 hover:bg-gray-100"
            >
              Recordar mañana
            </Button>
            <Button
              onClick={handleSubscribe}
              className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Ver Planes y Suscribirme
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
