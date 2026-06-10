import Database from "better-sqlite3";
import type { GameStatus, GuessDiff, UserStats } from "@holodle/shared";
import { env } from "../env.js";
import { feedbackKey } from "../game/feedback.js";
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

// Detects the legacy "branch\ngen" formatted group value (e.g.
// "JP\nGen 1"). Newer diffs use just the gen string ("Gen 1"); a
// "\n" in the value means the row was written under the branch+gen
// two-line format. Treats anything weird (non-object, non-string
// value) as suspicious enough to clear.
function hasLegacyGroupValue(group: unknown): boolean {
  if (!group || typeof group !== "object") return false;
  const v = (group as { value?: unknown }).value;
  return typeof v === "string" && v.includes("\n");
}

// Returns true iff `cell` is shaped like an AttrCell ({ value, state }).
// Used to tell apart current diffs (where `branch` is an AttrCell) from
// the pre-merged-group legacy diffs (where `branch` was the raw "JP"
// string at the top of the diff).
function isAttrCell(cell: unknown): boolean {
  return (
    typeof cell === "object" &&
    cell !== null &&
    "value" in cell &&
    "state" in cell
  );
}

// True iff this diff row has the legacy pre-merged-group shape: a raw
// `name` field (pre-Gen), a top-level `generation` string (pre-merged-
// group), or `branch` as a raw string instead of an AttrCell.
function hasLegacyTopLevelFields(first: Record<string, unknown>): boolean {
  if ("name" in first) return true;
  if ("generation" in first) return true;
  // Pre-merged-group diffs had `branch: "JP"` (string). Current diffs
  // have `branch: { value, state }`. Anything else with that field
  // present-but-not-AttrCell is treated as legacy.
  if ("branch" in first && !isAttrCell(first.branch)) return true;
  return false;
}

