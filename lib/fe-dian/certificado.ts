/**
 * Lectura del certificado de firma digital (.p12 / .pfx).
 *
 * La DIAN exige certificados de una Entidad de Certificación acreditada por la
 * ONAC, con algoritmo SHA-2 y usos "Digital Signature" + "Non Repudiation"
 * (anexo §10.14, Regla-2). Este módulo extrae del .p12:
 *  - la llave privada en PKCS#8 DER (para firmar con WebCrypto),
 *  - el certificado del firmante y su cadena (DER), ordenados firmante → raíz,
 *  - datos para mostrar y validar (titular, vigencia, usos).
 *
 * Usa node-forge (JavaScript puro): funciona en Node, Vercel y Workers. Abrir
 * un .p12 es costoso en CPU (derivación de claves), así que conviene hacerlo
 * UNA vez al cargar el certificado y guardar el resultado cifrado.
 */
import forge from 'node-forge';

export interface CertificadoX509 {
  /** Certificado en DER. */
  der: Uint8Array;
  /** Emisor en formato RFC 4514 (CN=...,O=...,C=CO). */
  emisor: string;
  /** Número de serie en decimal (xades:IssuerSerial/ds:X509SerialNumber). */
  serialDecimal: string;
  titular: string;
}

export interface CredencialesFirma {
  /** Llave privada RSA en PKCS#8 DER. */
  llavePrivadaPkcs8: Uint8Array;
  /** [0] = certificado del firmante; luego intermedios y raíz si vienen en el .p12. */
  certificados: CertificadoX509[];
}

export interface InfoCertificado {
  titular: string;
  /** Sujeto completo (RFC 4514); suele incluir la cédula o el NIT del titular. */
  sujeto: string;
  emisor: string;
  validoDesde: Date;
  validoHasta: Date;
  algoritmoFirma: string;
  firmaDigital: boolean;
  noRepudio: boolean;
  /** Problemas que harían que la DIAN rechace la firma. Vacío = apto. */
  problemas: string[];
}

function bytesABinario(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function binarioABytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function nombreRfc4514(attrs: forge.pki.CertificateField[]): string {
  // RFC 4514 lista los RDN en orden inverso al de la codificación ASN.1.
  return [...attrs]
    .reverse()
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${String(a.value)}`)
    .join(',');
}

function aCertificadoX509(c: forge.pki.Certificate): CertificadoX509 {
  const der = binarioABytes(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes());
  const cn = c.subject.getField('CN');
  return {
    der,
    emisor: nombreRfc4514(c.issuer.attributes),
    serialDecimal: BigInt('0x' + c.serialNumber).toString(10),
    titular: cn ? String(cn.value) : nombreRfc4514(c.subject.attributes),
  };
}

/** Abre un .p12 y devuelve la llave + cadena lista para firmar. */
export function leerP12(p12: Uint8Array, clave: string): { credenciales: CredencialesFirma; info: InfoCertificado } {
  const asn1 = forge.asn1.fromDer(bytesABinario(p12));
  const pfx = forge.pkcs12.pkcs12FromAsn1(asn1, false, clave);

  const llaves = [
    ...(pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(pfx.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const llave = llaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!llave) throw new Error('El archivo .p12 no contiene una llave privada RSA.');

  const certs = (pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (certs.length === 0) throw new Error('El archivo .p12 no contiene certificados.');

  // Firmante = el certificado cuya llave pública corresponde a la llave privada.
  const firmante = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub.n && pub.n.equals(llave.n);
  });
  if (!firmante) throw new Error('Ningún certificado del .p12 corresponde a la llave privada.');

  // Ordenar la cadena firmante → intermedios → raíz siguiendo emisor/sujeto.
  const cadena: forge.pki.Certificate[] = [firmante];
  const restantes = certs.filter((c) => c !== firmante);
  for (;;) {
    const actual = cadena[cadena.length - 1];
    if (actual.isIssuer(actual)) break; // raíz autofirmada
    const idx = restantes.findIndex((c) => c.isIssuer(actual));
    if (idx < 0) break;
    cadena.push(restantes.splice(idx, 1)[0]);
  }

  const pkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(llave));
  const llavePrivadaPkcs8 = binarioABytes(forge.asn1.toDer(pkcs8).getBytes());

  return {
    credenciales: { llavePrivadaPkcs8, certificados: cadena.map(aCertificadoX509) },
    info: inspeccionar(firmante),
  };
}

function inspeccionar(c: forge.pki.Certificate, ahora = new Date()): InfoCertificado {
  const ku = c.getExtension('keyUsage') as { digitalSignature?: boolean; nonRepudiation?: boolean } | null;
  const algoritmo = forge.pki.oids[c.siginfo.algorithmOid] ?? c.siginfo.algorithmOid;
  const info: InfoCertificado = {
    titular: aCertificadoX509(c).titular,
    sujeto: nombreRfc4514(c.subject.attributes),
    emisor: nombreRfc4514(c.issuer.attributes),
    validoDesde: c.validity.notBefore,
    validoHasta: c.validity.notAfter,
    algoritmoFirma: String(algoritmo),
    firmaDigital: !!ku?.digitalSignature,
    noRepudio: !!ku?.nonRepudiation,
    problemas: [],
  };
  if (!/sha(256|384|512)WithRSAEncryption/i.test(info.algoritmoFirma)) {
    info.problemas.push(`Algoritmo del certificado no admitido por la DIAN: ${info.algoritmoFirma} (debe ser SHA-256/384/512 con RSA).`);
  }
  if (!info.firmaDigital || !info.noRepudio) {
    info.problemas.push('El certificado debe tener los usos "Digital Signature" y "Non Repudiation".');
  }
  if (ahora < info.validoDesde || ahora > info.validoHasta) {
    info.problemas.push(
      `El certificado no está vigente (válido del ${info.validoDesde.toISOString().slice(0, 10)} al ${info.validoHasta.toISOString().slice(0, 10)}).`,
    );
  }
  return info;
}
