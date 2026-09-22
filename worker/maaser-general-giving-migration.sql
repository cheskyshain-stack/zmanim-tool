-- Add general giving and a saved per-tracker default. Existing records remain source-assigned.
ALTER TABLE trackers ADD COLUMN giving_default_mode TEXT NOT NULL DEFAULT 'source';
ALTER TABLE giving_entries ADD COLUMN mode TEXT NOT NULL DEFAULT 'source';
