/**
 * Cliente del web service de la DIAN (WcfDianCustomerServices, SOAP 1.2).
 *
 * Fuente: Anexo Técnico FE v1.9, capítulo 7. Cada petición va firmada con
 * WS-Security (X.509) usando el mismo certificado del facturador: se firma el
 * encabezado wsa:To con C14N exclusiva y RSA-SHA256.
 *
 *  - SendTestSetAsync: set de pruebas de habilitación (devuelve ZipKey/TrackId).
 *  - GetStatusZip:     resultado de un envío asíncrono (set de pruebas).
 *  - SendBillSync:     envío en producción, 1 documento, respuesta inmediata.
 *  - GetStatus:        estado de un documento por CUFE/CUDE (trackId).
 *  - GetNumberingRange: rangos de numeración autorizados para el NIT.
 *
 * Solo usa fetch + WebCrypto + fflate: funciona en Node, Vercel y Workers.
 */
import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { strToU8, zipSync } from 'fflate';
import { canonicalizar } from './c14n';
import type { CredencialesFirma } from './certificado';

export const URL_WS = {
  habilitacion: 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
  produccion: 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc',
} as const;
export type Ambiente = keyof typeof URL_WS;

const NS = {
  soap: 'http://www.w3.org/2003/05/soap-envelope',
  wcf: 'http://wcf.dian.colombia',
  wsa: 'http://www.w3.org/2005/08/addressing',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  ec: 'http://www.w3.org/2001/10/xml-exc-c14n#',
};
const X509_TOKEN = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3';
const BASE64_BIN = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

function aBase64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function desdeBase64(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ''));
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ─────────────────────────── Nombres y empaquetado ─────────────────────────── */

/**
 * Nombre de archivo según §6.5.7/§6.5.8: {tipo}{NIT 10}{000=software propio}{aa}{consecutivo 8 hex}.
 * tipo: fv factura, nc nota crédito, nd nota débito, z zip, ad attached document.
 */
export function nombreArchivo(tipo: 'fv' | 'nc' | 'nd' | 'ad' | 'z', nit: string, consecutivo: number, anio: number): string {
  const nitPad = nit.replace(/\D/g, '').padStart(10, '0');
  const aa = String(anio % 100).padStart(2, '0');
  const hex = consecutivo.toString(16).toUpperCase().padStart(8, '0');
  return `${tipo}${nitPad}000${aa}${hex}${tipo === 'z' ? '.zip' : '.xml'}`;
}

/** Comprime uno o varios XML firmados en el ZIP que recibe la DIAN. */
export function empaquetarZip(archivos: Array<{ nombre: string; xml: string }>): Uint8Array {
  const entradas: Record<string, Uint8Array> = {};
  for (const a of archivos) entradas[a.nombre] = strToU8(a.xml);
  return zipSync(entradas, { level: 9 });
}

/* ──────────────────────────────── WS-Security ─────────────────────────────── */

