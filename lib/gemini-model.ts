// Modelos de Gemini para todas las funciones de IA (un solo lugar).
// - gemini-2.5-flash ya no se habilita para cuentas nuevas de Google AI Studio
//   (404 "no longer available to new users" con la key de un tendero nuevo).
// - Los modelos más nuevos (3.7/3.8, flash-latest) pasan días con 503 "high
//   demand"; gemini-3.5-flash y los lite responden. Por eso se prueban en orden
//   y, si uno está saturado o no existe para esa key, se pasa al siguiente.
// GEMINI_MODEL (env) pone un modelo de primero sin desplegar código.
export const GEMINI_MODELS = [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
].filter((m, i, all) => all.indexOf(m) === i);

/** Respuestas en las que vale la pena probar con otro modelo. */
const RETRY_WITH_NEXT_MODEL = new Set([404, 429, 500, 503]);

// v1beta: es la que acepta responseMimeType (JSON mode).
function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * POST a generateContent probando GEMINI_MODELS en orden. Devuelve la primera
 * respuesta OK, o la del último modelo si todos fallan (para que el llamador
 * muestre el error como antes). Los errores de red se propagan.
 */
export async function fetchGemini(apiKey: string, init: RequestInit): Promise<Response> {
  let response: Response | undefined;
  for (const model of GEMINI_MODELS) {
    response = await fetch(`${geminiUrl(model)}?key=${apiKey}`, init);
    if (response.ok || !RETRY_WITH_NEXT_MODEL.has(response.status)) return response;
    console.warn(`Gemini ${model} respondió ${response.status}; probando el siguiente modelo`);
  }
  return response!;
}
