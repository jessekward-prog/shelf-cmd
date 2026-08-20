CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📁',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subcategories (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  subcategory_id INT REFERENCES subcategories(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'link',
  url TEXT,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  youtube_id TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  label TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Collaborative shelves ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS is_collab BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS shelf_members (
  subcategory_id INT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (subcategory_id, user_id)
);

-- One standing invite code per shelf; re-shown rather than rotated.
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  subcategory_id INT NOT NULL UNIQUE REFERENCES subcategories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed starter categories only if table is empty
INSERT INTO categories (name, icon, sort_order)
SELECT * FROM (VALUES ('Cooking','🍳',0),('Tech','💻',1),('Music','🎵',2)) AS v(name,icon,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM categories);
