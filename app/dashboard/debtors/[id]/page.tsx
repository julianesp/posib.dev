'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCustomerById, getUserProfile } from '@/lib/cloudflare-api';
import {
  getCustomerCreditSales,
  getCreditPaymentHistory,
  registerCreditPayment,
  updateCustomerCreditLimit,
} from '@/lib/cloudflare-credit-helpers';
import { Customer, SaleItemWithProduct, SaleWithRelations, UserProfile } from '@/lib/types';
import type { CreditPaymentData } from '@/lib/cloudflare-api';
import { formatCurrency } from '@/lib/utils';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  DollarSign,
  CreditCard,
  Calendar,
  AlertCircle,
  CheckCircle,
  Receipt,
  HandCoins,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Swal from 'sweetalert2';
import { PageGlossary } from "@/components/dashboard/page-glossary";

export default function DebtorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken, userId } = useAuth();
  const customerId = params.id as string;

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [creditSales, setCreditSales] = useState<SaleWithRelations[]>([]);
  const [selectedSale, setSelectedSale] = useState<SaleWithRelations | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<CreditPaymentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  // 'pago' = pagar el saldo completo; 'abono' = pago parcial
  const [paymentMode, setPaymentMode] = useState<'pago' | 'abono'>('pago');
  const [showCreditLimitModal, setShowCreditLimitModal] = useState(false);

  // Form states
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'transferencia'>(
    'efectivo'
  );
  const [paymentNotes, setPaymentNotes] = useState('');
  const [newCreditLimit, setNewCreditLimit] = useState('');

  useEffect(() => {
    loadDebtorData();
  }, [customerId]);

  const loadDebtorData = async () => {
    try {
      setLoading(true);

      // Load user profile if not already loaded
      if (!userProfile) {
        const profile = await getUserProfile(getToken);
        setUserProfile(profile);
      }

      const customerData = await getCustomerById(customerId, getToken);
      setCustomer(customerData);

      const sales = await getCustomerCreditSales(customerId, getToken);
      setCreditSales(sales);
    } catch (error) {
      console.error('Error loading debtor data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaleClick = async (sale: SaleWithRelations, mode: 'pago' | 'abono' = 'pago') => {
    setSelectedSale(sale);
    setPaymentMode(mode);
    const history = await getCreditPaymentHistory(sale.id, getToken);
    setPaymentHistory(history);
    setShowPaymentModal(true);
    // En un abono el tendero escribe cuánto le entregaron; en un pago va el saldo completo
    setPaymentAmount(mode === 'abono' ? '' : sale.amount_pending?.toString() || '0');
  };

  const handleRegisterPayment = async () => {
    if (!selectedSale || !userProfile) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'El monto debe ser mayor a cero',
      });
      return;
    }

    if (amount > (selectedSale.amount_pending || 0)) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'El monto no puede ser mayor al saldo pendiente',
      });
      return;
    }

    try {
      await registerCreditPayment(
        selectedSale.id,
        customerId,
        amount,
        paymentMethod,
        userProfile.id,
        paymentNotes,
        getToken
      );

      const remaining = (selectedSale.amount_pending || 0) - amount;
      Swal.fire({
        icon: 'success',
        title: paymentMode === 'abono' ? 'Abono registrado' : 'Pago registrado',
        text:
          remaining > 0
            ? `Se abonaron $${amount.toLocaleString('es-CO')}. Saldo pendiente: $${remaining.toLocaleString('es-CO')}`
            : 'La deuda de esta venta quedó saldada',
        // Se cierra solo; el tendero puede cerrarlo antes con OK
        timer: 3000,
        timerProgressBar: true,
      });

      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentNotes('');
      loadDebtorData();
    } catch (error) {
      console.error('Error registering payment:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo registrar el pago',
      });
    }
  };

  const handleUpdateCreditLimit = async () => {
    if (!customer) return;

    const limit = parseFloat(newCreditLimit);
    if (isNaN(limit) || limit < 0) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'El límite debe ser un número válido',
      });
      return;
    }

    try {
      await updateCustomerCreditLimit(customerId, limit, getToken);

      Swal.fire({
        icon: 'success',
        title: 'Límite actualizado',
        text: 'El límite de crédito se ha actualizado correctamente',
      });

      setShowCreditLimitModal(false);
      setNewCreditLimit('');
      loadDebtorData();
    } catch (error) {
      console.error('Error updating credit limit:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo actualizar el límite de crédito',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando información...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cliente no encontrado</p>
      </div>
    );
  }

  const creditLimit = customer.credit_limit || 0;
  const currentDebt = customer.current_debt || 0;
  const availableCredit = creditLimit - currentDebt;
  const debtPercentage = creditLimit > 0 ? (currentDebt / creditLimit) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{customer.name}</h1>
          <p className="text-gray-500">Detalles del deudor y gestión de pagos</p>
        </div>
      </div>

      {/* Información del Cliente */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              Información
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="truncate">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-gray-400" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-gray-400" />
                <span className="truncate">{customer.address}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-brand" />
              Límite de Crédito
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">
              ${creditLimit.toLocaleString('es-CO')}
            </div>
            <Button
              variant="link"
              className="p-0 h-auto text-xs"
              onClick={() => {
                setNewCreditLimit(creditLimit.toString());
                setShowCreditLimitModal(true);
              }}
            >
              Modificar límite
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-red-600" />
              Deuda Actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">
              ${currentDebt.toLocaleString('es-CO')}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {debtPercentage.toFixed(0)}% del límite
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Crédito Disponible
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${availableCredit > 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${availableCredit.toLocaleString('es-CO')}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {(100 - debtPercentage).toFixed(0)}% disponible
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Estado del crédito */}
      {debtPercentage >= 90 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-6 w-6 text-red-600" />
              <div>
                <h3 className="font-semibold text-red-900">Crédito Crítico</h3>
                <p className="text-sm text-red-700">
                  Este cliente ha alcanzado el {debtPercentage.toFixed(0)}% de su límite de crédito
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ventas a crédito pendientes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Ventas a Crédito Pendientes ({creditSales.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {creditSales.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-50" />
              <p className="text-gray-500">No tiene ventas a crédito pendientes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {creditSales.map((sale) => (
                <div
                  key={sale.id}
                  className="border rounded-lg p-4 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">Venta #{sale.sale_number}</h3>
                      <p className="text-sm text-gray-500">
                        {format(new Date(sale.created_at), 'PPP', { locale: es })}
                      </p>
                      {sale.due_date && (
                        <p className="text-sm text-orange-600">
                          Vence: {format(new Date(sale.due_date), 'PPP', { locale: es })}
                        </p>
                      )}
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        sale.payment_status === 'pendiente'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {sale.payment_status === 'pendiente' ? 'Pendiente' : 'Pago Parcial'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                    <div>
                      <p className="text-gray-500">Total</p>
                      <p className="font-semibold">${sale.total.toLocaleString('es-CO')}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Pagado</p>
                      <p className="font-semibold text-green-600">
                        ${(sale.amount_paid || 0).toLocaleString('es-CO')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Pendiente</p>
                      <p className="font-semibold text-red-600">
                        ${(sale.amount_pending || 0).toLocaleString('es-CO')}
                      </p>
                    </div>
                  </div>

                  {/* Lista de Productos */}
                  {sale.items && sale.items.length > 0 && (
                    <div className="mb-3 border-t pt-3">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Productos:</p>
                      <div className="space-y-1.5">
                        {(sale.items as SaleItemWithProduct[]).map((item, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between items-center text-sm bg-gray-50 rounded px-2 py-1.5"
                          >
                            <div className="flex-1">
                              <span className="font-medium text-gray-800">
                                {item.product?.name || 'Producto desconocido'}
                              </span>
                              <span className="text-gray-500 text-xs ml-2">
                                × {item.quantity}
                              </span>
                            </div>
                            <span className="font-medium text-gray-700">
                              ${item.subtotal.toLocaleString('es-CO')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Botones de Registrar Pago (saldo completo) y Abonar (pago parcial) */}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSaleClick(sale, 'pago')}
                      className="flex-1 bg-brand hover:bg-brand-hover text-white font-semibold"
                    >
                      <DollarSign className="h-4 w-4 mr-2" />
                      Registrar Pago
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleSaleClick(sale, 'abono')}
                      className="flex-1 border-brand text-brand hover:bg-brand-light font-semibold"
                    >
                      <HandCoins className="h-4 w-4 mr-2" />
                      Abonar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de registro de pago */}
      {showPaymentModal && selectedSale && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>
                {paymentMode === 'abono' ? 'Abonar' : 'Registrar Pago'} - Venta #{selectedSale.sale_number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Información de la venta */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="font-semibold">${selectedSale.total.toLocaleString('es-CO')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pagado</p>
                  <p className="font-semibold text-green-600">
                    ${(selectedSale.amount_paid || 0).toLocaleString('es-CO')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pendiente</p>
                  <p className="font-semibold text-red-600">
                    ${(selectedSale.amount_pending || 0).toLocaleString('es-CO')}
                  </p>
                </div>
              </div>

              {/* Historial de pagos */}
              {paymentHistory.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3">Historial de Pagos</h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {paymentHistory.map((payment) => (
                      <div key={payment.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                        <div>
                          <p className="text-sm font-medium">
                            ${payment.amount.toLocaleString('es-CO')}
                          </p>
                          <p className="text-xs text-gray-500">
                            {payment.created_at ? format(new Date(payment.created_at), 'PPp', { locale: es }) : 'N/A'}
                          </p>
                        </div>
                        <span className="text-xs px-2 py-1 bg-brand-light text-brand rounded">
                          {payment.payment_method}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Formulario de pago */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="amount">
                    {paymentMode === 'abono' ? '¿Cuánto abona?' : 'Monto a Pagar'}
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="numeric"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="0"
                    min="0"
                    step="1000"
                    autoFocus={paymentMode === 'abono'}
                  />
                  {paymentMode === 'abono' && parseFloat(paymentAmount) > 0 && (
                    <p className="text-sm text-gray-500 mt-1">
                      Quedaría debiendo:{' '}
                      <span className="font-semibold text-red-600">
                        $
                        {Math.max(
                          (selectedSale.amount_pending || 0) - parseFloat(paymentAmount),
                          0
                        ).toLocaleString('es-CO')}
                      </span>
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="payment_method">Método de Pago</Label>
                  <select
                    id="payment_method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as 'efectivo' | 'tarjeta' | 'transferencia')}
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="notes">Notas (opcional)</Label>
                  <Textarea
                    id="notes"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Agregar notas sobre el pago..."
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleRegisterPayment} className="flex-1">
                  {paymentMode === 'abono' ? 'Registrar Abono' : 'Registrar Pago'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPaymentModal(false);
                    setPaymentAmount('');
                    setPaymentNotes('');
                  }}
                  className="flex-1"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal de límite de crédito */}
      {showCreditLimitModal && (
        <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Modificar Límite de Crédito</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="credit_limit">Nuevo Límite de Crédito</Label>
                <Input
                  id="credit_limit"
                  type="number"
                  inputMode="numeric"
                  value={newCreditLimit}
                  onChange={(e) => setNewCreditLimit(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="10000"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Límite actual: ${creditLimit.toLocaleString('es-CO')}
                </p>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleUpdateCreditLimit} className="flex-1">
                  Actualizar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreditLimitModal(false);
                    setNewCreditLimit('');
                  }}
                  className="flex-1"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Explicación en palabras sencillas de los datos de esta página */}
      <PageGlossary
        storageKey="debtor-detail"
        items={[
          {
            term: "Límite de crédito",
            meaning: "Lo máximo que le fías.",
          },
          {
            term: "Crédito disponible",
            meaning: "Lo que aún le puedes fiar. Negativo: ya pasó el límite.",
          },
          {
            term: "Registrar pago",
            meaning: "Paga toda la deuda de esa venta.",
          },
          {
            term: "Abonar",
            meaning: "Paga solo una parte.",
          },
        ]}
      />
    </div>
  );
}
