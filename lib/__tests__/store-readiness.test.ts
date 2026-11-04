import { hasValidNequiNumber, idleShippingZones, productVisibility, storeReadiness, type StoreReadinessInput } from '../store-readiness';

const base: StoreReadinessInput = {
  storeEnabled: false,
  storeName: '',
  storeSlug: '',
  storeWhatsapp: '',
  storeNequiNumber: '',
  paymentQrUrl: '',
  storeShippingEnabled: false,
  storePickupEnabled: true,
  products: [],
};

describe('guía "¿Lista para vender?" de la tienda online', () => {
  it('una tienda nueva arranca con poco avance y no puede vender', () => {
    const r = storeReadiness(base);
    expect(r.canSell).toBe(false);
    expect(r.steps.find((s) => s.id === 'entregas')?.done).toBe(true); // recoger viene encendido
    expect(r.percent).toBe(14);
  });

  it('con lo obligatorio completo ya puede vender, aunque falte el QR', () => {
    const r = storeReadiness({
      ...base,
      storeEnabled: true,
      storeName: 'neurai',
      storeSlug: 'neurai',
      storeWhatsapp: '317 450 3604',
      storeNequiNumber: '3174503604',
      products: [{ stock: 3 }],
    });
    expect(r.canSell).toBe(true);
    expect(r.steps.find((s) => s.id === 'qr')).toMatchObject({ done: false, required: false });
    expect(r.percent).toBe(86);
  });

  it('todo completo = 100 %', () => {
    const r = storeReadiness({
      ...base,
      storeEnabled: true,
      storeName: 'neurai',
      storeSlug: 'neurai',
      storeWhatsapp: '3174503604',
      storeNequiNumber: '3174503604',
      paymentQrUrl: 'https://res.cloudinary.com/qr.png',
      products: [{ stock: 1, image_url: 'https://x/foto.jpg' }],
    });
    expect(r.percent).toBe(100);
  });

  it('sin productos con stock no puede vender (no aparecen en la tienda)', () => {
    const r = storeReadiness({ ...base, products: [{ stock: 0 }, { stock: -2 }] });
    expect(r.steps.find((s) => s.id === 'productos')).toMatchObject({ done: false });
  });

  it('cuenta qué productos se ven bien, cuáles sin foto y cuáles no aparecen', () => {
    expect(
      productVisibility([
        { stock: 5, image_url: 'https://x/a.jpg' },
        { stock: 2, images: '["https://x/b.jpg"]' },
        { stock: 1, images: '[]' },
        { stock: 4 },
        { stock: 0, image_url: 'https://x/c.jpg' },
        // En el navegador getProducts ya entrega `images` como lista
        { stock: 3, images: ['https://x/d.jpg'] },
        { stock: 3, images: [] },
      ])
    ).toEqual({ ready: 3, noPhoto: 3, noStock: 1 });
  });
});

describe('Nequi obligatorio para activar la tienda', () => {
  it.each([
    ['3174503604', true],
    ['317 450 3604', true],
    ['+57 317-450-3604', true],
    ['12345678901', true], // cuenta bancaria
    ['317450', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (value, expected) => {
    expect(hasValidNequiNumber(value)).toBe(expected);
  });
});

describe('zonas de envío con el domicilio apagado', () => {
  it('cuenta las zonas activas que el cliente no puede usar', () => {
    expect(idleShippingZones([{ is_active: 1 }, { is_active: 0 }, { is_active: true }], false)).toBe(2);
  });

  it('no avisa si el domicilio está encendido o no hay zonas', () => {
    expect(idleShippingZones([{ is_active: 1 }], true)).toBe(0);
    expect(idleShippingZones([], false)).toBe(0);
    expect(idleShippingZones(null, false)).toBe(0);
  });
});
