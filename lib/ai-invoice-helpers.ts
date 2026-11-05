// Lectura de facturas de compra (proveedor) con IA (Google Gemini, visión).
// Sigue el mismo patrón que lib/ai-insights-helpers.ts: misma key (del usuario o
// del sistema como fallback) y el modelo de lib/gemini-model.ts, que soporta imágenes.

import { GEMINI_API_URL } from './gemini-model';

const SYSTEM_GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function resolveApiKey(userKey?: string): string {
  const key = userKey?.trim() || SYSTEM_GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Necesitas configurar tu API Key de Gemini en Configuración → IA para usar esta función.',
    );
  }
  return key;
}

/** Un renglón de producto leído de la factura del proveedor. */
export interface ReadInvoiceItem {
  /** Nombre del producto tal como aparece en la factura. */
  name: string;
  /** Cantidad comprada (unidades). */
  quantity: number;
  /** Costo unitario (lo que pagó el tendero por unidad), en COP. */
  cost_price: number;
  /** Código de barras si la factura lo trae; opcional. */
  barcode?: string;
}

export interface ReadInvoiceResult {
  items: ReadInvoiceItem[];
  /** Nombre del proveedor si la IA lo detecta en la factura; opcional. */
  supplier_name?: string;
}

/**
 * Envía la imagen de una factura de compra a Gemini y devuelve los productos
 * leídos (nombre, cantidad, costo unitario). No inventa datos: si un campo no
 * está claro, lo deja en 0 / vacío para que el tendero lo corrija en la revisión.
 *
 * @param imageBase64  imagen de la factura en base64 (sin el prefijo data:).
 * @param mimeType     tipo MIME de la imagen (image/jpeg, image/png, ...).
 * @param userApiKey   API key de Gemini del tendero (opcional).
 */
export async function readPurchaseInvoice(
  imageBase64: string,
  mimeType: string,
  userApiKey?: string,
): Promise<ReadInvoiceResult> {
  const apiKey = resolveApiKey(userApiKey);

  const prompt = `Eres un asistente que lee facturas de compra de proveedores de tiendas en Colombia.
Analiza la imagen de la factura y extrae la lista de productos comprados.

Devuelve ÚNICAMENTE un objeto JSON válido (sin texto adicional, sin markdown, sin \`\`\`) con esta forma exacta:
{
  "supplier_name": "nombre del proveedor si aparece, si no cadena vacía",
  "items": [
    { "name": "nombre del producto", "quantity": número de unidades, "cost_price": costo unitario en pesos colombianos, "barcode": "código de barras si aparece, si no omitir" }
  ]
}

REGLAS IMPORTANTES:
- "cost_price" es el costo UNITARIO (precio por unidad), NO el total de la línea. Si la factura solo muestra el total de la línea, divídelo entre la cantidad.
- Los precios en pesos colombianos: quita puntos de miles y símbolos ($). Usa solo el número entero (ej. "12.500" → 12500).
- Si un dato no está claro o no aparece, usa 0 para números y omite el campo de texto. NO inventes valores.
- Ignora líneas que no sean productos (subtotales, IVA, totales, descuentos generales).
- Si no logras leer ningún producto, devuelve "items": [].`;

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
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
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
  } catch (error) {
    console.error('Error llamando a Gemini (factura):', error);
    throw new Error('No se pudo conectar con la IA. Intenta de nuevo.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Gemini API error (factura):', {
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
      throw new Error('Límite de solicitudes alcanzado. Intenta nuevamente en unos minutos.');
    }
    throw new Error(`Error de la IA: ${response.statusText || 'desconocido'}`);
  }

  const data = await response.json();
  const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('Respuesta incompleta de Gemini (factura):', data);
    throw new Error('La IA no pudo leer la factura. Intenta con una foto más clara.');
  }

  // El modelo devuelve JSON (responseMimeType), pero por robustez limpiamos por
  // si viniera envuelto en ```json ... ```.
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  let parsed: ReadInvoiceResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('JSON inválido de Gemini (factura):', cleaned);
    throw new Error('La IA no devolvió un resultado legible. Intenta con otra foto.');
  }

  // Normalizar/sanear: números válidos, sin filas vacías.
  const items: ReadInvoiceItem[] = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((it) => ({
      name: String(it?.name ?? '').trim(),
      quantity: Number(it?.quantity) > 0 ? Math.round(Number(it.quantity)) : 1,
      cost_price: Number(it?.cost_price) >= 0 ? Math.round(Number(it.cost_price)) : 0,
      barcode: it?.barcode ? String(it.barcode).trim() : undefined,
    }))
    .filter((it) => it.name.length > 0);

  return {
    items,
    supplier_name: parsed.supplier_name?.trim() || undefined,
  };
}
