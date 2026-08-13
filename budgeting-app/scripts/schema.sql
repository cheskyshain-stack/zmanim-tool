CREATE TABLE IF NOT EXISTS entities (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('personal','business','rental')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY,
  entity_id    INTEGER REFERENCES entities(id),
  name         TEXT NOT NULL,
  mask         TEXT,
  institution  TEXT,
  kind         TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE(name, mask)
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  parent      TEXT,
  kind        TEXT NOT NULL CHECK (kind IN
                ('fixed','variable','savings','income','transfer','one_time','review')),
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS merchants (
  id            INTEGER PRIMARY KEY,
  normalized    TEXT NOT NULL UNIQUE,
  display       TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  seen_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY,
  external_id    TEXT UNIQUE,
  account_id     INTEGER REFERENCES accounts(id),
  entity_id      INTEGER REFERENCES entities(id),
  posted_date    TEXT NOT NULL,
  amount         REAL NOT NULL,
  raw_description TEXT NOT NULL,
  merchant_id    INTEGER REFERENCES merchants(id),
  category_id    INTEGER REFERENCES categories(id),
  source         TEXT,
  confidence     REAL,
  needs_review   INTEGER NOT NULL DEFAULT 0,
  is_transfer    INTEGER NOT NULL DEFAULT 0,
  transfer_pair  INTEGER REFERENCES transactions(id),
  is_one_time    INTEGER NOT NULL DEFAULT 0,
  note           TEXT
);
CREATE INDEX IF NOT EXISTS ix_tx_date     ON transactions(posted_date);
CREATE INDEX IF NOT EXISTS ix_tx_cat      ON transactions(category_id);
CREATE INDEX IF NOT EXISTS ix_tx_review   ON transactions(needs_review);
CREATE INDEX IF NOT EXISTS ix_tx_merchant ON transactions(merchant_id);

CREATE TABLE IF NOT EXISTS category_events (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER REFERENCES categories(id),
  source         TEXT NOT NULL CHECK (source IN ('rule','memory','import','model','user')),
  confidence     REAL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id           INTEGER PRIMARY KEY,
  priority     INTEGER NOT NULL DEFAULT 100,
  match_text   TEXT NOT NULL,
  match_account TEXT,
  min_amount   REAL,
  max_amount   REAL,
  polarity     TEXT CHECK (polarity IN ('positive','negative')),
  category_id  INTEGER REFERENCES categories(id),
  set_transfer INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
