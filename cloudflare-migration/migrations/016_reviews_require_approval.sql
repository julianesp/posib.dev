-- Las reseñas ahora requieren aprobación del superadmin antes de mostrarse en
-- la landing. Cambia el default de is_approved de 1 a 0.
-- La tabla está vacía, así que la recreamos con el nuevo default (SQLite no
-- permite ALTER COLUMN sobre el DEFAULT).

DROP TABLE IF EXISTS pos_reviews;

CREATE TABLE pos_reviews (
  user_profile_id TEXT PRIMARY KEY,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  store_name TEXT,
  store_city TEXT,
  -- 0 = pendiente de aprobación (por defecto), 1 = aprobada y visible en landing.
  is_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pos_reviews_approved
  ON pos_reviews (is_approved, rating);
