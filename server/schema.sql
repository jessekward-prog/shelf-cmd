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

-- A shared shelf is a whole category: the invitee gets it and every tab inside it.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_collab BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subcategories DROP COLUMN IF EXISTS is_collab;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;

-- Sharing started out tab-level. Drop the old shape rather than migrate it: it was
-- only ever live briefly and never had a row in it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='shelf_members' AND column_name='subcategory_id') THEN
    DROP TABLE shelf_members;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='invites' AND column_name='subcategory_id') THEN
    DROP TABLE invites;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shelf_members (
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (category_id, user_id)
);

-- One standing invite code per shelf; re-shown rather than rotated.
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  category_id INT NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed starter categories only if table is empty
INSERT INTO categories (name, icon, sort_order)
SELECT * FROM (VALUES ('Cooking','🍳',0),('Tech','💻',1),('Music','🎵',2)) AS v(name,icon,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM categories);