// True iff this diff row is missing a field the current GuessDiff
// shape requires, or carries the legacy two-line group value.
function isMissingCurrentFields(first: Record<string, unknown>): boolean {
  return (
    !("penlightColor" in first) ||
    !("group" in first) ||
    !("branch" in first) ||
    hasLegacyGroupValue(first.group)
  );
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
        // Each schema swap drops a field and adds another. We treat any
        // of the legacy signals — `.name` (pre-Gen), stray `.generation`
        // or `.branch` (pre-merged-group), or missing `.penlightColor` /
        // `.group` — as definitive evidence of a row that won't render
        // under the current GuessDiff shape.
        if (
          first &&
          (hasLegacyTopLevelFields(first) || isMissingCurrentFields(first))
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
          (hasLegacyTopLevelFields(first) || isMissingCurrentFields(first))
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
  // Stable theme id (see client/src/themes.ts). Validated against the
  // allowlist at the route boundary; this layer just round-trips the
  // string so unknown ids from a future client never crash the server.
  theme: string;
  // Has the user dismissed the first-launch welcome overlay?
  // Server-tracked rather than localStorage-tracked because Discord
  // Activity iframes don't reliably share localStorage across
  // launches (partitioned storage).
  welcomed: boolean;
  // Highest one-time "patch notes" notice version the user has dismissed.
  // The client decides what to show by comparing this against its notice
  // registry's current version (client/src/notices.tsx); this layer just
  // round-trips the integer. 0 = seen nothing.
  lastSeenNoticeVersion: number;
}

const DEFAULT_USER_PREFS: UserPrefs = {
  recapPingMuted: false,
  // "sky" — the original holodle palette, restored as the default.
  // Existing user_prefs rows keep whatever theme they were assigned;
  // brand-new users (no row yet) and pre-theme migrated users get this.
  theme: "sky",
  welcomed: false,
  lastSeenNoticeVersion: 0,
};

// Returns the user's preferences row, falling back to DEFAULT_USER_PREFS
// when no row exists. Never throws — a missing row is the normal state
// for the vast majority of users who haven't touched the settings toggle.
export function getUserPrefs(userId: string): UserPrefs {
  const row = getDb()
    .prepare(
      `SELECT recap_ping_muted, theme, welcomed, last_seen_notice_version FROM user_prefs WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        recap_ping_muted: number;
        theme: string;
        welcomed: number;
        last_seen_notice_version: number;
      }
    | undefined;
  if (!row) return { ...DEFAULT_USER_PREFS };
  return {
    recapPingMuted: row.recap_ping_muted !== 0,
    theme: row.theme || DEFAULT_USER_PREFS.theme,
    welcomed: row.welcomed !== 0,
    lastSeenNoticeVersion: row.last_seen_notice_version ?? 0,
  };
}

// UPSERT the prefs row. Touches updated_at on every write so we have a
// "last interacted with settings" signal if we ever want it.
export function setUserPrefs(userId: string, prefs: UserPrefs): void {
  getDb()
    .prepare(
      `INSERT INTO user_prefs (user_id, recap_ping_muted, theme, welcomed, last_seen_notice_version, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
       ON CONFLICT(user_id) DO UPDATE SET
         recap_ping_muted          = excluded.recap_ping_muted,
         theme                     = excluded.theme,
         welcomed                  = excluded.welcomed,
         last_seen_notice_version  = excluded.last_seen_notice_version,
         updated_at                = excluded.updated_at`,
    )
    .run(
      userId,
      prefs.recapPingMuted ? 1 : 0,
      prefs.theme,
      prefs.welcomed ? 1 : 0,
      prefs.lastSeenNoticeVersion,
    );
}

// Returns the subset of `userIds` whose recap_ping_muted flag is set.
// Used by the recap-build time to decide which mentions should render as
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

// Per-user lifetime guess-count distribution for the result screen: wins
// bucketed by how many guesses they took (1-6) plus a flat losses count.
// Read straight from user_day (the canonical per-game record) so it reflects
// every settled game, including the one that just finished.
export function getUserGuessDistribution(userId: string): {
  wins: Record<number, number>;
  losses: number;
} {
  const rows = getDb()
    .prepare(
      `SELECT status, guesses_json FROM user_day
        WHERE user_id = ? AND status IN ('won','lost')`,
    )
    .all(userId) as Array<{ status: "won" | "lost"; guesses_json: string }>;
  const wins: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let losses = 0;
  for (const r of rows) {
    if (r.status === "lost") {
      losses++;
      continue;
    }
    const len = (JSON.parse(r.guesses_json) as unknown[]).length;
    const bucket = Math.min(Math.max(len, 1), 6);
    wins[bucket] = (wins[bucket] ?? 0) + 1;
  }
  return { wins, losses };
}

export function loadStats(
  userId: string,
): Omit<UserStats, "guessDistribution"> & { lastDayIndex: number | null } {
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

// ─── Daily pick log ──────────────────────────────────────────────────
//
// Backs the weighted random picker (game/dailyPicker.ts::pickAndLogDaily).
// One row per dayIndex; talent_id is the answer for that day. The picker
// is idempotent — first call writes the row, subsequent calls read it.

// Look up the answer recorded for `dayIndex`, or null if none yet.
export function getPickLogEntry(dayIndex: number): string | null {
  const row = getDb()
    .prepare(`SELECT talent_id FROM daily_pick_log WHERE day_index = ?`)
    .get(dayIndex) as { talent_id: string } | undefined;
  return row?.talent_id ?? null;
}

// Returns the set of talent ids picked in the (open) window
// (dayIndex - windowDays, dayIndex). Used to honour the rolling 30-day
// no-repeat rule. Bounded by the window size; never returns null.
export function getPickLogRecent(dayIndex: number, windowDays: number): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT talent_id FROM daily_pick_log
        WHERE day_index < ? AND day_index >= ?`,
    )
    .all(dayIndex, dayIndex - windowDays) as Array<{ talent_id: string }>;
  return new Set(rows.map((r) => r.talent_id));
}

// Returns the day_index → talent_id map for the most-recent `limit`
// entries, ordered newest first. Used as the small-pool fallback when
// every active talent has been picked recently — the picker re-selects
// the LEAST recently-picked among them.
export function getPickLogRecentOrdered(
  dayIndex: number,
  limit: number,
): Array<{ dayIndex: number; talentId: string }> {
  const rows = getDb()
    .prepare(
      `SELECT day_index, talent_id FROM daily_pick_log
        WHERE day_index < ?
        ORDER BY day_index DESC
        LIMIT ?`,
    )
    .all(dayIndex, limit) as Array<{ day_index: number; talent_id: string }>;
  return rows.map((r) => ({ dayIndex: r.day_index, talentId: r.talent_id }));
}

// Returns a Map of talentId → total count of times it has been picked.
// Talents never picked are absent from the map (treated as count 0 by
// the picker, which is the design intent — fresh talents win weighting).
export function getPickLogCounts(): Map<string, number> {
  const rows = getDb()
    .prepare(`SELECT talent_id, COUNT(*) AS c FROM daily_pick_log GROUP BY talent_id`)
    .all() as Array<{ talent_id: string; c: number }>;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.talent_id, r.c);
  return m;
}

// Record this dayIndex → talentId pairing. INSERT OR IGNORE so a race
// between concurrent /api/daily + /api/guess on the same day produces
// exactly one row, not an exception. Returns true if this call wrote
// the row (false means another caller beat us to it).
export function insertPickLog(dayIndex: number, talentId: string): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO daily_pick_log (day_index, talent_id)
       VALUES (?, ?)`,
    )
    .run(dayIndex, talentId);
  return result.changes === 1;
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

// ─── Admin stats aggregation ──────────────────────────────────────────
//
// Functions for querying global usage statistics across all users.

// Returns all settled games (won or lost) with parsed guesses.
export interface SettledGameRow {
  userId: string;
  dayIndex: number;
  guesses: GuessDiff[];
  status: "won" | "lost";
  settledAt: number | null;
}

export function getAllSettledGames(): SettledGameRow[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, day_index, guesses_json, status, settled_at
         FROM user_day
        WHERE status IN ('won','lost')`,
    )
    .all() as Array<{
    user_id: string;
    day_index: number;
    guesses_json: string;
    status: "won" | "lost";
    settled_at: number | null;
  }>;
  return rows.map((r) => ({
    userId: r.user_id,
    dayIndex: r.day_index,
    guesses: JSON.parse(r.guesses_json) as GuessDiff[],
    status: r.status,
    settledAt: r.settled_at,
  }));
}

