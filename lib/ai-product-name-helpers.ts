// Sugerencia de nombre de producto a partir de una foto del empaque (Gemini, visión).
// Misma key (del tendero o del sistema) y modelo que lib/ai-invoice-helpers.ts.

import { fetchGemini } from './gemini-model';

const SYSTEM_GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export interface SuggestNameResult {
  /** Nombre sugerido; vacío si la foto no permite leer el empaque. */
  name: string;
}

/**
 * Lee el empaque de un producto y propone un nombre "Marca + producto + variedad +
 * tamaño". Solo usa lo que se ve escrito en el empaque: si no es legible devuelve
 * un nombre vacío en lugar de inventarlo.
 *
 * @param imageBase64  foto del empaque en base64 (sin el prefijo data:).
 * @param currentName  nombre actual del producto, solo como pista de contexto.
 * @param userApiKey   API key de Gemini del tendero (opcional).
 */
export async function suggestProductName(
  imageBase64: string,
  mimeType: string,
  currentName: string | undefined,
  userApiKey?: string,
): Promise<SuggestNameResult> {
  const apiKey = userApiKey?.trim() || SYSTEM_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Necesitas configurar tu API Key de Gemini en Configuración → IA para usar esta función.',
    );
  }

  const hint = currentName?.trim()
    ? `La tendera lo tiene guardado como "${currentName.trim()}", pero eso puede estar incompleto o mal escrito: manda lo que dice el empaque.`
    : '';

  const prompt = `Eres un asistente de una tienda de barrio en Colombia. En la foto hay el empaque de un producto.
${hint}

Propón el nombre para el inventario con este formato: Marca + producto + variedad o sabor + tamaño.
Ejemplos: "Trululu gomitas fresa 100 g", "Postobón manzana 400 ml", "Dove shampoo hidratación 200 ml".

REGLAS:
- Usa SOLO lo que se lea en el empaque. NO inventes marca, sabor ni tamaño; si un dato no se ve, omítelo.
- El tamaño con su unidad y un espacio (g, kg, ml, L, unidades).
- Sin precios, sin promociones ("¡nuevo!", "20% más gratis") y sin códigos de barras.
- Máximo 60 caracteres, en español, con mayúscula solo en la primera letra de cada palabra que sea nombre propio o marca.
- Si la foto no muestra un empaque legible, devuelve el nombre vacío.

Devuelve ÚNICAMENTE un JSON válido (sin markdown) con esta forma exacta:
{ "name": "nombre sugerido o cadena vacía" }`;

  let response: Response;
  try {
    response = await fetchGemini(apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
  } catch (error) {
    console.error('Error llamando a Gemini (nombre de producto):', error);
    throw new Error('No se pudo conectar con la IA. Intenta de nuevo.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Gemini API error (nombre de producto):', {
      status: response.status,
      errorData,
    });
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
  if (!text) {
    throw new Error('La IA no pudo leer la foto. Intenta con una foto más clara.');
  }

  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  let parsed: { name?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('La IA no devolvió un resultado legible. Intenta con otra foto.');
  }

  return { name: String(parsed.name ?? '').trim().slice(0, 80) };
}
