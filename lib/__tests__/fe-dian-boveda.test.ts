/** Bóveda de secretos de facturación electrónica (lib/fe-dian/boveda.ts). */
import { randomBytes } from 'node:crypto';
import { cifrar, descifrar, descifrarTexto } from '../fe-dian/boveda';

const CLAVE = randomBytes(32).toString('base64');

describe('bóveda FE', () => {
  it('cifra y descifra (texto y binario)', async () => {
    const s = await cifrar('12345', CLAVE, 'tenant-1');
    expect(s).toMatch(/^v1:/);
    expect(s).not.toContain('12345');
    expect(await descifrarTexto(s, CLAVE, 'tenant-1')).toBe('12345');
    const bin = new Uint8Array([0, 1, 2, 255]);
    expect(Array.from(await descifrar(await cifrar(bin, CLAVE, 't'), CLAVE, 't'))).toEqual([0, 1, 2, 255]);
  });

  it('cada cifrado es distinto (IV aleatorio)', async () => {
    expect(await cifrar('x', CLAVE, 't')).not.toBe(await cifrar('x', CLAVE, 't'));
  });

  it('no se puede usar el secreto de una tienda en otra', async () => {
    const s = await cifrar('pin', CLAVE, 'tenant-1');
    await expect(descifrar(s, CLAVE, 'tenant-2')).rejects.toThrow(/No se pudo descifrar/);
  });

  it('falla con otra clave maestra o clave mal formada', async () => {
    const s = await cifrar('pin', CLAVE, 't');
    await expect(descifrar(s, randomBytes(32).toString('base64'), 't')).rejects.toThrow(/No se pudo descifrar/);
    await expect(cifrar('x', 'corta', 't')).rejects.toThrow(/32 bytes/);
  });
});
