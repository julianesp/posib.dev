/**
 * Canonicalización XML (C14N 1.0 inclusiva y exclusiva, sin comentarios).
 *
 * La firma XAdES de la DIAN se calcula sobre la forma canónica de varios
 * fragmentos del documento (anexo §10.7: "Canonical XML (omits comments)",
 * http://www.w3.org/TR/2001/REC-xml-c14n-20010315). El envío SOAP usa además
 * C14N exclusiva (http://www.w3.org/2001/10/xml-exc-c14n#) para WS-Security.
 *
 * Se implementa aquí (≈150 líneas, sin dependencias de Node) en lugar de usar
 * xml-crypto para que corra igual en Node, Vercel y Cloudflare Workers. Las
 * pruebas verifican la firma resultante con xml-crypto, que tiene su propia
 * implementación, como control independiente.
 *
 * Reglas aplicadas (W3C C14N 1.0):
 *  - sin declaración XML ni comentarios;
 *  - elementos vacíos como <a></a>;
 *  - declaraciones de namespace primero (ordenadas por prefijo, el default
 *    primero), luego atributos ordenados por (URI de namespace, nombre local);
 *  - escapes de texto: & < > \r ; de atributos: & < " \t \n \r;
 *  - al canonicalizar un fragmento, el elemento raíz del fragmento hereda los
 *    namespaces en alcance de sus ancestros (inclusiva) o solo los que usa
 *    visiblemente más la lista InclusiveNamespaces (exclusiva).
 */

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;
const DOCUMENT_NODE = 9;

/* Tipos mínimos estructurales para no acoplarse a una implementación DOM. */
interface NodoAttr {
  name: string;
  localName: string | null;
  prefix: string | null;
  namespaceURI: string | null;
  value: string;
}
interface Nodo {
  nodeType: number;
  nodeName: string;
  parentNode: Nodo | null;
  childNodes: ArrayLike<Nodo>;
  prefix?: string | null;
  localName?: string | null;
  attributes?: ArrayLike<NodoAttr> | null;
  data?: string;
  target?: string;
  documentElement?: Nodo | null;
}

export interface C14nOpciones {
  /** true = C14N exclusiva (xml-exc-c14n#). Por defecto inclusiva. */
  exclusiva?: boolean;
  /** Solo exclusiva: prefijos de InclusiveNamespaces/@PrefixList ("#default" = sin prefijo). */
  prefijosInclusivos?: string[];
  /** Nodo a omitir con todo su contenido (transformación enveloped-signature). */
  excluir?: unknown;
}