// Maps each logged day_index to the talent that was the answer that day.
// Shared by the per-answer and guess-frequency aggregations.
function getDayToAnswerMap(): Map<number, string> {
  const rows = getDb()
    .prepare(`SELECT day_index, talent_id FROM daily_pick_log`)
    .all() as Array<{ day_index: number; talent_id: string }>;
  const m = new Map<number, string>();
  for (const r of rows) m.set(r.day_index, r.talent_id);
  return m;
}

// Count how many times each talent was guessed across all games. `total` is
// every guess; `nonAnswer` excludes guesses where the talent WAS that day's
// answer (i.e. the self-answer winning guess) — so it isolates how often a
// talent is used as a strategic/probe guess. Days with no logged answer count
// toward nonAnswer (we can't confirm a self-answer, and it almost never is).
export function getTalentGuessFrequency(): Map<string, { total: number; nonAnswer: number }> {
  const games = getAllSettledGames();
  const dayToAnswer = getDayToAnswerMap();
  const freq = new Map<string, { total: number; nonAnswer: number }>();
  for (const game of games) {
    const answer = dayToAnswer.get(game.dayIndex);
    for (const guess of game.guesses) {
      const e = freq.get(guess.talentId) ?? { total: 0, nonAnswer: 0 };
      e.total++;
      if (guess.talentId !== answer) e.nonAnswer++;
      freq.set(guess.talentId, e);
    }
  }
  return freq;
}

// Returns histogram of games by guess count (1-6).
export function getGuessDistribution(): Record<number, number> {
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const games = getAllSettledGames();
  for (const game of games) {
    const guessCount = Math.min(game.guesses.length, 6) || 1;
    const current = dist[guessCount];
    if (current !== undefined) {
      dist[guessCount] = current + 1;
    }
  }
  return dist;
}

// Guess-count histogram split by outcome. Wins distribute across 1-6; losses
// cluster at 6 (all guesses spent). Powers the stacked win/loss distribution
// chart and the fail-rate read.
export function getGuessDistributionByOutcome(): {
  win: Record<number, number>;
  loss: Record<number, number>;
} {
  const win: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const loss: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const game of getAllSettledGames()) {
    const bucket = Math.min(game.guesses.length, 6) || 1;
    const target = game.status === "won" ? win : loss;
    const current = target[bucket];
    if (current !== undefined) target[bucket] = current + 1;
  }
  return { win, loss };
}

