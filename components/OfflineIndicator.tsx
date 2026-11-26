'use client';

import { useEffect, useState } from 'react';
import { WifiOff, Wifi, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { toast } from 'sonner';
import { isOfflineMode, useOfflineMode } from '@/lib/offline-mode';

export default function OfflineIndicator() {
  const { isOnline, pendingSync, isSyncing, syncOfflineData } = useOfflineSync();
  const [showIndicator, setShowIndicator] = useState(false);
  const [userDismissed, setUserDismissed] = useState(false);
  // Si el POS abrió desde la copia guardada, ya hay una franja propia arriba.
  const offlineMode = useOfflineMode();

  useEffect(() => {
    if (!isOnline) {
      // Sin conexión: mostrar el aviso (naranja) y resetear el cierre manual.
      setUserDismissed(false);
      setShowIndicator(true);
      // Se espera un momento: el layout decide en su efecto (que corre después
      // de este) si entra en modo sin internet, y ahí el aviso sobra.
      const t = setTimeout(() => {
        if (isOfflineMode()) return;
        toast.warning('Sin conexión a internet', {
          description: 'El sistema continuará funcionando offline',
          duration: 5000,
        });
      }, 0);
      return () => clearTimeout(t);
    }

    // Online. Solo mostramos el indicador si hay algo accionable (datos
    // pendientes de sincronizar) o si venimos de un estado offline (para
    // confirmar "Conexión restaurada"). El estado "todo sincronizado" NO se
    // queda pegado: se auto-oculta a los 3s.
    const wasOffline = showIndicator; // estaba visible por estar offline
    if (wasOffline) {
      toast.success('Conexión restaurada', {
        description: 'Sincronizando datos...',
        duration: 3000,
      });
    }

    if (pendingSync > 0) {
      // Hay operaciones pendientes: mantener visible (tiene botón de acción).
      setShowIndicator(true);
      return;
    }

    if (wasOffline) {
      // Acabamos de reconectar sin pendientes: mostrar breve confirmación y ocultar.
      setShowIndicator(true);
      const t = setTimeout(() => setShowIndicator(false), 3000);
      return () => clearTimeout(t);
    }

    // Online, sin pendientes y sin transición desde offline: no molestar.
    setShowIndicator(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, pendingSync]);

  const handleSync = async () => {
    try {
      await syncOfflineData();
      toast.success('Sincronización completada');
    } catch (error) {
      toast.error('Error al sincronizar datos');
    }
  };

  const handleClose = () => {
    setUserDismissed(true);
    setShowIndicator(false);
  };

  // No mostrar si el usuario lo cerró manualmente o si ya se ve la franja
  // del modo sin internet.
  if (userDismissed || offlineMode) {
    return null;
  }

  // No mostrar si está todo bien y no hay nada que mostrar
  if (!showIndicator && isOnline && pendingSync === 0) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 rounded-lg shadow-lg p-4 max-w-sm transition-all ${
        isOnline
          ? 'bg-green-500 text-white'
          : 'bg-orange-500 text-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isOnline ? (
            <Wifi className="h-5 w-5" />
          ) : (
            <WifiOff className="h-5 w-5 animate-pulse" />
          )}
        </div>

        <div className="flex-1">
          <h4 className="font-semibold text-sm mb-1">
            {isOnline ? 'Conectado' : 'Modo Offline'}
          </h4>

          <p className="text-xs opacity-90 mb-2">
            {isOnline ? (
              pendingSync > 0 ? (
                `${pendingSync} operación${pendingSync > 1 ? 'es' : ''} pendiente${pendingSync > 1 ? 's' : ''} de sincronizar`
              ) : (
                'Todos los datos sincronizados'
              )
            ) : (
              'Las ventas se guardarán localmente y se sincronizarán automáticamente'
            )}
          </p>

          {isOnline && pendingSync > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSync}
              disabled={isSyncing}
              className="h-7 text-xs"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Sincronizar ahora
                </>
              )}
            </Button>
          )}

          {isOnline && pendingSync === 0 && !isSyncing && (
            <div className="flex items-center gap-1 text-xs">
              <CheckCircle2 className="h-3 w-3" />
              <span>Sincronizado</span>
            </div>
          )}
        </div>

        <button
          onClick={handleClose}
          className="text-white/80 hover:text-white text-xl leading-none"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>

      {!isOnline && (
        <div className="mt-3 pt-3 border-t border-white/20">
          <div className="text-xs space-y-1">
            <p className="font-medium">✓ Puedes seguir usando:</p>
            <ul className="ml-3 space-y-0.5 opacity-90">
              <li>• Registrar ventas</li>
              <li>• Consultar productos</li>
              <li>• Ver clientes</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