function escaparTexto(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

function escaparAtributo(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

function esDeclaracionNs(a: NodoAttr): boolean {
  return a.namespaceURI === XMLNS_NS || a.name === 'xmlns' || a.name.startsWith('xmlns:');
}

function prefijoDeDeclaracion(a: NodoAttr): string {
  return a.name === 'xmlns' ? '' : a.name.slice('xmlns:'.length);
}

/** Declaraciones de namespace hechas en el propio elemento. */
function declaracionesPropias(el: Nodo): Map<string, string> {
  const m = new Map<string, string>();
  const attrs = el.attributes;
  if (!attrs) return m;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    if (esDeclaracionNs(a)) m.set(prefijoDeDeclaracion(a), a.value);
  }
  return m;
}

/** Namespaces en alcance heredados de los ancestros de `el` (sin incluir los de `el`). */
function namespacesHeredados(el: Nodo): Map<string, string> {
  const cadena: Nodo[] = [];
  for (let p = el.parentNode; p && p.nodeType === ELEMENT_NODE; p = p.parentNode) cadena.push(p);
  const m = new Map<string, string>();
  for (let i = cadena.length - 1; i >= 0; i--) {
    for (const [pre, uri] of declaracionesPropias(cadena[i])) m.set(pre, uri);
  }
  return m;
}

function compararCadenas(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalizar(nodo: unknown, opciones: C14nOpciones = {}): string {
  const raiz = nodo as Nodo;
  const exclusiva = !!opciones.exclusiva;
  const inclusivos = new Set((opciones.prefijosInclusivos ?? []).map((p) => (p === '#default' ? '' : p)));
  const excluir = opciones.excluir as Nodo | undefined;
  const partes: string[] = [];

  const procesarElemento = (el: Nodo, enAlcancePadre: Map<string, string>, renderizadosPadre: Map<string, string>) => {
    if (el === excluir) return;

    const enAlcance = new Map(enAlcancePadre);
    for (const [pre, uri] of declaracionesPropias(el)) enAlcance.set(pre, uri);

    // Qué namespaces son candidatos a declararse en este elemento.
    const candidatos = new Set<string>();
    if (exclusiva) {
      candidatos.add(el.prefix ?? '');
      const attrs = el.attributes;
      if (attrs) {
        for (let i = 0; i < attrs.length; i++) {
          const a = attrs[i];
          if (!esDeclaracionNs(a) && a.prefix && a.prefix !== 'xml') candidatos.add(a.prefix);
        }
      }
      for (const p of inclusivos) if (enAlcance.has(p)) candidatos.add(p);
    } else {
      for (const p of enAlcance.keys()) candidatos.add(p);
    }

    const renderizados = new Map(renderizadosPadre);
    const declaraciones: Array<[string, string]> = [];
    for (const pre of candidatos) {
      const uri = enAlcance.get(pre) ?? '';
      const previo = renderizadosPadre.get(pre) ?? '';
      // Ya vigente en el ancestro de salida (para el default, '' == '' = sin default).
      // Así xmlns="" solo aparece cuando deshace un default declarado arriba.
      if (uri === previo) continue;
      if (pre !== '' && uri === '') continue;
      declaraciones.push([pre, uri]);
      renderizados.set(pre, uri);
    }
    declaraciones.sort((a, b) => compararCadenas(a[0], b[0]));

    const atributos: NodoAttr[] = [];
    const attrs = el.attributes;
    if (attrs) {
      for (let i = 0; i < attrs.length; i++) if (!esDeclaracionNs(attrs[i])) atributos.push(attrs[i]);
    }
    atributos.sort(
      (a, b) =>
        compararCadenas(a.namespaceURI ?? '', b.namespaceURI ?? '') ||
        compararCadenas(a.localName ?? a.name, b.localName ?? b.name),
    );

    partes.push('<', el.nodeName);
    for (const [pre, uri] of declaraciones) {
      partes.push(pre === '' ? ' xmlns="' : ` xmlns:${pre}="`, escaparAtributo(uri), '"');
    }
    for (const a of atributos) partes.push(' ', a.name, '="', escaparAtributo(a.value), '"');
    partes.push('>');

    const hijos = el.childNodes;
    for (let i = 0; i < hijos.length; i++) procesarNodo(hijos[i], enAlcance, renderizados);

    partes.push('</', el.nodeName, '>');
  };

  const procesarNodo = (n: Nodo, enAlcance: Map<string, string>, renderizados: Map<string, string>) => {
    switch (n.nodeType) {
      case ELEMENT_NODE:
        procesarElemento(n, enAlcance, renderizados);
        break;
      case TEXT_NODE:
      case CDATA_SECTION_NODE:
        partes.push(escaparTexto(n.data ?? ''));
        break;
      case PROCESSING_INSTRUCTION_NODE:
        if (n.target !== 'xml') partes.push('<?', n.target ?? '', n.data ? ' ' + n.data : '', '?>');
        break;
      default:
        break; // comentarios y demás se omiten
    }
  };

  if (raiz.nodeType === DOCUMENT_NODE) {
    const doc = raiz.documentElement;
    if (doc) procesarElemento(doc, new Map(), new Map());
  } else {
    procesarElemento(raiz, namespacesHeredados(raiz), new Map());
  }
  return partes.join('');
}
