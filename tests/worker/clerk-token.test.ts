import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from '../../cloudflare-migration/src/types';
import {
  isAllowedClerkIssuer,
  verifyClerkToken,
} from '../../cloudflare-migration/src/middleware/auth';

// En el Worker jose usa su build "browser", que baja el JWKS con fetch; en Jest
// carga la build de Node (node:https). Se cambia por fetch para que el JWKS
// salga del fetch simulado de abajo.
jest.mock(
  '../../cloudflare-migration/node_modules/jose/dist/node/cjs/runtime/fetch_jwks.js',
  () => ({
    __esModule: true,
    default: async (url: URL) => {
      const res = await fetch(url);
      if (res.status !== 200) throw new Error('Expected 200 OK from the JSON Web Key Set HTTP response');
      return res.json();
    },
  })
);

const PROD ='https://clerk.posib.dev';
const DEV = 'https://excited-foal-90.clerk.accounts.dev';
const env = { CLERK_JWT_ISSUERS: `${PROD},${DEV}` } as Env;

// Claves de "nuestro" Clerk y de un atacante; el fetch simulado sirve el JWKS
// que corresponde a cada host, como lo haría internet.
let keys: Record<string, CryptoKeyPair>;
const realFetch = global.fetch;

async function token(issuer: string, sub: string, key = keys[issuer].privateKey) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

beforeAll(async () => {
  keys = {
    [PROD]: await generateKeyPair('RS256'),
    'https://clerk.atacante.com': await generateKeyPair('RS256'),
    'https://otra.clerk.accounts.dev': await generateKeyPair('RS256'),
  };
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    const pair = keys[url.origin];
    if (!pair || url.pathname !== '/.well-known/jwks.json') return new Response('', { status: 404 });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    return new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('isAllowedClerkIssuer', () => {
  it('acepta solo los issuers configurados (con o sin "/" final)', () => {
    expect(isAllowedClerkIssuer(PROD, env)).toBe(true);
    expect(isAllowedClerkIssuer(`${DEV}/`, env)).toBe(true);
    expect(isAllowedClerkIssuer(PROD, { CLERK_JWT_ISSUER: `${PROD}/` } as Env)).toBe(true);
  });

  it('rechaza hosts parecidos a Clerk que no son nuestros', () => {
    expect(isAllowedClerkIssuer('https://clerk.atacante.com', env)).toBe(false);
    expect(isAllowedClerkIssuer('https://otra.clerk.accounts.dev', env)).toBe(false);
    expect(isAllowedClerkIssuer('https://clerk.posib.dev.atacante.com', env)).toBe(false);
  });

  it('sin configuración no acepta ningún issuer', () => {
    expect(isAllowedClerkIssuer(PROD, {} as Env)).toBe(false);
  });
});

describe('verifyClerkToken', () => {
  it('devuelve el sub de un token firmado por nuestro Clerk', async () => {
    expect(await verifyClerkToken(await token(PROD, 'user_dueno'), env)).toBe('user_dueno');
  });

  it('rechaza un token firmado por un Clerk del atacante con el sub de otro usuario', async () => {
    const forjado = await token('https://clerk.atacante.com', 'user_superadmin');
    expect(await verifyClerkToken(forjado, env)).toBeNull();
    const otroDev = await token('https://otra.clerk.accounts.dev', 'user_superadmin');
    expect(await verifyClerkToken(otroDev, env)).toBeNull();
  });

  it('rechaza un token con nuestro issuer pero firmado con otra clave', async () => {
    const forjado = await token(PROD, 'user_superadmin', keys['https://clerk.atacante.com'].privateKey);
    expect(await verifyClerkToken(forjado, env)).toBeNull();
  });

  it('rechaza un token sin firmar (como el que aceptaba /team-invitations/accept)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const sinFirma = `${b64({ alg: 'none' })}.${b64({ iss: PROD, sub: 'user_otro' })}.`;
    expect(await verifyClerkToken(sinFirma, env)).toBeNull();
  });
});
