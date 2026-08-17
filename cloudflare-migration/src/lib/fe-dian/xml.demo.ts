/**
 * Demo del generador de XML UBL 2.1. Genera una factura de ejemplo (tienda de
 * barrio) y verifica que el XML esté bien formado y contenga el CUFE.
 *
 *   npx tsx src/lib/fe-dian/xml.demo.ts
 */
import { generarFacturaXml, type FacturaInput } from './xml';

const factura: FacturaInput = {
  prefijo: 'SETP',
  consecutivo: '990000001',
  fecha: '2024-05-01',
  hora: '10:53:10-05:00',
  ambiente: 2, // pruebas / habilitación
  emisor: {
    nombre: 'Tienda La Esquina',
    identificacion: '900123456',
    dv: '3',
    tipoId: '31',
    municipioCodigo: '05001',
    municipioNombre: 'Medellín',
    departamentoCodigo: '05',
    direccion: 'Calle 10 # 20-30',
    tipoOrganizacion: '1',
  },
  adquiriente: {
    nombre: 'Consumidor Final',
    identificacion: '222222222222',
    tipoId: '13',
    municipioCodigo: '05001',
    municipioNombre: 'Medellín',
    departamentoCodigo: '05',
    direccion: 'N/A',
    tipoOrganizacion: '2',
  },
  claveTecnica: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  lineas: [
    { descripcion: 'Arroz 500g', codigo: 'ARR500', cantidad: 2, precioUnitario: 2500, ivaPorcentaje: 0 },
    { descripcion: 'Gaseosa 400ml', codigo: 'GAS400', cantidad: 3, precioUnitario: 2100, ivaPorcentaje: 19 },
  ],
};

async function main() {
  const res = await generarFacturaXml(factura);

  console.log('Número factura :', res.numeroFactura);
  console.log('CUFE           :', res.cufe);
  console.log('Subtotal       :', res.subtotalSinImpuestos);
  console.log('IVA            :', res.totalIva);
  console.log('Total          :', res.totalConImpuestos);
  console.log('----- XML -----');
  console.log(res.xml);

  // Chequeos básicos.
  let ok = true;
  const checks: Array<[boolean, string]> = [
    [res.xml.includes(`>${res.cufe}<`), 'el CUFE está incrustado en <cbc:UUID>'],
    [res.xml.includes('{{FIRMA_XADES}}'), 'el marcador de firma XAdES está presente'],
    [res.xml.includes('<Invoice'), 'raíz <Invoice> presente'],
    [res.totalConImpuestos === 5000 + 6300 + Math.trunc(6300 * 0.19 * 100) / 100, 'total = 5000 (arroz) + 6300 (gaseosa) + IVA 19% gaseosa'],
    // XML balanceado (mismo # de < que de >): heurística simple de buena formación.
    [(res.xml.match(/</g) || []).length === (res.xml.match(/>/g) || []).length, 'etiquetas balanceadas'],
  ];
  for (const [cond, desc] of checks) {
    console.log(cond ? `✓ ${desc}` : `✗ ${desc}`);
    if (!cond) ok = false;
  }
  console.log(ok ? '\nDEMO OK ✅' : '\nDEMO CON FALLOS ❌');
  if (!ok) process.exit(1);
}

main();
