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

-- Membership and invite codes used to live here, from when collaborators logged
-- in to someone else's instance. They live on the hub now, because they span
-- instances: a person is a member from their own shelf, not a guest on yours.
DROP TABLE IF EXISTS shelf_members;
DROP TABLE IF EXISTS invites;

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

-- One of the same five buckets guides use (speed/thinking/design/tools/
-- reference) — same taxonomy, same legend, so a shelf reads consistently
-- whether you're looking at its cards or its guides.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS category TEXT;

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

-- ── Drive: files live on a shelf like cards do ──────────────────────────────
-- Each shelf gets a drive. A file is stored on this box (bytes on disk, row
-- here) and shown as a card with an AI blurb scanned at upload time. Phase 1 is
-- local-only; collab files (hosted by the uploader, brokered by the hub) come
-- later, which is why user_id and a hub id column are already carried.
CREATE TABLE IF NOT EXISTS files (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  subcategory_id INT REFERENCES subcategories(id) ON DELETE SET NULL,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,          -- original filename
  stored_name   TEXT NOT NULL,          -- name on disk under UPLOADS_DIR
  mime_type     TEXT,
  kind          TEXT NOT NULL DEFAULT 'other', -- image|video|audio|pdf|doc|archive|other
  size          BIGINT NOT NULL DEFAULT 0,
  has_thumb     BOOLEAN NOT NULL DEFAULT FALSE,
  blurb         TEXT,                    -- AI one-liner describing the file
  status        TEXT NOT NULL DEFAULT 'ready', -- pending while thumb+blurb build
  hub_file_id   INT,                     -- phase 2: id on the hub for collab files
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS file_share_tokens (
  token      TEXT PRIMARY KEY,
  file_id    INT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A folder is a path prefix in files.name, not a row, so its share token keys
-- off "<category_id>:<prefix>" rather than a foreign key.
CREATE TABLE IF NOT EXISTS folder_share_tokens (
  token       TEXT PRIMARY KEY,
  folder_key  TEXT NOT NULL UNIQUE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  prefix      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed starter categories only if table is empty
INSERT INTO categories (name, icon, sort_order)
SELECT * FROM (VALUES ('Cooking','🍳',0),('Tech','💻',1),('Music','🎵',2)) AS v(name,icon,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM categories);

-- Where the shelf owner's instance lives. Drive files are never mirrored, so a
-- member needs this to fetch them from the machine that actually holds them.
ALTER TABLE linked_shelves ADD COLUMN IF NOT EXISTS origin TEXT;

-- Archived hides a shelf from the everyday nav without deleting it (and
-- everything on it — cards, drive files, guides, a collab link).
ALTER TABLE categories ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Shelf chat: "man" (member messages) and "machine" (auto activity log) ────
-- Both mirror to the hub the same way guides do, so every collaborator's box
-- ends up with the same log — a message/event posted while a member's box was
-- offline still lands once the hub is reachable again (see hub.js queue()).

CREATE TABLE IF NOT EXISTS shelf_messages (
  id             SERIAL PRIMARY KEY,
  category_id    INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hub_message_id INT,
  hub_user_id    INT,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS shelf_messages_hub_id ON shelf_messages (hub_message_id) WHERE hub_message_id IS NOT NULL;

-- kind is a coarse tag (card_added, file_added, guide_added, ...) the "what's
-- new" panel can use for an icon; summary is the actual one-line text shown.
CREATE TABLE IF NOT EXISTS shelf_activity (
  id              SERIAL PRIMARY KEY,
  category_id     INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hub_activity_id INT,
  hub_user_id     INT,
  kind            TEXT NOT NULL,
  summary         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS shelf_activity_hub_id ON shelf_activity (hub_activity_id) WHERE hub_activity_id IS NOT NULL;
