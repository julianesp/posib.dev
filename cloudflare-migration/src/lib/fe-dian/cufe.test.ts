/**
 * Verificación del CUFE contra el ejemplo oficial de la DIAN.
 *
 * Fuente: Anexo Técnico FE v1.9, sección 11.2.1 (p.657). El anexo publica una
 * factura de ejemplo con su cadena base y el SHA-384 esperado, así que sirve
 * como "vector de prueba" oficial: si nuestro cálculo reproduce ese hash, la
 * implementación del CUFE es correcta — sin necesidad de certificado ni DIAN.
 *
 * Ejecutable sin framework de tests:  npx tsx cufe.test.ts   (o node --import tsx)
 */
import { buildCufeString, formatMonto, generateCufe, type CufeInput } from './cufe';

// Datos de entrada del ejemplo oficial (Anexo v1.9, p.656-657).
const ejemplo: CufeInput = {
  numFac: '323200000129',
  fecFac: '2019-01-16',
  horFac: '10:53:10-05:00',
  valFac: 1500000.0,
  valIva: 285000.0,
  valInc: 0.0,
  valIca: 0.0,
  valTot: 1785000.0,
  nitOFE: '700085371',
  numAdq: '800199436',
  clTec: '693ff6f2a553c3646a063436fd4dd9ded0311471',
  tipoAmbiente: 1,
};

// Cadena base publicada en el anexo (concatenación esperada).
const CADENA_ESPERADA =
  '3232000001292019-01-1610:53:10-05:001500000.0001285000.00040.00030.001785000.00700085371800199436693ff6f2a553c3646a063436fd4dd9ded03114711';

// Hash SHA-384 publicado en el anexo.
const CUFE_ESPERADO =
  '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4';

async function main() {
  let ok = true;

  // 1) La cadena base debe coincidir exactamente con la del anexo.
  const cadena = buildCufeString(ejemplo);
  if (cadena !== CADENA_ESPERADA) {
    ok = false;
    console.error('✗ Cadena base NO coincide.');
    console.error('  esperada:', CADENA_ESPERADA);
    console.error('  obtenida:', cadena);
  } else {
    console.log('✓ Cadena base coincide con el anexo.');
  }

  // 2) El hash SHA-384 debe coincidir con el del anexo.
  const cufe = await generateCufe(ejemplo);
  if (cufe !== CUFE_ESPERADO) {
    ok = false;
    console.error('✗ CUFE NO coincide.');
    console.error('  esperado:', CUFE_ESPERADO);
    console.error('  obtenido:', cufe);
  } else {
    console.log('✓ CUFE coincide con el ejemplo oficial de la DIAN.');
  }

  // 3) La regla de truncado (no redondeo) de montos.
  const casos: Array<[number, string]> = [
    [1500000, '1500000.00'],
    [285000.999, '285000.99'], // trunca, no redondea a .00 ni a 285001
    [0, '0.00'],
    [12.005, '12.00'],
  ];
  for (const [valor, esperado] of casos) {
    const got = formatMonto(valor);
    if (got !== esperado) {
      ok = false;
      console.error(`✗ formatMonto(${valor}) = ${got}, esperado ${esperado}`);
    }
  }
  if (ok) console.log('✓ Truncado de montos correcto.');

  console.log(ok ? '\nTODOS LOS CHECKS PASARON ✅' : '\nHAY CHECKS FALLIDOS ❌');
  if (!ok) process.exit(1);
}

main();
