import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getTransactionStatus } from '@/lib/epayco';
import { getUserProfile } from '@/lib/cloudflare-api';
import { activateEPaycoPayment } from '@/lib/epayco-activation';

/**
 * Endpoint para verificar manualmente si un pago fue aprobado
 * El usuario debe proporcionar el ID de transacción de ePayco
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      );
    }

    const { transactionId } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { error: 'Se requiere el ID de transacción' },
        { status: 400 }
      );
    }

    // Obtener el estado de la transacción desde ePayco
    const transaction = await getTransactionStatus(transactionId);

    if (!transaction || !transaction.data) {
      return NextResponse.json(
        { error: 'Transacción no encontrada en ePayco' },
        { status: 404 }
      );
    }

    const transactionData = transaction.data;

    // ePayco devuelve el estado como 'Aceptada', 'Rechazada', 'Pendiente'
    const status = transactionData.x_transaction_state || transactionData.estado;
    const amount = parseFloat(transactionData.x_amount || transactionData.valor);
    const reference = transactionData.x_id_invoice || transactionData.referencia;

    // Obtener el perfil del usuario
    const userProfile = await getUserProfile(getToken);

    if (!userProfile) {
      return NextResponse.json(
        { error: 'Perfil de usuario no encontrado' },
        { status: 404 }
      );
    }

    // Verificar que la transacción fue aprobada (ePayco usa 'Aceptada')
    if (status !== 'Aceptada') {
      return NextResponse.json({
        success: false,
        message: `El pago está en estado: ${status}`,
        transactionStatus: status,
        canActivate: false,
      });
    }

    // El pago debe ser de ESTE perfil: ePayco devuelve el userProfileId y el
    // planId en los extras que posib manda al crear el checkout. Antes se
    // activaba con cualquier transacción aprobada (incluso de otra tienda) y
    // el plan se adivinaba por el monto.
    const payerProfileId = transactionData.x_extra1;
    const planId = transactionData.x_extra2;
    if (!payerProfileId || !planId) {
      return NextResponse.json({
        success: false,
        message: 'Este pago no trae los datos de la cuenta. Escríbenos por WhatsApp con la referencia y lo activamos.',
        canActivate: false,
      });
    }
    if (payerProfileId !== userProfile.id) {
      return NextResponse.json({
        success: false,
        message: 'Este pago pertenece a otra cuenta.',
        canActivate: false,
      }, { status: 403 });
    }

    // Misma activación que el webhook y payment-status: el Worker suma el mes
    // y registra la transacción, idempotente por ref_payco.
    const apiUrl = process.env.NEXT_PUBLIC_CLOUDFLARE_API_URL || 'https://tienda-pos-api.julii1295.workers.dev';
    await activateEPaycoPayment({
      apiUrl,
      userProfileId: userProfile.id,
      planId,
      transactionId: transactionData.x_transaction_id,
      refPayco: transactionData.x_ref_payco || transactionId,
      amount,
      currency: transactionData.x_currency_code,
      invoice: reference,
    });

    return NextResponse.json({
      success: true,
      message: '¡Pago aplicado a tu cuenta!',
      subscription: { planId },
      transaction: {
        id: transactionId,
        amount,
        status,
      },
    });

  } catch (error) {
    console.error('Error verifying payment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al verificar el pago' },
      { status: 500 }
    );
  }
}
