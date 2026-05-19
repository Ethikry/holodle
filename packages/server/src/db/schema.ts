// SQLite schema, inlined as a string so it travels with the compiled JS
// without a separate file-copy step in tsc/Docker/Fly.
//
// For tables that already exist in the wild (post-v0.1 databases), CREATE
// TABLE IF NOT EXISTS won't add new columns. The migration helper in
// db/client.ts uses PRAGMA table_info + ALTER TABLE to top up missing
// columns at boot.
export const SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS idx_user_day_day ON user_day(day_index);
CREATE INDEX IF NOT EXISTS idx_user_day_settled ON user_day(settled_at);
`;

// Additive columns that need ALTER TABLE on databases predating round-2.
// Each entry: { table, column, ddl }. Run via the migration helper in
// db/client.ts at boot.
export const ADDITIVE_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "user_day", column: "channel_id", ddl: "ALTER TABLE user_day ADD COLUMN channel_id TEXT" },
  { table: "user_day", column: "tz", ddl: "ALTER TABLE user_day ADD COLUMN tz TEXT" },
  { table: "user_day", column: "settled_at", ddl: "ALTER TABLE user_day ADD COLUMN settled_at INTEGER" },
  {
    table: "user_day",
    column: "exit_embed_posted",
    ddl: "ALTER TABLE user_day ADD COLUMN exit_embed_posted INTEGER NOT NULL DEFAULT 0",
  },
];
