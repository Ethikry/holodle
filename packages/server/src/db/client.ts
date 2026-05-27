import Database from "better-sqlite3";
import type { GameStatus, GuessDiff, UserStats } from "@holodle/shared";
import { env } from "../env.js";
import { ADDITIVE_MIGRATIONS, INDEXES_SQL, TABLES_SQL } from "./schema.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(env.DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // 1) Create tables (idempotent — no-op on existing DBs).
  db.exec(TABLES_SQL);
  // 2) Add columns missing on pre-round-2 databases.
  runAdditiveMigrations(db);
  // 3) Indexes last — some reference columns added in step 2.
  db.exec(INDEXES_SQL);
  // 4) Drop stored guesses_json arrays that predate either the Name → Gen
  //    swap OR the DebutYear → PenlightColor swap. Their AttrCell shape is
  //    missing one of the current columns and the client crashes on render
  //    with "Cannot read properties of undefined (reading 'state')".
  clearStaleDiffShapes(db);
  return db;
}

// One-time data migration: scan every user_day row, drop any whose stored
// guesses_json contains a diff that no longer matches the current shape.
// The row is reset to a fresh playing state — the user effectively gets
// their guesses back. Settled rows (won/lost) also get reset, which loses
// the win/loss record for that legacy day but avoids crashing the client
// when the history is re-rendered. Idempotent: once a row is reset, future
// runs see an empty array and skip it.
function clearStaleDiffShapes(database: Database.Database): void {
  const rows = database
    .prepare("SELECT user_id, day_index, guesses_json FROM user_day")
    .all() as Array<{ user_id: string; day_index: number; guesses_json: string }>;
  const reset = database.prepare(
    `UPDATE user_day
        SET guesses_json     = '[]',
            status           = 'playing',
            settled_at       = NULL,
            exit_embed_posted= 0
      WHERE user_id = ? AND day_index = ?`,
  );
  let cleared = 0;
  for (const row of rows) {
    let stale = false;
    try {
      const guesses = JSON.parse(row.guesses_json) as unknown[];
      if (Array.isArray(guesses) && guesses.length > 0) {
        const first = guesses[0] as Record<string, unknown> | null;
        // Each schema swap drops a field and adds another. We treat any of
        // the legacy signals — `.name` (pre-Gen), missing `.generation`
        // (pre-Gen), or missing `.penlightColor` (pre-Penlight) — as
        // definitive evidence of a row that won't render under the current
        // GuessDiff shape.
        if (
          first &&
          (!("generation" in first) ||
            "name" in first ||
            !("penlightColor" in first))
        ) {
          stale = true;
        }
      }
    } catch {
      stale = true; // unparseable JSON — just clear it
    }
    if (stale) {
      reset.run(row.user_id, row.day_index);
      cleared++;
    }
  }
  if (cleared > 0) {
    console.log(`[db] cleared ${cleared} user_day row(s) with stale GuessDiff shape`);
  }

  // Same thing for channel_daily_participant.guesses_json. Stale rows here
  // would crash the boards panel (PlayerSnapshot board state) and the
  // Discord image renderer (column lookup throws on the missing cell).
  const channelRows = database
    .prepare(
      `SELECT channel_id, puzzle_id, user_id, guesses_json
         FROM channel_daily_participant
        WHERE guesses_json IS NOT NULL`,
    )
    .all() as Array<{
    channel_id: string;
    puzzle_id: string;
    user_id: string;
    guesses_json: string | null;
  }>;
  const resetChannel = database.prepare(
    `UPDATE channel_daily_participant
        SET guesses_used = 0,
            guesses_json = '[]',
            status       = 'playing'
      WHERE channel_id = ? AND puzzle_id = ? AND user_id = ?`,
  );
  let clearedChannel = 0;
  for (const row of channelRows) {
    if (!row.guesses_json) continue;
    let stale = false;
    try {
      const guesses = JSON.parse(row.guesses_json) as unknown[];
      if (Array.isArray(guesses) && guesses.length > 0) {
        const first = guesses[0] as Record<string, unknown> | null;
        if (
          first &&
          (!("generation" in first) ||
            "name" in first ||
            !("penlightColor" in first))
        ) {
          stale = true;
        }
      }
    } catch {
      stale = true;
    }
    if (stale) {
      resetChannel.run(row.channel_id, row.puzzle_id, row.user_id);
      clearedChannel++;
    }
  }
  if (clearedChannel > 0) {
    console.log(
      `[db] cleared ${clearedChannel} channel_daily_participant row(s) with stale GuessDiff shape`,
    );
  }
}

