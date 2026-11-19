/**
 * Generación del CUFE (Código Único de Factura Electrónica).
 *
 * Fuente: DIAN — Anexo Técnico de la Factura Electrónica de Venta v1.9
 * (Resolución 000165 del 01/NOV/2023), sección 11.2.
 *
 *   CUFE = SHA-384(
 *     NumFac + FecFac + HorFac + ValFac +
 *     CodImp1(01) + ValImp1 + CodImp2(04) + ValImp2 + CodImp3(03) + ValImp3 +
 *     ValTot + NitOFE + NumAdq + ClTec + TipoAmbiente
 *   )
 *
 * Reglas de formato de los valores monetarios (anexo §11.2):
 *  - punto decimal, exactamente 2 decimales TRUNCADOS (no redondeados),
 *  - sin separadores de miles, sin símbolo de pesos.
 *
 * Impuestos con código fijo en el CUFE:
 *  - CodImp1 = 01 → IVA
 *  - CodImp2 = 04 → Impuesto Nacional al Consumo (INC)
 *  - CodImp3 = 03 → ICA
 *  Si un impuesto no está referenciado, su valor va como "0.00".
 *
 * Este módulo NO requiere certificado de firma: el CUFE es verificable de
 * forma aislada contra el ejemplo oficial del anexo (ver cufe.test.ts).
 */

/** Datos mínimos necesarios para calcular el CUFE de una factura de venta. */
export interface CufeInput {
  /** Número de factura: prefijo concatenado con el consecutivo. Ej: "323200000129". */
  numFac: string;
  /** Fecha de la factura en formato ISO date. Ej: "2019-01-16". */
  fecFac: string;
  /** Hora de la factura incluyendo GMT. Ej: "10:53:10-05:00". */
  horFac: string;
  /** Valor de la factura SIN impuestos. */
  valFac: number;
  /** Valor del impuesto 01 (IVA). 0 si no aplica. */
  valIva?: number;
  /** Valor del impuesto 04 (INC). 0 si no aplica. */
  valInc?: number;
  /** Valor del impuesto 03 (ICA). 0 si no aplica. */
  valIca?: number;
  /** Valor total de la factura (con impuestos). */
  valTot: number;
  /** NIT del Facturador Electrónico, sin puntos, guiones ni dígito de verificación. */
  nitOFE: string;
  /** Identificación del adquiriente, sin puntos, guiones ni dígito de verificación. */
  numAdq: string;
  /** Clave técnica del rango de facturación (la entrega la DIAN por rango). */
  clTec: string;
  /** Ambiente: 1 = producción, 2 = pruebas/habilitación. */
  tipoAmbiente: 1 | 2;
}

/**
 * Formatea un valor monetario según la regla del anexo:
 * 2 decimales TRUNCADOS (no redondeados), punto decimal, sin separadores.
 *
 * Truncar (no redondear) es crítico: si se redondea, el hash no coincide con
 * el que calcula la DIAN y la factura se rechaza.
 */
export function formatMonto(valor: number): string {
  // Trunca hacia cero a 2 decimales evitando errores de coma flotante.
  const truncado = Math.trunc(valor * 100) / 100;
  return truncado.toFixed(2);
}

/**
 * Construye la cadena base que se somete al hash. Se expone aparte para poder
 * inspeccionarla/depurarla y compararla con el ejemplo del anexo.
 */
export function buildCufeString(input: CufeInput): string {
  return (
    input.numFac +
    input.fecFac +
    input.horFac +
    formatMonto(input.valFac) +
    '01' +
    formatMonto(input.valIva ?? 0) +
    '04' +
    formatMonto(input.valInc ?? 0) +
    '03' +
    formatMonto(input.valIca ?? 0) +
    formatMonto(input.valTot) +
    input.nitOFE +
    input.numAdq +
    input.clTec +
    String(input.tipoAmbiente)
  );
}

/** Convierte un ArrayBuffer a hexadecimal en minúsculas. */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** SHA-384 en hexadecimal minúsculas (WebCrypto: Workers, Node ≥ 18, navegador). */
export async function sha384Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-384', new TextEncoder().encode(texto));
  return toHex(digest);
}

/**
 * Calcula el CUFE (SHA-384 en hexadecimal minúsculas) usando WebCrypto,
 * disponible en el runtime de Cloudflare Workers y en Node ≥ 18.
 */
export async function generateCufe(input: CufeInput): Promise<string> {
  return sha384Hex(buildCufeString(input));
}

/**
 * CUDE de notas crédito/débito (anexo §11.4.3): misma cadena que el CUFE pero
 * con el PIN del software en lugar de la clave técnica (las notas no tienen
 * rango de numeración autorizado). Se reutiliza `CufeInput` poniendo el PIN en
 * `clTec`.
 */
export async function generateCude(input: Omit<CufeInput, 'clTec'> & { pinSoftware: string }): Promise<string> {
  const { pinSoftware, ...resto } = input;
  return sha384Hex(buildCufeString({ ...resto, clTec: pinSoftware }));
}

/**
 * Código de seguridad del software (anexo §11.8):
 *   SHA-384(Id Software + Pin + Número del documento)
 * Va en sts:DianExtensions/sts:SoftwareSecurityCode.
 */
export async function softwareSecurityCode(softwareId: string, pin: string, numeroDocumento: string): Promise<string> {
  return sha384Hex(softwareId + pin + numeroDocumento);
}