async function sha256Base64(texto: string): Promise<string> {
  return aBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

/**
 * Construye el sobre SOAP firmado. Exportado para poder verificarlo en pruebas.
 */
export async function sobreFirmado(
  accion: string,
  cuerpo: string,
  url: string,
  credenciales: CredencialesFirma,
  ahora = new Date(),
): Promise<string> {
  const cert = aBase64(credenciales.certificados[0].der);
  const uid = () => crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const idTs = `TS-${uid()}`;
  const idTok = `X509-${uid()}`;
  const idSig = `SIG-${uid()}`;
  const idKi = `KI-${uid()}`;
  const idStr = `STR-${uid()}`;
  const idTo = `id-${uid()}`;
  const creado = ahora.toISOString();
  const expira = new Date(ahora.getTime() + 60_000).toISOString();
  const accionUrl = `http://wcf.dian.colombia/IWcfDianCustomerServices/${accion}`;

  const signedInfo =
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"><ec:InclusiveNamespaces xmlns:ec="${NS.ec}" PrefixList="wsa soap wcf"/></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
    `<ds:Reference URI="#${idTo}">` +
    `<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"><ec:InclusiveNamespaces xmlns:ec="${NS.ec}" PrefixList="soap wcf"/></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>{{DIGEST}}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  const plantilla =
    `<soap:Envelope xmlns:soap="${NS.soap}" xmlns:wcf="${NS.wcf}">` +
    `<soap:Header xmlns:wsa="${NS.wsa}">` +
    `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
    `<wsu:Timestamp wsu:Id="${idTs}"><wsu:Created>${creado}</wsu:Created><wsu:Expires>${expira}</wsu:Expires></wsu:Timestamp>` +
    `<wsse:BinarySecurityToken EncodingType="${BASE64_BIN}" ValueType="${X509_TOKEN}" wsu:Id="${idTok}">${cert}</wsse:BinarySecurityToken>` +
    `<ds:Signature Id="${idSig}" xmlns:ds="${NS.ds}">` +
    signedInfo +
    `<ds:SignatureValue>{{FIRMA}}</ds:SignatureValue>` +
    `<ds:KeyInfo Id="${idKi}"><wsse:SecurityTokenReference wsu:Id="${idStr}"><wsse:Reference URI="#${idTok}" ValueType="${X509_TOKEN}"/></wsse:SecurityTokenReference></ds:KeyInfo>` +
    `</ds:Signature>` +
    `</wsse:Security>` +
    `<wsa:Action>${accionUrl}</wsa:Action>` +
    `<wsa:To wsu:Id="${idTo}" xmlns:wsu="${NS.wsu}">${esc(url)}</wsa:To>` +
    `</soap:Header>` +
    `<soap:Body>${cuerpo}</soap:Body>` +
    `</soap:Envelope>`;

  // 1) Digest de wsa:To en su contexto real del sobre.
  const parser = new DOMParser();
  const doc1 = parser.parseFromString(plantilla, 'text/xml');
  const to = doc1.getElementsByTagNameNS(NS.wsa, 'To').item(0)!;
  const digest = await sha256Base64(canonicalizar(to, { exclusiva: true, prefijosInclusivos: ['soap', 'wcf'] }));
  const conDigest = plantilla.replace('{{DIGEST}}', digest);

  // 2) Firma del SignedInfo canonicalizado (C14N exclusiva, PrefixList "wsa soap wcf").
  const doc2 = parser.parseFromString(conDigest, 'text/xml');
  const si = doc2.getElementsByTagNameNS(NS.ds, 'SignedInfo').item(0)!;
  const llave = await crypto.subtle.importKey(
    'pkcs8',
    credenciales.llavePrivadaPkcs8 as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    llave,
    new TextEncoder().encode(canonicalizar(si, { exclusiva: true, prefijosInclusivos: ['wsa', 'soap', 'wcf'] })),
  );
  return conDigest.replace('{{FIRMA}}', aBase64(firma));
}

/* ──────────────────────────────── Respuestas ──────────────────────────────── */

export interface RespuestaDian {
  /** true si la DIAN validó el documento (IsValid=true). */
  valido: boolean;
  codigo?: string;
  descripcion?: string;
  mensaje?: string;
  /** Reglas incumplidas (rechazos y notificaciones), p. ej. "Regla: FAJ43b, Rechazo: ...". */
  errores: string[];
  trackId?: string;
  /** ApplicationResponse de la DIAN en XML (cuando viene). */
  applicationResponse?: string;
}

function texto(el: Element | null | undefined): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}

function primero(raiz: Document | Element, local: string): Element | null {
  const lista = raiz.getElementsByTagNameNS('*', local);
  return lista.length ? (lista.item(0) as Element) : null;
}

function leerRespuestas(xml: string): RespuestaDian[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const fault = primero(doc, 'Fault');
  if (fault) {
    return [{ valido: false, errores: [texto(primero(fault, 'Text')) ?? texto(fault) ?? 'SOAP Fault'] }];
  }
  const nodos = doc.getElementsByTagNameNS('*', 'DianResponse');
  const lista: Element[] = [];
  for (let i = 0; i < nodos.length; i++) lista.push(nodos.item(i) as Element);
  if (lista.length === 0) {
    // SendBillSync / GetStatus devuelven la respuesta directamente en *Result.
    const r = primero(doc, 'SendBillSyncResult') ?? primero(doc, 'GetStatusResult');
    if (r) lista.push(r);
  }
  return lista.map((r) => {
    const errores: string[] = [];
    const msgs = r.getElementsByTagNameNS('*', 'ErrorMessage').item(0);
    if (msgs) {
      const strs = (msgs as Element).getElementsByTagNameNS('*', 'string');
      for (let i = 0; i < strs.length; i++) {
        const t = texto(strs.item(i) as Element);
        if (t) errores.push(t);
      }
    }
    const xmlB64 = texto(primero(r, 'XmlBase64Bytes'));
    return {
      valido: texto(primero(r, 'IsValid')) === 'true',
      codigo: texto(primero(r, 'StatusCode')),
      descripcion: texto(primero(r, 'StatusDescription')),
      mensaje: texto(primero(r, 'StatusMessage')),
      trackId: texto(primero(r, 'XmlDocumentKey')),
      errores,
      applicationResponse: xmlB64 ? new TextDecoder().decode(desdeBase64(xmlB64)) : undefined,
    };
  });
}

/* ───────────────────────────────── Cliente ─────────────────────────────────── */

