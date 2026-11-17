'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCustomerById, updateCustomer } from '@/lib/cloudflare-api';
import { getCustomerPurchaseHistory } from '@/lib/loyalty-helpers';
import { Customer, CustomerPurchaseHistory, Sale, SaleItemWithProduct, UserProfile } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft, User, Mail, Phone, MapPin, Award, ShoppingBag, Calendar, CreditCard, FileText, Edit } from 'lucide-react';
import Link from 'next/link';
import { RemoveCustomerDialog } from '@/components/customers/remove-customer-dialog';
import { InvoiceModal } from '@/components/sales/invoice-modal';
import { getUserProfileByClerkId } from '@/lib/cloudflare-subscription-helpers';

export default function CustomerDetailPage() {
  const { getToken } = useAuth();

  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<CustomerPurchaseHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [selectedSaleItems, setSelectedSaleItems] = useState<SaleItemWithProduct[]>([]);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [storeInfo, setStoreInfo] = useState<UserProfile | null>(null);

  // Estados para edición
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    id_number: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCustomerData();
  }, [customerId]);

  const loadCustomerData = async () => {
    try {
      setLoading(true);
      const [customerData, history, profile] = await Promise.all([
        getCustomerById(customerId, getToken),
        getCustomerPurchaseHistory(customerId, getToken),
        getUserProfileByClerkId(getToken),
      ]);

      setCustomer(customerData as Customer);
      setPurchaseHistory(history as CustomerPurchaseHistory[]);
      setStoreInfo(profile);
    } catch (error) {
      console.error('Error loading customer data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = () => {
    if (!customer) return;

    // Inicializar el formulario con los datos actuales del cliente
    setEditForm({
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      city: customer.city || '',
      id_number: customer.id_number || '',
    });
    setEditModalOpen(true);
  };

  const handleSaveCustomer = async () => {
    if (!customer) return;

    try {
      setSaving(true);

      // Actualizar cliente
      const updatedCustomer = await updateCustomer(
        customer.id,
        {
          name: editForm.name,
          email: editForm.email || undefined,
          phone: editForm.phone || undefined,
          address: editForm.address || undefined,
          city: editForm.city || undefined,
          id_number: editForm.id_number || undefined,
        },
        getToken
      );

      // Actualizar el estado local
      setCustomer(updatedCustomer as Customer);
      setEditModalOpen(false);
    } catch (error) {
      console.error('Error al actualizar cliente:', error);
      alert('Error al actualizar el cliente');
    } finally {
      setSaving(false);
    }
  };

  const handleViewInvoice = (purchase: CustomerPurchaseHistory) => {
    // Convertir CustomerPurchaseHistory a Sale
    const sale: Sale = {
      id: purchase.sale_id,
      sale_number: purchase.sale_number,
      customer_id: customerId,
      user_profile_id: storeInfo?.id || '',
      payment_method: purchase.payment_method as 'efectivo' | 'tarjeta' | 'transferencia' | 'credito',
      total: purchase.total,
      subtotal: purchase.total,
      tax: 0,
      discount: 0,
      status: 'completada',
      created_at: purchase.date,
      updated_at: purchase.date,
      cashier_id: '',
    };

    // Convertir items a SaleItemWithProduct
    const saleItems: SaleItemWithProduct[] = purchase.items.map(item => ({
      id: item.id,
      sale_id: purchase.sale_id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: 0,
      subtotal: item.subtotal,
      product: item.product,
      user_profile_id: storeInfo?.id || '',
      created_at: purchase.date,
    }));

    setSelectedSale(sale);
    setSelectedSaleItems(saleItems);
    setInvoiceModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando información del cliente...</p>
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

  const totalSpent = purchaseHistory.reduce((sum, purchase) => sum + purchase.total, 0);
  const totalPurchases = purchaseHistory.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{customer.name}</h1>
          <p className="text-gray-500">Detalles del cliente e historial de compras</p>
        </div>
      </div>

      {/* Información del Cliente */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                Información Personal
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleEditClick}>
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </Button>
                <RemoveCustomerDialog customer={customer} purchases={purchaseHistory.length} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{customer.email}</span>
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
                <span>{customer.address}</span>
              </div>
            )}
            {customer.id_number && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">ID:</span>
                <span>{customer.id_number}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="h-5 w-5 text-yellow-600" />
              Puntos de Lealtad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-yellow-600">
              {customer.loyalty_points}
            </div>
            <p className="text-sm text-gray-500 mt-1">Puntos acumulados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-brand" />
              Estadísticas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-sm text-gray-500">Total comprado</p>
              <p className="text-xl font-bold text-brand">{formatCurrency(totalSpent)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Número de compras</p>
              <p className="text-xl font-bold">{totalPurchases}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Historial de Compras */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            Historial de Compras ({purchaseHistory.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {purchaseHistory.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingBag className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-gray-500">Este cliente no ha realizado compras aún</p>
            </div>
          ) : (
            <div className="space-y-4">
              {purchaseHistory.map((purchase) => (
                <Card key={purchase.sale_id} className="bg-gray-50">
                  <CardContent className="pt-4">
                    {/* Encabezado de la compra */}
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 pb-4 border-b">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-brand">
                            {purchase.sale_number}
                          </span>
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                            Completada
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {new Date(purchase.date).toLocaleDateString('es-CO', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="flex items-center gap-1">
                            <CreditCard className="h-4 w-4" />
                            {purchase.payment_method}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col md:flex-row md:items-center gap-3 mt-2 md:mt-0">
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Total</p>
                          <p className="text-2xl font-bold text-brand">
                            {formatCurrency(purchase.total)}
                          </p>
                          {purchase.points_earned > 0 && (
                            <p className="text-sm text-yellow-600 font-medium">
                              +{purchase.points_earned} puntos
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewInvoice(purchase)}
                          className="gap-2"
                        >
                          <FileText className="h-4 w-4" />
                          Ver Factura
                        </Button>
                      </div>
                    </div>

                    {/* Lista de productos */}
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">Productos comprados:</p>
                      <div className="space-y-2">
                        {purchase.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between bg-white p-3 rounded border"
                          >
                            <div className="flex-1">
                              <p className="font-medium text-sm">
                                {item.product?.name || 'Producto desconocido'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatCurrency(item.unit_price)} x {item.quantity} unidad(es)
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-brand">
                                {formatCurrency(item.subtotal)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Factura */}
      {selectedSale && selectedSaleItems && storeInfo && (
        <InvoiceModal
          open={invoiceModalOpen}
          onOpenChange={setInvoiceModalOpen}
          sale={selectedSale}
          saleItems={selectedSaleItems}
          customer={customer}
          storeInfo={storeInfo}
          cashierName={storeInfo.store_name || 'Cajero'}
        />
      )}

      {/* Modal de Edición */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="cliente@ejemplo.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                placeholder="3001234567"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="id_number">Número de Identificación</Label>
              <Input
                id="id_number"
                value={editForm.id_number}
                onChange={(e) => setEditForm({ ...editForm, id_number: e.target.value })}
                placeholder="1234567890"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                placeholder="Calle 123 #45-67"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="city">Ciudad</Label>
              <Input
                id="city"
                value={editForm.city}
                onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                placeholder="Bogotá"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveCustomer} disabled={saving || !editForm.name.trim()}>
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