// Add any columns from ADDITIVE_MIGRATIONS that are missing on existing
// tables. CREATE TABLE IF NOT EXISTS doesn't touch existing tables, so
// pre-round-2 databases need this top-up.
function runAdditiveMigrations(database: Database.Database): void {
  for (const { table, column, ddl } of ADDITIVE_MIGRATIONS) {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      database.exec(ddl);
    }
  }
}

export interface UserDayRow {
  userId: string;
  dayIndex: number;
  guesses: GuessDiff[];
  status: GameStatus;
  channelId: string | null;
  tz: string | null;
  settledAt: number | null;
  exitEmbedPosted: boolean;
  // Test-guild /endless counter. Added to dayIndex when picking this user's
  // answer, so each /endless invocation rotates them to a fresh talent.
  endlessOffset: number;
}

export function loadUserDay(userId: string, dayIndex: number): UserDayRow {
  const row = getDb()
    .prepare(
      `SELECT guesses_json, status, channel_id, tz, settled_at, exit_embed_posted, endless_offset
         FROM user_day WHERE user_id = ? AND day_index = ?`,
    )
    .get(userId, dayIndex) as
    | {
        guesses_json: string;
        status: GameStatus;
        channel_id: string | null;
        tz: string | null;
        settled_at: number | null;
        exit_embed_posted: number;
        endless_offset: number;
      }
    | undefined;
  if (!row) {
    return {
      userId,
      dayIndex,
      guesses: [],
      status: "playing",
      channelId: null,
      tz: null,
      settledAt: null,
      exitEmbedPosted: false,
      endlessOffset: 0,
    };
  }
  return {
    userId,
    dayIndex,
    guesses: JSON.parse(row.guesses_json) as GuessDiff[],
    status: row.status,
    channelId: row.channel_id,
    tz: row.tz,
    settledAt: row.settled_at,
    exitEmbedPosted: row.exit_embed_posted !== 0,
    endlessOffset: row.endless_offset ?? 0,
  };
}

export function saveUserDay(row: UserDayRow): void {
  getDb()
    .prepare(
      `INSERT INTO user_day
         (user_id, day_index, guesses_json, status, updated_at, channel_id, tz, settled_at, exit_embed_posted, endless_offset)
       VALUES (?, ?, ?, ?, strftime('%s','now'), ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day_index) DO UPDATE SET
         guesses_json      = excluded.guesses_json,
         status            = excluded.status,
         updated_at        = excluded.updated_at,
         -- channel_id and tz are sticky: keep the previously-stored value
         -- when the new value is NULL (e.g. an unauthenticated retry).
         channel_id        = COALESCE(excluded.channel_id, user_day.channel_id),
         tz                = COALESCE(excluded.tz, user_day.tz),
         settled_at        = COALESCE(excluded.settled_at, user_day.settled_at),
         exit_embed_posted = excluded.exit_embed_posted,
         endless_offset    = excluded.endless_offset`,
    )
    .run(
      row.userId,
      row.dayIndex,
      JSON.stringify(row.guesses),
      row.status,
      row.channelId,
      row.tz,
      row.settledAt,
      row.exitEmbedPosted ? 1 : 0,
      row.endlessOffset,
    );
}

// Test-guild only. Advances the user's endless offset for `dayIndex` by one
// and resets the row to a fresh playing state — preserves channel_id/tz so
// the next guess still ties back to the channel embed, but clears guesses,
// status, settled_at, and the exit-embed flag. Returns the new offset.
export function advanceEndless(userId: string, dayIndex: number): number {
  const db = getDb();
  const row = loadUserDay(userId, dayIndex);
  const nextOffset = row.endlessOffset + 1;
  db.prepare(
    `INSERT INTO user_day
       (user_id, day_index, guesses_json, status, updated_at, channel_id, tz, settled_at, exit_embed_posted, endless_offset)
     VALUES (?, ?, '[]', 'playing', strftime('%s','now'), ?, ?, NULL, 0, ?)
     ON CONFLICT(user_id, day_index) DO UPDATE SET
       guesses_json      = '[]',
       status            = 'playing',
       updated_at        = strftime('%s','now'),
       settled_at        = NULL,
       exit_embed_posted = 0,
       endless_offset    = excluded.endless_offset`,
  ).run(userId, dayIndex, row.channelId, row.tz, nextOffset);
  return nextOffset;
}

