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
