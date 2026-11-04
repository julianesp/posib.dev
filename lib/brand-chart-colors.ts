/**
 * Colores de gráficas sacados SOLO del color que eligió el tendero (--brand,
 * lib/accent.ts): tonos más oscuros y más claros del mismo color, alternados
 * para que barras o líneas vecinas se distingan sin meter otros colores.
 *
 * Son valores CSS (var() + color-mix), válidos en los atributos fill/stroke de
 * Recharts, y siguen al color de la tienda y al tema oscuro sin recargar.
 */

export const BRAND = 'var(--brand)';
export const BRAND_DARK = 'color-mix(in srgb, var(--brand) 70%, black)';
export const BRAND_LIGHT = 'color-mix(in srgb, var(--brand) 45%, white)';

/** Paleta para series o barras: alterna oscuro / claro. */
export const BRAND_CHART_COLORS = [
  BRAND,
  BRAND_LIGHT,
  BRAND_DARK,
  'color-mix(in srgb, var(--brand) 70%, white)',
  'color-mix(in srgb, var(--brand) 25%, white)',
];