// How often each talent is chosen as the SECOND guess (guesses[1]), across
// settled games with at least two guesses. Sorted most-common first.
export function getSecondGuessFrequency(): Array<{ talentId: string; count: number }> {
  const freq = new Map<string, number>();
  for (const game of getAllSettledGames()) {
    const second = game.guesses[1]?.talentId;
    if (second) freq.set(second, (freq.get(second) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .map(([talentId, count]) => ({ talentId, count }))
    .sort((a, b) => b.count - a.count);
}

// "Given this feedback, what did players guess next?" For every consecutive
// guess pair (g_i, g_{i+1}) in a settled game, key by g_i's feedback pattern
// and tally g_{i+1}'s talent. Returns the top `topN` next-guesses per observed
// pattern. Only patterns that actually occurred are present.
export function getNextGuessByFeedback(
  topN = 8,
): Record<string, Array<{ talentId: string; count: number }>> {
  const byPattern = new Map<string, Map<string, number>>();
  for (const game of getAllSettledGames()) {
    for (let i = 0; i < game.guesses.length - 1; i++) {
      const cur = game.guesses[i];
      const next = game.guesses[i + 1];
      if (!cur || !next) continue;
      const key = feedbackKey(cur);
      let counts = byPattern.get(key);
      if (!counts) {
        counts = new Map<string, number>();
        byPattern.set(key, counts);
      }
      counts.set(next.talentId, (counts.get(next.talentId) ?? 0) + 1);
    }
  }
  const out: Record<string, Array<{ talentId: string; count: number }>> = {};
  for (const [key, counts] of byPattern) {
    out[key] = Array.from(counts.entries())
      .map(([talentId, count]) => ({ talentId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }
  return out;
}

// Aggregate accuracy (% of "equal" state) for each attribute.
export function getAttributeAccuracy(): Record<string, number> {
  const attributes: Array<keyof Omit<GuessDiff, "talentId">> = [
    "branch",
    "group",
    "penlightColor",
    "archetype",
    "height",
    "birthMonth",
  ];
  const accuracy: Record<string, number> = {};

  const games = getAllSettledGames();
  const counts = new Map<string, { correct: number; total: number }>();

  for (const attr of attributes) {
    counts.set(attr, { correct: 0, total: 0 });
  }

  for (const game of games) {
    for (const guess of game.guesses) {
      for (const attr of attributes) {
        const cell = guess[attr];
        if (cell) {
          const key = String(attr);
          const stat = counts.get(key);
          if (stat) { // Check stat is defined to satisfy strict compilers
            stat.total++;
            if (cell.state === "equal") {
              stat.correct++;
            }
          }
        }
      }
    }
  }

  for (const [attr, stat] of counts) {
    accuracy[attr] = stat.total > 0 ? stat.correct / stat.total : 0;
  }

  return accuracy;
}

// Returns games + wins per date (from settled_at timestamps). `wins` powers
// the win-rate-over-time trend; `games` powers the activity chart.
export function getActivityByDate(): Array<{ date: string; games: number; wins: number }> {
  const games = getAllSettledGames();
  const dateMap = new Map<string, { games: number; wins: number }>();

  for (const game of games) {
    if (!game.settledAt) continue;
    // Convert unix timestamp to YYYY-MM-DD
    const date = new Date(game.settledAt * 1000).toISOString().split("T")[0];
    if (date) { // Check that date exists to satisfy strict 'noUncheckedIndexedAccess' compiler rule
      const e = dateMap.get(date) ?? { games: 0, wins: 0 };
      e.games++;
      if (game.status === "won") e.wins++;
      dateMap.set(date, e);
    }
  }

  // Sort by date ascending
  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, games: v.games, wins: v.wins }));
}

// Per-answer-talent difficulty: for each talent that has been a daily answer,
// how many settled games landed on its day, how many were won, the win rate,
// and the average guesses spent. This is the headline "which answers are too
// hard / too easy" signal for tuning the talent pool. Games are joined to the
// day's answer via the day_index → talent_id map in daily_pick_log.
export interface PerAnswerTalentStat {
  talentId: string;
  plays: number;
  wins: number;
  winRate: number; // 0..1
  avgGuesses: number;
}

export function getPerAnswerTalentStats(): PerAnswerTalentStat[] {
  const dayToTalent = getDayToAnswerMap();

  const agg = new Map<string, { plays: number; wins: number; totalGuesses: number }>();
  for (const game of getAllSettledGames()) {
    const talentId = dayToTalent.get(game.dayIndex);
    if (!talentId) continue; // game on a day with no logged answer — skip
    const stat = agg.get(talentId) ?? { plays: 0, wins: 0, totalGuesses: 0 };
    stat.plays++;
    stat.totalGuesses += game.guesses.length;
    if (game.status === "won") stat.wins++;
    agg.set(talentId, stat);
  }

  return Array.from(agg.entries())
    .map(([talentId, s]) => ({
      talentId,
      plays: s.plays,
      wins: s.wins,
      winRate: s.plays > 0 ? s.wins / s.plays : 0,
      avgGuesses: s.plays > 0 ? s.totalGuesses / s.plays : 0,
    }))
    .sort((a, b) => b.plays - a.plays);
}

// Count how many times each talent was used as a player's opening guess.
export function getFirstGuessFrequency(): Map<string, number> {
  const freq = new Map<string, number>();
  for (const game of getAllSettledGames()) {
    const first = game.guesses[0]?.talentId;
    if (first) freq.set(first, (freq.get(first) ?? 0) + 1);
  }
  return freq;
}

// How effective each opening guess is in practice: for every talent used as
// a first guess, the win rate of games that opened with it and the average
// guesses those games took to win. This answers "which openers actually lead
// to the best outcomes" rather than just which are popular. Sorted best-first
// (highest win rate, then most plays as a tie-breaker so a 1-game 100% opener
// doesn't outrank a well-sampled strong one).
export interface FirstGuessEffectivenessStat {
  talentId: string;
  plays: number;
  wins: number;
  winRate: number; // 0..1
  avgGuessesToWin: number; // 0 when no wins
}

export function getFirstGuessEffectiveness(): FirstGuessEffectivenessStat[] {
  const agg = new Map<string, { plays: number; wins: number; winGuesses: number }>();
  for (const game of getAllSettledGames()) {
    const first = game.guesses[0]?.talentId;
    if (!first) continue;
    const stat = agg.get(first) ?? { plays: 0, wins: 0, winGuesses: 0 };
    stat.plays++;
    if (game.status === "won") {
      stat.wins++;
      stat.winGuesses += game.guesses.length;
    }
    agg.set(first, stat);
  }
  return Array.from(agg.entries())
    .map(([talentId, s]) => ({
      talentId,
      plays: s.plays,
      wins: s.wins,
      winRate: s.plays > 0 ? s.wins / s.plays : 0,
      avgGuessesToWin: s.wins > 0 ? s.winGuesses / s.wins : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.plays - a.plays);
}

// Richer sibling of getAttributeAccuracy: tally all three cell states
// (equal / partial / wrong) per attribute so we can see not just how often an
// attribute matches, but how often it gives a partial hint vs a flat miss.
export function getAttributeBreakdown(): Record<
  string,
  { equal: number; partial: number; wrong: number }
> {
  const attributes: Array<keyof Omit<GuessDiff, "talentId">> = [
    "branch",
    "group",
    "penlightColor",
    "archetype",
    "height",
    "birthMonth",
  ];
  const breakdown: Record<string, { equal: number; partial: number; wrong: number }> = {};
  for (const attr of attributes) {
    breakdown[String(attr)] = { equal: 0, partial: 0, wrong: 0 };
  }

  for (const game of getAllSettledGames()) {
    for (const guess of game.guesses) {
      for (const attr of attributes) {
        const cell = guess[attr];
        if (!cell) continue;
        const bucket = breakdown[String(attr)];
        if (!bucket) continue;
        if (cell.state === "equal") bucket.equal++;
        else if (cell.state === "partial") bucket.partial++;
        else bucket.wrong++;
      }
    }
  }

  return breakdown;
}

// Reach across all settled games. Every game (solo or channel-launched)
// lands in user_day — channel play merely mirrors a copy into
// channel_daily_participant for embed rendering — so user_day is the
// complete, de-duplicated source. The channel_id column distinguishes
// channel-launched games (non-null) from solo play (null).
export interface ReachStats {
  uniquePlayers: number;
  distinctChannels: number;
  soloGames: number;
  channelGames: number;
}

export function getReachStats(): ReachStats {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(DISTINCT user_id) AS uniquePlayers,
         COUNT(DISTINCT channel_id) AS distinctChannels,
         COALESCE(SUM(CASE WHEN channel_id IS NULL THEN 1 ELSE 0 END), 0) AS soloGames,
         COALESCE(SUM(CASE WHEN channel_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS channelGames
       FROM user_day
       WHERE status IN ('won','lost')`,
    )
    .get() as {
    uniquePlayers: number;
    distinctChannels: number;
    soloGames: number;
    channelGames: number;
  };
  return {
    uniquePlayers: row.uniquePlayers,
    distinctChannels: row.distinctChannels,
    soloGames: row.soloGames,
    channelGames: row.channelGames,
  };
}