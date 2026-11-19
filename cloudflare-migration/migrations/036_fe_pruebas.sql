-- Facturación electrónica: resultado del set de pruebas de habilitación DIAN,
-- lanzado desde Configuración → Facturación electrónica (paso 4).
-- JSON sin secretos: { enviado_at, consultado_at, cantidades, documentos: [
--   { numero, tipo, zip_key, estado: 'enviado'|'aceptado'|'rechazado'|'error', errores: [] } ] }
-- Lo escribe Next (/api/fe/pruebas) por la ruta interna del Worker.
ALTER TABLE fe_config ADD COLUMN pruebas TEXT;
