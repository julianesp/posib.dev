'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface VerifyResult {
  type: 'success' | 'error';
  data: {
    message: string;
    subscription?: {
      planId: string;
      status: string;
      hasAIAddon?: boolean;
    };
  };
}

export default function VerifyPaymentPage() {
  const router = useRouter();
  const [transactionId, setTransactionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const handleVerify = async () => {
    if (!transactionId.trim()) {
      toast.error('Por favor ingresa el ID de transacción');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/subscription/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transactionId: transactionId.trim() }),
      });

      const data = await response.json();

      if (data.success) {
        setResult({ type: 'success', data });
        toast.success('¡Suscripción activada exitosamente!');

        // Redirigir al dashboard después de 3 segundos
        setTimeout(() => {
          router.push('/dashboard');
        }, 3000);
      } else {
        setResult({ type: 'error', data });
        toast.error(data.message || 'No se pudo verificar el pago');
      }
    } catch (error) {
      console.error('Error:', error);
      toast.error('Error al verificar el pago');
      setResult({ type: 'error', data: { message: 'Error de conexión' } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Verificar Pago Manual</h1>
        <p className="text-gray-500 mt-2">
          Ingresa el ID de tu transacción de ePayco para activar tu suscripción
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Verificar Transacción</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">ID de Transacción de ePayco</label>
            <Input
              placeholder="Ejemplo: 12345 (número de referencia ePayco)"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-gray-500">
              Puedes encontrar este ID en el email de confirmación de ePayco o en el recibo de pago
            </p>
          </div>

          <Button
            onClick={handleVerify}
            disabled={loading || !transactionId.trim()}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Verificando...
              </>
            ) : (
              'Verificar y Activar Suscripción'
            )}
          </Button>

          {result && (
            <div
              className={`p-4 rounded-lg border ${
                result.type === 'success'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-start gap-3">
                {result.type === 'success' ? (
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <p
                    className={`font-medium ${
                      result.type === 'success' ? 'text-green-900' : 'text-red-900'
                    }`}
                  >
                    {result.data.message}
                  </p>
                  {result.type === 'success' && result.data.subscription && (
                    <div className="mt-2 text-sm text-green-800">
                      <p>Plan: {result.data.subscription.planId}</p>
                    </div>
                  )}
                  {result.type === 'success' && (
                    <p className="mt-2 text-sm text-green-700">
                      Redirigiendo al dashboard en 3 segundos...
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">¿Dónde encuentro el ID de transacción?</p>
            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
              <li>En el email de confirmación de ePayco</li>
              <li>En el recibo de pago que descargaste</li>
              <li>En tu cuenta de ePayco (si te registraste)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl bg-brand-light/50 border-brand/40">
        <CardContent className="pt-6">
          <p className="text-sm text-brand">
            💡 <strong>Nota:</strong> Esta verificación manual es temporal. Una vez tengas un dominio
            o uses ngrok, los pagos se activarán automáticamente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
