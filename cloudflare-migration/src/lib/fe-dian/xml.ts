/**
 * Generación del XML UBL 2.1 de la Factura Electrónica de Venta (Invoice).
 *
 * Fuente: DIAN — Anexo Técnico FE v1.9 (Resolución 000165/2023), sección 6.1.
 *
 * ALCANCE de esta versión: produce un Invoice con la estructura mínima
 * requerida (emisor, adquiriente, líneas, totales de impuestos y CUFE). Está
 * pensado para desarrollar y validar SIN certificado de firma.
 *
 * PENDIENTE (requiere certificado de firma .p12):
 *   - El bloque <ext:UBLExtensions> con la firma XAdES-EPES. Aquí se deja el
 *     marcador {{FIRMA_XADES}} en su lugar; ver §10 del anexo.
 *   - El envío al web service SOAP de la DIAN (SendTestSetAsync / SendBillSync).
 *
 * Nota: por ahora solo se soporta IVA (impuesto 01). INC (04) e ICA (03) se
 * contemplan en el CUFE pero no se emiten como <TaxSubTotal> hasta modelarlos.
 */
import { generateCufe, formatMonto, type CufeInput } from './cufe';

/** Tipo de identificación del adquiriente (Anexo §13.2.7.1). */
export type TipoIdentificacion =
  | '13' // Cédula de ciudadanía
  | '31' // NIT
  | '22' // Cédula de extranjería
  | '41' // Pasaporte
  | '47' // PEP
  | '48'; // PPT

export interface Party {
  /** Razón social o nombre completo. */
  nombre: string;
  /** Número de identificación (sin puntos, guiones ni DV). */
  identificacion: string;
  /** Dígito de verificación (solo NIT). */
  dv?: string;
  tipoId: TipoIdentificacion;
  /** Código de municipio DANE (ej. "05001" Medellín). */
  municipioCodigo: string;
  municipioNombre: string;
  /** Código de departamento (ISO 3166-2:CO), ej. "05". */
  departamentoCodigo: string;
  direccion: string;
  /** 1 = Persona Jurídica, 2 = Persona Natural (Anexo §13.2.7.3). */
  tipoOrganizacion: '1' | '2';
}

export interface LineaFactura {
  /** Descripción del producto/servicio. */
  descripcion: string;
  /** Código interno del producto (schemeID 999 = estándar del vendedor). */
  codigo: string;
  /** Cantidad. */
  cantidad: number;
  /** Precio unitario sin IVA. */
  precioUnitario: number;
  /** Tarifa de IVA como porcentaje (ej. 19, 5, 0). */
  ivaPorcentaje: number;
}

export interface FacturaInput {
  /** Prefijo autorizado por la DIAN para el rango. Ej. "SETP". */
  prefijo: string;
  /** Consecutivo (número) dentro del rango. */
  consecutivo: string;
  /** Fecha de emisión ISO date, ej. "2024-05-01". */
  fecha: string;
  /** Hora con GMT, ej. "10:53:10-05:00". */
  hora: string;
  emisor: Party;
  adquiriente: Party;
  lineas: LineaFactura[];
  /** Clave técnica del rango de facturación (entregada por la DIAN). */
  claveTecnica: string;
  /** 1 = producción, 2 = pruebas/habilitación. */
  ambiente: 1 | 2;
  /** Moneda ISO 4217. Por defecto COP. */
  moneda?: string;
}

export interface FacturaCalculada {
  numeroFactura: string;
  cufe: string;
  subtotalSinImpuestos: number;
  totalIva: number;
  totalConImpuestos: number;
  xml: string;
}

/** Escapa caracteres especiales para insertarlos como texto XML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Totales de una línea, truncados a 2 decimales según regla del anexo. */
function calcularLinea(l: LineaFactura) {
  const base = Math.trunc(l.cantidad * l.precioUnitario * 100) / 100;
  const iva = Math.trunc(base * (l.ivaPorcentaje / 100) * 100) / 100;
  return { base, iva };
}

