/**
 * Documentos DIAN completos: XML UBL (xml.ts), set de pruebas (set-pruebas.ts)
 * y cliente SOAP con WS-Security (soap.ts).
 *
 * La validación contra los XSD oficiales UBL 2.1 se hizo aparte con xmllint
 * (ver lib/fe-dian/README.md); aquí se comprueba la coherencia interna: que el
 * CUFE del XML se pueda recalcular leyendo el propio XML (así lo hace la DIAN),
 * que los totales cuadren y que las firmas verifiquen.
 */
// Abrir un .p12 (derivación de claves en JS puro) es lento con la suite en paralelo.
jest.setTimeout(30_000);
import { DOMParser, type Element } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import { SignedXml } from 'xml-crypto';
import { generateCufe } from '../fe-dian/cufe';
import { leerP12 } from '../fe-dian/certificado';
import { firmarDocumento } from '../fe-dian/firma';
import { RESOLUCION_HABILITACION, generarSetPruebas } from '../fe-dian/set-pruebas';
import { ClienteDian, empaquetarZip, nombreArchivo, sobreFirmado } from '../fe-dian/soap';
import { CONSUMIDOR_FINAL, generarFactura, type Tercero } from '../fe-dian/xml';
import { crearP12DePrueba } from './helpers/certificado-prueba';

const EMISOR: Tercero = {
  tipoPersona: '2',
  tipoId: '13',
  identificacion: '1234567',
  razonSocial: 'Cielo López',
  nombreComercial: 'Tienda Doña Cielo',
  responsabilidades: 'R-99-PN',
  tributo: { id: 'ZZ', nombre: 'No aplica' },
  direccion: { municipioCodigo: '86001', municipio: 'Mocoa', departamento: 'Putumayo', departamentoCodigo: '86', linea: 'Barrio Centro' },
};
const SOFTWARE = { softwareId: '11111111-2222-3333-4444-555555555555', pin: '12345', ambiente: 2 as const };

const { p12, clave, certPem } = crearP12DePrueba();
const { credenciales } = leerP12(p12, clave);

function xpathTexto(xml: string, ruta: string[]): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  let el: Element = doc.documentElement!;
  for (const local of ruta) {
    let sig: Element | null = null;
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && (n as Element).localName === local) {
        sig = n as Element;
        break;
      }
    }
    if (!sig) throw new Error(`No existe ${ruta.join('/')}`);
    el = sig;
  }
  return el.textContent ?? '';
}

