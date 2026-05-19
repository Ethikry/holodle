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
  return db;
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
}

export function loadUserDay(userId: string, dayIndex: number): UserDayRow {
  const row = getDb()
    .prepare(
      `SELECT guesses_json, status, channel_id, tz, settled_at, exit_embed_posted
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
  };
}

export function saveUserDay(row: UserDayRow): void {
  getDb()
    .prepare(
      `INSERT INTO user_day
         (user_id, day_index, guesses_json, status, updated_at, channel_id, tz, settled_at, exit_embed_posted)
       VALUES (?, ?, ?, ?, strftime('%s','now'), ?, ?, ?, ?)
       ON CONFLICT(user_id, day_index) DO UPDATE SET
         guesses_json      = excluded.guesses_json,
         status            = excluded.status,
         updated_at        = excluded.updated_at,
         -- channel_id and tz are sticky: keep the previously-stored value
         -- when the new value is NULL (e.g. an unauthenticated retry).
         channel_id        = COALESCE(excluded.channel_id, user_day.channel_id),
         tz                = COALESCE(excluded.tz, user_day.tz),
         settled_at        = COALESCE(excluded.settled_at, user_day.settled_at),
         exit_embed_posted = excluded.exit_embed_posted`,
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
    );
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
