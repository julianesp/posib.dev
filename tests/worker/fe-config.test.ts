/**
 * Facturación electrónica — configuración por tienda (/api/fe-config y
 * /api/fe-internal/secretos) contra el esquema real de D1 (migración 035).
 */
import { Hono } from 'hono';
import feConfigRoutes, { calcularDv, feInternal, setAprobado, validarFeConfig, validarPruebas } from '../../cloudflare-migration/src/routes/fe-config';
import { D1DatabaseFake } from './helpers/d1-sqlite';

const SECRETO = 'cron-secreto';
const SOFTWARE_ID = '56f2ae4e-9812-4fad-9255-08fcfcd5ccb0';

const DATOS = {
  tipo_persona: '2',
  nit: '900108281',
  dv: '3',
  razon_social: 'Cielo López',
  responsabilidades: 'r-99-pn',
  tributo: 'ZZ',
  municipio_codigo: '86001',
  municipio: 'Mocoa',
  departamento: 'Putumayo',
  departamento_codigo: '86',
  direccion: 'Barrio Centro',
  correo: 'cielo@example.com',
  software_id: SOFTWARE_ID,
  test_set_id: '4de36cb4-9973-4ea4-a156-34e909aa24dc',
};

describe('calcularDv y validarFeConfig', () => {
  it('calcula el dígito de verificación como la DIAN', () => {
    expect(calcularDv('900108281')).toBe('3');
    expect(calcularDv('800197268')).toBe('4'); // NIT de la DIAN
  });

  it('normaliza NIT y responsabilidades', () => {
    const r = validarFeConfig({ nit: '900.108.281', responsabilidades: 'o-13; o-15;' });
    expect(r).toEqual({ ok: true, value: { nit: '900108281', responsabilidades: 'O-13;O-15' } });
  });

  it('rechaza DV equivocado, DANE inconsistente, IDs DIAN mal formados', () => {
    expect(validarFeConfig({ nit: '900108281', dv: '5' })).toEqual({
      ok: false,
      error: 'El dígito de verificación no corresponde al NIT (debería ser 3)',
    });
    expect(validarFeConfig({ municipio_codigo: '05001', departamento_codigo: '86' }).ok).toBe(false);
    expect(validarFeConfig({ software_id: 'abc' }).ok).toBe(false);
    expect(validarFeConfig({ responsabilidades: 'cualquiera' }).ok).toBe(false);
    expect(validarFeConfig({ tributo: '99' }).ok).toBe(false);
  });

  it('campos vacíos se guardan como null', () => {
    expect(validarFeConfig({ telefono: '  ' })).toEqual({ ok: true, value: { telefono: null } });
  });
});

