CREATE TABLE display_items (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('announcement','dedication','schedule')),
 status TEXT NOT NULL CHECK(status IN ('draft','published','hidden','archived')),
 internal_name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
 starts_at TEXT, ends_at TEXT, data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 created_by TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE INDEX display_visibility ON display_items(status,starts_at,ends_at);
CREATE TABLE display_permissions (email TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL CHECK(json_valid(capabilities_json)),updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
CREATE TABLE display_audit (id TEXT PRIMARY KEY,item_id TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,version INTEGER);
CREATE UNIQUE INDEX display_schedule_precedence ON display_items(json_extract(data_json,'$.precedence')) WHERE kind='schedule' AND status='published';