describe('generarFactura', () => {
  const base = {
    resolucion: RESOLUCION_HABILITACION,
    consecutivo: 990000010,
    fecha: '2026-11-19',
    hora: '10:15:00-05:00',
    emisor: EMISOR,
    adquiriente: CONSUMIDOR_FINAL,
    lineas: [
      { codigo: '1', descripcion: 'Gaseosa', cantidad: 2, precioUnitario: 4201.68, impuestos: [{ tipo: '01' as const, porcentaje: 19 }] },
      { codigo: '2', descripcion: 'Arroz', cantidad: 1, precioUnitario: 2100, impuestos: [{ tipo: '01' as const, porcentaje: 0 }] },
    ],
    pago: { forma: '1' as const, medio: '10' },
    software: SOFTWARE,
  };

  it('calcula totales e impuestos agrupados', async () => {
    const f = await generarFactura(base);
    expect(f.numero).toBe('SETP990000010');
    expect(f.subtotal).toBe(10503.36);
    expect(f.impuestos.iva).toBe(1596.64); // 8403.36 × 19 %
    expect(f.total).toBe(12100);
  });

  it('el CUFE se puede recalcular leyendo el XML, como hace la DIAN', async () => {
    const f = await generarFactura(base);
    const x = f.xml;
    const recalculado = await generateCufe({
      numFac: xpathTexto(x, ['ID']),
      fecFac: xpathTexto(x, ['IssueDate']),
      horFac: xpathTexto(x, ['IssueTime']),
      valFac: Number(xpathTexto(x, ['LegalMonetaryTotal', 'LineExtensionAmount'])),
      valIva: Number(xpathTexto(x, ['TaxTotal', 'TaxAmount'])),
      valTot: Number(xpathTexto(x, ['LegalMonetaryTotal', 'PayableAmount'])),
      nitOFE: xpathTexto(x, ['AccountingSupplierParty', 'Party', 'PartyTaxScheme', 'CompanyID']),
      numAdq: xpathTexto(x, ['AccountingCustomerParty', 'Party', 'PartyTaxScheme', 'CompanyID']),
      clTec: RESOLUCION_HABILITACION.claveTecnica,
      tipoAmbiente: 2,
    });
    expect(xpathTexto(x, ['UUID'])).toBe(recalculado);
    expect(f.codigoUnico).toBe(recalculado);
  });

  it('TaxExclusiveAmount suma solo las bases gravadas (regla FAU04)', async () => {
    const f = await generarFactura({
      ...base,
      lineas: [...base.lineas, { codigo: '3', descripcion: 'Excluido', cantidad: 1, precioUnitario: 1000 }],
    });
    expect(xpathTexto(f.xml, ['LegalMonetaryTotal', 'LineExtensionAmount'])).toBe('11503.36');
    expect(xpathTexto(f.xml, ['LegalMonetaryTotal', 'TaxExclusiveAmount'])).toBe('10503.36');
  });

  it('consumidor final con los códigos que pide la DIAN', async () => {
    const { xml } = await generarFactura(base);
    expect(xml).toContain('schemeName="13">222222222222</cbc:CompanyID>');
    expect(xml).toContain('<cbc:TaxLevelCode listName="No aplica">R-99-PN</cbc:TaxLevelCode>');
    expect(xml).toContain('<cbc:ID>ZZ</cbc:ID><cbc:Name>No aplica</cbc:Name>');
  });

  it('QR en DianExtensions = URL de consulta del ambiente', async () => {
    const f = await generarFactura(base);
    expect(f.xml).toContain(`<sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${f.codigoUnico}</sts:QRCode>`);
    expect(f.qr).toMatch(/^NumFac: SETP990000010\n/);
  });

  it('rechaza consecutivo fuera de rango, crédito sin vencimiento y NIT sin DV', async () => {
    await expect(generarFactura({ ...base, consecutivo: 1 })).rejects.toThrow(/fuera del rango/);
    await expect(generarFactura({ ...base, pago: { forma: '2', medio: '10' } })).rejects.toThrow(/vencimiento/);
    await expect(
      generarFactura({ ...base, adquiriente: { ...CONSUMIDOR_FINAL, tipoId: '31', identificacion: '900108281' } }),
    ).rejects.toThrow(/dígito de verificación/);
  });
});

