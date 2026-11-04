/**
 * El checkout (lib/storefront-delivery.ts) y el Worker deben ofrecer las mismas
 * formas de entrega: si no, el cliente elige una opción que el servidor rechaza.
 */
import { allowedDeliveryMethods as front } from '../../lib/storefront-delivery';
import { allowedDeliveryMethods as worker } from '../../cloudflare-migration/src/routes/storefront';

describe('formas de entrega de la tienda', () => {
  it.each([
    [{ store_shipping_enabled: 1, store_pickup_enabled: 1 }, { shipping: true, pickup: true }],
    [{ store_shipping_enabled: 0, store_pickup_enabled: 1 }, { shipping: false, pickup: true }],
    [{ store_shipping_enabled: 1, store_pickup_enabled: 0 }, { shipping: true, pickup: false }],
    // Las dos apagadas: se deja recoger para que la tienda no quede sin pedidos.
    [{ store_shipping_enabled: 0, store_pickup_enabled: 0 }, { shipping: false, pickup: true }],
    // Tiendas viejas sin configurar: domicilio nace apagado, recogida encendida.
    [{ store_shipping_enabled: null, store_pickup_enabled: null }, { shipping: false, pickup: true }],
    [{}, { shipping: false, pickup: true }],
  ])('%j → %j (igual en el checkout y en el Worker)', (config, expected) => {
    expect(front(config)).toEqual(expected);
    expect(worker(config)).toEqual(expected);
  });
});
