/**
 * Firma digital XAdES-EPES de documentos electrónicos DIAN.
 *
 * Fuente: Anexo Técnico FE v1.9, capítulo 10 (Política de firma):
 *  - XMLDSig enveloped + XAdES-EPES (ETSI TS 101 903 v1.3.2).
 *  - SignedInfo con 3 referencias: documento completo (enveloped), KeyInfo y
 *    SignedProperties; canonicalización C14N 1.0 inclusiva.
 *  - RSA-SHA256 y digests SHA-256.
 *  - Política: politicadefirmav2.pdf con su hash SHA-256 (verificado contra el
 *    PDF publicado por la DIAN el 2026-11-19).
 *  - Ubicación: última ext:UBLExtension/ext:ExtensionContent del documento.
 *
 * Solo usa WebCrypto + @xmldom/xmldom, así que corre en Node, Vercel y Workers.
 */
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { canonicalizar } from './c14n';
import type { CredencialesFirma } from './certificado';

const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const NS_XADES141 = 'http://uri.etsi.org/01903/v1.4.1#';
const NS_EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';

const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export const POLITICA_FIRMA_URL = 'https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf';
/** SHA-256 (base64) de politicadefirmav2.pdf. */
export const POLITICA_FIRMA_HASH = 'dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=';
const POLITICA_FIRMA_DESCRIPCION = 'Política de firma para facturas electrónicas de la República de Colombia.';

export interface OpcionesFirma {
  /** Hora de firma; por defecto ahora. Debe caer dentro de la vigencia del certificado. */
  horaFirma?: Date;
  /** "supplier" si firma el facturador (software propio); "third party" si firma un PT. */
  rol?: 'supplier' | 'third party';
  /** Identificador base de la firma (por defecto aleatorio). Útil en pruebas. */
  id?: string;
}

function aBase64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

async function sha256Base64(datos: string | Uint8Array): Promise<string> {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
  return aBase64(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Fecha en hora legal colombiana con desfase explícito, p. ej. 2026-11-19T10:15:00-05:00. */
export function horaColombia(d: Date): string {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 19) + '-05:00';
}

function hijoPorNombre(el: Element, ns: string, local: string): Element | null {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === local) return n as Element;
  }
  return null;
}

function porId(raiz: Element, id: string): Element {
  const pendientes: Element[] = [raiz];
  while (pendientes.length) {
    const el = pendientes.pop()!;
    if (el.getAttribute('Id') === id) return el;
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) pendientes.push(n as Element);
  }
  throw new Error(`No se encontró el elemento con Id="${id}"`);
}

/**
 * Firma un documento UBL (Invoice, CreditNote, DebitNote, AttachedDocument,
 * ApplicationResponse). El documento debe traer, como última extensión, un
 * `<ext:ExtensionContent/>` vacío donde va la firma.
 */
