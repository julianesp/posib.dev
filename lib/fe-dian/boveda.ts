/**
 * Bóveda para los secretos de facturación electrónica de cada tienda: la llave
 * privada del certificado y el PIN del software DIAN.
 *
 * Cifrado AES-256-GCM con una clave maestra (FE_MASTER_KEY, 32 bytes en base64)
 * que vive SOLO en el servidor de Next (Vercel). El Worker/D1 guarda el texto
 * cifrado pero nunca puede descifrarlo: si alguien obtiene una copia de la base
 * de datos, no obtiene las firmas digitales de las tiendas.
 *
 * Formato: "v1:" + base64(iv[12] || ciphertext+tag). El `contexto` (p. ej. el
 * tenant) va como dato adicional autenticado: un secreto cifrado para una tienda
 * no se puede copiar a otra.
 */

const VERSION = 'v1';

function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function desdeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

async function importarClave(claveMaestraB64: string): Promise<CryptoKey> {
  let bruta: Uint8Array;
  try {
    bruta = desdeBase64(claveMaestraB64);
  } catch {
    bruta = new Uint8Array(0);
  }
  if (bruta.length !== 32) throw new Error('FE_MASTER_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32).');
  return crypto.subtle.importKey('raw', bruta as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cifrar(datos: Uint8Array | string, claveMaestraB64: string, contexto: string): Promise<string> {
  const clave = await importarClave(claveMaestraB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plano = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(contexto) },
      clave,
      plano as BufferSource,
    ),
  );
  const todo = new Uint8Array(iv.length + cifrado.length);
  todo.set(iv);
  todo.set(cifrado, iv.length);
  return `${VERSION}:${aBase64(todo)}`;
}

export async function descifrar(sobre: string, claveMaestraB64: string, contexto: string): Promise<Uint8Array> {
  const [version, cuerpo] = sobre.split(':');
  if (version !== VERSION || !cuerpo) throw new Error('Formato de secreto cifrado desconocido.');
  const todo = desdeBase64(cuerpo);
  const clave = await importarClave(claveMaestraB64);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: todo.subarray(0, 12) as BufferSource, additionalData: new TextEncoder().encode(contexto) },
        clave,
        todo.subarray(12) as BufferSource,
      ),
    );
  } catch {
    throw new Error('No se pudo descifrar el secreto (clave maestra o tienda incorrecta).');
  }
}

export async function descifrarTexto(sobre: string, claveMaestraB64: string, contexto: string): Promise<string> {
  return new TextDecoder().decode(await descifrar(sobre, claveMaestraB64, contexto));
}
