/**
 * Arma los documentos del SET DE PRUEBAS de habilitación (modo software propio).
 *
 * En habilitación la DIAN asigna una numeración de prueba fija: prefijo SETP,
 * rango 990000000–995000000, resolución 18760000001 y una clave técnica de
 * prueba. Conviene confirmarla con GetNumberingRange (soap.ts) antes de enviar;
 * si la DIAN devuelve otra, se pasa en `resolucion`.
 *
 * La cantidad exacta de facturas/notas que exige el set aparece en el portal
 * de habilitación de la DIAN al registrar el software ("Set de pruebas").
 */
import {
  CONSUMIDOR_FINAL,
  generarFactura,
  generarNotaCredito,
  generarNotaDebito,
  type ConfigSoftware,
  type DocumentoGenerado,
  type Linea,
  type Resolucion,
  type Tercero,
} from './xml';

export const RESOLUCION_HABILITACION: Resolucion = {
  numero: '18760000001',
  fechaDesde: '2019-01-19',
  fechaHasta: '2030-01-19',
  prefijo: 'SETP',
  rangoDesde: 990000000,
  rangoHasta: 995000000,
  claveTecnica: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
};

export interface OpcionesSet {
  emisor: Tercero;
  software: ConfigSoftware;
  resolucion?: Resolucion;
  /** Primer consecutivo a usar (cada reintento debe usar números nuevos). */
  desde?: number;
  facturas?: number;
  notasCredito?: number;
  notasDebito?: number;
  /** Fecha/hora de emisión; por defecto ahora en Colombia. */
  ahora?: Date;
}

/** Productos típicos de tienda de barrio, con las tarifas que más se usan. */
const PRODUCTOS: Linea[] = [
  { codigo: '7702001001', descripcion: 'Arroz 500 g', cantidad: 2, precioUnitario: 2100, impuestos: [{ tipo: '01', porcentaje: 0 }] },
  { codigo: '7702002002', descripcion: 'Gaseosa 1.5 L', cantidad: 1, precioUnitario: 4201.68, impuestos: [{ tipo: '01', porcentaje: 19 }] },
  { codigo: '7702003003', descripcion: 'Café molido 250 g', cantidad: 1, precioUnitario: 8571.43, impuestos: [{ tipo: '01', porcentaje: 5 }] },
  { codigo: '7702004004', descripcion: 'Jabón de barra', cantidad: 3, precioUnitario: 1680.67, impuestos: [{ tipo: '01', porcentaje: 19 }] },
];

const ADQUIRIENTE_EMPRESA: Tercero = {
  tipoPersona: '1',
  tipoId: '31',
  identificacion: '900108281',
  dv: '3',
  razonSocial: 'CLIENTE DE PRUEBA SAS',
  responsabilidades: 'O-13',
  tributo: { id: '01', nombre: 'IVA' },
  direccion: {
    municipioCodigo: '11001',
    municipio: 'Bogotá, D.C.',
    departamento: 'Bogotá',
    departamentoCodigo: '11',
    linea: 'Calle 1 # 2-3',
  },
  correo: 'cliente@example.com',
};

function partesFechaColombia(d: Date): { fecha: string; hora: string } {
  const iso = new Date(d.getTime() - 5 * 3600_000).toISOString();
  return { fecha: iso.slice(0, 10), hora: `${iso.slice(11, 19)}-05:00` };
}

export async function generarSetPruebas(o: OpcionesSet): Promise<DocumentoGenerado[]> {
  const resolucion = o.resolucion ?? RESOLUCION_HABILITACION;
  const { fecha, hora } = partesFechaColombia(o.ahora ?? new Date());
  let consecutivo = o.desde ?? resolucion.rangoDesde + 1;
  const docs: DocumentoGenerado[] = [];

  const nFacturas = o.facturas ?? 8;
  for (let i = 0; i < nFacturas; i++) {
    // Alterna consumidor final / empresa y contado / crédito para cubrir casos.
    const empresa = i % 2 === 1;
    docs.push(
      await generarFactura({
        resolucion,
        consecutivo: consecutivo++,
        fecha,
        hora,
        emisor: o.emisor,
        adquiriente: empresa ? ADQUIRIENTE_EMPRESA : CONSUMIDOR_FINAL,
        lineas: PRODUCTOS.slice(0, 1 + (i % PRODUCTOS.length)),
        pago: empresa ? { forma: '2', medio: '47', vence: fecha } : { forma: '1', medio: '10' },
        software: o.software,
      }),
    );
  }

  const facturasEmpresa = docs.filter((d, i) => i % 2 === 1);
  const referencia = (i: number) => {
    const f = facturasEmpresa[i % facturasEmpresa.length] ?? docs[0];
    return { numero: f.numero, cufe: f.codigoUnico, fecha };
  };

  for (let i = 0; i < (o.notasCredito ?? 1); i++) {
    docs.push(
      await generarNotaCredito({
        prefijo: 'NC',
        consecutivo: (o.desde ?? 1) + i,
        fecha,
        hora,
        emisor: o.emisor,
        adquiriente: ADQUIRIENTE_EMPRESA,
        lineas: [{ ...PRODUCTOS[1], cantidad: 1 }],
        pago: { forma: '1', medio: '10' },
        factura: referencia(i),
        concepto: { codigo: '1', descripcion: 'Devolución parcial de los bienes' },
        software: o.software,
      }),
    );
  }

  for (let i = 0; i < (o.notasDebito ?? 1); i++) {
    docs.push(
      await generarNotaDebito({
        prefijo: 'ND',
        consecutivo: (o.desde ?? 1) + i,
        fecha,
        hora,
        emisor: o.emisor,
        adquiriente: ADQUIRIENTE_EMPRESA,
        lineas: [{ codigo: 'INT', descripcion: 'Intereses por mora', cantidad: 1, precioUnitario: 1500, impuestos: [{ tipo: '01', porcentaje: 0 }] }],
        pago: { forma: '1', medio: '10' },
        factura: referencia(i),
        concepto: { codigo: '1', descripcion: 'Intereses' },
        software: o.software,
      }),
    );
  }

  return docs;
}
