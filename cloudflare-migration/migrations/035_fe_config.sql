-- Facturación electrónica DIAN (modo "software propio"): configuración por tienda.
-- Una fila por tenant. Ver lib/fe-dian/ (Next) y routes/fe-config.ts (Worker).
--
-- Los secretos (llave privada del certificado y PIN del software) llegan YA
-- CIFRADOS desde Next con FE_MASTER_KEY (AES-256-GCM, lib/fe-dian/boveda.ts).
-- El Worker y D1 nunca ven la llave en claro ni pueden descifrarla.
CREATE TABLE IF NOT EXISTS fe_config (
  tenant_id TEXT PRIMARY KEY,

  -- Avance de la activación:
  -- borrador → datos fiscales a medias
  -- listo_pruebas → datos + certificado + software DIAN (puede correr el set de pruebas)
  -- habilitado → la DIAN aceptó el set de pruebas
  -- produccion → tiene resolución de numeración y factura de verdad
  status TEXT NOT NULL DEFAULT 'borrador'
    CHECK(status IN ('borrador', 'listo_pruebas', 'habilitado', 'produccion')),

  -- Datos del RUT del facturador (la tienda).
  tipo_persona TEXT CHECK(tipo_persona IN ('1', '2')),   -- 1 jurídica, 2 natural
  nit TEXT,
  dv TEXT,
  razon_social TEXT,
  nombre_comercial TEXT,
  responsabilidades TEXT,           -- p. ej. 'R-99-PN' u 'O-13;O-15'
  tributo TEXT CHECK(tributo IN ('01', '04', 'ZA', 'ZZ')),
  municipio_codigo TEXT,            -- DANE 5 dígitos
  municipio TEXT,
  departamento TEXT,
  departamento_codigo TEXT,         -- DANE 2 dígitos
  direccion TEXT,
  telefono TEXT,
  correo TEXT,                      -- correo de recepción de documentos electrónicos

  -- Software registrado en el portal DIAN como "software propio".
  software_id TEXT,
  software_pin_cifrado TEXT,        -- cifrado (bóveda)
  test_set_id TEXT,

  -- Resolución de numeración de producción (se llena al pasar a 'produccion').
  res_numero TEXT,
  res_prefijo TEXT,
  res_desde INTEGER,
  res_hasta INTEGER,
  res_fecha_desde TEXT,
  res_fecha_hasta TEXT,
  res_clave_tecnica TEXT,

  -- Certificado de firma digital (.p12) de la tienda.
  cert_proveedor TEXT DEFAULT 'maticerts',
  cert_llave_cifrada TEXT,          -- PKCS#8 cifrado (bóveda)
  cert_cadena TEXT,                 -- JSON: [{der (base64), emisor, serialDecimal, titular}] (público)
  cert_titular TEXT,
  cert_emisor TEXT,
  cert_valido_desde TEXT,
  cert_vence TEXT,                  -- ISO; para los avisos de renovación
  cert_cargado_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fe_config_cert_vence ON fe_config(cert_vence);

-- Solo el superadmin activa la facturación electrónica a una tienda
-- (/dashboard/admin/users → "Facturación ON/OFF"). El dueño no puede
-- activársela solo: es un campo de cobro (BILLING_FIELDS en user-profiles.ts).
ALTER TABLE user_profiles ADD COLUMN has_fe_addon INTEGER DEFAULT 0;
