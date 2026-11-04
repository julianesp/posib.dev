/**
 * ePayco Storefront Routes
 * Endpoints públicos para pagos con ePayco en tiendas online de comerciantes
 */

import { Hono } from 'hono';
import type { APIResponse, AppEnv } from '../types';

const app = new Hono<AppEnv>();

// POST /api/storefront/epayco/create-session/:slug
// DESACTIVADA (410): el monto lo mandaba el navegador y no se comparaba con el total
// del pedido (se podía pagar menos de lo pedido). Ninguna pantalla la usaba; la
// tienda cobra por Nequi con referencia. Si se reactiva, el monto debe salir de
// `sales.total` del pedido, nunca del body.
app.post('/create-session/:slug', (c) =>
  c.json<APIResponse>(
    { success: false, error: 'El pago con ePayco desde la tienda no está disponible. Paga por Nequi.' },
    410
  )
);

// GET /api/storefront/epayco/transaction/:refPayco
// Consulta el estado de una transacción ePayco por ref_payco
app.get('/transaction/:refPayco', async (c) => {
  const refPayco = c.req.param('refPayco');

  try {
    if (!refPayco) {
      return c.json<APIResponse>({
        success: false,
        error: 'refPayco es requerido',
      }, 400);
    }

    // Consultar estado de la transacción en ePayco
    const epaycoResponse = await fetch(
      `https://secure.epayco.co/validation/v1/reference/${encodeURIComponent(refPayco)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!epaycoResponse.ok) {
      const errorText = await epaycoResponse.text().catch(() => '');
      console.error('ePayco transaction lookup error:', epaycoResponse.status, errorText);
      return c.json<APIResponse>({
        success: false,
        error: 'Error al consultar transacción en ePayco',
      }, 502);
    }

    const epaycoData = await epaycoResponse.json() as any;

    if (!epaycoData?.success) {
      return c.json<APIResponse>({
        success: false,
        error: epaycoData?.titleResponse || 'Transacción no encontrada',
      }, 404);
    }

    const tx = epaycoData.data;

    // Normalizar estado ePayco a valores internos
    const stateMap: Record<string, string> = {
      'Aceptada': 'APPROVED',
      'Rechazada': 'DECLINED',
      'Pendiente': 'PENDING',
      'Fallida': 'DECLINED',
      'Cancelada': 'DECLINED',
      'Revertida': 'DECLINED',
    };

    const normalizedStatus = stateMap[tx?.x_transaction_state] || 'PENDING';

    return c.json<APIResponse>({
      success: true,
      data: {
        ref_payco: tx?.x_ref_payco,
        transaction_id: tx?.x_transaction_id,
        status: normalizedStatus,
        status_raw: tx?.x_transaction_state,
        amount: parseFloat(tx?.x_amount || '0'),
        currency: tx?.x_currency_code,
        payment_method: tx?.x_franchise || tx?.x_type_payment,
        approval_code: tx?.x_approval_code,
        transaction_date: tx?.x_transaction_date,
        bank_name: tx?.x_bank_name,
        description: tx?.x_description,
        extra1: tx?.x_extra1,
        extra2: tx?.x_extra2,
        extra3: tx?.x_extra3,
        customer_email: tx?.x_customer_email || tx?.x_cardnumber,
        error_code: tx?.x_error_code,
        error_code_ewallet: tx?.x_error_code_ewallet,
      },
    });

  } catch (error: any) {
    console.error('Error fetching ePayco transaction:', error);
    return c.json<APIResponse>({
      success: false,
      error: error.message || 'Error al consultar transacción',
    }, 500);
  }
});

export default app;
