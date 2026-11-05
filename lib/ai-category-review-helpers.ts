// Revisión de categorías con Gemini: encuentra productos guardados en una
// categoría que no les corresponde (ej. "Monster energy" en "Frutas y verduras").
// Misma key (del tendero o del sistema) y modelo que lib/ai-product-name-helpers.ts.

import { GEMINI_API_URL } from './gemini-model';

const SYSTEM_GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/** Más que esto no se lee con calma; la idea es mostrar los casos más claros. */
const MAX_FINDINGS = 50; // por tanda (el cliente manda tandas de 500)

export interface CategoryReviewInput {
  /** Nombre del producto. */
  n: string;
  /** Categoría actual. */
  c: string;
}

export interface CategoryFinding {
  /** Índice del producto en la lista recibida. */
  i: number;
  suggested: string;
}

/**
 * Devuelve los productos cuya categoría claramente no corresponde, con una
 * categoría sugerida que YA EXISTE en la tienda. Ante la duda no reporta nada.
 */
export async function reviewCategories(
  items: CategoryReviewInput[],
  userApiKey?: string,
): Promise<CategoryFinding[]> {
  const apiKey = userApiKey?.trim() || SYSTEM_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Necesitas configurar tu API Key de Gemini en Configuración → IA para usar esta función.',
    );
  }

  const categories = [...new Set(items.map((it) => it.c))].sort();
  if (categories.length < 2) return []; // con una sola categoría no hay a dónde mover nada

  const lines = items.map((it, i) => `${i}|${it.c}|${it.n}`).join('\n');
  const prompt = `Eres un asistente de una tienda de barrio en Colombia que ordena el inventario.

Categorías que existen en la tienda:
${categories.map((c) => `- ${c}`).join('\n')}

Productos, uno por línea con el formato "número|categoría actual|nombre":
${lines}

Encuentra los productos que están en una categoría que CLARAMENTE no les corresponde y
sugiere la categoría correcta ENTRE LAS QUE EXISTEN arriba (escrita exactamente igual).
Ejemplos de errores claros: una bebida energizante en "Frutas y verduras", arroz en "Bebidas",
un cepillo de dientes en "Bebidas".

REGLAS:
- Solo casos evidentes. Si hay duda, o si ninguna categoría existente encaja mejor, NO lo incluyas.
- No reportes diferencias de mayúsculas, plurales ni sinónimos de la misma categoría.
- Máximo ${MAX_FINDINGS} productos, empezando por los errores más evidentes.

Devuelve ÚNICAMENTE un JSON válido (sin markdown) con esta forma exacta:
{ "findings": [ { "i": 12, "suggested": "BEBIDAS" } ] }`;

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          // Clasificar nombres no necesita razonamiento; con él, 1.000 productos tardan minutos.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (error) {
    console.error('Error llamando a Gemini (categorías):', error);
    throw new Error('No se pudo conectar con la IA. Intenta de nuevo.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Gemini API error (categorías):', { status: response.status, errorData });
    if (response.status === 400 && errorData.error?.message?.includes('API key not valid')) {
      throw new Error(
        'La API Key de Gemini no es válida. Genera una nueva en https://aistudio.google.com/app/apikey',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'API Key de Gemini inválida o sin permisos. Genera una nueva en https://aistudio.google.com/app/apikey',
      );
    }
    if (response.status === 429) {
      throw new Error('Límite de solicitudes alcanzado. Intenta nuevamente en un minuto.');
    }
    if (response.status === 503) {
      throw new Error('La IA está saturada en este momento. Intenta de nuevo en unos segundos.');
    }
    throw new Error(`Error de la IA: ${response.statusText || 'desconocido'}`);
  }

  const data = await response.json();
  const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('La IA no devolvió resultados. Intenta de nuevo.');

  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  let parsed: { findings?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('La IA no devolvió un resultado legible. Intenta de nuevo.');
  }

  // Validar: índice real, categoría existente y distinta de la actual.
  const valid = new Set(categories);
  const seen = new Set<number>();
  const findings: CategoryFinding[] = [];
  for (const f of Array.isArray(parsed.findings) ? parsed.findings : []) {
    const i = Number((f as CategoryFinding)?.i);
    const suggested = String((f as CategoryFinding)?.suggested ?? '').trim();
    if (!Number.isInteger(i) || i < 0 || i >= items.length || seen.has(i)) continue;
    if (!valid.has(suggested) || suggested === items[i].c) continue;
    seen.add(i);
    findings.push({ i, suggested });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}
