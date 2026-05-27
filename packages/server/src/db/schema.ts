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
  -- Counts how many times this user has invoked /endless on this day_index.
  -- The active answer is picked at (dayIndex + endlessOffset), so each call
  -- advances them to the next shuffled-pool position. Always 0 in normal
  -- play; only the test-guild /endless command mutates it.
  endless_offset    INTEGER NOT NULL DEFAULT 0,
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
  -- Epoch seconds. Set when message_id is first written; tracked so we can
  -- decide whether to PATCH the existing embed in place or post a new one
  -- as a reply (see isStaleMessage in channelState.ts). NULL when no
  -- message has been posted yet for this puzzle.
  message_created_at   INTEGER,
  message_updated_at   INTEGER,
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

-- Per-user preferences. One row per user_id. New columns should land here
-- with sensible DEFAULTs so we don't need an additive migration for every
-- pref we add. recap_ping_muted=1 causes the daily recap to render this
-- user's display name as plain text instead of a <@id> mention chip.
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id          TEXT PRIMARY KEY,
  recap_ping_muted INTEGER NOT NULL DEFAULT 0,
  theme            TEXT NOT NULL DEFAULT 'sky',
  updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
  -- IANA timezone the participant was playing from (latest known). Used by
  -- the recap eligibility gate so a JP-launched recap doesn't fire while
  -- a US-CST participant is still mid-day. NULL on legacy rows; the gate
  -- treats NULL as the most conservative tz (UTC-12).
  tz           TEXT,
  PRIMARY KEY (channel_id, puzzle_id, user_id)
);

-- Per-day puzzle answer log. One row per dayIndex. Drives the weighted
-- random picker in dailyPicker.ts: the picker reads this table to (a)
-- skip talents picked within the 30-day window and (b) bias selection
-- toward talents with the lowest historical count. First write wins —
-- once a dayIndex has a row, subsequent calls are idempotent and just
-- return the stored talent.
CREATE TABLE IF NOT EXISTS daily_pick_log (
  day_index  INTEGER PRIMARY KEY,
  talent_id  TEXT NOT NULL,
  logged_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
`;

export const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_user_day_day ON user_day(day_index);
CREATE INDEX IF NOT EXISTS idx_user_day_settled ON user_day(settled_at);
CREATE INDEX IF NOT EXISTS idx_channel_participant_channel_puzzle
  ON channel_daily_participant(channel_id, puzzle_id);
-- Count-by-talent lookups for the weighted picker.
CREATE INDEX IF NOT EXISTS idx_pick_log_talent ON daily_pick_log(talent_id);
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
  {
    table: "channel_daily_state",
    column: "message_created_at",
    ddl: "ALTER TABLE channel_daily_state ADD COLUMN message_created_at INTEGER",
  },
  {
    table: "channel_daily_state",
    column: "message_updated_at",
    ddl: "ALTER TABLE channel_daily_state ADD COLUMN message_updated_at INTEGER",
  },
  {
    table: "user_day",
    column: "endless_offset",
    ddl: "ALTER TABLE user_day ADD COLUMN endless_offset INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "channel_daily_participant",
    column: "tz",
    ddl: "ALTER TABLE channel_daily_participant ADD COLUMN tz TEXT",
  },
  // Theming: visible-only client preference, but persisted server-side so
  // it survives device reinstalls. Older user_prefs rows (created before
  // the theme picker shipped) need the column added.
  {
    table: "user_prefs",
    column: "theme",
    ddl: "ALTER TABLE user_prefs ADD COLUMN theme TEXT NOT NULL DEFAULT 'sky'",
  },
];
