PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS players (
 id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
 mode INTEGER NOT NULL CHECK(mode IN (30,60)), pack TEXT NOT NULL CHECK(pack IN ('english','code')),
 seed INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 receipt TEXT
);
CREATE INDEX IF NOT EXISTS runs_expiry ON runs(expires_at);
CREATE TABLE IF NOT EXISTS scores (
 player_id TEXT NOT NULL REFERENCES players(id), mode INTEGER NOT NULL, pack TEXT NOT NULL,
 wpm INTEGER NOT NULL, accuracy INTEGER NOT NULL, words INTEGER NOT NULL,
 recorded_at INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(player_id, mode, pack)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores(mode,pack,wpm DESC,accuracy DESC,recorded_at ASC);
CREATE TABLE IF NOT EXISTS request_limits (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS limits_expiry ON request_limits(expires_at);
-- Optional private contact details. Public score queries never join this table.
CREATE TABLE IF NOT EXISTS player_contacts (
 player_id TEXT PRIMARY KEY REFERENCES players(id), email TEXT NOT NULL,
 consent_version TEXT NOT NULL, consented_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_links (
 code_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
 expires_at INTEGER NOT NULL, used_at INTEGER, request_hash TEXT, action TEXT
);
CREATE INDEX IF NOT EXISTS contact_links_expiry ON contact_links(expires_at);
CREATE INDEX IF NOT EXISTS contact_links_player ON contact_links(player_id);

-- Rules 2: strict input, automatic word completion, actual characters only.
-- Legacy runs/scores remain intact for historical records.
CREATE TABLE IF NOT EXISTS runs_v2 (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
 mode INTEGER NOT NULL CHECK(mode IN (30,60)), pack TEXT NOT NULL CHECK(pack IN ('english','code')),
 seed INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, receipt TEXT
);
CREATE INDEX IF NOT EXISTS runs_v2_expiry ON runs_v2(expires_at);
CREATE TABLE IF NOT EXISTS scores_v2 (
 player_id TEXT NOT NULL REFERENCES players(id), mode INTEGER NOT NULL, pack TEXT NOT NULL,
 wpm INTEGER NOT NULL, accuracy INTEGER NOT NULL, words INTEGER NOT NULL, mistakes INTEGER NOT NULL,
 recorded_at INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(player_id, mode, pack)
);
CREATE INDEX IF NOT EXISTS scores_v2_board ON scores_v2(mode,pack,wpm DESC,accuracy DESC,recorded_at ASC);