// Test-guild only. Resets every user_day row whose day_index falls within
// the cross-tz window for "today" (yesterday-UTC through tomorrow-UTC, so
// JST and Pacific players in flight at the same wall-clock moment are
// covered). Returns the number of user_day + channel_daily_participant
// rows wiped. Stats (user_stats) intentionally aren't touched — a hard
// reset of streaks shouldn't be a side effect of a "let me replay today"
// command.
export function resetToday(todayUtcDayIndex: number): {
  userDays: number;
  channelRows: number;
} {
  const db = getDb();
  const lo = todayUtcDayIndex - 1;
  const hi = todayUtcDayIndex + 1;
  const dayResult = db
    .prepare(
      `UPDATE user_day
          SET guesses_json     = '[]',
              status           = 'playing',
              settled_at       = NULL,
              exit_embed_posted= 0,
              endless_offset   = 0,
              updated_at       = strftime('%s','now')
        WHERE day_index BETWEEN ? AND ?`,
    )
    .run(lo, hi);
  // channel_daily_participant is keyed by puzzle_id (YYYY-MM-DD), not by
  // day_index. We don't have a direct dayIndex→puzzleId mapping here; use
  // the `updated_at` proxy on user_day to find the puzzleIds we just touched,
  // then drop all matching channel rows. Simpler: just clear every channel
  // participant row from the last 48h.
  const channelResult = db
    .prepare(
      `UPDATE channel_daily_participant
          SET guesses_used = 0,
              guesses_json = '[]',
              status       = 'playing'
        WHERE joined_at >= strftime('%s','now') - 48*3600`,
    )
    .run();
  return {
    userDays: dayResult.changes,
    channelRows: channelResult.changes,
  };
}

// Returns the IANA tz this user most-recently played from, or null if no
// /api/guess has ever recorded one. Used by the interactions handler so the
// launch-time channel puzzle id matches the puzzle the user actually plays.
export function getLatestUserTz(userId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT tz FROM user_day
        WHERE user_id = ? AND tz IS NOT NULL
        ORDER BY day_index DESC LIMIT 1`,
    )
    .get(userId) as { tz: string } | undefined;
  return row?.tz ?? null;
}

export interface UserPrefs {
  recapPingMuted: boolean;
}

const DEFAULT_USER_PREFS: UserPrefs = { recapPingMuted: false };

// Returns the user's preferences row, falling back to DEFAULT_USER_PREFS
// when no row exists. Never throws — a missing row is the normal state
// for the vast majority of users who haven't touched the settings toggle.
export function getUserPrefs(userId: string): UserPrefs {
  const row = getDb()
    .prepare(`SELECT recap_ping_muted FROM user_prefs WHERE user_id = ?`)
    .get(userId) as { recap_ping_muted: number } | undefined;
  if (!row) return { ...DEFAULT_USER_PREFS };
  return { recapPingMuted: row.recap_ping_muted !== 0 };
}

// UPSERT the prefs row. Touches updated_at on every write so we have a
// "last interacted with settings" signal if we ever want it.
export function setUserPrefs(userId: string, prefs: UserPrefs): void {
  getDb()
    .prepare(
      `INSERT INTO user_prefs (user_id, recap_ping_muted, updated_at)
       VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(user_id) DO UPDATE SET
         recap_ping_muted = excluded.recap_ping_muted,
         updated_at       = excluded.updated_at`,
    )
    .run(userId, prefs.recapPingMuted ? 1 : 0);
}

// Returns the subset of `userIds` whose recap_ping_muted flag is set.
// Used at recap-build time to decide which mentions should render as
// plain text vs as `<@id>` chips. Empty input → empty set, no query.
export function getMutedRecapUserIds(userIds: string[]): Set<string> {
  if (userIds.length === 0) return new Set();
  const placeholders = userIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT user_id FROM user_prefs
        WHERE recap_ping_muted = 1
          AND user_id IN (${placeholders})`,
    )
    .all(...userIds) as Array<{ user_id: string }>;
  return new Set(rows.map((r) => r.user_id));
}

