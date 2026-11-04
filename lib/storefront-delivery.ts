/**
 * Formas de entrega que ofrece una tienda online, según Configuración de la
 * tienda → Envío / Recogida. Misma regla que allowedDeliveryMethods() del
 * Worker (cloudflare-migration/src/routes/storefront.ts), que rechaza el pedido
 * si no se cumple:
 *  - Domicilio solo si el tendero lo activó (la columna nace en 0).
 *  - Recogida salvo que la apague.
 *  - Si apagó las dos, se permite recoger para no dejar la tienda sin pedidos.
 */
export function allowedDeliveryMethods(config: {
  store_shipping_enabled?: number | boolean | null;
  store_pickup_enabled?: number | boolean | null;
}): { shipping: boolean; pickup: boolean } {
  const shipping = Number(config.store_shipping_enabled) === 1;
  const pickup = config.store_pickup_enabled == null || Number(config.store_pickup_enabled) !== 0;
  return { shipping, pickup: pickup || !shipping };
}
