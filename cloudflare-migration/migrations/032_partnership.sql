-- Negocio de varios socios (Configuración → "Negocio con socios").
-- partnership_enabled: 0 = un solo dueño (por defecto), 1 = varios socios.
-- partners: JSON [{ "name": "Carlos", "share": 50 }, ...]; los % suman 100.
-- Ver routes/partnership.ts.
ALTER TABLE user_profiles ADD COLUMN partnership_enabled INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN partners TEXT;
