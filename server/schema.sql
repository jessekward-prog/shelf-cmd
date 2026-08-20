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

-- ── Hub sync ────────────────────────────────────────────────────────────────
-- A linked shelf is a local category whose contents are mirrored from the hub.
-- We keep a full local copy on purpose: the shelf still renders when the hub or
-- the other person's box is unreachable, and it means the hub holds no unique
-- data, so it can be rebuilt from any member.
CREATE TABLE IF NOT EXISTS linked_shelves (
  category_id  INT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  hub_shelf_id INT NOT NULL UNIQUE,
  last_seq     BIGINT NOT NULL DEFAULT 0,
  is_owner     BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at    TIMESTAMPTZ,
  sync_error   TEXT
);

-- Mirrored rows carry their hub identity so the changefeed can match them up.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS hub_card_id INT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS hub_user_id INT;
ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS hub_tab_id INT;

-- Names of people who exist on the hub but have no account here. Refreshed on
-- every sync, and bylines resolve THROUGH this table rather than storing the
-- name on the card — otherwise someone renaming themselves would leave stale
-- names on every card they'd already posted to another instance.
CREATE TABLE IF NOT EXISTS hub_users (
  id       INT PRIMARY KEY,
  username TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cards_hub_id ON cards (hub_card_id) WHERE hub_card_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subcategories_hub_tab ON subcategories (hub_tab_id) WHERE hub_tab_id IS NOT NULL;

-- Writes made while the hub is unreachable wait here and flush on reconnect,
-- so a dropped connection costs you a delay rather than the link you saved.
CREATE TABLE IF NOT EXISTS outbox (
  id          SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  op          TEXT NOT NULL,
  payload     JSONB NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed starter categories only if table is empty
INSERT INTO categories (name, icon, sort_order)
SELECT * FROM (VALUES ('Cooking','🍳',0),('Tech','💻',1),('Music','🎵',2)) AS v(name,icon,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM categories);