describe('rutas', () => {
  let db: D1DatabaseFake;

  const app = (clerkUserId: string) => {
    const a = new Hono();
    a.route('/api/fe-internal', feInternal);
    a.use('/api/fe-config/*', async (c, next) => {
      c.set('tenant' as never, { id: 't_tienda' } as never);
      c.set('clerkUserId' as never, clerkUserId as never);
      await next();
    });
    a.route('/api/fe-config', feConfigRoutes);
    return a;
  };

  const call = async (clerkUserId: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app(clerkUserId).request(
      url,
      { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined },
      { DB: db, CRON_SECRET: SECRETO },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };

  const secretos = (body: unknown, secreto = SECRETO) =>
    call('', 'PUT', '/api/fe-internal/secretos', body, { 'X-Cron-Secret': secreto });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db = new D1DatabaseFake();
    db.insert('user_profiles', {
      id: 't_tienda',
      clerk_user_id: 'clerk_dueno',
      email: 'dueno@tienda.co',
      role: 'admin',
      subscription_status: 'active',
      has_fe_addon: 1,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('sin configuración: estado borrador con todo pendiente', async () => {
    const r = await call('clerk_dueno', 'GET', '/api/fe-config');
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe('borrador');
    expect(r.json.data.faltantes).toContain('Firma digital (.p12)');
    expect(r.json.data.certificado).toBeNull();
  });

  it('sin activación del superadmin, ni el dueño la ve ni se pueden subir firmas', async () => {
    await db.prepare('UPDATE user_profiles SET has_fe_addon = 0 WHERE id = ?').bind('t_tienda').run();
    const r = await call('clerk_dueno', 'GET', '/api/fe-config');
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('FE_NO_ACTIVADA');
    expect((await call('clerk_dueno', 'PUT', '/api/fe-config', DATOS)).status).toBe(403);
    expect((await secretos({ tenant_id: 't_tienda', pin_cifrado: 'v1:x' })).status).toBe(403);
  });

  it('solo el dueño puede ver o cambiar la configuración', async () => {
    expect((await call('clerk_cajero', 'GET', '/api/fe-config')).status).toBe(403);
    expect((await call('clerk_cajero', 'PUT', '/api/fe-config', DATOS)).status).toBe(403);
  });

  it('guarda los datos fiscales y sigue en borrador sin PIN ni firma', async () => {
    const r = await call('clerk_dueno', 'PUT', '/api/fe-config', DATOS);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ status: 'borrador', nit: '900108281', responsabilidades: 'R-99-PN' });
    expect(r.json.data.faltantes).toEqual(['PIN del software', 'Firma digital (.p12)']);

    // Un segundo guardado parcial no borra lo anterior.
    const r2 = await call('clerk_dueno', 'PUT', '/api/fe-config', { telefono: '3001234567' });
    expect(r2.json.data).toMatchObject({ nit: '900108281', telefono: '3001234567' });
  });

  it('con datos + PIN + firma queda lista para el set de pruebas, sin exponer secretos', async () => {
    await call('clerk_dueno', 'PUT', '/api/fe-config', DATOS);
    const r = await secretos({
      tenant_id: 't_tienda',
      pin_cifrado: 'v1:PIN',
      certificado: {
        llave_cifrada: 'v1:LLAVE',
        cadena: '[]',
        titular: 'CIELO LOPEZ',
        emisor: 'CN=Viafirma',
        valido_desde: '2026-11-20T00:00:00.000Z',
        vence: '2027-11-20T00:00:00.000Z',
      },
    });
    expect(r.status).toBe(200);

    const g = await call('clerk_dueno', 'GET', '/api/fe-config');
    expect(g.json.data.status).toBe('listo_pruebas');
    expect(g.json.data.faltantes).toEqual([]);
    expect(g.json.data.tiene_pin).toBe(true);
    expect(g.json.data.certificado).toMatchObject({ proveedor: 'maticerts', titular: 'CIELO LOPEZ', vence: '2027-11-20T00:00:00.000Z' });
    expect(JSON.stringify(g.json)).not.toContain('v1:');
  });

  it('la ruta interna exige el secreto y que los datos lleguen cifrados', async () => {
    expect((await secretos({ tenant_id: 't_tienda', pin_cifrado: 'v1:x' }, 'otro')).status).toBe(401);
    expect((await secretos({ tenant_id: 't_tienda', pin_cifrado: '12345' })).status).toBe(400);
    expect((await secretos({ tenant_id: 't_otra', pin_cifrado: 'v1:x' })).status).toBe(404);
  });

  it('una tienda ya habilitada no vuelve a borrador al editar datos', async () => {
    await call('clerk_dueno', 'PUT', '/api/fe-config', DATOS);
    await db.prepare("UPDATE fe_config SET status = 'habilitado' WHERE tenant_id = ?").bind('t_tienda').run();
    const r = await call('clerk_dueno', 'PUT', '/api/fe-config', { telefono: null });
    expect(r.json.data.status).toBe('habilitado');
  });
});

describe('set de pruebas (ruta interna)', () => {
  let db: D1DatabaseFake;
  const pedir = async (method: string, url: string, body?: unknown, secreto = SECRETO) => {
    const a = new Hono();
    a.route('/api/fe-internal', feInternal);
    const res = await a.request(
      url,
      { method, headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': secreto }, body: body ? JSON.stringify(body) : undefined },
      { DB: db, CRON_SECRET: SECRETO },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };
  const doc = (numero: string, estado: string, tipo = 'Invoice') => ({ numero, tipo, zip_key: 'z-' + numero, estado, errores: [] });
  const pruebas = (docs: unknown[]) => ({
    enviado_at: '2026-11-19T20:00:00.000Z',
    consultado_at: null,
    cantidades: { facturas: 2, notas_credito: 1, notas_debito: 0 },
    documentos: docs,
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db = new D1DatabaseFake();
    db.insert('user_profiles', { id: 't_tienda', clerk_user_id: 'clerk_dueno', email: 'd@t.co', role: 'admin', subscription_status: 'active', has_fe_addon: 1 });
    db.insert('fe_config', {
      ...DATOS, tenant_id: 't_tienda', status: 'listo_pruebas', software_pin_cifrado: 'v1:PIN',
      cert_llave_cifrada: 'v1:LLAVE', created_at: 'x', updated_at: 'x',
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('entrega la configuración completa solo con el secreto y solo si está activada', async () => {
    const ok = await pedir('GET', '/api/fe-internal/config/t_tienda');
    expect(ok.status).toBe(200);
    expect(ok.json.data.cert_llave_cifrada).toBe('v1:LLAVE');
    expect((await pedir('GET', '/api/fe-internal/config/t_tienda', undefined, 'otro')).status).toBe(401);
    await db.prepare('UPDATE user_profiles SET has_fe_addon = 0').run();
    expect((await pedir('GET', '/api/fe-internal/config/t_tienda')).status).toBe(403);
  });

  it('guarda el avance sin habilitar mientras falten aceptaciones', async () => {
    const r = await pedir('PUT', '/api/fe-internal/pruebas', {
      tenant_id: 't_tienda',
      pruebas: pruebas([doc('SETP1', 'aceptado'), doc('SETP2', 'rechazado'), doc('NC1', 'enviado', 'CreditNote')]),
    });
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe('listo_pruebas');
    expect(r.json.data.pruebas.documentos).toHaveLength(3);
  });

  it('con todos los documentos pedidos aceptados, la tienda queda habilitada', async () => {
    const r = await pedir('PUT', '/api/fe-internal/pruebas', {
      tenant_id: 't_tienda',
      pruebas: pruebas([doc('SETP1', 'aceptado'), doc('SETP2', 'aceptado'), doc('NC1', 'aceptado', 'CreditNote')]),
    });
    expect(r.json.data.status).toBe('habilitado');
  });

  it('rechaza resultados mal formados', async () => {
    expect((await pedir('PUT', '/api/fe-internal/pruebas', { tenant_id: 't_tienda', pruebas: { documentos: 'x' } })).status).toBe(400);
    expect(validarPruebas({ ...pruebas([doc('A', 'raro')]) })).toBeNull();
  });

  it('setAprobado exige la cantidad pedida, no solo que lo enviado esté bien', () => {
    expect(setAprobado(validarPruebas(pruebas([doc('SETP1', 'aceptado')]))!)).toBe(false);
  });
});
