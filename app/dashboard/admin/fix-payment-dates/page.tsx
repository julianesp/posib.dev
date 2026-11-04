'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar, DollarSign, AlertCircle, CheckCircle, Search } from 'lucide-react';
import { toast } from 'sonner';

interface FixDatesResult {
  email: string;
  userProfileId: string;
  lastPayment: {
    date: string;
    amount: number;
    currency: string;
    transactionId: string;
  };
  updated: {
    last_payment_date: string;
    next_billing_date: string;
    subscription_status: string;
  };
  totalApprovedPayments: number;
  allTransactions: number;
}

export default function FixPaymentDatesPage() {
  const { getToken } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FixDatesResult | null>(null);

  const handleFixDates = async () => {
    if (!email) {
      toast.error('Por favor ingresa un email');
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const token = await getToken();
      const response = await fetch('/api/admin/fix-payment-dates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al corregir fechas');
      }

      setResult(data.data);
      toast.success(data.message);

    } catch (error) {
      console.error('Error fixing payment dates:', error);
      toast.error(error instanceof Error ? error.message : 'Error al corregir fechas de pago');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Calendar className="h-8 w-8 text-brand" />
        <div>
          <h1 className="text-3xl font-bold">Corregir Fechas de Pago</h1>
          <p className="text-gray-500">
            Actualiza las fechas basándose en los pagos reales registrados (ePayco)
          </p>
        </div>
      </div>

      {/* Formulario */}
      <Card>
        <CardHeader>
          <CardTitle>Buscar Usuario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                type="email"
                placeholder="Email del usuario (ej: julii1295@gmail.com)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFixDates()}
              />
            </div>
            <Button onClick={handleFixDates} disabled={loading}>
              <Search className="h-4 w-4 mr-2" />
              {loading ? 'Procesando...' : 'Corregir Fechas'}
            </Button>
          </div>

          <div className="bg-brand-light/50 border border-brand/40 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-brand mt-0.5" />
              <div className="text-sm text-brand">
                <p className="font-medium mb-1">¿Qué hace esta herramienta?</p>
                <ul className="list-disc list-inside space-y-1 text-brand">
                  <li>Busca todas las transacciones de pago aprobadas (ePayco)</li>
                  <li>Identifica la fecha del último pago REAL</li>
                  <li>Actualiza last_payment_date con la fecha correcta</li>
                  <li>Calcula next_billing_date (+30 días desde el último pago)</li>
                  <li>Establece subscription_status como "active"</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resultados */}
      {result && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900">
              <CheckCircle className="h-5 w-5" />
              Fechas Corregidas Exitosamente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Usuario */}
            <div>
              <h3 className="font-medium text-green-900 mb-2">Usuario</h3>
              <div className="bg-white rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Email:</span>
                  <span className="font-medium">{result.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Profile ID:</span>
                  <span className="font-mono text-sm">{result.userProfileId}</span>
                </div>
              </div>
            </div>

            {/* Último Pago */}
            <div>
              <h3 className="font-medium text-green-900 mb-2">Último Pago Registrado</h3>
              <div className="bg-white rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Fecha:</span>
                  <span className="font-medium">
                    {new Date(result.lastPayment.date).toLocaleString('es-CO', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Monto:</span>
                  <span className="font-medium text-green-600">
                    ${result.lastPayment.amount.toLocaleString('es-CO')} {result.lastPayment.currency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Transaction ID:</span>
                  <span className="font-mono text-xs">{result.lastPayment.transactionId}</span>
                </div>
              </div>
            </div>

            {/* Fechas Actualizadas */}
            <div>
              <h3 className="font-medium text-green-900 mb-2">Fechas Actualizadas</h3>
              <div className="bg-white rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Último pago:</span>
                  <span className="font-medium">
                    {new Date(result.updated.last_payment_date).toLocaleDateString('es-CO')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Próximo cobro:</span>
                  <span className="font-medium text-brand">
                    {new Date(result.updated.next_billing_date).toLocaleDateString('es-CO')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Estado:</span>
                  <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {result.updated.subscription_status}
                  </span>
                </div>
              </div>
            </div>

            {/* Estadísticas */}
            <div>
              <h3 className="font-medium text-green-900 mb-2">Estadísticas</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-lg p-4">
                  <div className="text-2xl font-bold text-gray-900">{result.totalApprovedPayments}</div>
                  <div className="text-sm text-gray-600">Pagos Aprobados</div>
                </div>
                <div className="bg-white rounded-lg p-4">
                  <div className="text-2xl font-bold text-gray-900">{result.allTransactions}</div>
                  <div className="text-sm text-gray-600">Transacciones Totales</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
