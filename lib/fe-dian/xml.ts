/**
 * Generación del XML UBL 2.1 de la factura electrónica de venta y de sus notas
 * crédito y débito, según el Anexo Técnico FE v1.9 (Resolución 000165/2023).
 *
 *   generarFactura()     → Invoice     (CustomizationID 10, CUFE)
 *   generarNotaCredito() → CreditNote  (CustomizationID 20, CUDE)
 *   generarNotaDebito()  → DebitNote   (CustomizationID 30, CUDE)
 *
 * El XML sale SIN firmar: trae dos ext:UBLExtension, la primera con
 * sts:DianExtensions y la segunda vacía para la firma (ver firma.ts).
 *
 * Montos: se redondean a 2 decimales al calcular, y el CUFE/CUDE se arma con
 * exactamente los mismos valores que quedan en el XML (la DIAN recalcula el
 * CUFE leyendo el XML; si no coinciden, rechaza).
 *
 * Impuestos soportados por línea: IVA (01) e INC (04). ICA (03) no lo factura
 * una tienda de barrio, así que va en 0.00 en el CUFE.
 */
import { formatMonto, generateCude, generateCufe, softwareSecurityCode } from './cufe';

const AGENCIA = 'schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"';
const NIT_DIAN = '800197268';
const DV_DIAN = '4';

export const URL_QR = {
  1: 'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=',
  2: 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=',
} as const;

/* ───────────────────────────── Tipos de entrada ───────────────────────────── */

/** Tipo de documento de identidad (anexo §13.2.1). */
export type TipoIdentificacion = '11' | '12' | '13' | '21' | '22' | '31' | '41' | '42' | '47' | '48' | '50' | '91';

export interface Direccion {
  /** Código DANE del municipio, 5 dígitos. Ej. "86001" Mocoa. */
  municipioCodigo: string;
  municipio: string;
  departamento: string;
  /** Código DANE del departamento, 2 dígitos. Ej. "86" Putumayo. */
  departamentoCodigo: string;
  linea: string;
  codigoPostal?: string;
}

/** Tributo del tercero (anexo §13.2.6.2): 01 IVA, 04 INC, ZA IVA e INC, ZZ No aplica. */
export type Tributo = { id: '01'; nombre: 'IVA' } | { id: '04'; nombre: 'INC' } | { id: 'ZA'; nombre: 'IVA e INC' } | { id: 'ZZ'; nombre: 'No aplica' };

export interface Tercero {
  /** 1 = persona jurídica, 2 = persona natural. */
  tipoPersona: '1' | '2';
  tipoId: TipoIdentificacion;
  /** Número sin puntos, guiones ni DV. */
  identificacion: string;
  /** Dígito de verificación (obligatorio si tipoId = 31). */
  dv?: string;
  razonSocial: string;
  nombreComercial?: string;
  /** Responsabilidades fiscales del RUT separadas por ";" (ej. "O-13;O-15") o "R-99-PN". */
  responsabilidades: string;
  tributo: Tributo;
  direccion?: Direccion;
  telefono?: string;
  correo?: string;
}

/** Adquiriente genérico para ventas a consumidor final (anexo FAK21/FAK25/FAK26/FAK40). */
export const CONSUMIDOR_FINAL: Tercero = {
  tipoPersona: '2',
  tipoId: '13',
  identificacion: '222222222222',
  razonSocial: 'Consumidor Final',
  responsabilidades: 'R-99-PN',
  tributo: { id: 'ZZ', nombre: 'No aplica' },
};

export interface ImpuestoLinea {
  /** 01 = IVA, 04 = INC. */
  tipo: '01' | '04';
  /** Tarifa en porcentaje: IVA 0/5/19, INC 8. */
  porcentaje: number;
}

export interface Linea {
  codigo: string;
  descripcion: string;
  cantidad: number;
  /** Unidad de medida (anexo §13.3.6). 94 = unidad, KGM = kilo, LTR = litro. */
  unidad?: string;
  /** Precio unitario SIN impuestos. */
  precioUnitario: number;
  impuestos?: ImpuestoLinea[];
}