export async function firmarDocumento(
  xml: string,
  credenciales: CredencialesFirma,
  opciones: OpcionesFirma = {},
): Promise<string> {
  const firmante = credenciales.certificados[0];
  if (!firmante) throw new Error('Faltan los certificados de firma.');

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const raiz = doc.documentElement;
  if (!raiz) throw new Error('XML vacío.');

  const contenidos = raiz.getElementsByTagNameNS(NS_EXT, 'ExtensionContent');
  const destino = contenidos.item(contenidos.length - 1);
  if (!destino) throw new Error('El documento no tiene ext:ExtensionContent para la firma.');
  for (let n = destino.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) throw new Error('La última ext:ExtensionContent ya tiene contenido (¿documento ya firmado?).');
  }

  const id = opciones.id ?? `xmldsig-${crypto.randomUUID()}`;
  const rol = opciones.rol ?? 'supplier';
  const horaFirma = horaColombia(opciones.horaFirma ?? new Date());

  const certs = await Promise.all(
    credenciales.certificados.map(async (c) => ({
      b64: aBase64(c.der),
      digest: await sha256Base64(c.der),
      emisor: c.emisor,
      serial: c.serialDecimal,
    })),
  );

  const certsXades = certs
    .map(
      (c) =>
        `<xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${c.digest}</ds:DigestValue></xades:CertDigest>` +
        `<xades:IssuerSerial><ds:X509IssuerName>${esc(c.emisor)}</ds:X509IssuerName><ds:X509SerialNumber>${c.serial}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert>`,
    )
    .join('');

  const referencia = (uri: string, extra = '', transformacion = '') =>
    `<ds:Reference${extra} URI="${uri}">${transformacion}<ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue></ds:DigestValue></ds:Reference>`;

  const firmaXml =
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${id}">` +
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="${ALG_C14N}"/>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA256}"/>` +
    referencia('', ` Id="${id}-ref0"`, `<ds:Transforms><ds:Transform Algorithm="${ALG_ENVELOPED}"/></ds:Transforms>`) +
    referencia(`#${id}-keyinfo`) +
    referencia(`#${id}-signedprops`, ' Type="http://uri.etsi.org/01903#SignedProperties"') +
    `</ds:SignedInfo>` +
    `<ds:SignatureValue Id="${id}-sigvalue"></ds:SignatureValue>` +
    `<ds:KeyInfo Id="${id}-keyinfo"><ds:X509Data>` +
    certs.map((c) => `<ds:X509Certificate>${c.b64}</ds:X509Certificate>`).join('') +
    `</ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${NS_XADES}" xmlns:xades141="${NS_XADES141}" Target="#${id}">` +
    `<xades:SignedProperties Id="${id}-signedprops"><xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${horaFirma}</xades:SigningTime>` +
    `<xades:SigningCertificate>${certsXades}</xades:SigningCertificate>` +
    `<xades:SignaturePolicyIdentifier><xades:SignaturePolicyId>` +
    `<xades:SigPolicyId><xades:Identifier>${POLITICA_FIRMA_URL}</xades:Identifier><xades:Description>${POLITICA_FIRMA_DESCRIPCION}</xades:Description></xades:SigPolicyId>` +
    `<xades:SigPolicyHash><ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${POLITICA_FIRMA_HASH}</ds:DigestValue></xades:SigPolicyHash>` +
    `</xades:SignaturePolicyId></xades:SignaturePolicyIdentifier>` +
    `<xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>${rol}</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole>` +
    `</xades:SignedSignatureProperties></xades:SignedProperties>` +
    `</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>`;

  const fragmento = new DOMParser().parseFromString(firmaXml, 'text/xml').documentElement!;
  const firma = doc.importNode(fragmento, true) as Element;
  destino.appendChild(firma);

  // Digests de las tres referencias, calculados ya con la firma en su lugar
  // (así los namespaces heredados quedan igual que al verificar).
  const signedInfo = hijoPorNombre(firma, NS_DS, 'SignedInfo')!;
  const refs = signedInfo.getElementsByTagNameNS(NS_DS, 'Reference');
  const fijarDigest = (ref: Element, valor: string) => {
    const dv = ref.getElementsByTagNameNS(NS_DS, 'DigestValue').item(0)!;
    dv.appendChild(doc.createTextNode(valor));
  };
  fijarDigest(refs.item(0)!, await sha256Base64(canonicalizar(doc, { excluir: firma })));
  fijarDigest(refs.item(1)!, await sha256Base64(canonicalizar(porId(firma, `${id}-keyinfo`))));
  fijarDigest(refs.item(2)!, await sha256Base64(canonicalizar(porId(firma, `${id}-signedprops`))));

  // Firma RSA-SHA256 sobre el SignedInfo canonicalizado.
  const llave = await crypto.subtle.importKey(
    'pkcs8',
    credenciales.llavePrivadaPkcs8 as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const valor = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(canonicalizar(signedInfo)));
  hijoPorNombre(firma, NS_DS, 'SignatureValue')!.appendChild(doc.createTextNode(aBase64(valor)));

  const salida = new XMLSerializer().serializeToString(doc);
  return salida.startsWith('<?xml') ? salida : `<?xml version="1.0" encoding="UTF-8" standalone="no"?>${salida}`;
}
