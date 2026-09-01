-- Ported verbatim from shelf-hub/schema.sql (keep the two in sync). Lives in
-- its own Postgres schema so nothing here collides with shelf-cmd's own
-- `users` (PIN/admin auth) or `hub_users` (local mirror cache of a REMOTE
-- hub's usernames) — this is instead the data for a hub THIS instance hosts.
-- The pool that runs this (and every hosted-hub query) sets
-- search_path=hosted_hub,public, so these unqualified names resolve here.
CREATE SCHEMA IF NOT EXISTS hosted_hub;

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shelves (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  icon          TEXT,
  owner_user_id INT NOT NULL REFERENCES users(id),
  seq           BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shelf_tabs (
  id         SERIAL PRIMARY KEY,
  shelf_id   INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shelf_members (
  shelf_id  INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shelf_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  code            TEXT PRIMARY KEY,
  shelf_id        INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  max_redemptions INT,
  redemptions     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id            SERIAL PRIMARY KEY,
  shelf_id      INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  tab_id        INT REFERENCES shelf_tabs(id) ON DELETE SET NULL,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL DEFAULT 'link',
  url           TEXT,
  title         TEXT,
  description   TEXT,
  thumbnail_url TEXT,
  media_id      TEXT,
  notes         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  seq           BIGINT NOT NULL,
  deleted_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category      TEXT
);
CREATE INDEX IF NOT EXISTS cards_shelf_seq ON cards (shelf_id, seq);

ALTER TABLE shelves ADD COLUMN IF NOT EXISTS origin TEXT;

CREATE TABLE IF NOT EXISTS access_tickets (
  ticket     TEXT PRIMARY KEY,
  shelf_id   INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS guides (
  id         SERIAL PRIMARY KEY,
  shelf_id   INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  source     TEXT,
  filename   TEXT,
  chapters   INT NOT NULL DEFAULT 0,
  tagline    TEXT,
  category   TEXT,
  html       TEXT NOT NULL,
  seq        BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guides_shelf_seq ON guides (shelf_id, seq);

CREATE TABLE IF NOT EXISTS shelf_messages (
  id          SERIAL PRIMARY KEY,
  shelf_id    INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  seq         BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reply_to_id INT REFERENCES shelf_messages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS shelf_messages_shelf_seq ON shelf_messages (shelf_id, seq);

CREATE TABLE IF NOT EXISTS shelf_message_reactions (
  id         SERIAL PRIMARY KEY,
  message_id INT NOT NULL REFERENCES shelf_messages(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS shelf_activity (
  id         SERIAL PRIMARY KEY,
  shelf_id   INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  seq        BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shelf_activity_shelf_seq ON shelf_activity (shelf_id, seq);
