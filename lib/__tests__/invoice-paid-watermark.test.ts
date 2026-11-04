/**
 * Sello PAGADA de la factura: solo en ventas pagadas, en carta y en tira.
 */
import { generateInvoicePDF, isSalePaid } from '../invoice-helpers';
import type { Sale, UserProfile } from '../types';

const sale = (extra: Partial<Sale>) =>
  ({
    id: 's1',
    sale_number: 'WEB-20261104-000001',
    cashier_id: 't1',
    subtotal: 9600,
    tax: 0,
    discount: 0,
    total: 9600,
    payment_method: 'transferencia',
    status: 'completada',
    created_at: '2026-11-04T15:00:00Z',
    updated_at: '2026-11-04T15:00:00Z',
    ...extra,
  }) as Sale;

const store = { full_name: 'La Esquina' } as UserProfile;
const items = [{ id: 'i1', sale_id: 's1', product_id: 'p1', quantity: 2, unit_price: 4800, discount: 0, subtotal: 9600, product: { name: 'Arroz' } }] as never;

describe('isSalePaid', () => {
  it.each([
    ['venta de mostrador en efectivo', { payment_method: 'efectivo' as const }, true],
    ['pedido web confirmado', { payment_status: 'pagado' as const }, true],
    ['pedido web sin confirmar', { status: 'pendiente' as const, payment_status: 'pendiente' as const }, false],
    ['fiado con saldo', { payment_method: 'credito' as const, status: 'pendiente' as const, payment_status: 'parcial' as const }, false],
    ['fiado ya pagado', { payment_method: 'credito' as const, payment_status: 'pagado' as const }, true],
    ['venta anulada', { status: 'cancelada' as const, payment_method: 'efectivo' as const }, false],
  ])('%s → %s', (_caso, extra, expected) => {
    expect(isSalePaid(sale(extra))).toBe(expected);
  });
});

describe('PDF de la factura', () => {
  const pdfText = async (s: Sale, format: 'carta' | 'tira58' = 'carta') =>
    (await generateInvoicePDF({ sale: s, saleItems: items, storeInfo: store }, format)).output();

  it('una factura pagada lleva PAGADA (carta y tira)', async () => {
    expect(await pdfText(sale({ payment_status: 'pagado' }))).toContain('(PAGADA)');
    expect(await pdfText(sale({ payment_status: 'pagado' }), 'tira58')).toContain('(PAGADA)');
  });

  it('un pedido sin pagar no lleva el sello', async () => {
    expect(await pdfText(sale({ status: 'pendiente', payment_status: 'pendiente' }))).not.toContain('(PAGADA)');
  });
});
