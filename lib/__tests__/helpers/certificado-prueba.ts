/**
 * Certificado autofirmado para pruebas de la firma DIAN.
 * Tiene los usos que exige la DIAN (digitalSignature + nonRepudiation) y
 * algoritmo sha256WithRSA, pero NO es de una entidad ONAC: la DIAN real lo
 * rechazaría. Sirve para comprobar que la firma es criptográficamente válida.
 */
import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

export function crearP12DePrueba(clave = 'clave-prueba', opciones: { vencido?: boolean } = {}) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const llave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const publica = forge.pki.setRsaPublicKey(llave.n, llave.e);

  const cert = forge.pki.createCertificate();
  cert.publicKey = publica;
  cert.serialNumber = '0a1b2c3d4e5f';
  const ahora = new Date();
  cert.validity.notBefore = new Date(ahora.getTime() - (opciones.vencido ? 400 : 1) * 86400_000);
  cert.validity.notAfter = new Date(ahora.getTime() + (opciones.vencido ? -30 : 365) * 86400_000);
  const nombre = [
    { name: 'commonName', value: 'TIENDA DE PRUEBA SAS' },
    { name: 'organizationName', value: 'posib.dev pruebas' },
    { name: 'countryName', value: 'CO' },
  ];
  cert.setSubject(nombre);
  cert.setIssuer(nombre);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', critical: true, digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(llave, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(llave, [cert], clave, { algorithm: '3des' });
  const binario = forge.asn1.toDer(p12).getBytes();
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return { p12: bytes, clave, certPem: forge.pki.certificateToPem(cert) };
}
