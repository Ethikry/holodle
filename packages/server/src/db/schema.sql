-- Per-user state for a single UTC day's puzzle.
CREATE TABLE IF NOT EXISTS user_day (
  user_id      TEXT NOT NULL,
  day_index    INTEGER NOT NULL,
  guesses_json TEXT NOT NULL DEFAULT '[]',  -- JSON array of GuessDiff
  status       TEXT NOT NULL DEFAULT 'playing',  -- playing | won | lost
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, day_index)
);

-- Aggregated stats per user. Updated when a day settles (won/lost).
CREATE TABLE IF NOT EXISTS user_stats (
  user_id        TEXT PRIMARY KEY,
  streak         INTEGER NOT NULL DEFAULT 0,
  best           INTEGER NOT NULL DEFAULT 0,
  played         INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  last_day_index INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_day_day ON user_day(day_index);
