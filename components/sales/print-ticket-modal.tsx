'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TicketReceipt } from './ticket-receipt';
import { printTicket } from '@/lib/print-helpers';
import { Printer, X } from 'lucide-react';

interface PrintTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketData: {
    saleNumber: string;
    date: Date;
    items: Array<{
      name: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }>;
    subtotal: number;
    discount: number;
    total: number;
    paymentMethod: string;
    customerName?: string;
    customerPoints?: number;
    pointsEarned?: number;
    pointsRedeemed?: number;
    storeName?: string;
  };
}

export function PrintTicketModal({ isOpen, onClose, ticketData }: PrintTicketModalProps) {
  const ticketRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    printTicket(ticketRef.current);
  };

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <Card className="max-w-md w-full max-h-[90vh] overflow-y-auto bg-white">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold">Ticket de Venta</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Ticket Preview */}
        <div className="p-4">
          <div className="bg-gray-100 p-4 rounded-lg mb-4 flex justify-center">
            <TicketReceipt ref={ticketRef} {...ticketData} />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={handlePrint}
              className="flex-1"
              size="lg"
            >
              <Printer className="h-4 w-4 mr-2" />
              Imprimir Ticket
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              size="lg"
            >
              Cerrar
            </Button>
          </div>

          <p className="text-xs text-center text-gray-500 mt-3">
            El ticket se abrirá en una ventana de impresión.
            <br />
            Puedes guardarlo como PDF desde allí.
          </p>
        </div>
      </Card>
    </div>
  );
}