export interface ConfigSoftware {
  /** Identificador del software asignado por la DIAN al registrarlo. */
  softwareId: string;
  /** PIN que el facturador eligió al registrar el software. */
  pin: string;
  /** 1 = producción, 2 = pruebas/habilitación. */
  ambiente: 1 | 2;
}

export interface Resolucion {
  /** Número de la resolución de numeración. */
  numero: string;
  /** Vigencia, formato YYYY-MM-DD. */
  fechaDesde: string;
  fechaHasta: string;
  prefijo: string;
  rangoDesde: number;
  rangoHasta: number;
  claveTecnica: string;
}

export interface Pago {
  /** 1 = contado, 2 = crédito. */
  forma: '1' | '2';
  /** Medio de pago (anexo §13.3.4.2): 10 efectivo, 48 tarjeta crédito, 49 tarjeta débito, 42 consignación, 47 transferencia, ZZZ otro. */
  medio: string;
  /** Obligatorio si forma = 2 (YYYY-MM-DD). */
  vence?: string;
}

interface Base {
  /** Fecha de emisión YYYY-MM-DD (hora Colombia). */
  fecha: string;
  /** Hora de emisión HH:MM:SS-05:00. */
  hora: string;
  emisor: Tercero;
  adquiriente: Tercero;
  lineas: Linea[];
  pago: Pago;
  notas?: string[];
  software: ConfigSoftware;
}

export interface FacturaInput extends Base {
  resolucion: Resolucion;
  consecutivo: number;
}

export interface ReferenciaFactura {
  numero: string;
  cufe: string;
  fecha: string;
}

export interface NotaCreditoInput extends Base {
  prefijo: string;
  consecutivo: number;
  factura: ReferenciaFactura;
  /** Concepto (anexo §13.2.4): 1 devolución parcial, 2 anulación, 3 rebaja/descuento, 4 ajuste de precio, 5 descuento comercial, 6 otros. */
  concepto: { codigo: '1' | '2' | '3' | '4' | '5' | '6'; descripcion: string };
}

export interface NotaDebitoInput extends Base {
  prefijo: string;
  consecutivo: number;
  factura: ReferenciaFactura;
  /** Concepto (anexo §13.2.5): 1 intereses, 2 gastos por cobrar, 3 cambio del valor, 4 otros. */
  concepto: { codigo: '1' | '2' | '3' | '4'; descripcion: string };
}

export interface DocumentoGenerado {
  tipo: 'Invoice' | 'CreditNote' | 'DebitNote';
  numero: string;
  /** CUFE (factura) o CUDE (notas). */
  codigoUnico: string;
  subtotal: number;
  impuestos: { iva: number; inc: number };
  total: number;
  /** Contenido para el código QR de la representación gráfica. */
  qr: string;
  /** XML UBL sin firmar. */
  xml: string;
}

/* ──────────────────────────────── Utilidades ──────────────────────────────── */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const NOMBRE_IMPUESTO = { '01': 'IVA', '04': 'INC' } as const;

function idTercero(t: Tercero): string {
  const dv = t.tipoId === '31' && t.dv ? ` schemeID="${esc(t.dv)}"` : '';
  return `${AGENCIA}${dv} schemeName="${t.tipoId}"`;
}

function direccionXml(etiqueta: 'Address' | 'RegistrationAddress', d: Direccion): string {
  return (
    `<cac:${etiqueta}>` +
    `<cbc:ID>${esc(d.municipioCodigo)}</cbc:ID>` +
    `<cbc:CityName>${esc(d.municipio)}</cbc:CityName>` +
    (d.codigoPostal ? `<cbc:PostalZone>${esc(d.codigoPostal)}</cbc:PostalZone>` : '') +
    `<cbc:CountrySubentity>${esc(d.departamento)}</cbc:CountrySubentity>` +
    `<cbc:CountrySubentityCode>${esc(d.departamentoCodigo)}</cbc:CountrySubentityCode>` +
    `<cac:AddressLine><cbc:Line>${esc(d.linea)}</cbc:Line></cac:AddressLine>` +
    `<cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country>` +
    `</cac:${etiqueta}>`
  );
}

