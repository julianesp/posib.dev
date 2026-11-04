-- Cuentas de clientes de la tienda online con historial de compras.
-- 1) storefront_users: lo que traía la migración 023, que nunca se aplicó en
--    producción (por eso "Entrar" respondía 500).
CREATE TABLE IF NOT EXISTS storefront_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES user_profiles(id),
  UNIQUE(tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_storefront_users_tenant ON storefront_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_storefront_users_created_at ON storefront_users(created_at);

-- 2) Sesiones: el navegador guarda un código secreto y aquí solo su hash
--    (SHA-256). Vencen a los 90 días. Ver routes/storefront.ts (auth/*).
CREATE TABLE IF NOT EXISTS storefront_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_storefront_sessions_user ON storefront_sessions(user_id);

-- 3) Pedido web hecho con la sesión iniciada: así el cliente ve "Mis compras".
ALTER TABLE sales ADD COLUMN storefront_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_storefront_user ON sales(tenant_id, storefront_user_id);
