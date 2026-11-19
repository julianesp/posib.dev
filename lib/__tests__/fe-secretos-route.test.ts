/**
 * Ruta de Next /api/fe/secretos: valida la firma digital, la cifra y la manda
 * al Worker. Clerk y el Worker se simulan.
 */
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { descifrar, descifrarTexto } from '../fe-dian/boveda';
import { crearP12DePrueba } from './helpers/certificado-prueba';

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => ({ userId: 'clerk_dueno', getToken: async () => 'jwt' })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('../../app/api/fe/secretos/route') as typeof import('../../app/api/fe/secretos/route');

const CLAVE = randomBytes(32).toString('base64');

type Llamada = { url: string; init?: RequestInit };

function simularWorker(opciones: { estadoConfig?: number; nit?: string | null } = {}) {
  const llamadas: Llamada[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    if (url.endsWith('/api/fe-config')) {
      return new Response(JSON.stringify({ success: true, data: { tenant_id: 't_tienda', nit: opciones.nit ?? null } }), {
        status: opciones.estadoConfig ?? 200,
      });
    }
    return new Response(JSON.stringify({ success: true, data: { status: 'borrador' } }), { status: 200 });
  }) as unknown as typeof fetch;
  return llamadas;
}

function pedir(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/fe/secretos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': 't_tienda' },
      body: JSON.stringify(body),
    }),
  );
}

describe('/api/fe/secretos', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.FE_MASTER_KEY = CLAVE;
    process.env.CRON_SECRET = 'cron';
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('cifra la firma y el PIN antes de enviarlos al Worker (nunca en claro)', async () => {
    const llamadas = simularWorker();
    const { p12, clave } = crearP12DePrueba('maticerts-pin');
    const res = await pedir({ p12Base64: Buffer.from(p12).toString('base64'), p12Clave: clave, pin: '12345' });
    expect(res.status).toBe(200);

    const guardado = llamadas.find((l) => l.url.endsWith('/api/fe-internal/secretos'))!;
    expect((guardado.init!.headers as Record<string, string>)['X-Cron-Secret']).toBe('cron');
    const enviado = JSON.parse(String(guardado.init!.body));
    expect(enviado.tenant_id).toBe('t_tienda');
    expect(String(guardado.init!.body)).not.toContain('12345');
    expect(await descifrarTexto(enviado.pin_cifrado, CLAVE, 't_tienda')).toBe('12345');
    // La llave descifrada es un PKCS#8 válido para WebCrypto.
    const llave = await descifrar(enviado.certificado.llave_cifrada, CLAVE, 't_tienda');
    await expect(
      crypto.subtle.importKey('pkcs8', llave as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']),
    ).resolves.toBeDefined();
    expect(enviado.certificado).toMatchObject({ titular: 'TIENDA DE PRUEBA SAS', proveedor: 'maticerts' });
    expect(JSON.parse(enviado.certificado.cadena)).toHaveLength(1);
  });

  it('clave del .p12 equivocada → mensaje claro y no guarda nada', async () => {
    const llamadas = simularWorker();
    const { p12 } = crearP12DePrueba('buena');
    const res = await pedir({ p12Base64: Buffer.from(p12).toString('base64'), p12Clave: 'mala' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/clave/);
    expect(llamadas.some((l) => l.url.includes('fe-internal'))).toBe(false);
  });

  it('firma vencida → la rechaza con el motivo', async () => {
    simularWorker();
    const { p12, clave } = crearP12DePrueba('x', { vencido: true });
    const res = await pedir({ p12Base64: Buffer.from(p12).toString('base64'), p12Clave: clave });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.problemas.join(' ')).toMatch(/no está vigente/);
  });

  it('avisa si la firma no parece ser de la tienda (regla DIAN ZE03)', async () => {
    simularWorker({ nit: '900108281' });
    const { p12, clave } = crearP12DePrueba();
    const json = await (await pedir({ p12Base64: Buffer.from(p12).toString('base64'), p12Clave: clave })).json();
    expect(json.avisos[0]).toMatch(/900108281/);
  });

  it('solo el dueño; PIN con letras rechazado', async () => {
    simularWorker({ estadoConfig: 403 });
    expect((await pedir({ pin: '12345' })).status).toBe(403);
    simularWorker();
    expect((await pedir({ pin: 'abc' })).status).toBe(400);
  });

  it('sin FE_MASTER_KEY en el servidor no hace nada', async () => {
    delete process.env.FE_MASTER_KEY;
    const llamadas = simularWorker();
    expect((await pedir({ pin: '12345' })).status).toBe(500);
    expect(llamadas).toHaveLength(0);
  });
});
