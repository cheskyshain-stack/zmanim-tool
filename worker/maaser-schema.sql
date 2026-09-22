-- Schema for the Income and Maaser Tracker's D1 database.
--
-- One tracker per row in `trackers`. Nothing links two trackers together and nothing here
-- is keyed by anything a browser sends except the access token's hash, so knowing one
-- tracker's data reveals nothing about any other tracker.
--
-- Money is stored as integer cents everywhere (amount_cents, maaser_cents), never as a
-- float, so rounding cannot drift between what was saved and what is displayed.
--
-- Apply with:
--   wrangler d1 execute maaser-tracker --remote --file=worker/maaser-schema.sql
-- (drop --remote for local dev against `wrangler dev --local`).

CREATE TABLE IF NOT EXISTS trackers (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  pin_hash TEXT,
  pin_salt TEXT,
  pin_fail_count INTEGER NOT NULL DEFAULT 0,
  pin_locked_until INTEGER,
  recovery_hash TEXT NOT NULL,
  giving_default_mode TEXT NOT NULL DEFAULT 'source',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The only way a request's Authorization header resolves to a tracker. Unique so two
-- trackers can never collide on a token (astronomically unlikely at 256 bits, enforced
-- anyway).
CREATE UNIQUE INDEX IF NOT EXISTS idx_trackers_token_hash ON trackers(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trackers_recovery_hash ON trackers(recovery_hash);

-- Trackers created by the Maaser administrator. An invitation token cannot read or change
-- records until its recipient chooses a PIN. Older self-created trackers have no row here
-- and keep their original link and recovery-code flow.
CREATE TABLE IF NOT EXISTS managed_trackers (
  tracker_id TEXT PRIMARY KEY REFERENCES trackers(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id),
  name TEXT NOT NULL,
  default_percent REAL NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_tracker ON sources(tracker_id);

CREATE TABLE IF NOT EXISTS income_entries (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  amount_cents INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  note TEXT,
  percent REAL NOT NULL,
  maaser_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_income_tracker ON income_entries(tracker_id);
CREATE INDEX IF NOT EXISTS idx_income_source ON income_entries(source_id);

CREATE TABLE IF NOT EXISTS giving_entries (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id),
  amount_cents INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  recipient TEXT,
  note TEXT,
  mode TEXT NOT NULL DEFAULT 'source',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giving_tracker ON giving_entries(tracker_id);

-- A giving entry with one row here is an ordinary, unsplit donation. Always going through
-- this table (rather than a source_id column on giving_entries itself) means "split across
-- several sources" is not a special case anywhere that reads the data back.
CREATE TABLE IF NOT EXISTS giving_allocations (
  id TEXT PRIMARY KEY,
  giving_id TEXT NOT NULL REFERENCES giving_entries(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  amount_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_giving ON giving_allocations(giving_id);
CREATE INDEX IF NOT EXISTS idx_alloc_source ON giving_allocations(source_id);

-- A dated adjustment for what a source's balance was before this tracker started counting.
-- type is 'remaining' (still owed) or 'ahead' (already given beyond what was owed). Never
-- income and never a donation, which is why it has its own table rather than a flag on one
-- of the two above.
CREATE TABLE IF NOT EXISTS opening_balances (
  id TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  balance_type TEXT NOT NULL CHECK (balance_type IN ('remaining', 'ahead')),
  amount_cents INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opening_tracker ON opening_balances(tracker_id);

-- Fixed-window rate limiting. `bucket` is "<kind>:<ip-or-token-prefix>:<window-start>", so a
-- new window is a fresh row rather than an update, and old windows are cleaned up lazily
-- (see PRUNE_RATE_LIMIT_PROBABILITY in the worker) rather than needing a cron trigger.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Answers a retried "create tracker" request the same way as the original, for the case
-- described in the spec: a tap that fires twice, or a connection that drops after the
-- database write but before the reply. The token and recovery code are held here only long
-- enough to answer that retry; see CREATE_IDEMPOTENCY_TTL_MS in the worker for how long and
-- why keeping them at all, briefly, is the only way a retry can be answered without a second
-- tracker being created.
CREATE TABLE IF NOT EXISTS create_idempotency (
  idem_key TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL,
  token TEXT NOT NULL,
  recovery_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- The general form of the same idea, for every other POST that creates a record (income,
-- giving, opening balances, new sources): a retried request with the same key gets back the
-- first request's own response instead of creating a second row. Scoped by tracker_id so one
-- tracker's retried key can never replay into another tracker's data.
CREATE TABLE IF NOT EXISTS write_idempotency (
  idem_key TEXT NOT NULL,
  tracker_id TEXT NOT NULL,
  response_body TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (idem_key, tracker_id)
);