function terceroXml(t: Tercero, rol: 'AccountingSupplierParty' | 'AccountingCustomerParty', prefijo?: string): string {
  const esEmisor = rol === 'AccountingSupplierParty';
  if (esEmisor && !t.direccion) throw new Error('La dirección del emisor es obligatoria.');
  const id = esc(t.identificacion);
  return (
    `<cac:${rol}>` +
    `<cbc:AdditionalAccountID>${t.tipoPersona}</cbc:AdditionalAccountID>` +
    `<cac:Party>` +
    (!esEmisor && t.tipoPersona === '2'
      ? `<cac:PartyIdentification><cbc:ID ${idTercero(t)}>${id}</cbc:ID></cac:PartyIdentification>`
      : '') +
    `<cac:PartyName><cbc:Name>${esc(t.nombreComercial ?? t.razonSocial)}</cbc:Name></cac:PartyName>` +
    (t.direccion ? `<cac:PhysicalLocation>${direccionXml('Address', t.direccion)}</cac:PhysicalLocation>` : '') +
    `<cac:PartyTaxScheme>` +
    `<cbc:RegistrationName>${esc(t.razonSocial)}</cbc:RegistrationName>` +
    `<cbc:CompanyID ${idTercero(t)}>${id}</cbc:CompanyID>` +
    `<cbc:TaxLevelCode listName="No aplica">${esc(t.responsabilidades)}</cbc:TaxLevelCode>` +
    (t.direccion ? direccionXml('RegistrationAddress', t.direccion) : '') +
    `<cac:TaxScheme><cbc:ID>${t.tributo.id}</cbc:ID><cbc:Name>${esc(t.tributo.nombre)}</cbc:Name></cac:TaxScheme>` +
    `</cac:PartyTaxScheme>` +
    `<cac:PartyLegalEntity>` +
    `<cbc:RegistrationName>${esc(t.razonSocial)}</cbc:RegistrationName>` +
    `<cbc:CompanyID ${idTercero(t)}>${id}</cbc:CompanyID>` +
    (esEmisor && prefijo
      ? `<cac:CorporateRegistrationScheme><cbc:ID>${esc(prefijo)}</cbc:ID></cac:CorporateRegistrationScheme>`
      : '') +
    `</cac:PartyLegalEntity>` +
    (t.telefono || t.correo
      ? `<cac:Contact>` +
        (t.telefono ? `<cbc:Telephone>${esc(t.telefono)}</cbc:Telephone>` : '') +
        (t.correo ? `<cbc:ElectronicMail>${esc(t.correo)}</cbc:ElectronicMail>` : '') +
        `</cac:Contact>`
      : '') +
    `</cac:Party>` +
    `</cac:${rol}>`
  );
}

interface LineaCalculada {
  linea: Linea;
  base: number;
  impuestos: Array<{ tipo: '01' | '04'; porcentaje: number; valor: number }>;
}

interface Totales {
  lineas: LineaCalculada[];
  subtotal: number;
  /** Agrupado por tributo y tarifa. */
  grupos: Map<'01' | '04', Map<number, { base: number; valor: number }>>;
  iva: number;
  inc: number;
  total: number;
}

function calcular(lineas: Linea[]): Totales {
  if (lineas.length === 0) throw new Error('El documento debe tener al menos una línea.');
  const grupos: Totales['grupos'] = new Map();
  const calculadas = lineas.map((linea) => {
    if (!(linea.cantidad > 0)) throw new Error(`Cantidad inválida en "${linea.descripcion}".`);
    const base = r2(linea.cantidad * linea.precioUnitario);
    const impuestos = (linea.impuestos ?? []).map((imp) => {
      const valor = r2((base * imp.porcentaje) / 100);
      const porTipo = grupos.get(imp.tipo) ?? new Map();
      const g = porTipo.get(imp.porcentaje) ?? { base: 0, valor: 0 };
      g.base = r2(g.base + base);
      g.valor = r2(g.valor + valor);
      porTipo.set(imp.porcentaje, g);
      grupos.set(imp.tipo, porTipo);
      return { ...imp, valor };
    });
    return { linea, base, impuestos };
  });
  const subtotal = r2(calculadas.reduce((s, l) => s + l.base, 0));
  const sumar = (tipo: '01' | '04') => r2([...(grupos.get(tipo)?.values() ?? [])].reduce((s, g) => s + g.valor, 0));
  const iva = sumar('01');
  const inc = sumar('04');
  return { lineas: calculadas, subtotal, grupos, iva, inc, total: r2(subtotal + iva + inc) };
}