function partyBlockXml(p: Party, rol: 'AccountingSupplierParty' | 'AccountingCustomerParty'): string {
  return `  <cac:${rol}>
    <cbc:AdditionalAccountID>${p.tipoOrganizacion}</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(p.nombre)}</cbc:Name></cac:PartyName>
      <cac:PhysicalLocation>
        <cac:Address>
          <cbc:ID>${esc(p.municipioCodigo)}</cbc:ID>
          <cbc:CityName>${esc(p.municipioNombre)}</cbc:CityName>
          <cbc:CountrySubentityCode>${esc(p.departamentoCodigo)}</cbc:CountrySubentityCode>
          <cac:AddressLine><cbc:Line>${esc(p.direccion)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode></cac:Country>
        </cac:Address>
      </cac:PhysicalLocation>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${esc(p.nombre)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${p.dv ? ` schemeID="${esc(p.dv)}"` : ''} schemeName="${p.tipoId}">${esc(p.identificacion)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:${rol}>`;
}

/**
 * Genera el XML UBL 2.1 de la factura y su CUFE.
 * Async porque el CUFE usa WebCrypto (SHA-384).
 */
export async function generarFacturaXml(input: FacturaInput): Promise<FacturaCalculada> {
  const moneda = input.moneda ?? 'COP';
  const numeroFactura = `${input.prefijo}${input.consecutivo}`;

  // Totales.
  let subtotal = 0;
  let totalIva = 0;
  const lineasCalc = input.lineas.map((l) => {
    const { base, iva } = calcularLinea(l);
    subtotal += base;
    totalIva += iva;
    return { l, base, iva };
  });
  subtotal = Math.trunc(subtotal * 100) / 100;
  totalIva = Math.trunc(totalIva * 100) / 100;
  const total = Math.trunc((subtotal + totalIva) * 100) / 100;

  // CUFE.
  const cufeInput: CufeInput = {
    numFac: numeroFactura,
    fecFac: input.fecha,
    horFac: input.hora,
    valFac: subtotal,
    valIva: totalIva,
    valInc: 0,
    valIca: 0,
    valTot: total,
    nitOFE: input.emisor.identificacion,
    numAdq: input.adquiriente.identificacion,
    clTec: input.claveTecnica,
    tipoAmbiente: input.ambiente,
  };
  const cufe = await generateCufe(cufeInput);

  // Líneas <cac:InvoiceLine>.
  const lineasXml = lineasCalc
    .map(({ l, base, iva }, i) => {
      const precioUnit = Math.trunc(l.precioUnitario * 100) / 100;
      return `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">${l.cantidad}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${moneda}">${formatMonto(base)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${formatMonto(iva)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${moneda}">${formatMonto(base)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${moneda}">${formatMonto(iva)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${l.ivaPorcentaje.toFixed(2)}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Description>${esc(l.descripcion)}</cbc:Description>
      <cac:StandardItemIdentification>
        <cbc:ID schemeID="999">${esc(l.codigo)}</cbc:ID>
      </cac:StandardItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${moneda}">${formatMonto(precioUnit)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">${l.cantidad}</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <!-- Bloque sts:DianExtensions (InvoiceControl, InvoiceSource, SoftwareProvider,
             SoftwareSecurityCode, QRCode) — se completa al integrar el software autorizado. -->
      </ext:ExtensionContent>
    </ext:UBLExtension>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        {{FIRMA_XADES}}
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>${input.ambiente}</cbc:ProfileExecutionID>
  <cbc:ID>${esc(numeroFactura)}</cbc:ID>
  <cbc:UUID schemeID="${input.ambiente}" schemeName="CUFE-SHA384">${cufe}</cbc:UUID>
  <cbc:IssueDate>${esc(input.fecha)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(input.hora)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${input.lineas.length}</cbc:LineCountNumeric>
${partyBlockXml(input.emisor, 'AccountingSupplierParty')}
${partyBlockXml(input.adquiriente, 'AccountingCustomerParty')}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${moneda}">${formatMonto(totalIva)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${formatMonto(subtotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">${formatMonto(totalIva)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${moneda}">${formatMonto(subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${moneda}">${formatMonto(subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${moneda}">${formatMonto(total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${moneda}">${formatMonto(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineasXml}
</Invoice>`;

  return {
    numeroFactura,
    cufe,
    subtotalSinImpuestos: subtotal,
    totalIva,
    totalConImpuestos: total,
    xml,
  };
}
