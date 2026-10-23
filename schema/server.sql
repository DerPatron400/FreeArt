-- Khora shared city (Cloudflare D1). Apply with:
--   npx wrangler d1 execute freeart --remote --file schema/server.sql
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,          -- SHA-256 of the private edit key; the key itself is never stored
  data TEXT NOT NULL,              -- the world JSON
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS worlds_plot ON worlds (plot_x, plot_z);

CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,            -- media/<world id>/<name>.<ext>
  world_id TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_world ON media (world_id);

-- Only used until R2 is switched on: files kept in D1 in pieces.
CREATE TABLE IF NOT EXISTS chunks (
  key TEXT NOT NULL,
  n INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (key, n)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world_id TEXT NOT NULL,
  reason TEXT,
  ip_hash TEXT,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creations (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);