function totalImpuestosXml(t: Totales, moneda: string): string {
  return [...t.grupos.entries()]
    .map(([tipo, porTarifa]) => {
      const total = r2([...porTarifa.values()].reduce((s, g) => s + g.valor, 0));
      const subtotales = [...porTarifa.entries()]
        .map(
          ([pct, g]) =>
            `<cac:TaxSubtotal>` +
            `<cbc:TaxableAmount currencyID="${moneda}">${formatMonto(g.base)}</cbc:TaxableAmount>` +
            `<cbc:TaxAmount currencyID="${moneda}">${formatMonto(g.valor)}</cbc:TaxAmount>` +
            `<cac:TaxCategory><cbc:Percent>${pct.toFixed(2)}</cbc:Percent>` +
            `<cac:TaxScheme><cbc:ID>${tipo}</cbc:ID><cbc:Name>${NOMBRE_IMPUESTO[tipo]}</cbc:Name></cac:TaxScheme></cac:TaxCategory>` +
            `</cac:TaxSubtotal>`,
        )
        .join('');
      return `<cac:TaxTotal><cbc:TaxAmount currencyID="${moneda}">${formatMonto(total)}</cbc:TaxAmount>${subtotales}</cac:TaxTotal>`;
    })
    .join('');
}

function lineasXml(t: Totales, etiqueta: 'InvoiceLine' | 'CreditNoteLine' | 'DebitNoteLine', moneda: string): string {
  const cantidadTag = { InvoiceLine: 'InvoicedQuantity', CreditNoteLine: 'CreditedQuantity', DebitNoteLine: 'DebitedQuantity' }[etiqueta];
  return t.lineas
    .map(({ linea, base, impuestos }, i) => {
      const unidad = esc(linea.unidad ?? '94');
      const impuestosXml = impuestos
        .map(
          (imp) =>
            `<cac:TaxTotal><cbc:TaxAmount currencyID="${moneda}">${formatMonto(imp.valor)}</cbc:TaxAmount>` +
            `<cac:TaxSubtotal>` +
            `<cbc:TaxableAmount currencyID="${moneda}">${formatMonto(base)}</cbc:TaxableAmount>` +
            `<cbc:TaxAmount currencyID="${moneda}">${formatMonto(imp.valor)}</cbc:TaxAmount>` +
            `<cac:TaxCategory><cbc:Percent>${imp.porcentaje.toFixed(2)}</cbc:Percent>` +
            `<cac:TaxScheme><cbc:ID>${imp.tipo}</cbc:ID><cbc:Name>${NOMBRE_IMPUESTO[imp.tipo]}</cbc:Name></cac:TaxScheme></cac:TaxCategory>` +
            `</cac:TaxSubtotal></cac:TaxTotal>`,
        )
        .join('');
      return (
        `<cac:${etiqueta}>` +
        `<cbc:ID>${i + 1}</cbc:ID>` +
        `<cbc:${cantidadTag} unitCode="${unidad}">${linea.cantidad}</cbc:${cantidadTag}>` +
        `<cbc:LineExtensionAmount currencyID="${moneda}">${formatMonto(base)}</cbc:LineExtensionAmount>` +
        impuestosXml +
        `<cac:Item><cbc:Description>${esc(linea.descripcion)}</cbc:Description>` +
        `<cac:StandardItemIdentification><cbc:ID schemeID="999">${esc(linea.codigo)}</cbc:ID></cac:StandardItemIdentification>` +
        `</cac:Item>` +
        `<cac:Price><cbc:PriceAmount currencyID="${moneda}">${formatMonto(r2(linea.precioUnitario))}</cbc:PriceAmount>` +
        `<cbc:BaseQuantity unitCode="${unidad}">1</cbc:BaseQuantity></cac:Price>` +
        `</cac:${etiqueta}>`
      );
    })
    .join('');
}

