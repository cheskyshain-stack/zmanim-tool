-- Add administrator-created invitation trackers to an existing Maaser D1 database.
-- Safe to re-run. Existing tracker records and their access methods are unchanged.
CREATE TABLE IF NOT EXISTS managed_trackers (
  tracker_id TEXT PRIMARY KEY REFERENCES trackers(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
