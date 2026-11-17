/**
 * Clientes repetidos: borrar solo si no tiene historial y unir duplicados
 * sin perder ventas, abonos, deuda ni puntos (caso Saira: "Valentina villareal" x2).
 */
import { createWorker, seed } from './helpers/worker-app';

type Worker = ReturnType<typeof createWorker>;
let w: Worker;

const customer = (id: string) =>
  w.db.get<{ name: string; current_debt: number; loyalty_points: number; phone: string | null }>(
    'SELECT name, current_debt, loyalty_points, phone FROM customers WHERE id = ?',
    id
  );

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  w = createWorker();
  seed(w.db);
  // El repetido: misma persona, con su propio fiado y teléfono.
  w.db.insert('customers', {
    id: 'cli_rosa_2',
    tenant_id: 'tenant_tienda',
    name: 'Doña Rosa',
    phone: '3001234567',
    current_debt: 22800,
    loyalty_points: 5,
  });
  const { json } = await w.call('POST', '/api/sales', {
    total: 22800,
    payment_method: 'credito',
    customer_id: 'cli_rosa_2',
    items: [{ product_id: 'prod_pan', quantity: 2, unit_price: 11400, subtotal: 22800 }],
  });
  await w.call('POST', '/api/credit-payments', {
    sale_id: json.data.id,
    customer_id: 'cli_rosa_2',
    amount: 2800,
    payment_method: 'efectivo',
    cashier_id: 'tenant_tienda',
  });
});

describe('clientes repetidos', () => {
  it('no deja borrar un cliente con ventas o abonos (perdería el fiado)', async () => {
    const { status, json } = await w.call('DELETE', '/api/customers/cli_rosa_2');
    expect(status).toBe(409);
    expect(json.error).toContain('únelo');
    expect(customer('cli_rosa_2')).toBeTruthy();
  });

  it('borra un cliente sin historial', async () => {
    expect((await w.call('DELETE', '/api/customers/cli_pedro')).status).toBe(200);
    expect(customer('cli_pedro')).toBeUndefined();
  });

  it('une el repetido con el otro: pasa ventas y abonos, suma deuda y puntos, completa datos', async () => {
    const before = customer('cli_rosa')!;
    const debtSecond = customer('cli_rosa_2')!.current_debt;
    const { status } = await w.call('POST', '/api/customers/cli_rosa_2/merge', { into: 'cli_rosa' });
    expect(status).toBe(200);

    expect(customer('cli_rosa_2')).toBeUndefined();
    const merged = customer('cli_rosa')!;
    expect(merged.current_debt).toBe(before.current_debt + debtSecond);
    expect(merged.loyalty_points).toBe(before.loyalty_points + 5);
    expect(merged.phone).toBe('3001234567');
    expect(w.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sales WHERE customer_id = 'cli_rosa_2'")!.n).toBe(0);
    expect(w.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sales WHERE customer_id = 'cli_rosa'")!.n).toBe(1);
    expect(w.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM credit_payments WHERE customer_id = 'cli_rosa'")!.n).toBe(1);
  });

  it('no une con sí mismo ni con un cliente de otra tienda', async () => {
    expect((await w.call('POST', '/api/customers/cli_rosa_2/merge', { into: 'cli_rosa_2' })).status).toBe(400);
    w.db.insert('customers', { id: 'cli_ajeno', tenant_id: 'tenant_vecina', name: 'Ajeno' });
    expect((await w.call('POST', '/api/customers/cli_rosa_2/merge', { into: 'cli_ajeno' })).status).toBe(404);
  });
});
