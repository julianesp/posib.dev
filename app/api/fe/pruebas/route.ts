/**
 * Set de pruebas de habilitación DIAN desde Configuración (paso 4).
 *
 *   POST { accion: 'enviar', cantidades }  arma el set, lo firma con la firma de la
 *                                         tienda y lo envía a la DIAN (habilitación)
 *   POST { accion: 'consultar' }           pregunta a la DIAN el resultado de cada documento
 *
 * El resultado (sin secretos) se guarda en fe_config.pruebas. Cuando la DIAN
 * acepta todos los documentos pedidos, el Worker pasa la tienda a 'habilitado'.
 * Es lo mismo que hace `pnpm fe:habilitacion`, pero sin depender del computador.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { RESOLUCION_HABILITACION, generarSetPruebas } from '@/lib/fe-dian/set-pruebas';
import { firmarDocumento } from '@/lib/fe-dian/firma';
import { ClienteDian, empaquetarZip, nombreArchivo } from '@/lib/fe-dian/soap';
import {
  ErrorFe,
  configPublicaDelDueno,
  credencialesDeFila,
  emisorDeFila,
  estadoDeRespuesta,
  type EstadoPrueba,
  filaCompleta,
  guardarInterno,
  softwareDeFila,
} from '@/lib/fe-dian/servidor';

export const runtime = 'nodejs';
// Firmar y enviar ~10 documentos a la DIAN toma unos segundos por documento.
export const maxDuration = 120;

interface DocumentoPrueba {
  numero: string;
  tipo: 'Invoice' | 'CreditNote' | 'DebitNote';
  zip_key: string | null;
  estado: EstadoPrueba;
  errores: string[];
}
interface Cantidades {
  facturas: number;
  notas_credito: number;
  notas_debito: number;
}

const PREFIJO_ARCHIVO = { Invoice: 'fv', CreditNote: 'nc', DebitNote: 'nd' } as const;

function cantidadesValidas(c: unknown): Cantidades | null {
  if (!c || typeof c !== 'object') return null;
  const x = c as Record<string, unknown>;
  const n = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
  const facturas = n(x.facturas, 30);
  const nc = n(x.notas_credito, 10);
  const nd = n(x.notas_debito, 10);
  if (facturas === null || nc === null || nd === null || facturas < 1) return null;
  return { facturas, notas_credito: nc, notas_debito: nd };
}

async function enviar(tenantId: string, cantidades: Cantidades) {
  const fila = await filaCompleta(tenantId);
  if (fila.status !== 'listo_pruebas') {
    throw new ErrorFe(
      fila.status === 'borrador'
        ? 'Completa los datos, el PIN y la firma digital antes de hacer las pruebas'
        : 'Esta tienda ya está habilitada por la DIAN',
    );
  }
  if (!fila.test_set_id) throw new ErrorFe('Falta el Test Set ID de la DIAN');

  const credenciales = await credencialesDeFila(fila);
  const software = await softwareDeFila(fila, 2);
  const nit = String(fila.nit);
  // Consecutivo nuevo en cada intento: la DIAN rechaza números repetidos.
  const desde = RESOLUCION_HABILITACION.rangoDesde + (Math.floor(Date.now() / 1000) % 4_000_000);
  const docs = await generarSetPruebas({
    emisor: emisorDeFila(fila),
    software,
    desde,
    facturas: cantidades.facturas,
    notasCredito: cantidades.notas_credito,
    notasDebito: cantidades.notas_debito,
  });

  const cliente = new ClienteDian({ ambiente: 'habilitacion', credenciales });
  const anio = new Date().getFullYear();
  const documentos: DocumentoPrueba[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    try {
      const xml = await firmarDocumento(d.xml, credenciales);
      const zip = empaquetarZip([{ nombre: nombreArchivo(PREFIJO_ARCHIVO[d.tipo], nit, desde + i, anio), xml }]);
      const r = await cliente.enviarSetPruebas(nombreArchivo('z', nit, desde + i, anio), zip, String(fila.test_set_id));
      documentos.push({
        numero: d.numero,
        tipo: d.tipo,
        zip_key: r.zipKey ?? null,
        estado: r.zipKey ? 'enviado' : 'error',
        errores: r.zipKey ? r.errores : r.errores.length ? r.errores : ['La DIAN no devolvió el código de seguimiento'],
      });
    } catch (e) {
      documentos.push({ numero: d.numero, tipo: d.tipo, zip_key: null, estado: 'error', errores: [e instanceof Error ? e.message : String(e)] });
    }
  }

  return guardarInterno('pruebas', {
    tenant_id: tenantId,
    pruebas: { enviado_at: new Date().toISOString(), consultado_at: null, cantidades, documentos },
  });
}

async function consultar(tenantId: string) {
  const fila = await filaCompleta(tenantId);
  const pruebas = fila.pruebas ? JSON.parse(String(fila.pruebas)) : null;
  if (!pruebas?.documentos?.length) throw new ErrorFe('Todavía no se han enviado pruebas a la DIAN');

  const cliente = new ClienteDian({ ambiente: 'habilitacion', credenciales: await credencialesDeFila(fila) });
  const documentos: DocumentoPrueba[] = [];
  for (const d of pruebas.documentos as DocumentoPrueba[]) {
    if (!d.zip_key || d.estado === 'aceptado') {
      documentos.push(d);
      continue;
    }
    try {
      const [r] = await cliente.getStatusZip(d.zip_key);
      documentos.push({ ...d, ...estadoDeRespuesta(r) });
    } catch (e) {
      documentos.push({ ...d, errores: [`No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }
  return guardarInterno('pruebas', {
    tenant_id: tenantId,
    pruebas: { ...pruebas, consultado_at: new Date().toISOString(), documentos },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { getToken, userId } = await auth();
    if (!userId) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    const token = await getToken();
    if (!token) return NextResponse.json({ success: false, error: 'No se pudo obtener el token' }, { status: 401 });

    const cfg = await configPublicaDelDueno(token, request.headers.get('X-Tenant-ID'));
    const body = (await request.json().catch(() => null)) as { accion?: string; cantidades?: unknown } | null;

    if (body?.accion === 'enviar') {
      const cantidades = cantidadesValidas(body.cantidades);
      if (!cantidades) return NextResponse.json({ success: false, error: 'Cantidades del set inválidas' }, { status: 400 });
      return NextResponse.json({ success: true, data: await enviar(cfg.tenant_id, cantidades) });
    }
    if (body?.accion === 'consultar') {
      return NextResponse.json({ success: true, data: await consultar(cfg.tenant_id) });
    }
    return NextResponse.json({ success: false, error: 'Acción inválida' }, { status: 400 });
  } catch (e) {
    if (e instanceof ErrorFe) return NextResponse.json({ success: false, error: e.message, ...e.extra }, { status: e.status });
    console.error('[fe/pruebas] Error:', e);
    return NextResponse.json({ success: false, error: 'Error con las pruebas de la DIAN' }, { status: 500 });
  }
}
