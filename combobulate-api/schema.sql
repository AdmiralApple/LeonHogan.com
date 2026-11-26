-- Combobulate database. Safe to run more than once.

-- Every element anyone has discovered. `key` is the lowercase name.
CREATE TABLE IF NOT EXISTS elements (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every pair anyone has tried. a <= b (sorted keys). result NULL means "nothing happens".
CREATE TABLE IF NOT EXISTS recipes (
  a          TEXT NOT NULL,
  b          TEXT NOT NULL,
  result     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

-- How many brand-new pairs each visitor generated per day. `visitor` is a salted hash, never a raw IP.
CREATE TABLE IF NOT EXISTS usage (
  visitor TEXT NOT NULL,
  day     TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor, day)
);

-- The four starting elements.
INSERT OR IGNORE INTO elements (key, name, emoji, created_at) VALUES
  ('water', 'Water', '💧', 0),
  ('fire',  'Fire',  '🔥', 0),
  ('earth', 'Earth', '🌍', 0),
  ('air',   'Air',   '💨', 0);