describe('set de pruebas', () => {
  it('genera facturas, notas crédito y débito firmables y verificables', async () => {
    const docs = await generarSetPruebas({ emisor: EMISOR, software: SOFTWARE, facturas: 4, notasCredito: 2, notasDebito: 2 });
    expect(docs.map((d) => d.tipo)).toEqual([
      'Invoice', 'Invoice', 'Invoice', 'Invoice', 'CreditNote', 'CreditNote', 'DebitNote', 'DebitNote',
    ]);
    // Las notas referencian el CUFE de una factura del mismo set.
    const cufes = new Set(docs.filter((d) => d.tipo === 'Invoice').map((d) => d.codigoUnico));
    for (const nota of docs.filter((d) => d.tipo !== 'Invoice')) {
      expect(cufes.has(xpathTexto(nota.xml, ['BillingReference', 'InvoiceDocumentReference', 'UUID']))).toBe(true);
    }
    for (const d of docs) {
      const firmado = await firmarDocumento(d.xml, credenciales);
      const doc = new DOMParser().parseFromString(firmado, 'text/xml');
      const sig = new SignedXml({ publicCert: certPem });
      sig.loadSignature(doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature').item(0) as unknown as Node);
      expect(sig.checkSignature(firmado)).toBe(true);
    }
  });
});

describe('SOAP / WS-Security', () => {
  it('nombres de archivo según §6.5.7', () => {
    expect(nombreArchivo('nc', '800197268', 1, 2019)).toBe('nc08001972680001900000001.xml');
    expect(nombreArchivo('z', '800197268', 255, 2026)).toBe('z080019726800026000000FF.zip');
  });

  it('el ZIP contiene los XML intactos', () => {
    const zip = empaquetarZip([{ nombre: 'fv1.xml', xml: '<a>ñ</a>' }]);
    expect(strFromU8(unzipSync(zip)['fv1.xml'])).toBe('<a>ñ</a>');
  });

  it('el sobre va firmado (wsa:To) y un verificador independiente lo acepta', async () => {
    const sobre = await sobreFirmado(
      'GetStatusZip',
      '<wcf:GetStatusZip><wcf:trackId>abc</wcf:trackId></wcf:GetStatusZip>',
      'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
      credenciales,
    );
    const doc = new DOMParser().parseFromString(sobre, 'text/xml');
    const sig = new SignedXml({ publicCert: certPem });
    sig.loadSignature(doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature').item(0) as unknown as Node);
    expect(sig.checkSignature(sobre)).toBe(true);
    expect(sobre).toContain('<wsa:Action>http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatusZip</wsa:Action>');
  });

  it('interpreta ZipKey y los errores de validación de la DIAN', async () => {
    const respuestas: string[] = [
      `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><SendTestSetAsyncResponse xmlns="http://wcf.dian.colombia"><SendTestSetAsyncResult xmlns:b="http://schemas.datacontract.org/2004/07/UploadDocumentResponse"><b:ErrorMessageList/><b:ZipKey>zip-123</b:ZipKey></SendTestSetAsyncResult></SendTestSetAsyncResponse></s:Body></s:Envelope>`,
      `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetStatusZipResponse xmlns="http://wcf.dian.colombia"><GetStatusZipResult xmlns:b="http://schemas.datacontract.org/2004/07/DianResponse"><b:DianResponse><b:ErrorMessage xmlns:c="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><c:string>Regla: FAJ43b, Rechazo: Nombre informado no corresponde al registrado en el RUT</c:string></b:ErrorMessage><b:IsValid>false</b:IsValid><b:StatusCode>99</b:StatusCode><b:StatusDescription>Validación contiene errores en campos mandatorios.</b:StatusDescription><b:XmlDocumentKey>cufe-1</b:XmlDocumentKey></b:DianResponse></GetStatusZipResult></GetStatusZipResponse></s:Body></s:Envelope>`,
    ];
    const llamadas: RequestInit[] = [];
    const fetchFalso = (async (_url: string, init: RequestInit) => {
      llamadas.push(init);
      return new Response(respuestas.shift()!, { status: 200 });
    }) as unknown as typeof fetch;
    const cliente = new ClienteDian({ ambiente: 'habilitacion', credenciales, fetch: fetchFalso });

    const envio = await cliente.enviarSetPruebas('z.zip', new Uint8Array([1, 2]), 'test-set');
    expect(envio.zipKey).toBe('zip-123');
    expect(String(llamadas[0].headers && (llamadas[0].headers as Record<string, string>)['Content-Type'])).toContain('SendTestSetAsync');

    const [r] = await cliente.getStatusZip('zip-123');
    expect(r.valido).toBe(false);
    expect(r.codigo).toBe('99');
    expect(r.trackId).toBe('cufe-1');
    expect(r.errores[0]).toMatch(/FAJ43b/);
  });
});

describe('estadoDeRespuesta (resultado del set de pruebas)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { estadoDeRespuesta } = require('../fe-dian/servidor') as typeof import('../fe-dian/servidor');
  it('aceptado, en proceso o rechazado con sus reglas', () => {
    expect(estadoDeRespuesta({ valido: true, errores: [] }).estado).toBe('aceptado');
    expect(estadoDeRespuesta({ valido: false, errores: [], descripcion: 'Batch en proceso de validación.' }).estado).toBe('enviado');
    expect(estadoDeRespuesta({ valido: false, errores: ['Regla: FAJ43b, Rechazo: ...'], codigo: '99' })).toEqual({
      estado: 'rechazado',
      errores: ['Regla: FAJ43b, Rechazo: ...'],
    });
    expect(estadoDeRespuesta({ valido: false, errores: [], descripcion: 'Documento con errores' }).errores).toEqual(['Documento con errores']);
  });
});
