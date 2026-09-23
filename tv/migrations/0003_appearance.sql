CREATE TABLE display_appearance (
 id INTEGER PRIMARY KEY CHECK(id=1),
 mode TEXT NOT NULL CHECK(mode IN ('light','dark','scheduled')),
 dark_start TEXT NOT NULL,
 light_start TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT,
 updated_by TEXT,
 CHECK(mode!='scheduled' OR dark_start!=light_start)
);
INSERT INTO display_appearance(id,mode,dark_start,light_start) VALUES(1,'light','19:00','07:00');
