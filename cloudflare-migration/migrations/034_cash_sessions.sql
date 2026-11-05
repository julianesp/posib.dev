-- Apertura y cierre de caja (Punto de Venta → "Abrir caja" / "Cerrar caja").
-- Una fila por turno de caja. Mientras está 'open' solo guarda la apertura;
-- al cerrar se congelan los totales del turno y el conteo del cajero.
-- Ver routes/cash-sessions.ts. (Incluye la tabla cash_movements, más abajo.)
CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),

  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL,          -- clerk_user_id de quien abrió
  opened_by_name TEXT,
  opening_amount REAL NOT NULL DEFAULT 0,  -- base en efectivo

  closed_at TEXT,
  closed_by TEXT,
  closed_by_name TEXT,
  cash_sales REAL,                  -- ventas en efectivo del turno
  cash_payments REAL,               -- abonos de fiado recibidos en efectivo
  expected_cash REAL,               -- base + ventas efectivo + abonos efectivo
  counted_cash REAL,                -- lo que contó el cajero
  difference REAL,                  -- contado - esperado (negativo = falta)
  sales_count INTEGER,
  totals TEXT,                      -- JSON: ventas y abonos por medio de pago
  notes TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant ON cash_sessions(tenant_id, opened_at);
-- Una sola caja abierta por tienda (también evita abrir dos veces por doble clic).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_one_open ON cash_sessions(tenant_id) WHERE status = 'open';

-- Entradas y salidas de efectivo durante el turno: pagar al proveedor, un
-- gasto, retiro del dueño (salida) o meter plata para el cambio (entrada).
-- Cuentan en el cuadre: esperado = base + ventas + abonos + entradas - salidas.
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('salida', 'entrada')),
  amount REAL NOT NULL CHECK(amount > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(tenant_id, session_id);
