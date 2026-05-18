// SQLite schema, inlined as a string so it travels with the compiled JS
// without a separate file-copy step in tsc/Docker/Fly.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_day (
  user_id      TEXT NOT NULL,
  day_index    INTEGER NOT NULL,
  guesses_json TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'playing',
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, day_index)
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id        TEXT PRIMARY KEY,
  streak         INTEGER NOT NULL DEFAULT 0,
  best           INTEGER NOT NULL DEFAULT 0,
  played         INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  last_day_index INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_day_day ON user_day(day_index);
`;