function totalesMonetariosXml(t: Totales, etiqueta: 'LegalMonetaryTotal' | 'RequestedMonetaryTotal', moneda: string): string {
  return (
    `<cac:${etiqueta}>` +
    `<cbc:LineExtensionAmount currencyID="${moneda}">${formatMonto(t.subtotal)}</cbc:LineExtensionAmount>` +
    `<cbc:TaxExclusiveAmount currencyID="${moneda}">${formatMonto(baseGravable(t))}</cbc:TaxExclusiveAmount>` +
    `<cbc:TaxInclusiveAmount currencyID="${moneda}">${formatMonto(t.total)}</cbc:TaxInclusiveAmount>` +
    `<cbc:PayableAmount currencyID="${moneda}">${formatMonto(t.total)}</cbc:PayableAmount>` +
    `</cac:${etiqueta}>`
  );
}

/**
 * TaxExclusiveAmount = suma de las bases gravables (líneas con algún impuesto),
 * no el subtotal: las líneas sin impuestos (excluidas) no cuentan (regla FAU04).
 */
function baseGravable(t: Totales): number {
  return r2(t.lineas.filter((l) => l.impuestos.length > 0).reduce((s, l) => s + l.base, 0));
}

function pagoXml(p: Pago): string {
  if (p.forma === '2' && !p.vence) throw new Error('Una venta a crédito necesita fecha de vencimiento.');
  return (
    `<cac:PaymentMeans><cbc:ID>${p.forma}</cbc:ID><cbc:PaymentMeansCode>${esc(p.medio)}</cbc:PaymentMeansCode>` +
    (p.vence ? `<cbc:PaymentDueDate>${esc(p.vence)}</cbc:PaymentDueDate>` : '') +
    `</cac:PaymentMeans>`
  );
}

function qrTexto(numero: string, b: Base, t: Totales, codigo: string): string {
  return [
    `NumFac: ${numero}`,
    `FecFac: ${b.fecha}`,
    `HorFac: ${b.hora}`,
    `NitFac: ${b.emisor.identificacion}`,
    `DocAdq: ${b.adquiriente.identificacion}`,
    `ValFac: ${formatMonto(t.subtotal)}`,
    `ValIva: ${formatMonto(t.iva)}`,
    `ValOtroIm: ${formatMonto(t.inc)}`,
    `ValTolFac: ${formatMonto(t.total)}`,
    `CUFE: ${codigo}`,
    `${URL_QR[b.software.ambiente]}${codigo}`,
  ].join('\n');
}

/**
 * sts:QRCode lleva SOLO la URL de consulta (regla FAB36/CAB36); el texto
 * completo con los valores es para la representación gráfica.
 */
async function dianExtensionsXml(b: Base, numero: string, codigoUnico: string, resolucion?: Resolucion): Promise<string> {
  const ssc = await softwareSecurityCode(b.software.softwareId, b.software.pin, numero);
  const e = b.emisor;
  return (
    `<sts:DianExtensions>` +
    (resolucion
      ? `<sts:InvoiceControl>` +
        `<sts:InvoiceAuthorization>${esc(resolucion.numero)}</sts:InvoiceAuthorization>` +
        `<sts:AuthorizationPeriod><cbc:StartDate>${resolucion.fechaDesde}</cbc:StartDate><cbc:EndDate>${resolucion.fechaHasta}</cbc:EndDate></sts:AuthorizationPeriod>` +
        `<sts:AuthorizedInvoices><sts:Prefix>${esc(resolucion.prefijo)}</sts:Prefix><sts:From>${resolucion.rangoDesde}</sts:From><sts:To>${resolucion.rangoHasta}</sts:To></sts:AuthorizedInvoices>` +
        `</sts:InvoiceControl>`
      : '') +
    `<sts:InvoiceSource><cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode></sts:InvoiceSource>` +
    // Software propio: el proveedor del software es el mismo facturador.
    `<sts:SoftwareProvider>` +
    `<sts:ProviderID ${idTercero(e)}>${esc(e.identificacion)}</sts:ProviderID>` +
    `<sts:SoftwareID ${AGENCIA}>${esc(b.software.softwareId)}</sts:SoftwareID>` +
    `</sts:SoftwareProvider>` +
    `<sts:SoftwareSecurityCode ${AGENCIA}>${ssc}</sts:SoftwareSecurityCode>` +
    `<sts:AuthorizationProvider><sts:AuthorizationProviderID ${AGENCIA} schemeID="${DV_DIAN}" schemeName="31">${NIT_DIAN}</sts:AuthorizationProviderID></sts:AuthorizationProvider>` +
    `<sts:QRCode>${URL_QR[b.software.ambiente]}${codigoUnico}</sts:QRCode>` +
    `</sts:DianExtensions>`
  );
}

