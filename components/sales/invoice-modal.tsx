"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useReactToPrint } from "react-to-print";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvoiceReceipt } from "./invoice-receipt";
import {
  generateInvoicePDF,
  shareViaWhatsApp,
  getTicketWidthMm,
  INVOICE_FORMATS,
  type InvoiceFormat,
} from "@/lib/invoice-helpers";
import { Sale, SaleItemWithProduct, Customer, UserProfile } from "@/lib/types";
import { Download, Printer, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

interface InvoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: Sale;
  saleItems: SaleItemWithProduct[];
  customer?: Customer | null;
  storeInfo: UserProfile;
  cashierName?: string;
  /** Celular para "Enviar por WhatsApp" cuando no hay cliente registrado (pedido web). */
  defaultPhone?: string;
}

const INVOICE_FORMAT_KEY = "invoice_format";

export function InvoiceModal({
  open,
  onOpenChange,
  sale,
  saleItems,
  customer,
  storeInfo,
  cashierName,
  defaultPhone,
}: InvoiceModalProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState(customer?.phone || defaultPhone || "");
  // Carta o tira térmica; se recuerda en este navegador (la impresora es del equipo)
  const [invoiceFormat, setInvoiceFormat] = useState<InvoiceFormat>("carta");
  const ticketWidthMm = getTicketWidthMm(invoiceFormat);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(INVOICE_FORMAT_KEY) as InvoiceFormat | null;
      if (saved && INVOICE_FORMATS.some((f) => f.id === saved)) {
        // Solo se puede leer localStorage después de montar (SSR)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setInvoiceFormat(saved);
      }
    } catch {
      // Sin acceso a localStorage: queda en carta
    }
  }, []);

  const changeInvoiceFormat = (next: InvoiceFormat) => {
    setInvoiceFormat(next);
    try {
      localStorage.setItem(INVOICE_FORMAT_KEY, next);
    } catch {
      // Sin acceso a localStorage: solo cambia en esta factura
    }
  };

  // Configurar impresión: en tira la hoja mide lo que mide el papel y el largo es libre
  const handlePrint = useReactToPrint({
    contentRef: invoiceRef,
    documentTitle: `Factura-${sale.sale_number}`,
    pageStyle: ticketWidthMm
      ? `
      @page {
        size: ${ticketWidthMm}mm auto;
        margin: 0;
      }
      @media print {
        html, body {
          width: ${ticketWidthMm}mm;
          margin: 0;
          padding: 0;
        }
      }
    `
      : `
      @page {
        size: letter;
        margin: 10mm;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
  });

  // Generar y descargar PDF
  const handleDownloadPDF = async () => {
    try {
      const doc = await generateInvoicePDF(
        {
          sale,
          saleItems,
          customer,
          storeInfo,
          cashierName,
        },
        invoiceFormat,
      );

      doc.save(`Factura-${sale.sale_number}.pdf`);
      toast.success("PDF descargado correctamente");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Error al generar PDF");
    }
  };

  // Enviar factura por WhatsApp con link al PDF en R2
  const handleShareWhatsApp = async () => {
    try {
      toast.loading("Generando link de factura...");

      // 1. Generar PDF como base64
      const doc = await generateInvoicePDF({ sale, saleItems, customer, storeInfo, cashierName });
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      const fileName = `Factura-${sale.sale_number}-${Date.now()}.pdf`;

      // 2. Subir PDF a R2 via Worker (con el token de Clerk, si no el Worker responde 401)
      const token = await getToken();
      const uploadRes = await fetch('/api/facturas/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pdfBase64, fileName }),
      });

      const uploadData = await uploadRes.json();
      toast.dismiss();

      if (!uploadData.success) {
        toast.error("Error al subir la factura");
        return;
      }

      // 3. Construir mensaje con link al PDF
      const storeName = storeInfo.full_name || 'TIENDA POS';
      const message =
        `🧾 *Factura de compra - ${storeName}*\n\n` +
        `Factura #${sale.sale_number}\n` +
        `Total: *$${sale.total.toLocaleString('es-CO')}*\n\n` +
        `📄 Descarga tu factura aquí:\n${uploadData.url}\n\n` +
        `✨ ¡Gracias por tu compra!`;

      // 4. Abrir WhatsApp con el link
      shareViaWhatsApp(phoneNumber, message);
      toast.success("WhatsApp abierto con el link de la factura");
    } catch (error) {
      toast.dismiss();
      console.error("Error compartiendo factura:", error);
      toast.error("Error al compartir la factura");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-black">
            Factura de Venta #{sale.sale_number}
          </DialogTitle>
        </DialogHeader>

        {/* Formato: carta o tira para la impresora térmica */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Formato:</span>
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5" role="radiogroup" aria-label="Formato de la factura">
            {INVOICE_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={invoiceFormat === f.id}
                onClick={() => changeInvoiceFormat(f.id)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  invoiceFormat === f.id
                    ? "bg-brand text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {ticketWidthMm && (
            <span className="text-xs text-gray-500">
              Para impresora térmica de {ticketWidthMm} mm
            </span>
          )}
        </div>

        {/* Vista previa de la factura (con scroll) — lo más importante primero */}
        <div className={`flex-1 overflow-y-auto ${ticketWidthMm ? "bg-gray-100 py-4" : ""}`}>
          <InvoiceReceipt
            ref={invoiceRef}
            sale={sale}
            saleItems={saleItems}
            customer={customer}
            storeInfo={storeInfo}
            cashierName={cashierName}
            ticketWidthMm={ticketWidthMm}
          />
        </div>

        {/* Footer: imprimir, descargar y enviar por WhatsApp juntos a la
            izquierda; cerrar a la derecha. */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            {/* Acciones sobre la factura */}
            <div className="flex flex-wrap items-end gap-2">
              <Button
                variant="outline"
                onClick={handlePrint}
                className="gap-2 text-black"
              >
                <Printer className="h-4 w-4 text-black" />
                Imprimir
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadPDF}
                className="gap-2 text-black"
              >
                <Download className="h-4 w-4 text-black" />
                Descargar
              </Button>

              {/* Enviar por WhatsApp: número + botón, al lado de las otras acciones */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-green-800 flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Enviar factura por WhatsApp
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Número de celular del cliente"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-48 md:w-56 text-gray-800"
                  />
                  <Button
                    onClick={handleShareWhatsApp}
                    className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Enviar
                  </Button>
                </div>
              </div>
            </div>

            {/* Cerrar */}
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="self-end md:self-auto"
            >
              <span className="text-black">Cerrar</span>
            </Button>
          </div>

          {/* Ayuda del número de WhatsApp */}
          {customer?.phone ? (
            <p className="text-xs text-green-700">
              Número cargado del cliente: <strong>{customer.phone}</strong>
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Ingresa el número o déjalo en blanco para elegir el contacto en WhatsApp
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
