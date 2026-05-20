// SQLite schema, inlined as a string so it travels with the compiled JS
// without a separate file-copy step in tsc/Docker/Fly.
//
// Boot order in db/client.ts:
//   1) exec TABLES_SQL — creates tables (CREATE IF NOT EXISTS, idempotent).
//   2) runAdditiveMigrations — ALTER TABLE adds columns missing on
//      pre-round-2 databases (CREATE TABLE IF NOT EXISTS won't touch
//      existing tables).
//   3) exec INDEXES_SQL — creates indexes, including ones that reference
//      columns added in step 2. Must run AFTER the ALTERs.
// Splitting steps 1 and 3 prevents the "no such column: settled_at" error
// you'd otherwise get on a pre-existing database, where the index DDL fires
// against the old, un-migrated table.
export const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS user_day (
  user_id           TEXT NOT NULL,
  day_index         INTEGER NOT NULL,
  guesses_json      TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'playing',
  updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  channel_id        TEXT,
  tz                TEXT,
  settled_at        INTEGER,
  exit_embed_posted INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS daily_recaps (
  channel_id TEXT NOT NULL,
  fired_at   INTEGER NOT NULL,
  PRIMARY KEY (channel_id, fired_at)
);

CREATE TABLE IF NOT EXISTS channel_daily_state (
  channel_id           TEXT NOT NULL,
  puzzle_id            TEXT NOT NULL,
  message_id           TEXT,
  latest_token         TEXT NOT NULL,
  latest_token_app_id  TEXT NOT NULL,
  latest_token_exp     INTEGER NOT NULL,
  PRIMARY KEY (channel_id, puzzle_id)
);

CREATE TABLE IF NOT EXISTS channel_recap_posted (
  channel_id TEXT NOT NULL,
  puzzle_id  TEXT NOT NULL,
  PRIMARY KEY (channel_id, puzzle_id)
);

CREATE TABLE IF NOT EXISTS channel_daily_participant (
  channel_id   TEXT NOT NULL,
  puzzle_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  guesses_used INTEGER NOT NULL DEFAULT 0,
  guesses_json TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'playing',
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (channel_id, puzzle_id, user_id)
);
`;

export const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_user_day_day ON user_day(day_index);
CREATE INDEX IF NOT EXISTS idx_user_day_settled ON user_day(settled_at);
CREATE INDEX IF NOT EXISTS idx_channel_participant_channel_puzzle
  ON channel_daily_participant(channel_id, puzzle_id);
`;

// Additive columns that need ALTER TABLE on databases predating round-2.
// Order matters only insofar as the index step assumes these columns exist.
export const ADDITIVE_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "user_day", column: "channel_id", ddl: "ALTER TABLE user_day ADD COLUMN channel_id TEXT" },
  { table: "user_day", column: "tz", ddl: "ALTER TABLE user_day ADD COLUMN tz TEXT" },
  { table: "user_day", column: "settled_at", ddl: "ALTER TABLE user_day ADD COLUMN settled_at INTEGER" },
  {
    table: "user_day",
    column: "exit_embed_posted",
    ddl: "ALTER TABLE user_day ADD COLUMN exit_embed_posted INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "channel_daily_participant",
    column: "avatar_url",
    ddl: "ALTER TABLE channel_daily_participant ADD COLUMN avatar_url TEXT",
  },
  {
    table: "channel_daily_participant",
    column: "guesses_json",
    ddl: "ALTER TABLE channel_daily_participant ADD COLUMN guesses_json TEXT NOT NULL DEFAULT '[]'",
  },
];