function raizXml(tipo: DocumentoGenerado['tipo']): string {
  return (
    `<${tipo} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${tipo}-2"` +
    ` xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"` +
    ` xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"` +
    ` xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` +
    ` xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"` +
    ` xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"` +
    ` xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` +
    ` xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:${tipo}-2 http://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/maindoc/UBL-${tipo}-2.1.xsd">`
  );
}

function validarBase(b: Base) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) throw new Error(`Fecha inválida: ${b.fecha}`);
  if (!/^\d{2}:\d{2}:\d{2}-05:00$/.test(b.hora)) throw new Error(`Hora inválida (HH:MM:SS-05:00): ${b.hora}`);
  for (const t of [b.emisor, b.adquiriente]) {
    if (t.tipoId === '31' && !t.dv) throw new Error(`Falta el dígito de verificación del NIT ${t.identificacion}.`);
  }
}

/* ───────────────────────────────── Documentos ─────────────────────────────── */

export async function generarFactura(f: FacturaInput): Promise<DocumentoGenerado> {
  validarBase(f);
  const r = f.resolucion;
  if (f.consecutivo < r.rangoDesde || f.consecutivo > r.rangoHasta) {
    throw new Error(`El consecutivo ${f.consecutivo} está fuera del rango autorizado ${r.rangoDesde}-${r.rangoHasta}.`);
  }
  const moneda = 'COP';
  const numero = `${r.prefijo}${f.consecutivo}`;
  const t = calcular(f.lineas);
  const cufe = await generateCufe({
    numFac: numero,
    fecFac: f.fecha,
    horFac: f.hora,
    valFac: t.subtotal,
    valIva: t.iva,
    valInc: t.inc,
    valIca: 0,
    valTot: t.total,
    nitOFE: f.emisor.identificacion,
    numAdq: f.adquiriente.identificacion,
    clTec: r.claveTecnica,
    tipoAmbiente: f.software.ambiente,
  });
  const qr = qrTexto(numero, f, t, cufe);

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    raizXml('Invoice') +
    `<ext:UBLExtensions>` +
    `<ext:UBLExtension><ext:ExtensionContent>${await dianExtensionsXml(f, numero, cufe, r)}</ext:ExtensionContent></ext:UBLExtension>` +
    `<ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension>` +
    `</ext:UBLExtensions>` +
    `<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>` +
    `<cbc:CustomizationID>10</cbc:CustomizationID>` +
    `<cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>` +
    `<cbc:ProfileExecutionID>${f.software.ambiente}</cbc:ProfileExecutionID>` +
    `<cbc:ID>${esc(numero)}</cbc:ID>` +
    `<cbc:UUID schemeID="${f.software.ambiente}" schemeName="CUFE-SHA384">${cufe}</cbc:UUID>` +
    `<cbc:IssueDate>${f.fecha}</cbc:IssueDate>` +
    `<cbc:IssueTime>${f.hora}</cbc:IssueTime>` +
    (f.pago.vence ? `<cbc:DueDate>${f.pago.vence}</cbc:DueDate>` : '') +
    `<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>` +
    (f.notas ?? []).map((n) => `<cbc:Note>${esc(n)}</cbc:Note>`).join('') +
    `<cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>` +
    `<cbc:LineCountNumeric>${f.lineas.length}</cbc:LineCountNumeric>` +
    terceroXml(f.emisor, 'AccountingSupplierParty', r.prefijo) +
    terceroXml(f.adquiriente, 'AccountingCustomerParty') +
    pagoXml(f.pago) +
    totalImpuestosXml(t, moneda) +
    totalesMonetariosXml(t, 'LegalMonetaryTotal', moneda) +
    lineasXml(t, 'InvoiceLine', moneda) +
    `</Invoice>`;

  return { tipo: 'Invoice', numero, codigoUnico: cufe, subtotal: t.subtotal, impuestos: { iva: t.iva, inc: t.inc }, total: t.total, qr, xml };
}