export interface OpcionesCliente {
  ambiente: Ambiente;
  credenciales: CredencialesFirma;
  /** Para pruebas: reemplaza fetch. */
  fetch?: typeof fetch;
}

export class ClienteDian {
  private readonly url: string;
  private readonly hacerFetch: typeof fetch;

  constructor(private readonly opciones: OpcionesCliente) {
    this.url = URL_WS[opciones.ambiente];
    this.hacerFetch = opciones.fetch ?? fetch;
  }

  private async llamar(accion: string, cuerpo: string): Promise<string> {
    const sobre = await sobreFirmado(accion, cuerpo, this.url, this.opciones.credenciales);
    const resp = await this.hacerFetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml;charset=UTF-8;action="http://wcf.dian.colombia/IWcfDianCustomerServices/${accion}"`,
      },
      body: sobre,
    });
    const texto = await resp.text();
    if (!resp.ok && !texto.includes('Envelope')) {
      throw new Error(`DIAN respondió HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    }
    return texto;
  }

  /** Envía el set de pruebas. Devuelve el ZipKey para consultar con getStatusZip. */
  async enviarSetPruebas(nombreZip: string, zip: Uint8Array, testSetId: string): Promise<{ zipKey?: string; errores: string[]; crudo: string }> {
    const crudo = await this.llamar(
      'SendTestSetAsync',
      `<wcf:SendTestSetAsync><wcf:fileName>${esc(nombreZip)}</wcf:fileName><wcf:contentFile>${aBase64(zip)}</wcf:contentFile><wcf:testSetId>${esc(testSetId)}</wcf:testSetId></wcf:SendTestSetAsync>`,
    );
    const doc = new DOMParser().parseFromString(crudo, 'text/xml');
    const errores: string[] = [];
    const lista = doc.getElementsByTagNameNS('*', 'ProcessedMessage');
    for (let i = 0; i < lista.length; i++) {
      const t = texto(lista.item(i) as Element);
      if (t) errores.push(t);
    }
    const fault = primero(doc, 'Fault');
    if (fault) errores.push(texto(fault) ?? 'SOAP Fault');
    return { zipKey: texto(primero(doc, 'ZipKey')), errores, crudo };
  }

  /** Resultado de un envío asíncrono: una respuesta por documento del ZIP. */
  async getStatusZip(trackId: string): Promise<RespuestaDian[]> {
    return leerRespuestas(await this.llamar('GetStatusZip', `<wcf:GetStatusZip><wcf:trackId>${esc(trackId)}</wcf:trackId></wcf:GetStatusZip>`));
  }

  /** Producción: envía UN documento y devuelve la validación inmediata. */
  async enviarDocumento(nombreZip: string, zip: Uint8Array): Promise<RespuestaDian> {
    const r = leerRespuestas(
      await this.llamar(
        'SendBillSync',
        `<wcf:SendBillSync><wcf:fileName>${esc(nombreZip)}</wcf:fileName><wcf:contentFile>${aBase64(zip)}</wcf:contentFile></wcf:SendBillSync>`,
      ),
    );
    return r[0] ?? { valido: false, errores: ['Respuesta vacía de la DIAN'] };
  }

  /** Estado de un documento por su CUFE/CUDE. */
  async getStatus(cufe: string): Promise<RespuestaDian> {
    const r = leerRespuestas(await this.llamar('GetStatus', `<wcf:GetStatus><wcf:trackId>${esc(cufe)}</wcf:trackId></wcf:GetStatus>`));
    return r[0] ?? { valido: false, errores: ['Respuesta vacía de la DIAN'] };
  }

  /** Rangos de numeración autorizados (incluye la clave técnica). */
  async getNumberingRange(nitEmisor: string, softwareId: string): Promise<{ rangos: Array<Record<string, string>>; mensaje?: string; crudo: string }> {
    const crudo = await this.llamar(
      'GetNumberingRange',
      `<wcf:GetNumberingRange><wcf:accountCode>${esc(nitEmisor)}</wcf:accountCode><wcf:accountCodeT>${esc(nitEmisor)}</wcf:accountCodeT><wcf:softwareCode>${esc(softwareId)}</wcf:softwareCode></wcf:GetNumberingRange>`,
    );
    const doc = new DOMParser().parseFromString(crudo, 'text/xml');
    const rangos: Array<Record<string, string>> = [];
    const nodos = doc.getElementsByTagNameNS('*', 'NumberRangeResponse');
    for (let i = 0; i < nodos.length; i++) {
      const fila: Record<string, string> = {};
      for (let n = (nodos.item(i) as Element).firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1) fila[(n as Element).localName!] = (n as Element).textContent ?? '';
      }
      rangos.push(fila);
    }
    return { rangos, mensaje: texto(primero(doc, 'OperationDescription')), crudo };
  }
}
