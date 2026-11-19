/**
 * Habilitación ante la DIAN como "software propio" — herramienta de línea de comandos.
 *
 * Uso (desde la raíz del repo):
 *   pnpm fe:habilitacion rangos             # consulta la numeración de prueba (SETP + clave técnica)
 *   pnpm fe:habilitacion enviar             # genera, firma y envía el set de pruebas
 *   pnpm fe:habilitacion estado <zipKey>... # consulta el resultado de uno o más envíos
 *   pnpm fe:habilitacion revisar            # valida el certificado y genera los XML sin enviar
 *
 * Configuración en .env.fe-dian (no se sube a git; ver .env.fe-dian.example):
 *   FE_P12=/ruta/certificado.p12   FE_P12_CLAVE=...
 *   FE_SOFTWARE_ID=...             FE_PIN=...           FE_TEST_SET_ID=...
 *   FE_NIT=...  FE_DV=...  FE_TIPO_PERSONA=1|2  FE_RAZON_SOCIAL=...
 *   FE_RESPONSABILIDADES=R-99-PN   FE_TRIBUTO=ZZ|01
 *   FE_MUNICIPIO_CODIGO=86001 FE_MUNICIPIO=Mocoa FE_DEPARTAMENTO=Putumayo FE_DEPARTAMENTO_CODIGO=86 FE_DIRECCION=...
 *   FE_FACTURAS=8 FE_NOTAS_CREDITO=1 FE_NOTAS_DEBITO=1   (lo que pida el portal de la DIAN)
 *
 * Los XML firmados y las respuestas quedan en .fe-dian-salida/ (no se sube a git).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { leerP12 } from '../../lib/fe-dian/certificado';
import { firmarDocumento } from '../../lib/fe-dian/firma';
import { RESOLUCION_HABILITACION, generarSetPruebas } from '../../lib/fe-dian/set-pruebas';
import { ClienteDian, empaquetarZip, nombreArchivo } from '../../lib/fe-dian/soap';
import type { Resolucion, Tercero, Tributo } from '../../lib/fe-dian/xml';

const SALIDA = '.fe-dian-salida';

function cargarEnv(archivo = '.env.fe-dian') {
  if (!existsSync(archivo)) return;
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function req(nombre: string): string {
  const v = process.env[nombre];
  if (!v) {
    console.error(`Falta ${nombre} en .env.fe-dian`);
    process.exit(1);
  }
  return v;
}

const TRIBUTOS: Record<string, Tributo> = {
  '01': { id: '01', nombre: 'IVA' },
  '04': { id: '04', nombre: 'INC' },
  ZA: { id: 'ZA', nombre: 'IVA e INC' },
  ZZ: { id: 'ZZ', nombre: 'No aplica' },
};

function emisor(): Tercero {
  return {
    tipoPersona: (process.env.FE_TIPO_PERSONA as '1' | '2') ?? '2',
    tipoId: '31',
    identificacion: req('FE_NIT'),
    dv: req('FE_DV'),
    razonSocial: req('FE_RAZON_SOCIAL'),
    nombreComercial: process.env.FE_NOMBRE_COMERCIAL,
    responsabilidades: process.env.FE_RESPONSABILIDADES ?? 'R-99-PN',
    tributo: TRIBUTOS[process.env.FE_TRIBUTO ?? 'ZZ'] ?? TRIBUTOS.ZZ,
    direccion: {
      municipioCodigo: req('FE_MUNICIPIO_CODIGO'),
      municipio: req('FE_MUNICIPIO'),
      departamento: req('FE_DEPARTAMENTO'),
      departamentoCodigo: req('FE_DEPARTAMENTO_CODIGO'),
      linea: req('FE_DIRECCION'),
    },
    telefono: process.env.FE_TELEFONO,
    correo: process.env.FE_CORREO,
  };
}

function credenciales() {
  const { credenciales, info } = leerP12(new Uint8Array(readFileSync(req('FE_P12'))), req('FE_P12_CLAVE'));
  console.log(`Certificado: ${info.titular}`);
  console.log(`  Emisor:    ${info.emisor}`);
  console.log(`  Vigencia:  ${info.validoDesde.toISOString().slice(0, 10)} → ${info.validoHasta.toISOString().slice(0, 10)}`);
  if (info.problemas.length) {
    console.error('  ✗ Problemas que harán que la DIAN rechace la firma:');
    for (const p of info.problemas) console.error(`    - ${p}`);
    process.exit(1);
  }
  console.log('  ✓ Apto (SHA-2, firma digital + no repudio, vigente)');
  return credenciales;
}

function resolucion(): Resolucion {
  // Permite sobrescribir la numeración de prueba si GetNumberingRange devuelve otra.
  return {
    ...RESOLUCION_HABILITACION,
    ...(process.env.FE_CLAVE_TECNICA ? { claveTecnica: process.env.FE_CLAVE_TECNICA } : {}),
    ...(process.env.FE_PREFIJO ? { prefijo: process.env.FE_PREFIJO } : {}),
  };
}

async function generarFirmados() {
  const cred = credenciales();
  // Consecutivo nuevo en cada corrida: la DIAN rechaza números repetidos.
  const desde = Number(process.env.FE_DESDE) || RESOLUCION_HABILITACION.rangoDesde + (Math.floor(Date.now() / 1000) % 4_000_000);
  const docs = await generarSetPruebas({
    emisor: emisor(),
    software: { softwareId: req('FE_SOFTWARE_ID'), pin: req('FE_PIN'), ambiente: 2 },
    resolucion: resolucion(),
    desde,
    facturas: Number(process.env.FE_FACTURAS ?? 8),
    notasCredito: Number(process.env.FE_NOTAS_CREDITO ?? 1),
    notasDebito: Number(process.env.FE_NOTAS_DEBITO ?? 1),
  });
  const anio = new Date().getFullYear();
  const prefijoArchivo = { Invoice: 'fv', CreditNote: 'nc', DebitNote: 'nd' } as const;
  const firmados = [];
  mkdirSync(SALIDA, { recursive: true });
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const xml = await firmarDocumento(d.xml, cred);
    const nombre = nombreArchivo(prefijoArchivo[d.tipo], req('FE_NIT'), desde + i, anio);
    writeFileSync(join(SALIDA, nombre), xml);
    firmados.push({ ...d, xmlFirmado: xml, nombre, zip: nombreArchivo('z', req('FE_NIT'), desde + i, anio) });
  }
  console.log(`\n${docs.length} documentos firmados en ${SALIDA}/ (desde el consecutivo ${desde}).`);
  return { cred, firmados };
}

async function main() {
  cargarEnv();
  const [comando, ...args] = process.argv.slice(2);

  if (comando === 'revisar') {
    await generarFirmados();
    return;
  }

  if (comando === 'rangos') {
    const cliente = new ClienteDian({ ambiente: 'habilitacion', credenciales: credenciales() });
    const r = await cliente.getNumberingRange(req('FE_NIT'), req('FE_SOFTWARE_ID'));
    console.log(r.mensaje ?? '');
    console.table(r.rangos);
    if (r.rangos.length === 0) console.log(r.crudo.slice(0, 2000));
    return;
  }

  if (comando === 'enviar') {
    const { cred, firmados } = await generarFirmados();
    const cliente = new ClienteDian({ ambiente: 'habilitacion', credenciales: cred });
    const testSetId = req('FE_TEST_SET_ID');
    const registro: Array<{ numero: string; zipKey?: string; errores: string[] }> = [];
    for (const d of firmados) {
      const zip = empaquetarZip([{ nombre: d.nombre, xml: d.xmlFirmado }]);
      const r = await cliente.enviarSetPruebas(d.zip, zip, testSetId);
      registro.push({ numero: d.numero, zipKey: r.zipKey, errores: r.errores });
      console.log(`${d.numero.padEnd(16)} ${r.zipKey ? `ZipKey ${r.zipKey}` : '✗ sin ZipKey'} ${r.errores.join(' | ')}`);
      if (!r.zipKey) writeFileSync(join(SALIDA, `${d.numero}.respuesta.xml`), r.crudo);
    }
    writeFileSync(join(SALIDA, 'envio.json'), JSON.stringify(registro, null, 2));
    const keys = registro.map((r) => r.zipKey).filter(Boolean);
    console.log(`\nEspera 1–2 minutos y consulta:\n  pnpm fe:habilitacion estado ${keys.join(' ')}`);
    return;
  }

  if (comando === 'estado') {
    let keys = args;
    if (keys.length === 0 && existsSync(join(SALIDA, 'envio.json'))) {
      keys = JSON.parse(readFileSync(join(SALIDA, 'envio.json'), 'utf8')).map((r: { zipKey?: string }) => r.zipKey).filter(Boolean);
    }
    if (keys.length === 0) {
      console.error('Indica uno o más ZipKey (o corre primero "enviar").');
      process.exit(1);
    }
    const cliente = new ClienteDian({ ambiente: 'habilitacion', credenciales: credenciales() });
    let aceptados = 0;
    for (const k of keys) {
      for (const r of await cliente.getStatusZip(k)) {
        if (r.valido) aceptados++;
        console.log(`\n${r.valido ? '✓ ACEPTADO' : '✗ RECHAZADO'}  ${r.codigo ?? ''} ${r.descripcion ?? ''}`);
        if (r.mensaje) console.log(`  ${r.mensaje}`);
        for (const e of r.errores) console.log(`  - ${e}`);
      }
    }
    console.log(`\n${aceptados}/${keys.length} aceptados. Revisa el avance del set en el portal de habilitación de la DIAN.`);
    return;
  }

  console.log('Comandos: revisar | rangos | enviar | estado [zipKey...]   (ver encabezado de scripts/fe-dian/habilitacion.ts)');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