async function generarNota(
  tipo: 'CreditNote' | 'DebitNote',
  n: NotaCreditoInput | NotaDebitoInput,
): Promise<DocumentoGenerado> {
  validarBase(n);
  const moneda = 'COP';
  const numero = `${n.prefijo}${n.consecutivo}`;
  const t = calcular(n.lineas);
  const cude = await generateCude({
    numFac: numero,
    fecFac: n.fecha,
    horFac: n.hora,
    valFac: t.subtotal,
    valIva: t.iva,
    valInc: t.inc,
    valIca: 0,
    valTot: t.total,
    nitOFE: n.emisor.identificacion,
    numAdq: n.adquiriente.identificacion,
    pinSoftware: n.software.pin,
    tipoAmbiente: n.software.ambiente,
  });
  const qr = qrTexto(numero, n, t, cude);
  const credito = tipo === 'CreditNote';

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    raizXml(tipo) +
    `<ext:UBLExtensions>` +
    `<ext:UBLExtension><ext:ExtensionContent>${await dianExtensionsXml(n, numero, cude)}</ext:ExtensionContent></ext:UBLExtension>` +
    `<ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension>` +
    `</ext:UBLExtensions>` +
    `<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>` +
    `<cbc:CustomizationID>${credito ? '20' : '30'}</cbc:CustomizationID>` +
    `<cbc:ProfileID>DIAN 2.1: ${credito ? 'Nota Crédito' : 'Nota Débito'} de Factura Electrónica de Venta</cbc:ProfileID>` +
    `<cbc:ProfileExecutionID>${n.software.ambiente}</cbc:ProfileExecutionID>` +
    `<cbc:ID>${esc(numero)}</cbc:ID>` +
    `<cbc:UUID schemeID="${n.software.ambiente}" schemeName="CUDE-SHA384">${cude}</cbc:UUID>` +
    `<cbc:IssueDate>${n.fecha}</cbc:IssueDate>` +
    `<cbc:IssueTime>${n.hora}</cbc:IssueTime>` +
    (credito ? `<cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>` : '') +
    (n.notas ?? []).map((x) => `<cbc:Note>${esc(x)}</cbc:Note>`).join('') +
    `<cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>` +
    `<cbc:LineCountNumeric>${n.lineas.length}</cbc:LineCountNumeric>` +
    `<cac:DiscrepancyResponse><cbc:ReferenceID>${esc(n.factura.numero)}</cbc:ReferenceID>` +
    `<cbc:ResponseCode>${n.concepto.codigo}</cbc:ResponseCode><cbc:Description>${esc(n.concepto.descripcion)}</cbc:Description></cac:DiscrepancyResponse>` +
    `<cac:BillingReference><cac:InvoiceDocumentReference>` +
    `<cbc:ID>${esc(n.factura.numero)}</cbc:ID>` +
    `<cbc:UUID schemeName="CUFE-SHA384">${esc(n.factura.cufe)}</cbc:UUID>` +
    `<cbc:IssueDate>${esc(n.factura.fecha)}</cbc:IssueDate>` +
    `</cac:InvoiceDocumentReference></cac:BillingReference>` +
    terceroXml(n.emisor, 'AccountingSupplierParty') +
    terceroXml(n.adquiriente, 'AccountingCustomerParty') +
    pagoXml(n.pago) +
    totalImpuestosXml(t, moneda) +
    totalesMonetariosXml(t, credito ? 'LegalMonetaryTotal' : 'RequestedMonetaryTotal', moneda) +
    lineasXml(t, credito ? 'CreditNoteLine' : 'DebitNoteLine', moneda) +
    `</${tipo}>`;

  return { tipo, numero, codigoUnico: cude, subtotal: t.subtotal, impuestos: { iva: t.iva, inc: t.inc }, total: t.total, qr, xml };
}

export function generarNotaCredito(n: NotaCreditoInput): Promise<DocumentoGenerado> {
  return generarNota('CreditNote', n);
}

export function generarNotaDebito(n: NotaDebitoInput): Promise<DocumentoGenerado> {
  return generarNota('DebitNote', n);
}
