'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { DollarSign, Users, Eye, Search, Filter, CreditCard, FileSpreadsheet, Download, MessageCircle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Customer, Sale, SaleItemWithProduct } from '@/lib/types';
import { getDebtorCustomers } from '@/lib/cloudflare-credit-helpers';
import { getSales, getUserProfile } from '@/lib/cloudflare-api';
import { buildWhatsAppLink, buildDebtReminderMessage } from '@/lib/whatsapp';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { PageGlossary } from "@/components/dashboard/page-glossary";

type SaleWithItems = Sale & { items?: SaleItemWithProduct[] };

export default function DebtorsPage() {
  const { getToken } = useAuth();
  const [debtors, setDebtors] = useState<Customer[]>([]);
  const [filteredDebtors, setFilteredDebtors] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [totalDebt, setTotalDebt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [storeName, setStoreName] = useState<string | null>(null);

  useEffect(() => {
    const fetchDebtors = async () => {
      try {
        setLoading(true);
        const data = await getDebtorCustomers(getToken);
        setDebtors(data);
        setFilteredDebtors(data);

        // Calcular deuda total
        const total = data.reduce((sum, debtor) => sum + (debtor.current_debt || 0), 0);
        setTotalDebt(total);
      } catch (error) {
        console.error('Error fetching debtors:', error);
      } finally {
        setLoading(false);
      }
    };

    // Nombre de la tienda para personalizar los recordatorios de WhatsApp
    const fetchStoreName = async () => {
      try {
        const profile = await getUserProfile(getToken);
        setStoreName(profile?.store_name || null);
      } catch {
        // Si falla, el mensaje simplemente no incluirá el nombre de la tienda
      }
    };

    fetchDebtors();
    fetchStoreName();
  }, []);

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredDebtors(debtors);
    } else {
      const filtered = debtors.filter(
        (debtor) =>
          debtor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          debtor.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          debtor.email?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredDebtors(filtered);
    }
  }, [searchTerm, debtors]);

  const handleExportToExcel = async () => {
    try {
      setExporting(true);
      toast.loading('Generando archivo Excel...', { id: 'exporting' });

      // Obtener todas las ventas a crédito
      const allSales = (await getSales(getToken)) as SaleWithItems[];

      // Filtrar solo ventas a crédito con saldo pendiente
      const creditSales = allSales.filter((sale) =>
        sale.payment_method === 'credito' &&
        sale.payment_status !== 'pagado' &&
        sale.customer_id
      );

      // Crear array para las filas del Excel
      const excelData: Record<string, unknown>[] = [];

      // Agregar hoja de resumen de deudores
      debtors.forEach((debtor) => {
        const debtorSales = creditSales.filter((sale) => sale.customer_id === debtor.id);

        debtorSales.forEach((sale) => {
          // Para cada venta, agregar los productos
          (sale.items || []).forEach((item) => {
            excelData.push({
              'Cliente': debtor.name,
              'Teléfono': debtor.phone || 'N/A',
              'Email': debtor.email || 'N/A',
              'Límite de Crédito': debtor.credit_limit || 0,
              'Deuda Total Cliente': debtor.current_debt || 0,
              'Crédito Disponible': (debtor.credit_limit || 0) - (debtor.current_debt || 0),
              '---': '---',
              'Nº Venta': sale.sale_number,
              'Fecha Venta': sale.created_at ? format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm', { locale: es }) : 'N/A',
              'Total Venta': sale.total || 0,
              'Monto Pagado': sale.amount_paid || 0,
              'Saldo Pendiente': sale.amount_pending || 0,
              'Estado': sale.payment_status === 'pendiente' ? 'Pendiente' : sale.payment_status === 'parcial' ? 'Parcial' : 'Pagado',
              '----': '----',
              'Producto': item.product?.name || 'Producto desconocido',
              'Cantidad': item.quantity,
              'Precio Unitario': item.unit_price,
              'Subtotal Producto': item.subtotal,
            });
          });
        });
      });

      // Crear workbook con ExcelJS (carga diferida: solo al exportar)
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();

      // Hoja 1: Detalle completo de deudas
      const ws = workbook.addWorksheet('Detalle de Deudas');

      if (excelData.length > 0) {
        const headers = Object.keys(excelData[0]);
        ws.addRow(headers);

        // Estilizar headers
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        });

        // Agregar datos
        excelData.forEach(item => {
          const values = headers.map(header => item[header]);
          ws.addRow(values);
        });

        // Ajustar anchos de columna
        ws.columns = [
          { width: 25 }, // Cliente
          { width: 15 }, // Teléfono
          { width: 25 }, // Email
          { width: 18 }, // Límite de Crédito
          { width: 18 }, // Deuda Total Cliente
          { width: 18 }, // Crédito Disponible
          { width: 5 },  // ---
          { width: 20 }, // Nº Venta
          { width: 18 }, // Fecha Venta
          { width: 15 }, // Total Venta
          { width: 15 }, // Monto Pagado
          { width: 15 }, // Saldo Pendiente
          { width: 12 }, // Estado
          { width: 5 },  // ----
          { width: 30 }, // Producto
          { width: 10 }, // Cantidad
          { width: 15 }, // Precio Unitario
          { width: 15 }, // Subtotal Producto
        ];
      }

      // Hoja 2: Resumen por cliente
      const summaryData = debtors.map(debtor => {
        const debtorSales = creditSales.filter((sale) => sale.customer_id === debtor.id);
        const totalVentas = debtorSales.length;
        const totalProductos = debtorSales.reduce((sum, sale) =>
          sum + (sale.items?.length || 0), 0
        );

        return {
          'Cliente': debtor.name,
          'Teléfono': debtor.phone || 'N/A',
          'Email': debtor.email || 'N/A',
          'Límite de Crédito': debtor.credit_limit || 0,
          'Deuda Total': debtor.current_debt || 0,
          'Crédito Disponible': (debtor.credit_limit || 0) - (debtor.current_debt || 0),
          'Ventas a Crédito': totalVentas,
          'Total Productos': totalProductos,
          'Estado': !debtor.credit_limit || debtor.credit_limit === 0
            ? 'Sin Límite'
            : ((debtor.current_debt || 0) / (debtor.credit_limit || 1) * 100) >= 90
            ? 'Crítico'
            : ((debtor.current_debt || 0) / (debtor.credit_limit || 1) * 100) >= 70
            ? 'Alerta'
            : 'Normal',
        };
      });

      const wsSummary = workbook.addWorksheet('Resumen por Cliente');

      if (summaryData.length > 0) {
        const summaryHeaders = Object.keys(summaryData[0]);
        wsSummary.addRow(summaryHeaders);

        // Estilizar headers
        const summaryHeaderRow = wsSummary.getRow(1);
        summaryHeaderRow.font = { bold: true };
        summaryHeaderRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        summaryHeaderRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        });

        // Agregar datos
        summaryData.forEach(item => {
          const values = summaryHeaders.map(header => (item as Record<string, unknown>)[header]);
          wsSummary.addRow(values);
        });

        // Ajustar anchos de columna
        wsSummary.columns = [
          { width: 25 },
          { width: 15 },
          { width: 25 },
          { width: 18 },
          { width: 18 },
          { width: 18 },
          { width: 18 },
          { width: 15 },
          { width: 12 },
        ];
      }

      // Generar archivo y descargar
      const fileName = `deudores_${format(new Date(), 'yyyy-MM-dd_HHmm')}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);

      toast.success('Archivo Excel generado correctamente', { id: 'exporting' });
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      toast.error('Error al generar archivo Excel', { id: 'exporting' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Clientes Deudores</h1>
          <p className="text-gray-500 text-sm md:text-base">
            Gestiona las cuentas por cobrar
          </p>
        </div>
        <Button
          data-guide="debtors-export"
          onClick={handleExportToExcel}
          disabled={exporting || debtors.length === 0}
          className="bg-green-600 hover:bg-green-700 flex items-center gap-2"
        >
          {exporting ? (
            <>
              <Download className="h-4 w-4 animate-bounce" />
              Generando...
            </>
          ) : (
            <>
              <FileSpreadsheet className="h-4 w-4" />
              Exportar a Excel
            </>
          )}
        </Button>
      </div>

      {/* Resumen de deuda total */}
      <div data-guide="debtors-summary" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deuda Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ${totalDebt.toLocaleString('es-CO')}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes con Deuda</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{debtors.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deuda Promedio</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${debtors.length > 0 ? Math.round(totalDebt / debtors.length).toLocaleString('es-CO') : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Barra de búsqueda */}
      <Card data-guide="debtors-search">
        <CardContent className="pt-6">
          <div className="flex items-center space-x-2">
            <Search className="h-5 w-5 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar cliente por nombre, teléfono o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Lista de deudores */}
      <Card data-guide="debtors-list">
        <CardContent className="pt-6">
          {loading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Cargando deudores...</p>
            </div>
          ) : filteredDebtors.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-gray-500">
                {searchTerm
                  ? 'No se encontraron deudores con ese criterio'
                  : 'No hay clientes con deuda pendiente'}
              </p>
            </div>
          ) : (
            <>
              {/* Vista de tabla para desktop */}
              {/* overflow-x-clip (no auto): un contenedor con scroll propio anularía
                  el encabezado fijo, que se pega al tope del <main> al bajar */}
              <div className="hidden md:block overflow-x-clip">
                <table className="w-full">
                  <thead className="sticky -top-4 z-10 bg-brand-light text-sm font-semibold text-gray-800 shadow-[inset_0_-2px_0_var(--color-brand)]">
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">Nombre</th>
                      <th className="text-left py-3 px-4">Contacto</th>
                      <th className="text-right py-3 px-4">Deuda Actual</th>
                      <th className="text-center py-3 px-4">Recordatorios</th>
                      <th className="text-center py-3 px-4">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDebtors.map((debtor) => {
                      const currentDebt = debtor.current_debt || 0;

                      const handleWhatsAppReminder = () => {
                        if (!debtor.phone) {
                          toast.error('Este cliente no tiene teléfono registrado');
                          return;
                        }
                        const message = buildDebtReminderMessage({
                          customerName: debtor.name,
                          amount: currentDebt,
                          storeName,
                        });
                        // buildWhatsAppLink normaliza el número al formato
                        // internacional (agrega el 57 a celulares de 10 dígitos);
                        // sin esto WhatsApp rechaza el enlace.
                        const whatsappUrl = buildWhatsAppLink(debtor.phone, message);
                        if (!whatsappUrl) {
                          toast.error('El teléfono de este cliente no es válido para WhatsApp');
                          return;
                        }
                        window.open(whatsappUrl, '_blank');
                      };

                      const handleEmailReminder = () => {
                        if (!debtor.email) {
                          toast.error('Este cliente no tiene email registrado');
                          return;
                        }
                        const subject = encodeURIComponent('Recordatorio de pago');
                        const body = encodeURIComponent(
                          `Estimado/a ${debtor.name},\n\nTe recordamos que tienes una deuda pendiente de $${currentDebt.toLocaleString('es-CO')}.\n\nPor favor, cuando puedas realiza el pago.\n\n¡Gracias por tu preferencia!`
                        );
                        const mailtoUrl = `mailto:${debtor.email}?subject=${subject}&body=${body}`;
                        window.location.href = mailtoUrl;
                      };

                      return (
                        <tr key={debtor.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4 font-medium">{debtor.name}</td>
                          <td className="py-3 px-4">
                            <div className="text-sm">
                              {debtor.phone && <div>{debtor.phone}</div>}
                              {debtor.email && (
                                <div className="text-gray-500 truncate max-w-[200px]">
                                  {debtor.email}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-semibold text-red-600">
                              ${currentDebt.toLocaleString('es-CO')}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleWhatsAppReminder}
                                disabled={!debtor.phone}
                                title={debtor.phone ? 'Enviar recordatorio por WhatsApp' : 'No tiene teléfono'}
                                className="bg-green-50 hover:bg-green-100 border-green-200"
                              >
                                <MessageCircle className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleEmailReminder}
                                disabled={!debtor.email}
                                title={debtor.email ? 'Enviar recordatorio por Email' : 'No tiene email'}
                                className="bg-brand-light/50 hover:bg-brand-light border-brand/40"
                              >
                                <Mail className="h-4 w-4 text-brand" />
                              </Button>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Link href={`/dashboard/debtors/${debtor.id}`}>
                              <Button variant="outline" size="sm">
                                <Eye className="h-4 w-4 mr-1" />
                                Ver Detalle
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Vista de cards para móvil */}
              <div className="md:hidden space-y-3">
                {filteredDebtors.map((debtor) => {
                  const currentDebt = debtor.current_debt || 0;

                  const handleWhatsAppReminder = () => {
                    if (!debtor.phone) {
                      toast.error('Este cliente no tiene teléfono registrado');
                      return;
                    }
                    const message = buildDebtReminderMessage({
                      customerName: debtor.name,
                      amount: currentDebt,
                      storeName,
                    });
                    // Normaliza el número (agrega 57 a celulares de 10 dígitos)
                    const whatsappUrl = buildWhatsAppLink(debtor.phone, message);
                    if (!whatsappUrl) {
                      toast.error('El teléfono de este cliente no es válido para WhatsApp');
                      return;
                    }
                    window.open(whatsappUrl, '_blank');
                  };

                  const handleEmailReminder = () => {
                    if (!debtor.email) {
                      toast.error('Este cliente no tiene email registrado');
                      return;
                    }
                    const subject = encodeURIComponent('Recordatorio de pago');
                    const body = encodeURIComponent(
                      `Estimado/a ${debtor.name},\n\nTe recordamos que tienes una deuda pendiente de $${currentDebt.toLocaleString('es-CO')}.\n\nPor favor, cuando puedas realiza el pago.\n\n¡Gracias por tu preferencia!`
                    );
                    const mailtoUrl = `mailto:${debtor.email}?subject=${subject}&body=${body}`;
                    window.location.href = mailtoUrl;
                  };

                  return (
                    <Card key={debtor.id}>
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-base mb-3">{debtor.name}</h3>
                        <div className="space-y-2 text-sm mb-3">
                          {debtor.phone && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Teléfono:</span>
                              <span>{debtor.phone}</span>
                            </div>
                          )}
                          {debtor.email && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Email:</span>
                              <span className="truncate max-w-[180px]">{debtor.email}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-500">Deuda:</span>
                            <span className="font-semibold text-red-600">
                              ${currentDebt.toLocaleString('es-CO')}
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-2 mb-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleWhatsAppReminder}
                            disabled={!debtor.phone}
                            className="flex-1 bg-green-50 hover:bg-green-100 border-green-200"
                          >
                            <MessageCircle className="h-4 w-4 mr-1 text-green-600" />
                            WhatsApp
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleEmailReminder}
                            disabled={!debtor.email}
                            className="flex-1 bg-brand-light/50 hover:bg-brand-light border-brand/40"
                          >
                            <Mail className="h-4 w-4 mr-1 text-brand" />
                            Email
                          </Button>
                        </div>

                        <Link href={`/dashboard/debtors/${debtor.id}`}>
                          <Button variant="outline" size="sm" className="w-full">
                            <Eye className="h-4 w-4 mr-1" />
                            Ver Detalle y Pagos
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Explicación en palabras sencillas de los datos de esta página */}
      <PageGlossary
        storageKey="debtors"
        items={[
          {
            term: "Deuda actual",
            meaning: "Lo que te debe hoy, ya restados los abonos.",
          },
          {
            term: "Deuda promedio",
            meaning: "Lo que debe cada cliente, en promedio.",
          },
          {
            term: "Recordatorios",
            meaning: "Avisarle por WhatsApp o correo lo que debe.",
          },
        ]}
      />
    </div>
  );
}
