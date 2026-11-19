/**
 * Firma XAdES-EPES (lib/fe-dian/firma.ts) y canonicalización (c14n.ts).
 *
 * La verificación se hace con xml-crypto, que tiene su propia implementación
 * de C14N y XMLDSig: si xml-crypto valida las 3 referencias y el SignatureValue,
 * la firma es correcta según el estándar, que es lo que valida la DIAN.
 */
// Abrir un .p12 (derivación de claves en JS puro) es lento con la suite en paralelo.
jest.setTimeout(30_000);
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { canonicalizar } from '../fe-dian/c14n';
import { leerP12 } from '../fe-dian/certificado';
import { firmarDocumento, POLITICA_FIRMA_HASH } from '../fe-dian/firma';
import { crearP12DePrueba } from './helpers/certificado-prueba';

const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
  <ext:UBLExtensions>
    <ext:UBLExtension><ext:ExtensionContent><cbc:Note>dian</cbc:Note></ext:ExtensionContent></ext:UBLExtension>
    <ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:ID>SETP990000001</cbc:ID>
  <cbc:Note>Tienda "Doña Cielo" &amp; cía &lt;barrio&gt;</cbc:Note>
</Invoice>`;

function verificar(xmlFirmado: string, certPem: string): { ok: boolean; errores: string[] } {
  const doc = new DOMParser().parseFromString(xmlFirmado, 'text/xml');
  const firma = doc.getElementsByTagNameNS(NS_DS, 'Signature').item(0)!;
  const sig = new SignedXml({ publicCert: certPem });
  sig.loadSignature(firma as unknown as Node);
  try {
    const ok = sig.checkSignature(xmlFirmado);
    return { ok, errores: [] };
  } catch (e) {
    return { ok: false, errores: [String(e)] };
  }
}

describe('canonicalizar (C14N 1.0)', () => {
  it('ordena atributos, expande vacíos, escapa y omite comentarios', () => {
    const doc = new DOMParser().parseFromString(
      '<?xml version="1.0"?><r xmlns:b="urn:b" xmlns:a="urn:a" z="1" a:y="2"><!-- c --><v/><t>a&amp;b&lt;c&gt;</t></r>',
      'text/xml',
    );
    expect(canonicalizar(doc)).toBe(
      '<r xmlns:a="urn:a" xmlns:b="urn:b" z="1" a:y="2"><v></v><t>a&amp;b&lt;c&gt;</t></r>',
    );
  });

  it('un fragmento hereda todos los namespaces en alcance (inclusiva)', () => {
    const doc = new DOMParser().parseFromString(
      '<r xmlns="urn:d" xmlns:x="urn:x" xmlns:y="urn:y"><x:hijo><y:n/></x:hijo></r>',
      'text/xml',
    );
    const hijo = doc.documentElement!.firstChild!;
    expect(canonicalizar(hijo)).toBe('<x:hijo xmlns="urn:d" xmlns:x="urn:x" xmlns:y="urn:y"><y:n></y:n></x:hijo>');
  });

  it('exclusiva: solo namespaces usados + PrefixList', () => {
    const doc = new DOMParser().parseFromString(
      '<s:E xmlns:s="urn:s" xmlns:w="urn:w" xmlns:z="urn:z"><s:H xmlns:a="urn:a"><a:To xmlns:u="urn:u" u:Id="1">x</a:To></s:H></s:E>',
      'text/xml',
    );
    const to = doc.getElementsByTagNameNS('urn:a', 'To').item(0)!;
    expect(canonicalizar(to, { exclusiva: true, prefijosInclusivos: ['s', 'w'] })).toBe(
      '<a:To xmlns:a="urn:a" xmlns:s="urn:s" xmlns:u="urn:u" xmlns:w="urn:w" u:Id="1">x</a:To>',
    );
  });
});

describe('certificado .p12', () => {
  it('extrae llave, cadena y valida los usos que exige la DIAN', () => {
    const { p12, clave } = crearP12DePrueba();
    const { credenciales, info } = leerP12(p12, clave);
    expect(credenciales.llavePrivadaPkcs8.length).toBeGreaterThan(1000);
    expect(credenciales.certificados).toHaveLength(1);
    expect(credenciales.certificados[0].serialDecimal).toBe(BigInt('0x0a1b2c3d4e5f').toString());
    expect(info.titular).toBe('TIENDA DE PRUEBA SAS');
    expect(info.problemas).toEqual([]);
  });

  it('avisa si el certificado está vencido', () => {
    const { p12, clave } = crearP12DePrueba('x', { vencido: true });
    expect(leerP12(p12, clave).info.problemas.join(' ')).toMatch(/no está vigente/);
  });

  it('falla con clave incorrecta', () => {
    const { p12 } = crearP12DePrueba();
    expect(() => leerP12(p12, 'otra')).toThrow();
  });
});

describe('firmarDocumento (XAdES-EPES)', () => {
  const { p12, clave, certPem } = crearP12DePrueba();
  const { credenciales } = leerP12(p12, clave);

  it('produce una firma que un verificador independiente acepta', async () => {
    const firmado = await firmarDocumento(DOC, credenciales, { id: 'xmldsig-prueba' });
    const r = verificar(firmado, certPem);
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('incluye política DIAN, rol, hora y certificado en su lugar', async () => {
    const hora = new Date('2026-11-19T15:30:00Z');
    const firmado = await firmarDocumento(DOC, credenciales, { horaFirma: hora });
    expect(firmado).toContain(`<ds:DigestValue>${POLITICA_FIRMA_HASH}</ds:DigestValue>`);
    expect(firmado).toContain('<xades:ClaimedRole>supplier</xades:ClaimedRole>');
    expect(firmado).toContain('<xades:SigningTime>2026-11-19T10:30:00-05:00</xades:SigningTime>');
    expect(firmado).toContain('<ds:X509Certificate>');
    // La firma queda en la ÚLTIMA extensión, no en la de DianExtensions.
    expect(firmado.indexOf('<ds:Signature')).toBeGreaterThan(firmado.indexOf('<cbc:Note>dian</cbc:Note>'));
  });

  it('detecta si se altera el documento después de firmar', async () => {
    const firmado = await firmarDocumento(DOC, credenciales);
    const alterado = firmado.replace('SETP990000001', 'SETP990000002');
    expect(verificar(alterado, certPem).ok).toBe(false);
  });

  it('las propiedades firmadas (hora, política) también quedan protegidas', async () => {
    const firmado = await firmarDocumento(DOC, credenciales, { horaFirma: new Date('2026-11-19T15:30:00Z') });
    const alterado = firmado.replace('2026-11-19T10:30:00-05:00', '2026-11-19T10:31:00-05:00');
    expect(verificar(alterado, certPem).ok).toBe(false);
  });

  it('no firma dos veces el mismo documento', async () => {
    const firmado = await firmarDocumento(DOC, credenciales);
    await expect(firmarDocumento(firmado, credenciales)).rejects.toThrow(/ya tiene contenido/);
  });
});
