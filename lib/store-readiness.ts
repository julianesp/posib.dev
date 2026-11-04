/**
 * ¿Está la tienda online lista para vender? Pasos que ve el tendero en
 * Configuración de la tienda (components/store-config/store-readiness-guide.tsx),
 * calculados con lo que ya tiene guardado. `target` es la sección de la página
 * (atributo data-guide) a la que lleva el botón "Ir".
 */

/**
 * Número de Nequi (o cuenta) válido: al menos 10 dígitos. Es requisito para
 * encender la tienda; misma regla que hasValidNequiNumber() del Worker
 * (utils/storefront-access.ts), que rechaza encenderla o recibir pedidos sin él.
 */
export function hasValidNequiNumber(value: string | null | undefined): boolean {
  return (value ?? '').replace(/\D/g, '').length >= 10;
}

export interface StoreReadinessInput {
  storeEnabled: boolean;
  storeName: string;
  storeSlug: string;
  storeWhatsapp: string;
  storeNequiNumber: string;
  paymentQrUrl: string;
  storeShippingEnabled: boolean;
  storePickupEnabled: boolean;
  /** null mientras se cargan los productos. */
  products: { stock: number; image_url?: string | null; images?: unknown }[] | null;
}

export interface ReadinessStep {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  /** Si es false, falta pero la tienda igual puede vender (p. ej. el QR). */
  required: boolean;
  target: string;
}

export interface ProductVisibility {
  /** Con stock y foto: se ven bien en la tienda. */
  ready: number;
  /** Con stock pero sin foto: se ven, con un ícono gris. */
  noPhoto: number;
  /** Sin stock: NO aparecen en la tienda. */
  noStock: number;
}

const anyUrl = (list: unknown) => Array.isArray(list) && list.some((u) => typeof u === 'string' && u.trim() !== '');

// `images` llega como texto JSON desde la API o ya convertido en lista
// (getProducts lo parsea en el navegador): se aceptan las dos formas.
const hasPhoto = (p: { image_url?: string | null; images?: unknown }) => {
  if (p.image_url) return true;
  if (Array.isArray(p.images)) return anyUrl(p.images);
  if (typeof p.images !== 'string' || !p.images.trim()) return false;
  try {
    return anyUrl(JSON.parse(p.images));
  } catch {
    return true; // una sola URL guardada como texto
  }
};

export function productVisibility(products: StoreReadinessInput['products']): ProductVisibility {
  const result = { ready: 0, noPhoto: 0, noStock: 0 };
  for (const p of products ?? []) {
    if (!(Number(p.stock) > 0)) result.noStock++;
    else if (hasPhoto(p)) result.ready++;
    else result.noPhoto++;
  }
  return result;
}

export function storeReadiness(input: StoreReadinessInput): {
  steps: ReadinessStep[];
  percent: number;
  canSell: boolean;
} {
  const visible = input.products ? productVisibility(input.products) : null;
  const visibleCount = visible ? visible.ready + visible.noPhoto : 0;

  const steps: ReadinessStep[] = [
    {
      id: 'nombre',
      title: 'Nombre y dirección web',
      hint: input.storeSlug ? `Tu tienda: posib.dev/store/${input.storeSlug}` : 'Elige el nombre y la dirección que vas a compartir.',
      done: !!input.storeName.trim() && !!input.storeSlug.trim(),
      required: true,
      target: 'store-info',
    },
    {
      id: 'nequi',
      title: 'Número de Nequi',
      hint: 'Obligatorio para activar la tienda: a este número te pagan los clientes.',
      done: hasValidNequiNumber(input.storeNequiNumber),
      required: true,
      target: 'store-contact',
    },
    {
      id: 'qr',
      title: 'QR de Nequi (opcional)',
      hint: 'Con el QR el cliente paga escaneando; sin él, pega tu número.',
      done: !!input.paymentQrUrl,
      required: false,
      target: 'store-contact',
    },
    {
      id: 'whatsapp',
      title: 'WhatsApp de la tienda',
      hint: 'Para que el cliente te escriba y te mande el comprobante.',
      done: input.storeWhatsapp.replace(/\D/g, '').length >= 10,
      required: true,
      target: 'store-contact',
    },
    {
      id: 'entregas',
      title: 'Cómo entregas',
      hint: 'Domicilio, recoger en la tienda o las dos.',
      done: input.storeShippingEnabled || input.storePickupEnabled,
      required: true,
      target: 'store-delivery',
    },
    {
      id: 'productos',
      title: 'Productos con stock',
      hint: visible
        ? visibleCount > 0
          ? `${visibleCount} producto${visibleCount === 1 ? '' : 's'} se verá${visibleCount === 1 ? '' : 'n'} en la tienda.`
          : 'Los productos sin stock no aparecen en la tienda.'
        : 'Revisando tus productos…',
      done: visibleCount > 0,
      required: true,
      target: 'store-products',
    },
    {
      id: 'activar',
      title: 'Activar la tienda',
      hint: 'Enciéndela y guarda para que tus clientes la vean.',
      done: input.storeEnabled,
      required: true,
      target: 'store-status',
    },
  ];

  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    percent: Math.round((done / steps.length) * 100),
    canSell: steps.every((s) => s.done || !s.required),
  };
}

/**
 * Zonas de envío creadas pero el domicilio apagado: el cliente no puede elegir
 * domicilio en el checkout. Devuelve cuántas zonas activas quedan sin uso.
 */
export function idleShippingZones(
  zones: { is_active?: boolean | number | null }[] | null,
  shippingEnabled: boolean
): number {
  if (shippingEnabled || !zones) return 0;
  return zones.filter((z) => Number(z.is_active ?? 1) === 1).length;
}
