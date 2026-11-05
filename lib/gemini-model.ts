// Modelo de Gemini para todas las funciones de IA (un solo lugar).
// gemini-2.5-flash ya no se habilita para cuentas nuevas de Google AI Studio:
// con la key de un tendero nuevo respondía 404 "no longer available to new users".
// Se puede cambiar sin desplegar código con la env var GEMINI_MODEL.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// v1beta: es la que acepta responseMimeType (JSON mode).
export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