export function markExitEmbedPosted(userId: string, dayIndex: number): void {
  getDb()
    .prepare(
      `UPDATE user_day SET exit_embed_posted = 1 WHERE user_id = ? AND day_index = ?`,
    )
    .run(userId, dayIndex);
}

export function loadStats(userId: string): UserStats & { lastDayIndex: number | null } {
  const row = getDb()
    .prepare(
      `SELECT streak, best, played, wins, last_day_index FROM user_stats WHERE user_id = ?`,
    )
    .get(userId) as
    | { streak: number; best: number; played: number; wins: number; last_day_index: number | null }
    | undefined;
  if (!row) {
    return { streak: 0, best: 0, played: 0, winRate: 0, lastDayIndex: null };
  }
  const winRate = row.played === 0 ? 0 : row.wins / row.played;
  return {
    streak: row.streak,
    best: row.best,
    played: row.played,
    winRate,
    lastDayIndex: row.last_day_index,
  };
}

// Update aggregated stats when a day settles. Idempotent per (user, dayIndex).
export function settleDay(userId: string, dayIndex: number, won: boolean): void {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT streak, best, played, wins, last_day_index FROM user_stats WHERE user_id = ?`,
    )
    .get(userId) as
    | { streak: number; best: number; played: number; wins: number; last_day_index: number | null }
    | undefined;

  // Guard against double-settle. If last_day_index === dayIndex, this day was
  // already counted — bail.
  if (existing && existing.last_day_index === dayIndex) return;

  let streak: number;
  if (won) {
    if (existing && existing.last_day_index === dayIndex - 1) {
      streak = existing.streak + 1;
    } else {
      streak = 1;
    }
  } else {
    streak = 0;
  }

  const played = (existing?.played ?? 0) + 1;
  const wins = (existing?.wins ?? 0) + (won ? 1 : 0);
  const best = Math.max(existing?.best ?? 0, streak);

  db.prepare(
    `INSERT INTO user_stats (user_id, streak, best, played, wins, last_day_index)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       streak = excluded.streak,
       best = excluded.best,
       played = excluded.played,
       wins = excluded.wins,
       last_day_index = excluded.last_day_index`,
  ).run(userId, streak, best, played, wins, dayIndex);
}

// Recap idempotency: returns true if this insert was the first for the
// (channel, fireTimestamp) pair, false if it had already been recapped.
export function tryClaimRecap(channelId: string, firedAt: number): boolean {
  const result = getDb()
    .prepare(
      `INSERT INTO daily_recaps (channel_id, fired_at) VALUES (?, ?)
       ON CONFLICT (channel_id, fired_at) DO NOTHING`,
    )
    .run(channelId, firedAt);
  return result.changes === 1;
}

// Settled rows in a window. Used by the recap scheduler.
export interface SettledRow {
  userId: string;
  dayIndex: number;
  guessesUsed: number;
  status: "won" | "lost";
  channelId: string;
  tz: string | null;
}

export function settledRowsBetween(startSec: number, endSec: number): SettledRow[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, day_index, guesses_json, status, channel_id, tz
         FROM user_day
        WHERE status IN ('won','lost')
          AND channel_id IS NOT NULL
          AND settled_at IS NOT NULL
          AND settled_at >= ?
          AND settled_at <  ?`,
    )
    .all(startSec, endSec) as Array<{
    user_id: string;
    day_index: number;
    guesses_json: string;
    status: "won" | "lost";
    channel_id: string;
    tz: string | null;
  }>;
  return rows.map((r) => {
    const guesses = JSON.parse(r.guesses_json) as GuessDiff[];
    return {
      userId: r.user_id,
      dayIndex: r.day_index,
      guessesUsed: guesses.length,
      status: r.status,
      channelId: r.channel_id,
      tz: r.tz,
    };
  });
}
